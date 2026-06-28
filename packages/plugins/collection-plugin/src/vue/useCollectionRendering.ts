// Rendering + linked-data layer for collection surfaces, extracted from
// CollectionView.vue so the list/detail view AND the calendar view's
// record panel share one implementation (and one set of ref/embed
// caches). Owns: the per-target caches, the fan-out fetch that fills
// them, and every helper that turns a stored value into something the
// templates render (ref labels, money/currency, derived formulas, embed
// rows). Pure-but-stateful: instantiate ONCE per collection surface and
// pass the returned object down to child panels.

import { ref, type Ref } from "vue";
import { collectionUi } from "./uiContext";
import { deriveAll, embedTargetId } from "@mulmoclaude/core/collection";
import type {
  CollectionDetail,
  CollectionItem,
  CollectionSchema,
  CollectionFieldSpec as FieldSpec,
  CollectionFieldType as FieldType,
  CollectionDetailResponse,
  EmbedCache,
  EmbedRow,
  EmbedView,
  RefCache,
  RefDisplayMap,
  RefOption,
  RefRecordCache,
  RefRecordMap,
} from "@mulmoclaude/core/collection";

export interface CollectionRendering {
  refCache: Ref<RefCache>;
  refRecordCache: Ref<RefRecordCache>;
  embedCache: Ref<EmbedCache>;
  resetLinkedCaches: () => void;
  loadLinkedCollections: (schema: CollectionSchema, expectedSlug: string) => Promise<void>;
  refDisplay: (targetSlug: string, itemSlug: string) => string;
  refOptions: (targetSlug: string) => RefOption[];
  embedOptions: (targetSlug: string) => RefOption[];
  embedViewsFor: (record: CollectionItem | null) => Record<string, EmbedView>;
  resolveCurrency: (field: FieldSpec, record: CollectionItem | null | undefined) => string | undefined;
  currencySymbol: (currency: string | undefined) => string;
  formatMoney: (value: unknown, currency: string | undefined, displayLocale: string) => string;
  formatCell: (value: unknown, type: FieldType) => string;
  detailText: (value: unknown) => string;
  isExternalUrl: (value: unknown) => boolean;
  artifactUrl: (value: unknown) => string | null;
  fileRoutePath: (value: unknown) => string | null;
  tableRows: (value: unknown) => Record<string, unknown>[];
  hasTableRows: (value: unknown) => boolean;
  formatSubCell: (subField: FieldSpec, value: unknown, record: CollectionItem | null) => string;
  inputTypeFor: (type: FieldType) => string;
  stepFor: (type: FieldType) => string | undefined;
  deriveAll: (schema: CollectionSchema, base: CollectionItem, refRecords: RefRecordCache) => CollectionItem;
  evaluateDerivedAgainstItem: (field: FieldSpec, fieldKey: string, item: CollectionItem) => number | null;
  derivedDisplay: (field: FieldSpec, computedValue: unknown, record: CollectionItem | null) => string;
}

// `<input type="number">` defaults to step="1", which makes the browser
// reject any decimal value (e.g. 0.1) as invalid. Emit step="any" for
// numeric fields so fractional values can be entered and saved.
export function stepForFieldType(type: FieldType): string | undefined {
  if (type === "money") return "0.01";
  if (type === "number") return "any";
  return undefined;
}

