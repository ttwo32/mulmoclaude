// Server-side computed-field enrichment for collection records: the
// host evaluates `derived` formulas (via the SHARED saturation loop in
// src/utils/collections/deriveAll.ts — never a server reimplementation),
// projects `toggle` fields off their enum, and resolves `embed` fields
// to their fixed target record. The client does the same at render
// time; this module gives server consumers (manageCollection getItems)
// the same numbers the user sees on screen.

import { deriveAll, type DeriveRefRecords } from "../core/deriveAll";
import { loadCollection, type DiscoveryOptions } from "./discovery";
import type { LoadedCollection } from "./discoveredCollection";
import { listItems } from "./io";
import { embedTargetId } from "../core/schema";
import type { CollectionFieldSpec, CollectionItem, CollectionSchema } from "../core/schema";

/** Slugs of every collection referenced by a `ref` field — top-level
 *  and one level into `table` sub-fields (nested tables are
 *  schema-rejected). Mirrors the client's `uniqueRefTargets`. */
function uniqueRefTargets(schema: CollectionSchema): string[] {
  const targets = new Set<string>();
  const walk = (fields: Record<string, CollectionFieldSpec>): void => {
    for (const field of Object.values(fields)) {
      if (field.type === "ref" && typeof field.to === "string" && field.to.length > 0) targets.add(field.to);
      if (field.type === "table" && field.of) walk(field.of);
    }
  };
  walk(schema.fields);
  return [...targets];
}

/** Slugs of every collection referenced by an `embed` field (top-level
 *  only, like the client). */
function uniqueEmbedTargets(schema: CollectionSchema): string[] {
  const targets = new Set<string>();
  for (const field of Object.values(schema.fields)) {
    if (field.type === "embed" && typeof field.to === "string" && field.to.length > 0) targets.add(field.to);
  }
  return [...targets];
}

interface LinkedTarget {
  schema: CollectionSchema;
  /** primary-key slug → record (ref targets store the DERIVED record,
   *  mirroring the client's `buildRefRecordMap`, so a formula deref
   *  like `ticker.price` can read the target's own derived columns). */
  byId: Record<string, CollectionItem>;
}

async function loadTarget(slug: string, opts: DiscoveryOptions): Promise<LinkedTarget | null> {
  const target = await loadCollection(slug, opts);
  if (!target) return null;
  const items = await listItems(target.dataDir, { workspaceRoot: opts.workspaceRoot });
  const byId: Record<string, CollectionItem> = {};
  for (const item of items) {
    const itemId = item[target.schema.primaryKey];
    if (typeof itemId === "string" && itemId.length > 0) byId[itemId] = deriveAll(target.schema, item, {});
  }
  return { schema: target.schema, byId };
}

/** Load every ref/embed target collection once. Unknown / unloadable
 *  targets are simply absent — downstream derefs resolve to null, the
 *  same fail-soft the UI renders as an em-dash. */
async function loadLinkedTargets(schema: CollectionSchema, opts: DiscoveryOptions): Promise<Record<string, LinkedTarget>> {
  const slugs = [...new Set([...uniqueRefTargets(schema), ...uniqueEmbedTargets(schema)])];
  const loaded: Record<string, LinkedTarget> = {};
  for (const slug of slugs) {
    const target = await loadTarget(slug, opts);
    if (target) loaded[slug] = target;
  }
  return loaded;
}

function toRefRecords(linked: Record<string, LinkedTarget>): DeriveRefRecords {
  return Object.fromEntries(Object.entries(linked).map(([slug, target]) => [slug, target.byId]));
}

/** Project the computed (never-stored) field kinds onto one derived
 *  record: `toggle` → boolean off its enum, `embed` → the target record
 *  (fixed `id` or per-record `idField`), or null when missing. */
function projectComputed(schema: CollectionSchema, enriched: CollectionItem, linked: Record<string, LinkedTarget>): CollectionItem {
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.type === "toggle" && field.field) {
      enriched[key] = String(enriched[field.field] ?? "") === field.onValue;
    }
    if (field.type === "embed" && field.to) {
      const targetId = embedTargetId(field, enriched);
      enriched[key] = (targetId && linked[field.to]?.byId[targetId]) || null;
    }
  }
  return enriched;
}

/** Enrich records with every host-computed field: derived formulas
 *  evaluated (cross-collection derefs included), toggles projected,
 *  embeds resolved. Loads each linked collection ONCE per call. Input
 *  records are not mutated. */
export async function enrichItems(collection: LoadedCollection, items: CollectionItem[], opts: DiscoveryOptions = {}): Promise<CollectionItem[]> {
  const { schema } = collection;
  const linked = await loadLinkedTargets(schema, opts);
  const refRecords = toRefRecords(linked);
  return items.map((item) => projectComputed(schema, deriveAll(schema, item, refRecords), linked));
}
