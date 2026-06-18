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

`CollectionUi` now exposes: `fetchCollectionDetail`, `fileAssetUrl`, `fileRoutePath`, `imageSrc`.

### Remaining — the API-heavy cluster (design the rest of the context in one pass)

`CollectionViewConfigModal` (108) + `CollectionCustomView` (152) + `CollectionView` (2,131, the
root that renders both) share one large host surface. Survey of `CollectionView`'s coupling →
the `CollectionUi` additions needed:

- **Collection CRUD/actions** (replaces `apiGet/Post/Put/Delete` + `API_ROUTES.collections.*`):
  create item, update item, delete item, run item-action, run collection-action, refresh,
  feed detail (`API_ROUTES.feeds.detail`).
- **Custom views** (`CollectionCustomView`): `mintViewToken(slug, viewId)` (apiPost), `fetchViewHtml(slug, viewId)`
  (apiFetchRaw). `buildCustomViewSrcdoc` is a pure util → move into the package (`vue/` or core).
- **Custom-view delete** (`CollectionViewConfigModal`): `deleteView(slug, viewId)` (apiDelete) + `confirm(opts)`.
- **Navigation**: `navigate` (router push/replace + `PAGE_ROUTES.collections` / `PAGE_ROUTES.feeds`).
- **App integration**: `sendMessage`/`startNewChat` (`useAppApi`), `confirm` (`useConfirm`),
  `pin` (`useShortcuts`), `notify` (`useNotifications`).
- **Generic UI**: `ConfirmModal`, `PinToggle` — inject as context-provided components or move.
- **Misc utils**: `shortHexId` (`utils/id`), `defangForPrompt` (`utils/promptSafety`),
  `BUILTIN_ROLE_IDS` (`config/roles`), `collectionNotifiedSeverities` (host notifier bridge stays host-side).

### Sequence (each its own green commit)
1. ✅ done — see steps 1, 2a–2e above. Six leaf components migrated; `enumColors`/`draft` shims still in place (removed when `CollectionView` moves).
2. Expand `CollectionUi` with the CRUD/nav/confirm/app surface above; move `CollectionViewConfigModal` + `CollectionCustomView` + `CollectionView` → package `./vue`; remove the `enumColors`/`draft` shims.
3. Browsable pages (`CollectionsIndexView`, `/collections` route) → package + host router wiring.
4. Plugin `./vue` entry (View + Preview + lang); shrink the host `presentCollection` adapter; bump to `0.3.0` (new `./vue` + `./style.css` exports) + publish.

## Publish gate
The launcher pins `@mulmoclaude/collection-plugin@^0.2.x`; bump + republish before each PR/smoke run
so the clean-install resolves the current content (0.2.0 → 0.2.1 already done in PR #1723). The
`./vue` + `./style.css` additions make the next release a minor bump (`0.3.0`).
