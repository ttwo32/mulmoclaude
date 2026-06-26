// Client store for the dashboard layout (per-tile view mode + tile
// order for the favorites grid). Singleton module state shared across
// consumers, mirroring `useShortcuts`: persistence is server-side
// (`config/dashboard.json` via PUT /api/dashboard); the client owns the
// full array and replaces it wholesale. Mutations are optimistic with
// rollback on failure and serialised so overlapping replace-all PUTs
// never land out of order.
//
// Membership (which collections appear) is NOT owned here — it derives
// from the user's pinned collection shortcuts (favorites). `reconcile`
// folds a fresh favorite-slug list into the stored layout: it appends
// newly-favorited collections and prunes ones that were unpinned, while
// preserving the user's dashboard order and per-tile view modes.

import { computed, ref, type ComputedRef } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet, apiPut } from "../utils/api";
import type { DashboardTile } from "../types/dashboard";

const tiles = ref<DashboardTile[]>([]);
const loadError = ref<string | null>(null);
/** True only after a GET has authoritatively populated `tiles`. Until
 *  then, mutations refuse to persist — a replace-all PUT built on the
 *  empty default would clobber an existing `dashboard.json`. */
const loaded = ref(false);
let loadPromise: Promise<void> | null = null;

interface DashboardResponse {
  tiles: DashboardTile[];
}

/** Load once per session (deduped). A FAILED load is not cached so the
 *  next call retries rather than permanently serving the failure. */
async function load(force = false): Promise<void> {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    const result = await apiGet<DashboardResponse>(API_ROUTES.dashboard);
    if (!result.ok) {
      loadError.value = result.error;
      loadPromise = null; // allow retry on the next call
      return;
    }
    loadError.value = null;
    tiles.value = result.data.tiles;
    loaded.value = true;
  })();
  return loadPromise;
}

// Every mutation runs through this chain so the replace-all PUTs never
// overlap (the same race `useShortcuts` guards against).
let mutationChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(task, task);
  mutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Persist the given list, rolling the local ref back to `previous` on
 *  failure. Returns true on success. Call only from inside `enqueue`. */
async function persist(next: DashboardTile[], previous: DashboardTile[]): Promise<boolean> {
  tiles.value = next;
  const result = await apiPut<DashboardResponse>(API_ROUTES.dashboard, { tiles: next });
  if (!result.ok) {
    tiles.value = previous;
    loadError.value = result.error;
    console.error("[useDashboard] persist failed", result.error);
    return false;
  }
  tiles.value = result.data.tiles;
  loadError.value = null;
  return true;
}

/** Replace the full ordered tile list (used by drag-to-reorder). */
function setTiles(next: DashboardTile[]): Promise<boolean> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return false; // never overwrite an unread list
    return persist(next, tiles.value);
  });
}

/** Set (or, when null, clear) one tile's view mode. No-op if the slug
 *  isn't a tile. */
function setViewMode(slug: string, viewMode: string | null): Promise<boolean> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return false;
    if (!tiles.value.some((tile) => tile.slug === slug)) return true;
    const previous = tiles.value;
    const next = previous.map((tile) => {
      if (tile.slug !== slug) return tile;
      if (viewMode === null) {
        const { viewMode: __drop, ...rest } = tile;
        return rest;
      }
      return { ...tile, viewMode };
    });
    return persist(next, previous);
  });
}

/** Fold a fresh favorite-slug list into the stored layout: keep stored
 *  tiles whose slug is still a favorite (preserving order + view mode),
 *  then append any favorites not yet present (in the favorites' order).
 *  Persists only when something drifted, so the file self-heals after a
 *  pin / unpin without a redundant PUT on every visit. */
function reconcile(favoriteSlugs: string[]): Promise<void> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return; // never overwrite an unread list
    const favoriteSet = new Set(favoriteSlugs);
    const kept = tiles.value.filter((tile) => favoriteSet.has(tile.slug));
    const keptSlugs = new Set(kept.map((tile) => tile.slug));
    const appended = favoriteSlugs.filter((slug) => !keptSlugs.has(slug)).map((slug) => ({ slug }) as DashboardTile);
    const next = [...kept, ...appended];
    const drifted = next.length !== tiles.value.length || next.some((tile, i) => tile.slug !== tiles.value[i]?.slug);
    if (drifted) await persist(next, tiles.value);
  });
}

export function useDashboard(): {
  tiles: ComputedRef<DashboardTile[]>;
  loadError: ComputedRef<string | null>;
  load: (force?: boolean) => Promise<void>;
  setTiles: (next: DashboardTile[]) => Promise<boolean>;
  setViewMode: (slug: string, viewMode: string | null) => Promise<boolean>;
  reconcile: (favoriteSlugs: string[]) => Promise<void>;
} {
  void load();
  return {
    tiles: computed(() => tiles.value),
    loadError: computed(() => loadError.value),
    load,
    setTiles,
    setViewMode,
    reconcile,
  };
}
