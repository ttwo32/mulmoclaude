// Declarative retrieval config for the "Feeds" mechanism. A Feed is a
// CollectionSchema plus this `ingest` block, registered as data (NOT as
// a skill) under `<workspace>/feeds/<slug>/schema.json`. The host's
// retrieval engine reads it to periodically refill the collection's
// records via the shared collections io layer.
//
// The ingest vocab (INGEST_KINDS / FEED_SCHEDULES + their literal-union types)
// now lives in @mulmoclaude/core/collection alongside the schema contract, so
// the package's schema validator can enforce it. Re-exported here so the feeds
// engine's existing importers resolve them unchanged.
import {
  type CollectionIngest,
  INGEST_KINDS,
  AGENT_INGEST_KIND,
  FEED_SCHEDULES,
  type IngestKind,
  type AgentIngestKind,
  type FeedSchedule,
} from "@mulmoclaude/core/collection";
//
// Two flavours: the declarative kinds (`rss`/`atom`/`http-json`) fetch-and-map,
// and `agent` dispatches a hidden worker. The `code` kind (LLM-generated
// deterministic transform) is still reserved for a future retriever.

export { INGEST_KINDS, AGENT_INGEST_KIND, FEED_SCHEDULES, type IngestKind, type AgentIngestKind, type FeedSchedule };

const FEED_SCHEDULE_SET: ReadonlySet<string> = new Set(FEED_SCHEDULES);

export function isFeedSchedule(value: unknown): value is FeedSchedule {
  return typeof value === "string" && FEED_SCHEDULE_SET.has(value);
}

/** Default cap on stored records per feed when `ingest.maxItems` is
 *  omitted. Keeps high-volume feeds (news / podcasts) bounded. */
export const DEFAULT_FEED_MAX_ITEMS = 100;

/** Declarative field map: target collection field name → source path
 *  into the raw item (dot/bracket path, e.g. `"title"` or
 *  `"data.name"`). */
export type IngestFieldMap = Record<string, string>;

/** Declarative retrieval (`rss`/`atom`/`http-json`): the host fetches `url`
 *  and projects each item through `map`. The canonical schema (in
 *  @mulmoclaude/core/collection) only promises the minimal `CollectionIngest`;
 *  this feeds-only subtype narrows those + adds the retrieval fields the engine
 *  needs. */
export interface DeclarativeIngestSpec extends CollectionIngest {
  /** Which declarative retriever handles this feed. */
  kind: IngestKind;
  /** Endpoint to fetch (http/https). */
  url: string;
  /** Refresh cadence. */
  schedule: FeedSchedule;
  /** `http-json` only: dot/bracket path to the array of items in the
   *  response (e.g. `"hourly[]"` or `"data.results[]"`). Ignored for
   *  `rss`/`atom`, which yield items natively. */
  itemsAt?: string;
  /** target field → source path. Projects each raw item into a record
   *  whose keys match the schema's `fields`. */
  map: IngestFieldMap;
  /** Optional source path used to derive the primaryKey value when the
   *  mapped record's primaryKey is empty (e.g. `"feedId"`). Falls back
   *  to a content hash of the record. */
  idFrom?: string;
  /** Cap on stored records. After each fetch the feed keeps only the
   *  newest `maxItems` (ordered by the schema's first `date` field) and
   *  deletes the rest. Defaults to {@link DEFAULT_FEED_MAX_ITEMS} when
   *  omitted; `0` disables the cap (keep everything). Pruning is skipped
   *  when the schema has no `date` field to order by. */
  maxItems?: number;
}

/** Agent-performed retrieval (`kind: "agent"`). No `url`/`map`: the host seeds
 *  a hidden background worker (origin `system`) in `role` with `template` + a
 *  summary of every record, and the worker edits the records itself via the
 *  collections io layer. Valid on any collection (primarily skill-backed). */
export interface AgentIngestSpec extends CollectionIngest {
  kind: AgentIngestKind;
  /** Refresh cadence (same vocabulary as declarative feeds). */
  schedule: FeedSchedule;
  /** Role id the scheduled hidden worker runs in. */
  role: string;
  /** Skill-relative template path (under `templates/`) seeding the worker. */
  template: string;
}

/** The `ingest` block carried on a `CollectionSchema`, discriminated on `kind`. */
export type IngestSpec = DeclarativeIngestSpec | AgentIngestSpec;
