// Retrieval engine: fetch a feed, upsert its records into the
// collection's data dir (keyed by primaryKey, so re-fetches replace in
// place / accumulate by id), and persist per-feed state. Per-feed
// failures are isolated — `refreshOne` never throws; `refreshDue`
// processes feeds sequentially to stay gentle on remote hosts (the
// fetch client does no rate-limiting yet).

import { workspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";
import { writeItem, type CollectionItem, type LoadedCollection } from "../collections/index.js";
import { ONE_HOUR_MS, ONE_DAY_MS } from "../../utils/time.js";
import { getRetriever } from "./retrievers/index.js";
import "./retrievers/registerAll.js";
import { listFeeds } from "./registry.js";
import { readFeedState, writeFeedState, type FeedState } from "./state.js";
import type { FeedSchedule } from "./ingestTypes.js";

export interface RefreshResult {
  slug: string;
  written: number;
  errors: string[];
}

async function upsertItems(workspaceRoot: string, feed: LoadedCollection, items: CollectionItem[]): Promise<number> {
  let written = 0;
  for (const item of items) {
    const itemId = item[feed.schema.primaryKey];
    if (typeof itemId !== "string" || itemId.length === 0) continue;
    const result = await writeItem(feed.dataDir, itemId, item, { refuseOverwrite: false, workspaceRoot });
    if (result.kind === "ok") written += 1;
    else log.warn("feeds", "feed item write skipped", { slug: feed.slug, itemId, kind: result.kind });
  }
  return written;
}

/** Fetch one feed now and upsert its records. Failure-isolated: returns
 *  an errors array rather than throwing. */
export async function refreshOne(workspaceRoot: string, feed: LoadedCollection): Promise<RefreshResult> {
  const { slug } = feed;
  const { ingest } = feed.schema;
  if (!ingest) return { slug, written: 0, errors: ["collection has no ingest config"] };
  const retriever = getRetriever(ingest.kind);
  if (!retriever) return { slug, written: 0, errors: [`no retriever registered for kind '${ingest.kind}'`] };
  const state = await readFeedState(workspaceRoot, slug);
  try {
    const result = await retriever(ingest, feed.schema, state);
    const written = await upsertItems(workspaceRoot, feed, result.items);
    await writeFeedState(workspaceRoot, slug, { ...state, lastFetchedAt: new Date().toISOString(), cursor: result.cursor, consecutiveFailures: 0 });
    log.info("feeds", "feed refreshed", { slug, written, fetched: result.items.length });
    return { slug, written, errors: [] };
  } catch (error) {
    await writeFeedState(workspaceRoot, slug, { ...state, consecutiveFailures: state.consecutiveFailures + 1 });
    const message = String(error);
    log.warn("feeds", "feed refresh failed", { slug, error: message });
    return { slug, written: 0, errors: [message] };
  }
}

function dueIntervalMs(schedule: FeedSchedule): number {
  switch (schedule) {
    case "daily":
      return ONE_DAY_MS;
    case "weekly":
      return 7 * ONE_DAY_MS;
    default:
      return ONE_HOUR_MS;
  }
}

/** True iff a feed is due to refresh given its schedule + last fetch.
 *  `on-demand` feeds are never auto-due. */
function isFeedDue(feed: LoadedCollection, state: FeedState): boolean {
  const schedule = feed.schema.ingest?.schedule;
  if (!schedule || schedule === "on-demand") return false;
  if (!state.lastFetchedAt) return true;
  const elapsed = Date.now() - Date.parse(state.lastFetchedAt);
  if (!Number.isFinite(elapsed)) return true;
  return elapsed >= dueIntervalMs(schedule);
}

/** Refresh every feed whose schedule says it's due. Called by the
 *  hourly system task. Sequential + failure-isolated. */
export async function refreshDue(workspaceRoot: string = workspacePath): Promise<RefreshResult[]> {
  const feeds = await listFeeds(workspaceRoot);
  const results: RefreshResult[] = [];
  for (const feed of feeds) {
    const state = await readFeedState(workspaceRoot, feed.slug);
    if (!isFeedDue(feed, state)) continue;
    results.push(await refreshOne(workspaceRoot, feed));
  }
  return results;
}
