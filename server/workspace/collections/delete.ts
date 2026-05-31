// Delete a user-authored collection, archiving a full restorable copy
// first. A collection spans three on-disk locations (see
// docs/collections-architecture.md "Deleting a collection"):
//
//   1. data/skills/<slug>/    staging — the canonical skill source
//   2. .claude/skills/<slug>/ active mirror — what discovery scans
//   3. <schema.dataPath>/     the records (one <id>.json per record)
//
// Locations 1 and 2 are a source→mirror pair maintained by the
// skill-bridge hook, but that hook only fires on the agent's own tool
// calls — a server-side delete must remove BOTH explicitly. Before
// anything is removed we write a single skill copy (from the canonical
// staging dir), the records, and an LLM-runnable RESTORE.md to
// `archive/<date>-<uuid>/`.
//
// Only project-scope, non-preset collections are deletable: user-scope
// skills (`~/.claude/skills/`) are read-only from MulmoClaude, and a
// preset (`mc-*`) re-seeds on next boot so deleting it is futile.

import { cp, mkdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { log } from "../../system/logger/index.js";
import { WORKSPACE_DIRS } from "../paths.js";
import { workspacePath } from "../workspace.js";
import { isPresetSlug } from "../skills-preset.js";
import { isContainedInRoot } from "./paths.js";
import type { LoadedCollection } from "./discovery.js";

export type DeleteCollectionResult =
  | { kind: "ok"; slug: string; archivePath: string }
  | { kind: "user-scope"; slug: string }
  | { kind: "preset"; slug: string }
  | { kind: "path-escape"; slug: string };

export interface DeleteCollectionOptions {
  /** Override the workspace root for containment checks + archive
   *  placement. Default: the live `workspacePath`. Tests point this at
   *  a `mkdtempSync` tree (same pattern as the IO helpers). */
  workspaceRoot?: string;
  /** Override the `<date>` half of the archive folder name. Tests pass
   *  a fixed stamp so the asserted path is deterministic; production
   *  leaves it unset and the current UTC date (YYYY-MM-DD) is used. */
  dateStamp?: string;
}

/** The canonical staging dir for a slug: `data/skills/<slug>`. */
function stagingSkillDir(workspaceRoot: string, slug: string): string {
  return path.join(workspaceRoot, WORKSPACE_DIRS.skillsStaging, slug);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** UTC `YYYY-MM-DD` — keeps the archive folder human-sortable. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Every directory the delete will touch must resolve under the
 *  workspace root — guards against a symlinked ancestor escaping it. */
function deleteTargets(collection: LoadedCollection, workspaceRoot: string): string[] {
  return [stagingSkillDir(workspaceRoot, collection.slug), collection.skillDir, collection.dataDir];
}

function buildRestoreDoc(collection: LoadedCollection): string {
  const { slug, schema } = collection;
  return `# Restore "${schema.title}" (collection \`${slug}\`)

This folder is an automatic backup made when the collection was deleted.
To restore it, follow these steps (the staging path matters — writing the
skill into \`data/skills/\` lets the skill-bridge hook rebuild the
\`.claude/skills/\` mirror and re-register the collection; writing
\`.claude/skills/\` directly would hit the permission gate):

1. Recreate the skill from \`skill/\` into \`data/skills/${slug}/\`
   (copy \`SKILL.md\`, \`schema.json\`, and any \`templates/\`). The hook
   mirrors those files into \`.claude/skills/${slug}/\` automatically.
2. Restore the records from \`records/\` into \`${schema.dataPath}/\`.
3. Confirm the collection reappears at \`/collections/${slug}\`.

- slug: \`${slug}\`
- title: ${schema.title}
- dataPath: \`${schema.dataPath}\`
`;
}

/** Copy one skill copy + the records + RESTORE.md into `archiveDir`. */
async function writeArchive(collection: LoadedCollection, archiveDir: string, workspaceRoot: string): Promise<void> {
  // Prefer the canonical staging dir; fall back to the active mirror
  // for a project collection that was created without the bridge.
  const staging = stagingSkillDir(workspaceRoot, collection.slug);
  const skillSrc = (await pathExists(staging)) ? staging : collection.skillDir;
  await cp(skillSrc, path.join(archiveDir, "skill"), { recursive: true });
  if (await pathExists(collection.dataDir)) {
    await cp(collection.dataDir, path.join(archiveDir, "records"), { recursive: true });
  }
  await writeFile(path.join(archiveDir, "RESTORE.md"), buildRestoreDoc(collection), "utf-8");
}

/** Remove all three locations. `rm -rf`-style (force) so a missing dir
 *  is a no-op; the now-empty data parent (`data/<slug>/` after its
 *  `items/` is gone) is swept too, but only when empty. */
async function removeLocations(collection: LoadedCollection, workspaceRoot: string): Promise<void> {
  await rm(stagingSkillDir(workspaceRoot, collection.slug), { recursive: true, force: true });
  await rm(collection.skillDir, { recursive: true, force: true });
  await rm(collection.dataDir, { recursive: true, force: true });
  await rmdir(path.dirname(collection.dataDir)).catch(() => undefined);
}

export async function deleteCollection(collection: LoadedCollection, opts: DeleteCollectionOptions = {}): Promise<DeleteCollectionResult> {
  const { slug } = collection;
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  if (collection.source === "user") return { kind: "user-scope", slug };
  if (isPresetSlug(slug)) return { kind: "preset", slug };
  if (deleteTargets(collection, workspaceRoot).some((target) => !isContainedInRoot(target, workspaceRoot))) {
    log.warn("collections", "deleteCollection refused: a target escapes the workspace", { slug });
    return { kind: "path-escape", slug };
  }
  const archiveRel = path.join(WORKSPACE_DIRS.archive, `${opts.dateStamp ?? todayStamp()}-${randomUUID()}`);
  const archiveDir = path.join(workspaceRoot, archiveRel);
  await mkdir(archiveDir, { recursive: true });
  await writeArchive(collection, archiveDir, workspaceRoot);
  await removeLocations(collection, workspaceRoot);
  log.info("collections", "collection deleted + archived", { slug, archive: archiveRel });
  return { kind: "ok", slug, archivePath: archiveRel };
}
