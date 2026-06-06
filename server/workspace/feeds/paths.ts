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
