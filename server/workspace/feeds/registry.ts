// List the registered data-source feeds. Feeds are CREATED / REMOVED by
// the agent writing / deleting `feeds/<slug>/schema.json` directly (see
// config/helps/feeds.md) — the host only discovers + retrieves them.
// icon / dataPath defaults for agent-authored feed schemas are applied in
// `collections/discovery.ts` (source === "feed").

import { rm } from "node:fs/promises";
import { workspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";
import { discoverCollections, type LoadedCollection } from "../collections/index.js";
import { resolveDataDir, safeSlugName } from "@mulmoclaude/collection-plugin/server";
import { feedDir } from "./paths.js";

/** Every registered feed, as a discovered collection (carrying its
 *  validated schema, `ingest`, and resolved `dataDir`). */
export async function listFeeds(workspaceRoot: string = workspacePath): Promise<LoadedCollection[]> {
  const all = await discoverCollections({ workspaceRoot });
  return all.filter((collection) => collection.source === "feed");
}

/** Delete a feed entirely: its records AND its `feeds/<slug>/` directory
 *  (schema + state). Idempotent. Host-side only (backs the UI delete
 *  button); the agent removes a feed by deleting both directories itself.
 *
 *  The records dir is derived from the SLUG (`data/feeds/<slug>`), never
 *  from the schema's `dataPath` — feeds are forced into that namespace at
 *  discovery, so a malformed/hostile `dataPath` can't redirect this delete
 *  at another app's data (e.g. `data/wiki`). `resolveDataDir` also rejects
 *  any path that escapes the workspace. */
export async function removeFeed(workspaceRoot: string, slug: string): Promise<boolean> {
  const safe = safeSlugName(slug);
  if (safe === null) return false;
  const recordsDir = resolveDataDir(`data/feeds/${safe}`, workspaceRoot);
  try {
    if (recordsDir) await rm(recordsDir, { recursive: true, force: true });
    await rm(feedDir(safe, workspaceRoot), { recursive: true, force: true });
    log.info("feeds", "feed + records removed", { slug: safe });
    return true;
  } catch (error) {
    log.warn("feeds", "feed remove failed", { slug: safe, error: String(error) });
    return false;
  }
}
