// CRUD for the non-skill Feeds registry. A feed's schema.json IS a
// CollectionSchema-with-`ingest`, validated through the SAME
// `CollectionSchemaZ` the skill collections use (single source of
// truth). Records are stored + rendered by the collections layer; this
// module only owns the schema file + the per-feed state file.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { ZodIssue } from "zod";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { log } from "../../system/logger/index.js";
import { workspacePath } from "../workspace.js";
import { CollectionSchemaZ, discoverCollections, type LoadedCollection } from "../collections/index.js";
import { SCHEMA_FILE, resolveDataDir, safeSlugName } from "../collections/paths.js";
import type { CollectionSchema } from "../collections/types.js";
import { feedDir } from "./paths.js";

export type WriteFeedResult = { kind: "ok"; slug: string } | { kind: "error"; slug: string; message: string };

function err(slug: string, message: string): WriteFeedResult {
  return { kind: "error", slug, message };
}

function formatIssues(issues: ZodIssue[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Feed-specific checks beyond the shared schema validation: it must
 *  carry an `ingest` block and a primaryKey field flagged `primary`
 *  (the same primaryKey rule `loadOneCollection` enforces, surfaced
 *  here so register fails loudly instead of silently not discovering). */
function feedSchemaProblem(schema: CollectionSchema): string | null {
  if (!schema.ingest) return "a feed schema must declare an `ingest` block (kind, url, schedule, map)";
  const primaryField = schema.fields[schema.primaryKey];
  if (!primaryField) return `primaryKey '${schema.primaryKey}' is not one of the declared fields`;
  if (primaryField.primary !== true) return `the primaryKey field '${schema.primaryKey}' must be flagged \`primary: true\``;
  return null;
}

/** Fill the cosmetic / boilerplate top-level fields the caller can omit:
 *  `icon` defaults to a feed glyph, `dataPath` to `data/feeds/<slug>`.
 *  Explicit values always win; missing/blank ones are filled. Keeps the
 *  LLM's register payload minimal (it only must author fields + ingest).
 *  Non-object input is returned untouched so the Zod error stays clear. */
function applyFeedSchemaDefaults(schema: unknown, slug: string): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const obj = schema as Record<string, unknown>;
  const out = { ...obj };
  if (typeof out.icon !== "string" || out.icon.trim() === "") out.icon = "dynamic_feed";
  if (typeof out.dataPath !== "string" || out.dataPath.trim() === "") out.dataPath = `data/feeds/${slug}`;
  return out;
}

/** Validate + persist a feed's schema.json. Returns a typed result so
 *  the route can relay a useful message to the LLM. */
export async function writeFeed(workspaceRoot: string, slug: string, schema: unknown): Promise<WriteFeedResult> {
  const safe = safeSlugName(slug);
  if (safe === null) return err(slug, "slug must be alphanumeric / hyphen / underscore with no path separators");
  const parsed = CollectionSchemaZ.safeParse(applyFeedSchemaDefaults(schema, safe));
  if (!parsed.success) return err(safe, `schema validation failed — ${formatIssues(parsed.error.issues)}`);
  const validated = parsed.data as CollectionSchema;
  const problem = feedSchemaProblem(validated);
  if (problem) return err(safe, problem);
  if (resolveDataDir(validated.dataPath, workspaceRoot) === null) return err(safe, `dataPath '${validated.dataPath}' escapes the workspace`);
  await mkdir(feedDir(safe, workspaceRoot), { recursive: true });
  await writeFileAtomic(path.join(feedDir(safe, workspaceRoot), SCHEMA_FILE), `${JSON.stringify(validated, null, 2)}\n`);
  log.info("feeds", "feed registered", { slug: safe, kind: validated.ingest?.kind });
  return { kind: "ok", slug: safe };
}

/** Every registered feed, as a discovered collection (carrying its
 *  validated schema, `ingest`, and resolved `dataDir`). */
export async function listFeeds(workspaceRoot: string = workspacePath): Promise<LoadedCollection[]> {
  const all = await discoverCollections({ workspaceRoot });
  return all.filter((collection) => collection.source === "feed");
}

/** Delete a feed's schema + state directory. Records under the schema's
 *  `dataPath` are intentionally retained (data is the user's). Idempotent. */
export async function removeFeed(workspaceRoot: string, slug: string): Promise<boolean> {
  const safe = safeSlugName(slug);
  if (safe === null) return false;
  try {
    await rm(feedDir(safe, workspaceRoot), { recursive: true, force: true });
    log.info("feeds", "feed removed (records retained)", { slug: safe });
    return true;
  } catch (error) {
    log.warn("feeds", "feed remove failed", { slug: safe, error: String(error) });
    return false;
  }
}
