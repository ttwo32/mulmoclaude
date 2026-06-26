# Extract presentCollection + collection engine → @mulmoclaude/collection-plugin

Goal: package the Collections feature so MulmoTerminal can import it like `@mulmoclaude/chart-plugin`.

## Status

**Shipped in PR #1723** (`@mulmoclaude/collection-plugin@0.2.1`, published):

- ✅ **1a** — isomorphic engine (`derivedFormula`, `deriveAll`, `actionVisible`) → package `.`; removed the server→`src/` reach-in.
- ✅ **1b** — canonical schema types consolidated into the package core; server `types.ts` + frontend `collectionTypes.ts` re-export. Feeds decoupled (`IngestSpec extends CollectionIngest`).
- ✅ **1b-rest** — remaining pure utils (`sortItems`, `itemLabel`, `calendarGrid`) → core.
- ✅ **1c** — full server engine → `./server` entry behind `configureCollectionHost({ workspaceRoot, log, paths, isPresetSlug })`:
  - 1c-i: host binding + `paths`
  - 1c-ii: `io` + `validate` + `LoadedCollection` + atomic-write port
  - 1c-iii: `discovery` (+ zod) + `templatePath`; binding extended with skills/feeds path helpers; ingest vocab moved into the schema
  - 1c-iv/v: `derive` / `spawn` / `delete` / `views`
  - host-integration stays host-side: `notifications`, `watcher`, `api/routes/collections.ts`, `manageCollection.ts`
- ✅ **1d-core** — `presentCollection` tool definition + pure executor → package `.` (gui-chat-protocol peer dep).
- ✅ **1d step 1** — UI view-state types + `enumColors` + `draft` → core; host `collectionTypes.ts` owns no types now. `enumColors`/`draft` reached by host components via thin re-export shims (removed when components move).

## Phase 2 — the collection frontend (in progress, branch `feat/collection-ui-context`)

The View layer is gated on a **`CollectionUi`** injection binding — NOT Vue `provide`, but a
module-level singleton in `src/vue/uiContext.ts` (`configureCollectionUi()` / `collectionUi()`),
mirroring the server's `configureCollectionHost`. The host wires it once at startup
(`src/composables/collections/uiHost.ts`, side-effect import in `main.ts`); MulmoTerminal supplies
its own. The `./vue` entry side-effect-imports the package's compiled `style.css`.

**The SFC build pipeline is done** (step 2a): `./vue` now builds Vue SFCs via
`@vitejs/plugin-vue` + `@tailwindcss/vite` (shipped `dist/style.css`, new `./style.css` export),
with d.ts emitted by `vue-tsc` (not vite-plugin-dts). vue-i18n is a peer (`^11.4.4`); components
keep `useI18n()` and resolve the host's i18n instance + keys.

- ✅ **step 1** — `CollectionUi` binding + move `useCollectionRendering` onto it (`7f675b94`).
- ✅ **step 2a** — SFC build pipeline + move `CollectionRecordModal` (pure) — `d48040a5`.
- ✅ **step 2b** — `CollectionEmbedView` (validates the vue-i18n + global `<router-link>` path) — `721f1433`.
- ✅ **step 2c** — `CollectionCalendarView` + `CollectionDayView` — `68694c73`.
- ✅ **step 2d** — `CollectionKanbanView` (+ `vuedraggable` package dep, `CollectionNotifySeverity` type) — `294856f4`.
- ✅ **step 2e** — `CollectionRecordPanel` (+ `imageSrc` context capability) — `0f040837`.

Steps 1 + 2a–2e shipped in **PR #1725** as **`@mulmoclaude/collection-plugin@0.3.0`** (published; launcher pin → `^0.3.0`).

**Branch `feat/collection-view-move`** (off `feat/collection-ui-context`) — the API-heavy cluster:

- ✅ **step 2f** — `CollectionViewConfigModal` (+ `confirm`, `deleteView` capabilities; shared `errorMessage` core helper) — `6f5a173c`.
- ✅ **step 2g** — `CollectionCustomView` (+ `mintViewToken`, `fetchViewHtml`, `buildViewSrcdoc`; context result/token types exported from `./vue`) — `a52023c5`.
- ✅ **step 2h-prep** — moved `shortHexId` / `defangForPrompt` / `collectionViewMode` (CollectionView-only utils) into the package; server now imports `defangForPrompt` from the package too — `90f24b20`.
- ✅ **step 2h** — **`CollectionView`** (the 2,134-LOC root) → `./vue` — `4d90f783`.
- ✅ **step 2h-cleanup** — removed the dead `enumColors` / `draft` / `collectionEmbed` host shims — `7a233984`.

**The entire collection View layer is now in the package.** `CollectionUi` exposes the full host
surface: `fetchCollectionDetail` (now `CollectionApiResult`, with `status`), `fileAssetUrl`,
`fileRoutePath`, `imageSrc`, `confirm`, `deleteView`, `mintViewToken`, `fetchViewHtml`,
`buildViewSrcdoc`, `createItem`, `updateItem`, `deleteItem`, `deleteCollection`, `deleteFeed`,
`runItemAction`, `runCollectionAction`, `refreshCollection`, `routeSlug`, `routeSelectedId`,
`isFeedRoute`, `setSelectedId`, `gotoIndex`, `startChat`, `generalRoleId`, `unpin`,
`notifiedSeverities`, `pinToggle`. Routing is wired via the vue-router *instance* (no inject
barrier); `startChat` + `notifiedSeverities` are deferred to `installCollectionAppBindings`
(App.vue setup) because `useAppApi`/`useNotifications` need a component context. App.vue renders the
global `<ConfirmModal />`; `PinToggle` is injected via `<component :is>`.

### Sequence (each its own green commit) — on branch `feat/collection-view-move`
1. ✅ done — steps 1, 2a–2e (PR #1725, merged).
2. ✅ sub-modals — steps 2f, 2g.
3. ✅ **`CollectionView`** — steps 2h-prep / 2h / 2h-cleanup. View layer extraction COMPLETE.
4. ✅ **Browsable pages** — `CollectionsIndexView` + `FeedsView` moved; added `listCollections` /
   `listFeeds` / `gotoDetail` / `reconcileShortcuts` / `personalRoleId` to the binding.
5. ✅ **Self-contained i18n** — the plugin ships its OWN vue-i18n instance + all 8 locales
   (`collectionsView.*` + duplicated `common.*`); components use `useCollectionI18n()`; the host's
   dead `collectionsView` block was removed from all 8 locale files. `localeTag()` (via `unref`)
   feeds the host locale through the binding. The "ToolPlugin like chart" idea was dropped —
   `presentCollection` is a *built-in* plugin (host-specific registration), not a runtime plugin, and
   its tool def already lives in the package.

**The extraction is functionally complete: every collection component is importable from
`@mulmoclaude/collection-plugin/vue`, the plugin owns its i18n, and it uses no host i18n resources.**

Remaining before a release: bump to `0.4.0` + launcher pin → `^0.4.0`, push, open the PR, publish.

## Publish gate
The launcher pins `@mulmoclaude/collection-plugin`; bump + republish before each PR/smoke run so the
clean-install resolves the current content (`0.2.1` in PR #1723, `0.3.0` in PR #1725). The
CollectionView + index-pages + i18n work (new capabilities, no new export surface beyond the already-
shipped `./vue`) is a minor bump (`0.4.0`).
