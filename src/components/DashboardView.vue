<template>
  <div class="h-full overflow-auto p-4" data-testid="dashboard-view">
    <!-- Empty state: no pinned collections yet. -->
    <div v-if="favoriteSlugs.length === 0" class="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2">
      <span class="material-icons text-4xl text-slate-300">dashboard</span>
      <p class="text-sm font-medium">{{ t("dashboard.empty") }}</p>
      <p class="text-xs">{{ t("dashboard.emptyHint") }}</p>
    </div>

    <!-- Two-column grid of favorite collections. Each tile shows a live
         embedded CollectionView in the tile's chosen view mode. -->
    <div v-else class="grid gap-4 sm:grid-cols-2" data-testid="dashboard-grid">
      <section
        v-for="(tile, index) in tiles"
        v-show="metaFor(tile.slug)"
        :key="tile.slug"
        class="flex flex-col border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm"
        :class="{ 'ring-2 ring-indigo-400': dropIndex === index }"
        :data-testid="`dashboard-tile-${tile.slug}`"
        @dragover.prevent="dropIndex = index"
        @drop.prevent="onDrop(index)"
      >
        <!-- Tile header: drag handle + title/icon (opens full view) + view picker. -->
        <header class="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50">
          <span
            class="material-icons text-base text-slate-400 cursor-grab select-none"
            draggable="true"
            :title="t('dashboard.dragHint')"
            :aria-label="t('dashboard.dragHint')"
            data-testid="dashboard-tile-drag"
            @dragstart="onDragStart(index)"
            @dragend="onDragEnd"
            >drag_indicator</span
          >
          <button
            type="button"
            class="flex items-center gap-1.5 min-w-0 flex-1 text-left text-sm font-semibold text-slate-700 hover:text-indigo-600"
            :title="t('dashboard.openFull')"
            @click="openFull(tile.slug)"
          >
            <span class="material-symbols-outlined text-base flex-none">{{ metaFor(tile.slug)?.icon || "apps" }}</span>
            <span class="truncate">{{ metaFor(tile.slug)?.title || tile.slug }}</span>
          </button>
          <select
            class="flex-none text-xs bg-white border border-slate-200 rounded px-1.5 py-1 text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            :value="effectiveView(tile)"
            :aria-label="t('dashboard.viewPickerLabel')"
            :data-testid="`dashboard-tile-view-${tile.slug}`"
            @change="onPickView(tile.slug, $event)"
          >
            <option v-for="mode in modesFor(tile.slug)" :key="mode" :value="mode">{{ modeLabel(tile.slug, mode) }}</option>
          </select>
        </header>
        <!-- Live embedded view. `:key` remounts the view when the mode
             changes so the new initial view takes effect. -->
        <div class="h-80 overflow-auto">
          <CollectionView :key="`${tile.slug}:${effectiveView(tile)}`" :slug="tile.slug" :initial-view="effectiveView(tile)" hide-view-toggle />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { CollectionView, applicableViewModes, customViewKey, type CollectionViewMode } from "@mulmoclaude/collection-plugin/vue";
import { useShortcuts } from "../composables/useShortcuts";
import { useDashboard } from "../composables/useDashboard";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PAGE_ROUTES } from "../router/pageRoutes";
import type { DashboardTile } from "../types/dashboard";
import type { CollectionDetailResponse, CollectionSchema } from "./collectionTypes";

const { t } = useI18n();
const router = useRouter();

const { shortcuts, load: loadShortcuts } = useShortcuts();
const { tiles, load: loadDashboard, reconcile, setTiles, setViewMode } = useDashboard();

// Favorites = pinned COLLECTION shortcuts (feeds are excluded — the
// dashboard is a collections surface). The cached title/icon ride along
// so a tile renders without an extra fetch.
const collectionFavorites = computed(() => shortcuts.value.filter((entry) => entry.kind === "collection"));
const favoriteSlugs = computed(() => collectionFavorites.value.map((entry) => entry.slug));
const metaFor = (slug: string) => collectionFavorites.value.find((entry) => entry.slug === slug);

// Per-slug schema, fetched lazily to drive each tile's view picker.
const schemas = ref<Record<string, CollectionSchema>>({});

async function loadSchema(slug: string): Promise<void> {
  if (schemas.value[slug]) return;
  const url = API_ROUTES.collections.detail.replace(":slug", encodeURIComponent(slug));
  const result = await apiGet<CollectionDetailResponse>(url);
  if (result.ok) schemas.value = { ...schemas.value, [slug]: result.data.collection.schema };
}

function modesFor(slug: string): CollectionViewMode[] {
  const schema = schemas.value[slug];
  return schema ? applicableViewModes(schema) : ["table"];
}

/** The view a tile opens in: its stored mode when still applicable, else
 *  the first available mode (table). */
function effectiveView(tile: DashboardTile): CollectionViewMode {
  const modes = modesFor(tile.slug);
  return tile.viewMode && modes.includes(tile.viewMode as CollectionViewMode) ? (tile.viewMode as CollectionViewMode) : (modes[0] ?? "table");
}

const BUILTIN_LABEL_KEYS: Record<string, string> = {
  table: "dashboard.viewTable",
  calendar: "dashboard.viewCalendar",
  kanban: "dashboard.viewKanban",
};

function modeLabel(slug: string, mode: CollectionViewMode): string {
  const builtin = BUILTIN_LABEL_KEYS[mode];
  if (builtin) return t(builtin);
  // Custom view: use the author-authored label from the schema.
  const view = schemas.value[slug]?.views?.find((entry) => customViewKey(entry.id) === mode);
  return view?.label ?? mode;
}

function onPickView(slug: string, event: Event): void {
  const { value } = event.target as HTMLSelectElement;
  void setViewMode(slug, value);
}

function openFull(slug: string): void {
  router.push({ name: PAGE_ROUTES.collections, params: { slug } }).catch(() => {});
}

// ── Drag-to-reorder (independent of the launcher's shortcut order) ──
const dragIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);

function onDragStart(index: number): void {
  dragIndex.value = index;
}

function onDragEnd(): void {
  dragIndex.value = null;
  dropIndex.value = null;
}

function onDrop(target: number): void {
  const from = dragIndex.value;
  onDragEnd();
  if (from === null || from === target) return;
  const next = [...tiles.value];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  void setTiles(next);
}

// First load: fold favorites into the stored layout once both lists are
// authoritatively loaded (so an empty pre-load list never prunes tiles).
onMounted(async () => {
  await Promise.all([loadShortcuts(), loadDashboard()]);
  await reconcile(favoriteSlugs.value);
});

// Later pin/unpin while on the page re-reconciles. Non-immediate so it
// can't fire on the empty pre-load list.
watch(favoriteSlugs, (slugs) => void reconcile(slugs));

// Fetch each tile's schema as the layout settles.
watch(tiles, (list) => list.forEach((tile) => void loadSchema(tile.slug)), { immediate: true });
</script>
