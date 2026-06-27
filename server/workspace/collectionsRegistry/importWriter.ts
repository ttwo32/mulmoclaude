// Import a registry collection into the active workspace. The writer fetches the
// bundle, re-validates the schema with the host's own gates (R7 — the index is not
// a trust boundary), writes the bundle into .claude/skills/<localSlug>/ with a
// host-owned dataPath (R3), materializes any seed records into that dataPath when
// it's empty, and records provenance in .origin.json for update detection (R5/R8).
//
// `writeImportedCollection` takes the already-fetched bundle + an explicit
// workspaceRoot/clock so it is unit-testable against a temp workspace with no
// network; `performImport` is the thin glue that fetches and calls it.

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { acceptParsedSchema, CollectionSchemaZ, safeRecordId } from "@mulmoclaude/core/collection/server";
import type { CollectionSchema } from "@mulmoclaude/core/collection";

import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { isRecord } from "../../utils/types.js";
import { projectSkillDir } from "../skills/paths.js";
import { fetchRegistryIndex } from "./client.js";
import { fetchBundle, fetchManifest, normalizedDataPath } from "./importCollection.js";
import type { RegistryCollectionEntry } from "./registryIndex.js";

const ORIGIN_FILE = ".origin.json";
const SEED_PREFIX = "seed/items/";
const SCHEMA_FILE = "schema.json";
const STATUS_NOT_FOUND = 404;
const STATUS_CONFLICT = 409;
const STATUS_UNPROCESSABLE = 422;

export interface ImportOrigin {
  registry: string;
  author: string;
  slug: string;
  version: string;
  contentSha: string;
  importedAt: string;
}

export type ImportResult =
  | { ok: true; localSlug: string; updated: boolean; seedWritten: number; seedSkipped: boolean }
  | { ok: false; status: number; error: string };

async function statType(target: string): Promise<"dir" | "other" | "absent"> {
  try {
    return (await stat(target)).isDirectory() ? "dir" : "other";
  } catch (err) {
    // Only a genuinely missing path is "absent". ENOTDIR (an ancestor is a file),
    // EACCES, etc. are path-shape conflicts that mkdir would later throw on, so
    // surface them as "other" for deterministic 409 handling.
    if (isRecord(err) && err.code === "ENOENT") return "absent";
    return "other";
  }
}

async function isEmptyOrAbsentDir(target: string): Promise<boolean> {
  try {
    return (await readdir(target)).length === 0;
  } catch {
    return true;
  }
}

function originMatches(origin: unknown, registry: string, author: string, slug: string): boolean {
  return isRecord(origin) && origin.registry === registry && origin.author === author && origin.slug === slug;
}

async function readOrigin(targetDir: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(targetDir, ORIGIN_FILE), "utf-8"));
  } catch {
    return null;
  }
}

type TargetResolution = { targetDir: string; updated: boolean } | { conflict: string };

async function resolveTarget(workspaceRoot: string, registry: string, entry: RegistryCollectionEntry): Promise<TargetResolution> {
  const targetDir = projectSkillDir(workspaceRoot, entry.slug);
  const kind = await statType(targetDir);
  if (kind === "absent") return { targetDir, updated: false };
  if (kind === "other") return { conflict: `path for slug '${entry.slug}' exists and is not a directory` };
  if (originMatches(await readOrigin(targetDir), registry, entry.author, entry.slug)) return { targetDir, updated: true };
  return { conflict: `a different collection already occupies slug '${entry.slug}'` };
}

type SchemaResolution = { schema: CollectionSchema } | { error: string };