export function useCollectionRendering(collection: Ref<CollectionDetail | null>, locale: Ref<string>): CollectionRendering {
  const refCache = ref<RefCache>({});
  const refRecordCache = ref<RefRecordCache>({});
  const embedCache = ref<EmbedCache>({});

  function resetLinkedCaches(): void {
    refCache.value = {};
    refRecordCache.value = {};
    embedCache.value = {};
  }

  function uniqueRefTargets(schema: CollectionSchema): string[] {
    const targets = new Set<string>();
    const walk = (fields: Record<string, FieldSpec>): void => {
      for (const field of Object.values(fields)) {
        if (field.type === "ref" && typeof field.to === "string" && field.to.length > 0) targets.add(field.to);
        // Sub-fields of a table can also be refs; walk one level deep
        // (nested tables are schema-rejected, so one recursion suffices).
        if (field.type === "table" && field.of) walk(field.of);
      }
    };
    walk(schema.fields);
    return [...targets];
  }

  function uniqueEmbedTargets(schema: CollectionSchema): string[] {
    const targets = new Set<string>();
    // Embeds are top-level only (the schema rejects `embed` inside a
    // table's `of`), so no recursion.
    for (const field of Object.values(schema.fields)) {
      if (field.type === "embed" && typeof field.to === "string" && field.to.length > 0) targets.add(field.to);
    }
    return [...targets];
  }

  function buildRefDisplayMap(detail: CollectionDetailResponse): RefDisplayMap {
    const { fields, primaryKey } = detail.collection.schema;
    const displayField = "name" in fields ? "name" : "title" in fields ? "title" : primaryKey;
    const map: RefDisplayMap = {};
    for (const item of detail.items) {
      const slugRaw = item[primaryKey];
      if (typeof slugRaw !== "string" || slugRaw.length === 0) continue;
      const displayRaw = item[displayField];
      map[slugRaw] = typeof displayRaw === "string" && displayRaw.length > 0 ? displayRaw : slugRaw;
    }
    return map;
  }

  function buildRefRecordMap(detail: CollectionDetailResponse): RefRecordMap {
    const { schema } = detail.collection;
    const map: RefRecordMap = {};
    for (const item of detail.items) {
      const slugRaw = item[schema.primaryKey];
      if (typeof slugRaw === "string" && slugRaw.length > 0) map[slugRaw] = deriveAll(schema, item, {});
    }
    return map;
  }

  async function loadLinkedCollections(schema: CollectionSchema, expectedSlug: string): Promise<void> {
    const refTargets = new Set(uniqueRefTargets(schema));
    const embedTargets = new Set(uniqueEmbedTargets(schema));
    const allTargets = [...new Set([...refTargets, ...embedTargets])];
    if (allTargets.length === 0) return;
    // Best-effort: a single target whose fetch *rejects* (vs. resolving to
    // `{ ok: false }`) must not abort the others, so coerce a throw to a skip.
    const binding = collectionUi();
    const results = await Promise.all(
      allTargets.map(async (target) => {
        try {
          return { target, result: await binding.fetchCollectionDetail(target) };
        } catch {
          return { target, result: { ok: false as const } };
        }
      }),
    );
    // Stale-write guard: a quicker subsequent load may have replaced
    // `collection.value`; dropping the write avoids surfacing the
    // previous collection's linked data on the current one.
    if (collection.value?.slug !== expectedSlug) return;
    const nextRef: RefCache = {};
    const nextRefRecords: RefRecordCache = {};
    const nextEmbed: EmbedCache = {};
    for (const { target, result } of results) {
      if (!result.ok) continue;
      if (refTargets.has(target)) {
        nextRef[target] = buildRefDisplayMap(result.data);
        nextRefRecords[target] = buildRefRecordMap(result.data);
      }
      if (embedTargets.has(target)) nextEmbed[target] = { schema: result.data.collection.schema, items: result.data.items };
    }
    refCache.value = nextRef;
    refRecordCache.value = nextRefRecords;
    embedCache.value = nextEmbed;
  }

  function refDisplay(targetSlug: string, itemSlug: string): string {
    const map = refCache.value[targetSlug];
    return (map && map[itemSlug]) || itemSlug;
  }

  function refOptions(targetSlug: string): RefOption[] {
    const map = refCache.value[targetSlug];
    if (!map) return [];
    return Object.entries(map)
      .map(([slug, display]) => ({ slug, display }))
      .sort((left, right) => left.display.localeCompare(right.display));
  }

  /** Dropdown options for an `embed` field's per-record picker (`idField`):
   *  every record in the target collection, labelled by its name/title (or
   *  primary key). Built from `embedCache` so it works for embed targets
   *  that aren't also `ref` targets (the profile collection, say). */
  function embedOptions(targetSlug: string): RefOption[] {
    const data = embedCache.value[targetSlug];
    if (!data) return [];
    const { fields, primaryKey } = data.schema;
    const displayField = "name" in fields ? "name" : "title" in fields ? "title" : primaryKey;
    return data.items
      .map((item) => {
        const slug = String(item[primaryKey] ?? "");
        const labelRaw = item[displayField];
        const display = typeof labelRaw === "string" && labelRaw.length > 0 ? labelRaw : slug;
        return { slug, display };
      })
      .filter((opt) => opt.slug.length > 0)
      .sort((left, right) => left.display.localeCompare(right.display));
  }

  function resolveEmbed(field: FieldSpec, record: CollectionItem | null): { schema: CollectionSchema | null; item: CollectionItem | null } {
    if (field.type !== "embed" || !field.to) return { schema: null, item: null };
    const targetId = embedTargetId(field, record);
    const data = targetId ? embedCache.value[field.to] : undefined;
    if (!data) return { schema: null, item: null };
    const item = data.items.find((entry) => String(entry[data.schema.primaryKey] ?? "") === targetId) ?? null;
    return { schema: data.schema, item };
  }

  function embedValue(field: FieldSpec, value: unknown, record: CollectionItem | null): string {
    if (field.type === "money") return formatMoney(value, resolveCurrency(field, record), locale.value);
    return detailText(value);
  }

  /** Build the read-only embed view-models for one record. A function of
   *  the open record (not a bare computed) because a per-record `idField`
   *  embed resolves a different target per row. */
  function embedViewsFor(record: CollectionItem | null): Record<string, EmbedView> {
    const out: Record<string, EmbedView> = {};
    if (!collection.value) return out;
    for (const [key, field] of Object.entries(collection.value.schema.fields)) {
      if (field.type !== "embed") continue;
      const { schema, item } = resolveEmbed(field, record);
      const rows: EmbedRow[] = [];
      if (schema && item) {
        for (const [subKey, subField] of Object.entries(schema.fields)) {
          const value = item[subKey];
          // Skip empty fields — the embed is a read-only summary, so
          // unfilled optionals would just be "—" noise.
          if (value === undefined || value === null || value === "") continue;
          rows.push({ key: subKey, label: subField.label, type: subField.type, value, display: embedValue(subField, value, item) });
        }
      }
      out[key] = { found: Boolean(item), rows, targetSlug: field.to ?? "", recordId: embedTargetId(field, record) };
    }
    return out;
  }

  function resolveCurrency(field: FieldSpec, record: CollectionItem | null | undefined): string | undefined {
    if (field.currencyField && record) {
      const code = record[field.currencyField];
      if (typeof code === "string" && code.trim().length > 0) return code;
    }
    return field.currency;
  }

  function currencySymbol(currency: string | undefined): string {
    const code = currency && currency.length > 0 ? currency : "USD";
    try {
      const parts = new Intl.NumberFormat(locale.value, { style: "currency", currency: code }).formatToParts(0);
      return parts.find((entry) => entry.type === "currency")?.value ?? code;
    } catch {
      return code;
    }
  }

  function formatMoney(value: unknown, currency: string | undefined, displayLocale: string): string {
    if (value === undefined || value === "") return "—";
    const amount = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(amount)) return String(value);
    const currencyCode = currency && currency.length > 0 ? currency : "USD";
    try {
      return new Intl.NumberFormat(displayLocale, { style: "currency", currency: currencyCode }).format(amount);
    } catch {
      return String(amount);
    }
  }

  function formatCell(value: unknown, type: FieldType): string {
    if (value === undefined || value === null || value === "") return "—";
    if (type === "markdown" && typeof value === "string") return value.length > 80 ? `${value.slice(0, 80)}…` : value;
    if (typeof value === "string" || typeof value === "number") return String(value);
    return JSON.stringify(value);
  }

  function isExternalUrl(value: unknown): boolean {
    return typeof value === "string" && /^https?:\/\//i.test(value);
  }

  // A `file` field holds a workspace-relative path. When it points at an
  // HTML/SVG artifact the server serves directly, return that served URL
  // so the rendered app can open in a new tab; otherwise null. Reject
  // absolute / `..`-traversing paths first (same guard as fileRoutePath)
  // — the preview-URL builders don't, so a `..` would normalize out of
  // the intended mount.
  function artifactUrl(value: unknown): string | null {
    return collectionUi().fileAssetUrl(value);
  }

  // In-app File Explorer route for a workspace path — the fallback for
  // `file` values that aren't a directly-served artifact. The host owns the
  // path validity + route scheme.
  function fileRoutePath(value: unknown): string | null {
    return collectionUi().fileRoutePath(value);
  }

  function detailText(value: unknown): string {
    if (value === undefined || value === null || value === "") return "—";
    return String(value);
  }

  function tableRows(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  }

  function hasTableRows(value: unknown): boolean {
    return tableRows(value).length > 0;
  }

  function formatSubCell(subField: FieldSpec, value: unknown, record: CollectionItem | null): string {
    if (subField.type === "money") return formatMoney(value, resolveCurrency(subField, record), locale.value);
    if (subField.type === "ref" && subField.to && typeof value === "string" && value.length > 0) return refDisplay(subField.to, value);
    return formatCell(value, subField.type);
  }

  function inputTypeFor(type: FieldType): string {
    if (type === "email") return "email";
    if (type === "number") return "number";
    if (type === "money") return "number";
    if (type === "date") return "date";
    if (type === "datetime") return "datetime-local";
    return "text";
  }

  const stepFor = stepForFieldType;

  // The derive loop itself lives in `utils/collections/deriveAll.ts`,
  // shared with the server's manageCollection enrichment so both sides
  // compute identical values. This composable re-exposes it (typed with
  // the richer client types via structural assignability) plus the
  // collection-bound convenience wrappers below.

  function evaluateDerivedAgainstItem(field: FieldSpec, fieldKey: string, item: CollectionItem): number | null {
    if (!field.formula || !collection.value) return null;
    const enriched = deriveAll(collection.value.schema, item, refRecordCache.value);
    const result = enriched[fieldKey];
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  }

  function derivedDisplay(field: FieldSpec, computedValue: unknown, record: CollectionItem | null): string {
    if (computedValue === null || computedValue === undefined) return "—";
    if (field.display === "money") return formatMoney(computedValue, resolveCurrency(field, record), locale.value);
    return formatCell(computedValue, field.display ?? "number");
  }

  return {
    refCache,
    refRecordCache,
    embedCache,
    resetLinkedCaches,
    loadLinkedCollections,
    refDisplay,
    refOptions,
    embedOptions,
    embedViewsFor,
    resolveCurrency,
    currencySymbol,
    formatMoney,
    formatCell,
    detailText,
    isExternalUrl,
    artifactUrl,
    fileRoutePath,
    tableRows,
    hasTableRows,
    formatSubCell,
    inputTypeFor,
    stepFor,
    deriveAll,
    evaluateDerivedAgainstItem,
    derivedDisplay,
  };
}
