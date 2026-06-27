// Pluggable retriever registry. Each declarative `ingest.kind` maps to one
// RetrieveFn that fetches the endpoint and returns projected records.
// Side-effect registration keeps the engine decoupled from the kinds.
// The `agent` kind is NOT a retriever (it dispatches a hidden worker before
// the engine consults this registry); a future `code` kind would register here.

import type { CollectionItem, CollectionSchema } from "../../collections/index.js";
import type { DeclarativeIngestSpec } from "../ingestTypes.js";
import type { FeedState } from "../state.js";

export interface RetrieveResult {
  /** Projected records, keyed by primaryKey (the engine upserts them). */
  items: CollectionItem[];
  /** Updated retriever cursor to persist (incremental fetches). */
  cursor: Record<string, string>;
}

// Declarative-only: the engine branches `agent` ingest off BEFORE looking up a
// retriever, so a RetrieveFn never sees a non-fetch spec (and rss/http-json can
// read `ingest.url`/`map` without union narrowing).
export type RetrieveFn = (ingest: DeclarativeIngestSpec, schema: CollectionSchema, state: FeedState) => Promise<RetrieveResult>;

const registry = new Map<string, RetrieveFn>();

export function registerRetriever(kind: string, retriever: RetrieveFn): void {
  registry.set(kind, retriever);
}

export function getRetriever(kind: string): RetrieveFn | undefined {
  return registry.get(kind);
}
