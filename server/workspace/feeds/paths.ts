// Path helpers for the non-skill Feeds registry. Each feed lives at
// `<workspace>/feeds/<slug>/schema.json` (a CollectionSchema + `ingest`
// block) with its retrieval state alongside at
// `<workspace>/feeds/<slug>/_state.json`. Records land wherever the
// schema's `dataPath` points (validated by `resolveDataDir`), exactly
// like every other collection.
//
// Slugs reaching these helpers must already have passed `safeSlugName`
// (from `../collections/paths.js`) — these joins do not re-sanitize.

import path from "node:path";
import { workspacePath } from "../workspace.js";
import { WORKSPACE_DIRS } from "../paths.js";

export const FEEDS_DIR = "feeds";
export const FEED_STATE_FILE = "_state.json";

/** Absolute path to the feeds registry root for a workspace. */
export function feedsRoot(workspaceRoot: string = workspacePath): string {
  return path.join(workspaceRoot, FEEDS_DIR);
}

/** Absolute path to one feed's directory (`<root>/<slug>/`). */
export function feedDir(slug: string, workspaceRoot: string = workspacePath): string {
  return path.join(feedsRoot(workspaceRoot), slug);
}

/** Absolute path to one feed's retrieval-state file. */
export function feedStatePath(slug: string, workspaceRoot: string = workspacePath): string {
  return path.join(feedsRoot(workspaceRoot), slug, FEED_STATE_FILE);
}

/** Directory holding retrieval state for NON-feed collections with an
 *  `ingest` block (`kind: "agent"`). One file per collection. */
export function ingestStateDir(workspaceRoot: string = workspacePath): string {
  return path.join(workspaceRoot, WORKSPACE_DIRS.ingestState);
}

/** Absolute path to a non-feed collection's ingest-state file
 *  (`data/ingest-state/<slug>.json`). Kept OUT of the collection's dataDir
 *  (where `listItems` would read it as a record) and out of `feeds/` (a
 *  schema-less `feeds/<slug>/` dir confuses feed discovery). */
export function ingestStatePath(slug: string, workspaceRoot: string = workspacePath): string {
  return path.join(ingestStateDir(workspaceRoot), `${slug}.json`);
}
