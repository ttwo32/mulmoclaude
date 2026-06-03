<template>
  <div class="flex flex-col gap-3" data-testid="collection-calendar">
    <!-- Month nav -->
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 transition-colors"
        :aria-label="t('collectionsView.calendarPrevMonth')"
        data-testid="collection-calendar-prev"
        @click="stepMonth(-1)"
      >
        <span class="material-icons text-lg">chevron_left</span>
      </button>
      <button
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 transition-colors"
        :aria-label="t('collectionsView.calendarNextMonth')"
        data-testid="collection-calendar-next"
        @click="stepMonth(1)"
      >
        <span class="material-icons text-lg">chevron_right</span>
      </button>
      <h3 class="text-sm font-bold text-slate-800 flex-1" data-testid="collection-calendar-month">{{ monthLabel }}</h3>
      <button
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-xs font-bold transition-colors"
        data-testid="collection-calendar-today"
        @click="goToday"
      >
        {{ t("collectionsView.calendarToday") }}
      </button>
    </div>

    <!-- Weekday header -->
    <div class="grid grid-cols-7 gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider select-none">
      <div v-for="(label, idx) in weekdayLabels" :key="idx" class="px-1 py-1 text-center">{{ label }}</div>
    </div>

    <!-- Day grid. A day with no records is itself the create affordance —
         rendered with `role="button"` + keyboard handlers (no chips inside,
         so no nested-interactive conflict). Populated days are plain
         containers; their chips are the interactive elements. -->
    <div class="grid grid-cols-7 gap-1">
      <div
        v-for="{ cell, entries, creatable } in cells"
        :key="cell.key"
        class="min-h-[5.5rem] rounded-lg border p-1 flex flex-col gap-1 overflow-hidden transition-colors"
        :class="[
          cell.inMonth ? 'bg-white border-slate-200' : 'bg-slate-50/50 border-slate-100',
          creatable ? 'cursor-pointer hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30' : '',
        ]"
        :role="creatable ? 'button' : undefined"
        :tabindex="creatable ? 0 : undefined"
        :aria-label="creatable ? t('collectionsView.calendarCreateOn', { date: cell.key }) : undefined"
        :data-testid="`collection-calendar-day-${cell.key}`"
        @click="creatable && emit('createOn', cell.key)"
        @keydown.enter.prevent="creatable && emit('createOn', cell.key)"
        @keydown.space.prevent="creatable && emit('createOn', cell.key)"
      >
        <div class="flex items-center justify-end">
          <span
            class="text-[11px] font-bold h-5 min-w-5 px-1 inline-flex items-center justify-center rounded-full"
            :class="cell.key === todayKey ? 'bg-indigo-600 text-white' : cell.inMonth ? 'text-slate-500' : 'text-slate-300'"
            >{{ cell.ymd.day }}</span
          >
        </div>
        <button
          v-for="entry in entries"
          :key="entry.id"
          type="button"
          class="text-left text-[11px] leading-tight font-semibold truncate rounded px-1.5 py-0.5 border transition-colors"
          :class="entry.id === selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'"
          :data-testid="`collection-calendar-chip-${entry.id}`"
          @click.stop="emit('select', entry.id)"
        >
          {{ entry.label }}
        </button>
      </div>
    </div>

    <!-- Records with no usable anchor date — listed rather than dropped. -->
    <div v-if="bucketed.noDate.length > 0" class="flex flex-wrap items-center gap-1.5 pt-1" data-testid="collection-calendar-no-date">
      <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">{{ t("collectionsView.calendarNoDate") }}</span>
      <button
        v-for="entry in undatedEntries"
        :key="entry.id"
        type="button"
        class="text-[11px] font-semibold truncate rounded px-1.5 py-0.5 border transition-colors"
        :class="entry.id === selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'"
        :data-testid="`collection-calendar-undated-${entry.id}`"
        @click="emit('select', entry.id)"
      >
        {{ entry.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { bucketRecords, buildMonthGrid, ymdKey, spanCoversDay, type Ymd } from "../utils/collections/calendarGrid";
import type { CollectionItem, CollectionSchema } from "./collectionTypes";

const props = defineProps<{
  schema: CollectionSchema;
  items: CollectionItem[];
  /** The `date` field whose value places each record on the grid. */
  anchorField: string;
  /** Optional second `date` field — records span anchor→end inclusive. */
  endField?: string;
  /** Primary-key of the currently-open record (highlighted chip). */
  selected?: string;
  /** Whether empty-cell clicks create a record (Add gated for singletons). */
  canCreate: boolean;
}>();

const emit = defineEmits<{
  select: [id: string | null];
  createOn: [iso: string];
}>();

const { t, locale } = useI18n();

// Visible month, 1-12. Initial value is the current local month — app
// code, so `new Date()` is fine (the pure grid helpers stay clock-free).
const now = new Date();
const viewYear = ref(now.getFullYear());
const viewMonth = ref(now.getMonth() + 1);

const todayKey = ymdKey({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });

const grid = computed(() => buildMonthGrid(viewYear.value, viewMonth.value));

const bucketed = computed(() => bucketRecords(props.items, props.anchorField, props.endField));

function itemId(item: CollectionItem): string {
  return String(item[props.schema.primaryKey] ?? "");
}

/** Chip label: the schema's `displayField` value, else the primary key. */
function itemLabel(item: CollectionItem): string {
  const field = props.schema.displayField;
  if (field) {
    const value = item[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return itemId(item);
}

interface CalendarEntry {
  id: string;
  label: string;
}

/** Records whose span covers a given day, in the bucket's start order. */
function recordsOnDay(day: Ymd): CalendarEntry[] {
  return bucketed.value.spans.filter((span) => spanCoversDay(span, day)).map((span) => ({ id: itemId(span.item), label: itemLabel(span.item) }));
}

/** Grid cells paired with their records, computed once per render. A cell
 *  is `creatable` only when it has NO records — clicking an empty day is
 *  the create affordance; clicking a populated day must NOT create (it
 *  would silently duplicate-create on a date that already has events). */
const cells = computed(() =>
  grid.value.map((cell) => {
    const entries = recordsOnDay(cell.ymd);
    return { cell, entries, creatable: props.canCreate && entries.length === 0 };
  }),
);

const undatedEntries = computed<CalendarEntry[]>(() => bucketed.value.noDate.map((item) => ({ id: itemId(item), label: itemLabel(item) })));

const monthLabel = computed<string>(() => {
  try {
    return new Intl.DateTimeFormat(locale.value, { month: "long", year: "numeric" }).format(new Date(Date.UTC(viewYear.value, viewMonth.value - 1, 1)));
  } catch {
    return `${viewYear.value}-${String(viewMonth.value).padStart(2, "0")}`;
  }
});

/** Localized short weekday names, Sunday-first (matches the grid). */
const weekdayLabels = computed<string[]>(() => {
  try {
    const formatter = new Intl.DateTimeFormat(locale.value, { weekday: "short" });
    // 2024-01-07 is a Sunday — anchor the week there.
    return Array.from({ length: 7 }, (_, idx) => formatter.format(new Date(Date.UTC(2024, 0, 7 + idx))));
  } catch {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  }
});

function stepMonth(delta: number): void {
  const next = viewMonth.value + delta;
  if (next < 1) {
    viewMonth.value = 12;
    viewYear.value -= 1;
  } else if (next > 12) {
    viewMonth.value = 1;
    viewYear.value += 1;
  } else {
    viewMonth.value = next;
  }
}

function goToday(): void {
  viewYear.value = now.getFullYear();
  viewMonth.value = now.getMonth() + 1;
}
</script>
