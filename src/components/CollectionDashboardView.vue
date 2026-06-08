<template>
  <div class="flex flex-col gap-4 p-1" data-testid="collection-dashboard">
    <!-- Stat cards: one per declared enum value (+ an Uncategorized card when
         records carry an empty/unknown value). Colour is notifyWhen-driven —
         a value flagged by the schema's notifyWhen reads red, the empty value
         reads grey, everything else green. -->
    <div class="grid gap-3" :class="cardGridClass">
      <button
        v-for="card in cards"
        :key="card.value"
        type="button"
        class="flex flex-col items-center justify-center rounded-xl border px-4 py-4 text-center transition-colors"
        :class="STATUS_CARD_CLASS[card.status]"
        :data-testid="`collection-dashboard-stat-${card.value || 'uncategorized'}`"
        @click="emit('select', null)"
      >
        <span class="text-3xl font-bold leading-none">{{ card.count }}</span>
        <span class="mt-1.5 text-xs font-semibold truncate max-w-full" :title="card.label">{{ card.label }}</span>
      </button>
    </div>

    <!-- Alert box: records whose notifyWhen field holds one of the flagged
         values. Hidden entirely when nothing is flagged. -->
    <div v-if="alertItems.length > 0" class="rounded-xl border border-amber-200 bg-amber-50/70 p-4" data-testid="collection-dashboard-alert">
      <div class="flex items-center gap-2 text-sm font-bold text-amber-800">
        <span class="material-icons text-base">warning_amber</span>
        <span>{{ t("collectionsView.dashboardAlertHeading", { label: alertLabel, count: alertItems.length }) }}</span>
      </div>
      <ul class="mt-2.5 space-y-1">
        <li v-for="item in alertItems" :key="itemId(item)">
          <button
            type="button"
            class="text-left text-sm text-amber-900 hover:underline"
            :aria-label="t('collectionsView.kanbanOpenCard', { label: label(item) })"
            :data-testid="`collection-dashboard-alert-${itemId(item)}`"
            @click="emit('select', itemId(item))"
          >
            <span class="font-semibold">{{ label(item) }}</span>
          </button>
        </li>
      </ul>
    </div>

    <!-- Full list with a status dot + value badge per record, mirroring the
         table's openable rows. -->
    <div class="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div class="px-4 py-2.5 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {{ groupSpec?.label ?? t("collectionsView.dashboardAllItems") }}
      </div>
      <ul class="divide-y divide-slate-100">
        <li v-for="row in rows" :key="itemId(row.item)">
          <button
            type="button"
            class="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50/70 transition-colors"
            :class="itemId(row.item) === selected ? 'bg-indigo-50/40' : ''"
            :aria-label="t('collectionsView.kanbanOpenCard', { label: label(row.item) })"
            :data-testid="`collection-dashboard-row-${itemId(row.item)}`"
            @click="emit('select', itemId(row.item))"
          >
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="STATUS_DOT_CLASS[row.status]" />
            <span class="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate">{{ label(row.item) }}</span>
            <span v-if="row.badge" class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="STATUS_BADGE_CLASS[row.status]">
              {{ row.badge }}
            </span>
            <span class="material-icons text-base text-slate-300 shrink-0">chevron_right</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { fieldVisible } from "../utils/collections/actionVisible";
import { itemIdOf, itemLabelOf, labelFieldFor } from "../utils/collections/itemLabel";
import type { CollectionItem, CollectionSchema } from "./collectionTypes";

const props = defineProps<{
  schema: CollectionSchema;
  /** The `enum` field whose value drives the stat cards + status dots. */
  groupField: string;
  items: CollectionItem[];
  /** Primary-key of the currently-open record (highlighted row). */
  selected?: string;
}>();

const emit = defineEmits<{
  select: [id: string | null];
}>();

const { t } = useI18n();

/** A record's status drives its colour: an enum value flagged by notifyWhen
 *  reads alert (red), the empty/unknown value neutral (grey), else ok (green). */
type DashboardStatus = "alert" | "ok" | "none";