function validateAndNormalize(bundle: Map<string, string>, localSlug: string, workspaceRoot: string): SchemaResolution {
  const schemaText = bundle.get(SCHEMA_FILE);
  if (schemaText === undefined) return { error: "bundle is missing schema.json" };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(schemaText);
  } catch {
    return { error: "schema.json is not valid JSON" };
  }
  const parsed = CollectionSchemaZ.safeParse(parsedJson);
  if (!parsed.success) return { error: `schema.json failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  const schema: CollectionSchema = { ...parsed.data, dataPath: normalizedDataPath(localSlug) };
  const acceptance = acceptParsedSchema(schema, { source: "project", workspaceRoot });
  if (!acceptance.ok) return { error: `schema.json rejected: ${acceptance.reason}` };
  return { schema };
}

async function writeBundleFiles(targetDir: string, bundle: Map<string, string>, schema: CollectionSchema): Promise<void> {
  for (const [rel, content] of bundle) {
    if (rel.startsWith(SEED_PREFIX)) continue; // seed goes to dataPath, not the skill dir
    const dest = path.join(targetDir, ...rel.split("/"));
    if (dest !== targetDir && !dest.startsWith(targetDir + path.sep)) continue; // belt-and-suspenders (paths pre-validated)
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, rel === SCHEMA_FILE ? `${JSON.stringify(schema, null, 2)}\n` : content, "utf-8");
  }
}

async function materializeSeed(dataDir: string, bundle: Map<string, string>): Promise<{ written: number; skipped: boolean }> {
  const seedEntries = [...bundle].filter(([rel]) => rel.startsWith(SEED_PREFIX));
  if (seedEntries.length === 0) return { written: 0, skipped: false };
  if (!(await isEmptyOrAbsentDir(dataDir))) return { written: 0, skipped: true };
  await mkdir(dataDir, { recursive: true });
  let written = 0;
  for (const [rel, content] of seedEntries) {
    const fileName = rel.slice(SEED_PREFIX.length);
    if (fileName.includes("/") || safeRecordId(fileName.replace(/\.json$/, "")) === null) {
      log.warn("collections-registry", "skipped unsafe seed record", { rel });
      continue;
    }
    await writeFile(path.join(dataDir, fileName), content, "utf-8");
    written += 1;
  }
  return { written, skipped: false };
}

export async function writeImportedCollection(params: {
  registry: string;
  entry: RegistryCollectionEntry;
  bundle: Map<string, string>;
  workspaceRoot: string;
  nowIso: string;
}): Promise<ImportResult> {
  const { registry, entry, bundle, workspaceRoot, nowIso } = params;
  const target = await resolveTarget(workspaceRoot, registry, entry);
  if ("conflict" in target) return { ok: false, status: STATUS_CONFLICT, error: target.conflict };

  // Pre-flight the data dir before schema validation: a non-directory at the dataPath
  // (or an ancestor that's a file → ENOTDIR) would otherwise surface as a generic 500
  // on mkdir. statType maps ENOTDIR/other to a deterministic 409 path-shape conflict.
  const dataDir = path.join(workspaceRoot, ...normalizedDataPath(entry.slug).split("/"));
  if ((await statType(dataDir)) === "other") {
    return { ok: false, status: STATUS_CONFLICT, error: `data path for slug '${entry.slug}' exists and is not a directory` };
  }

  const validated = validateAndNormalize(bundle, entry.slug, workspaceRoot);
  if ("error" in validated) return { ok: false, status: STATUS_UNPROCESSABLE, error: validated.error };

  // Build the replacement fully in a hidden sibling staging dir (bundle + origin),
  // so the prior install is untouched until everything is durably written. Leftover
  // staging/backup dirs from a crashed import are cleaned first, keeping retries possible.
  const skillsParent = path.dirname(target.targetDir);
  const staging = path.join(skillsParent, `.importing-${entry.slug}`);
  const backup = path.join(skillsParent, `.backup-${entry.slug}`);
  await rm(staging, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await writeBundleFiles(staging, bundle, validated.schema);
  const origin: ImportOrigin = { registry, author: entry.author, slug: entry.slug, version: entry.version, contentSha: entry.contentSha, importedAt: nowIso };
  await writeFileAtomic(path.join(staging, ORIGIN_FILE), `${JSON.stringify(origin, null, 2)}\n`);

  // Swap with rollback: move the old install aside (rename), move the new in (rename),
  // then discard the old. If the swap fails, restore the old so we never end up with no
  // installed collection. Records live in dataPath (a separate dir) and are untouched.
  if (target.updated) await rename(target.targetDir, backup);
  try {
    await rename(staging, target.targetDir);
  } catch (err) {
    if (target.updated) await rename(backup, target.targetDir).catch(() => undefined);
    throw err;
  }
  await rm(backup, { recursive: true, force: true });

  const seed = await materializeSeed(dataDir, bundle);
  return { ok: true, localSlug: entry.slug, updated: target.updated, seedWritten: seed.written, seedSkipped: seed.skipped };
}

export async function performImport(author: string, slug: string, workspaceRoot: string): Promise<ImportResult> {
  const indexResult = await fetchRegistryIndex();
  if (!indexResult.ok) return { ok: false, status: indexResult.status, error: indexResult.error };
  const entry = indexResult.index.collections.find((candidate) => candidate.author === author && candidate.slug === slug);
  if (!entry) return { ok: false, status: STATUS_NOT_FOUND, error: `unknown collection: ${author}/${slug}` };
  const manifest = await fetchManifest(entry);
  if (!manifest.ok) return { ok: false, status: manifest.status, error: manifest.error };
  const bundle = await fetchBundle(entry, manifest.files);
  if (!bundle.ok) return { ok: false, status: bundle.status, error: bundle.error };
  try {
    return await writeImportedCollection({
      registry: indexResult.index.registry,
      entry,
      bundle: bundle.files,
      workspaceRoot,
      nowIso: new Date().toISOString(),
    });
  } catch (err) {
    log.warn("collections-registry", "import write failed", { author, slug, error: errorMessage(err) });
    return { ok: false, status: 500, error: `import failed: ${errorMessage(err)}` };
  }
}
