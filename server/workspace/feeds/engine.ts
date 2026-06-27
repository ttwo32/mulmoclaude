// Retrieval engine: fetch a feed, upsert its records into the
// collection's data dir (keyed by primaryKey, so re-fetches replace in
// place / accumulate by id), and persist per-feed state. Per-feed
// failures are isolated — `refreshOne` never throws; `refreshDue`
// processes feeds sequentially to stay gentle on remote hosts (the
// fetch client does no rate-limiting yet).

import { workspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";
import {
  deleteItem,
  discoverCollections,
  listItems,
  writeItem,
  type CollectionItem,
  type CollectionSchema,
  type LoadedCollection,
} from "../collections/index.js";
import { ONE_HOUR_MS, ONE_DAY_MS } from "../../utils/time.js";
import { getRetriever } from "./retrievers/index.js";
import "./retrievers/registerAll.js";
import { readFeedState, writeFeedState, type FeedState } from "./state.js";
import { DEFAULT_FEED_MAX_ITEMS, AGENT_INGEST_KIND, type FeedSchedule, type IngestSpec } from "./ingestTypes.js";
import { refreshViaAgent } from "./agentIngest.js";
import type { RefreshResult } from "./refreshResult.js";

export type { RefreshResult } from "./refreshResult.js";

/** Feed schemas carry the rich `IngestSpec` (validated at discovery —
 *  `source === "feed"` requires `ingest`), but the canonical
 *  `CollectionSchema.ingest` only promises the minimal `CollectionIngest`.
 *  Narrow here so the engine can read the retrieval fields type-safely. */
function feedIngest(schema: CollectionSchema): IngestSpec | undefined {
  return schema.ingest as IngestSpec | undefined;
}

async function upsertItems(workspaceRoot: string, feed: LoadedCollection, items: CollectionItem[]): Promise<number> {
  let written = 0;
  for (const item of items) {
    const itemId = item[feed.schema.primaryKey];
    if (typeof itemId !== "string" || itemId.length === 0) continue;
    const result = await writeItem(feed.dataDir, itemId, item, { refuseOverwrite: false, workspaceRoot, slug: feed.slug });
    if (result.kind === "ok") written += 1;
    else log.warn("feeds", "feed item write skipped", { slug: feed.slug, itemId, kind: result.kind });
  }
  return written;
}

/** The schema's first `date` field, used to order records for the
 *  maxItems cap. Null when the schema declares none. */
function firstDateField(schema: CollectionSchema): string | null {
  for (const [key, spec] of Object.entries(schema.fields)) {
    if (spec.type === "date") return key;
  }
  return null;
}

// Epoch ms for a record's date value; missing / unparseable sorts oldest.
function recordTime(item: CollectionItem, field: string): number {
  const value = item[field];
  const millis = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(millis) ? millis : Number.NEGATIVE_INFINITY;
}

/** Enforce `ingest.maxItems` (default 100): keep the newest N records by
 *  the schema's date field, delete the rest. No-op when the cap is 0/absent
 *  of a date field, or when under the cap. Returns the number deleted. */
async function pruneFeed(workspaceRoot: string, feed: LoadedCollection): Promise<number> {
  const ingest = feedIngest(feed.schema);
  // maxItems is a declarative-feed concept; agent ingest manages its own record
  // set, so it's never pruned here (and `refreshOne` never calls pruneFeed for it).
  const cap = (ingest && ingest.kind !== AGENT_INGEST_KIND ? ingest.maxItems : undefined) ?? DEFAULT_FEED_MAX_ITEMS;
  if (cap <= 0) return 0;
  const dateField = firstDateField(feed.schema);
  if (!dateField) {
    log.warn("feeds", "maxItems prune skipped: schema has no date field to order by", { slug: feed.slug });
    return 0;
  }
  const items = await listItems(feed.dataDir, { workspaceRoot });
  if (items.length <= cap) return 0;
  const stale = [...items].sort((left, right) => recordTime(right, dateField) - recordTime(left, dateField)).slice(cap);
  let removed = 0;
  for (const item of stale) {
    const itemId = item[feed.schema.primaryKey];
    if (typeof itemId !== "string" || itemId.length === 0) continue;
    if ((await deleteItem(feed.dataDir, itemId, { workspaceRoot, slug: feed.slug })).kind === "ok") removed += 1;
  }
  if (removed > 0) log.info("feeds", "pruned old feed records", { slug: feed.slug, removed, cap });
  return removed;
}

/** Fetch one feed now, upsert its records, then enforce the maxItems cap.
 *  Failure-isolated: returns an errors array rather than throwing. */
export async function refreshOne(workspaceRoot: string, feed: LoadedCollection, opts?: { hidden?: boolean }): Promise<RefreshResult> {
  const { slug } = feed;
  const ingest = feedIngest(feed.schema);
  if (!ingest) return { slug, written: 0, removed: 0, errors: ["collection has no ingest config"] };
  // `agent` ingest dispatches a worker instead of fetching: branch off BEFORE
  // the retriever registry (which only knows declarative kinds). `opts.hidden`
  // (manual Refresh passes false) only affects the agent path; declarative
  // feeds ignore it.
  if (ingest.kind === AGENT_INGEST_KIND) return refreshViaAgent(workspaceRoot, feed, opts);
  const retriever = getRetriever(ingest.kind);
  if (!retriever) return { slug, written: 0, removed: 0, errors: [`no retriever registered for kind '${ingest.kind}'`] };
  const state = await readFeedState(workspaceRoot, feed);
  try {
    const result = await retriever(ingest, feed.schema, state);
    const written = await upsertItems(workspaceRoot, feed, result.items);
    await writeFeedState(workspaceRoot, feed, { ...state, lastFetchedAt: new Date().toISOString(), cursor: result.cursor, consecutiveFailures: 0 });
    const removed = await pruneFeed(workspaceRoot, feed);
    log.info("feeds", "feed refreshed", { slug, written, removed, fetched: result.items.length });
    return { slug, written, removed, errors: [] };
  } catch (error) {
    await writeFeedState(workspaceRoot, feed, { ...state, consecutiveFailures: state.consecutiveFailures + 1 });
    const message = String(error);
    log.warn("feeds", "feed refresh failed", { slug, error: message });
    return { slug, written: 0, removed: 0, errors: [message] };
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

/** True iff a `daily` schedule with a UTC `atHour` anchor is due. The system
 *  task ticks hourly, so "due" means: we're in the anchor hour AND we haven't
 *  already run in roughly the last day. The 23 h floor (not 24 h) tolerates the
 *  tick landing a few minutes earlier than the previous run, while staying well
 *  above 1 h so a second tick in the same anchor hour can't double-fire. */
function isDailyAtHourDue(now: Date, atHour: number, lastFetchedAt: string | null): boolean {
  if (now.getUTCHours() !== atHour) return false;
  if (!lastFetchedAt) return true;
  const elapsed = now.getTime() - Date.parse(lastFetchedAt);
  if (!Number.isFinite(elapsed)) return true;
  return elapsed >= 23 * ONE_HOUR_MS;
}

/** True iff a collection is due to refresh given its schedule + last run.
 *  `on-demand` is never auto-due; a `daily` schedule with `atHour` anchors to
 *  that UTC hour, otherwise cadence is elapsed-based. */
function isFeedDue(feed: LoadedCollection, state: FeedState): boolean {
  const ingest = feedIngest(feed.schema);
  const schedule = ingest?.schedule;
  if (!schedule || schedule === "on-demand") return false;
  if (schedule === "daily" && typeof ingest?.atHour === "number") {
    return isDailyAtHourDue(new Date(), ingest.atHour, state.lastFetchedAt);
  }
  if (!state.lastFetchedAt) return true;
  const elapsed = Date.now() - Date.parse(state.lastFetchedAt);
  if (!Number.isFinite(elapsed)) return true;
  return elapsed >= dueIntervalMs(schedule);
}

/** Refresh every collection whose ingest schedule says it's due — declarative
 *  feeds AND skill-backed collections with `ingest.kind: "agent"`. Called by the
 *  hourly system task. Sequential + failure-isolated. */
export async function refreshDue(workspaceRoot: string = workspacePath): Promise<RefreshResult[]> {
  const all = await discoverCollections({ workspaceRoot });
  const withIngest = all.filter((collection) => collection.schema.ingest);
  const results: RefreshResult[] = [];
  for (const collection of withIngest) {
    const state = await readFeedState(workspaceRoot, collection);
    if (!isFeedDue(collection, state)) continue;
    results.push(await refreshOne(workspaceRoot, collection));
  }
  return results;
}