const STATUS_CARD_CLASS: Record<DashboardStatus, string> = {
  alert: "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
  none: "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100",
};
const STATUS_DOT_CLASS: Record<DashboardStatus, string> = {
  alert: "bg-rose-500",
  ok: "bg-emerald-500",
  none: "bg-slate-300",
};
const STATUS_BADGE_CLASS: Record<DashboardStatus, string> = {
  alert: "bg-rose-100 text-rose-700",
  ok: "bg-emerald-100 text-emerald-700",
  none: "bg-slate-100 text-slate-500",
};

const groupSpec = computed(() => props.schema.fields[props.groupField]);
const labelField = computed<string | null>(() => labelFieldFor(props.schema));

/** The schema's notifyWhen, kept only when it targets an actual field — its
 *  `in` values flag the alert section regardless of which field groups the
 *  board. */
const notify = computed(() => {
  const spec = props.schema.notifyWhen;
  return spec && props.schema.fields[spec.field] ? spec : null;
});

function itemId(item: CollectionItem): string {
  return itemIdOf(item, props.schema);
}
function label(item: CollectionItem): string {
  return itemLabelOf(item, props.schema, labelField.value);
}

/** A record's value on the grouping field, "" for empty/unknown. */
function valueOf(item: CollectionItem): string {
  const raw = item[props.groupField];
  if (raw === undefined || raw === null) return "";
  const value = String(raw);
  return (groupSpec.value?.values ?? []).includes(value) ? value : "";
}

/** The status of a grouping-field value: alert when notifyWhen targets THIS
 *  field and flags the value, none for the empty value, else ok. */
function statusOfValue(value: string): DashboardStatus {
  if (value === "") return "none";
  const spec = notify.value;
  if (spec && spec.field === props.groupField && spec.in.includes(value)) return "alert";
  return "ok";
}

// Records placed on the dashboard, dropping any whose grouping field is hidden
// by a `when` predicate — same rule the Kanban board applies.
const visibleItems = computed<CollectionItem[]>(() => (groupSpec.value ? props.items.filter((item) => fieldVisible(groupSpec.value, item)) : []));

interface StatCard {
  value: string;
  label: string;
  count: number;
  status: DashboardStatus;
}

const cards = computed<StatCard[]>(() => {
  const values = groupSpec.value?.values ?? [];
  const declared = new Set(values);
  const counts = new Map<string, number>(values.map((value) => [value, 0]));
  let uncategorized = 0;
  for (const item of visibleItems.value) {
    // Test declared membership, not truthiness: an enum that explicitly
    // declares "" as a value must count into its own card rather than
    // falling through to the (suppressed) Uncategorized bucket.
    const value = valueOf(item);
    if (declared.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
    else uncategorized += 1;
  }
  const result: StatCard[] = values.map((value) => ({ value, label: value, count: counts.get(value) ?? 0, status: statusOfValue(value) }));
  if (uncategorized > 0 && !values.includes("")) {
    result.push({ value: "", label: t("collectionsView.kanbanUncategorized"), count: uncategorized, status: "none" });
  }
  return result;
});

/** Grid columns clamp at 4 so a wide enum wraps instead of shrinking cards. */
const cardGridClass = computed<string>(() => {
  const columns = Math.min(cards.value.length, 4);
  return ["", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"][columns] ?? "grid-cols-4";
});

/** Records flagged by notifyWhen (over its own field, which may differ from
 *  the grouping field). */
const alertItems = computed<CollectionItem[]>(() => {
  const spec = notify.value;
  if (!spec) return [];
  return visibleItems.value.filter((item) => spec.in.includes(String(item[spec.field] ?? "")));
});

/** Heading label for the alert box: the flagged value(s), e.g. "要接種". */
const alertLabel = computed<string>(() => notify.value?.in.join(" / ") ?? "");

interface DashboardRow {
  item: CollectionItem;
  status: DashboardStatus;
  badge: string;
}

const rows = computed<DashboardRow[]>(() =>
  visibleItems.value.map((item) => {
    const value = valueOf(item);
    return { item, status: statusOfValue(value), badge: value };
  }),
);
</script>
