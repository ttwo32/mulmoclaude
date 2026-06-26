# refactor: trim toolbar surfaces — retire source/feed manage skills, sources/news + calendar views, and the manageCalendar tool

Status: proposed (next PR). Builds on #1629 (feeds are now help-file-managed, no `manageFeed` tool). DO NOT start until #1629 lands.

## Context

- #1629 dropped the `manageFeed` MCP tool: feeds are authored as `feeds/<slug>/schema.json` files, guided by `config/helps/feeds.md` + the `/feeds` UI. No per-system "manage" tool.
- The legacy **sources/news** stack still ships its own preset skill `mc-manage-sources` (writes `sources/<slug>.md`) and its own launcher surfaces (Sources, News).
- Decision for this PR: **stop shipping a "manage" preset skill for either system**, and **review/consolidate the launcher icons + views** now that Feeds supersedes Sources.

## Goals

1. **Fully remove the legacy sources/news stack** — the `mc-manage-sources` skill, the `manageSource` built-in plugin (tool + `SourcesManager` view), the **server-side backend + routes**, and the Sources/News launcher surfaces.
2. Do **not** add a `mc-manage-feeds` skill — feeds stay help-file-managed (`config/helps/feeds.md` + Personal-role prompt pointer + `/feeds` Add). (Note: `mc-manage-feeds` does not currently exist; this codifies the decision. If one gets added before this PR, remove it.)
3. Review and consolidate the launcher **tool icons** + **views** for `sources` / `news` / `feeds`.
4. Remove the **Calendar** toolbar icon + its view, and the **`manageCalendar`** tool. (Automations — the other half of the scheduler plugin — stays.)
5. Remove the dead **`manageBookmarks`** references (the sample bookmarks plugin is not loaded; its tool-name + role entry are no-ops).

## Items

### A. Remove `mc-manage-sources`
- Delete `server/workspace/skills-preset/mc-manage-sources/`.
- **Verify preset-sync prunes removed presets** from the active catalog (`syncPresetSkills` / `syncActivePresetSkills` in `server/workspace/skills-preset.ts`). If sync only adds/overwrites and never prunes, a removed preset lingers in existing workspaces — add pruning or document the manual cleanup. Cover with a `test_skills_preset.ts` case.
- Clean up the now-stale `mc-manage-sources` comments in `src/config/roles.ts` (lines ~253, ~446).

### B. Launcher icons + views review (`src/components/PluginLauncher.vue` TARGETS, `src/App.vue` mounts, `src/router/index.ts`)
Current data-plugin launcher row: `calendar · automations · wiki · collections · feeds(dynamic_feed) · sources(rss_feed) · news(newspaper)`.
- **Retire the Sources + News launcher buttons, views, and routes** (`SourcesView`/`SourcesManager`, `NewsView`; `/sources`, `/news`) — Feeds supersedes Sources, and News read on the daily-brief pipeline goes with it. Keep **Feeds**.
  - Update `SEPARATOR_AFTER_INDEX` and the `PluginLauncherTarget.key` union; remove the `pluginLauncher.sources` / `pluginLauncher.news` i18n keys (8 locales) and `PAGE_ROUTES.sources` / `.news`.
  - Update `docs/ui-cheatsheet.md` top-chrome block.
- **Feeds icon (DECIDED):** change the `feeds` launcher entry from `dynamic_feed` to **`rss_feed`** (freed up by removing Sources). Update `PluginLauncher.vue` + the `docs/ui-cheatsheet.md` row. (The `FeedsView` empty-state + `manageFeed`-era default icon references to `dynamic_feed` can stay or follow; the launcher is the user-visible one.)
- Remove the **`manageSource` built-in plugin** (`src/plugins/manageSource/*` — meta/definition/index/`View`/`Preview`, the `SourcesManager` wrapper) and re-run `yarn plugins:codegen`; this drops `TOOL_NAMES.manageSource` + the `sources` apiNamespace automatically.
- Remove orphaned frontend bits: `src/components/{SourcesView,SourcesManager,NewsView}.vue`, `src/composables/{useNewsItems,useNewsReadState}.ts`, `src/utils/sources/filter.ts`, and the host `news` group in `src/config/apiRoutes.ts`.

### C. Remove the Calendar surface + the `manageCalendar` tool
Calendar and Automations are two **separate** tools bundled in the `scheduler` plugin (`src/plugins/scheduler/`): calendar = `calendarMeta.ts` + `calendarDefinition.ts` + `CalendarView.vue`; automations = `automationsMeta.ts` + `automationsDefinition.ts` + `AutomationsView.vue`. Remove only the calendar half.
- **Launcher / view / route:** drop the `calendar` entry from `PluginLauncher.vue` TARGETS (icon `calendar_month`) + the `key` union + separator index; remove the `currentPage === 'calendar'` mount in `App.vue` (the `<PluginScopedRoot pkg-name="scheduler">` CalendarView block); remove `PAGE_ROUTES.calendar` + the `/calendar` route; drop `pluginLauncher.calendar` i18n (8 locales).
- **Tool:** remove `manageCalendar` — `src/plugins/scheduler/{calendarMeta,calendarDefinition}.ts`, `CalendarView.vue`, and its registration in `src/plugins/scheduler/index.ts`; remove `TOOL_NAMES.manageCalendar` from roles (`roles.ts` ~90, ~390) and any `src/tools/types.ts` / `toolNames` references; re-run `yarn plugins:codegen`. Adjust `src/utils/filesPreview/schedulerPreview.ts` (references calendar) as needed.
- **Decision:** the `scheduler` plugin's `apiNamespace`/routes are shared with automations — confirm which routes are calendar-only and remove just those; keep the automations dispatch intact. Also decide the fate of the server-side calendar **data/store** (`data/calendar`, any calendar event IO) — remove with the tool, or leave the data and only drop the UI/tool? Flag.
- Update `docs/ui-cheatsheet.md` (the `/calendar` block + launcher row).

### D. Remove the server-side sources/news backend (DECIDED — full removal)
- **Server modules:** delete `server/workspace/sources/` (whole tree: `registry`, `pipeline/*`, `fetchers/*`, `classifier`, `taxonomy`, `arxivDiscovery`, `interests`, `httpFetcher`, `rateLimiter`, `robots`, `sourceState`, `urls`, `paths`, `types`) and `server/workspace/news/` (`reader.ts`).
- **Routes:** delete `server/api/routes/sources.ts` + `news.ts`; remove their imports + `app.use(sourcesRoutes)` / `app.use(newsRoutes)` in `server/index.ts` (~lines 11, 13, 608, 610).
- **Pipeline triggers:** the daily-brief pipeline (`runSourcesPipeline`, arXiv auto-discovery) is invoked only from the sources routes (on-demand `POST /api/sources/rebuild`), so it goes with the routes — confirm there's no scheduler `SystemTaskDef` for it to also remove.
- **Workspace dirs:** drop `sources` (`data/sources`) and `news` (`artifacts/news`) from `WORKSPACE_DIRS` (`server/workspace/paths.ts`); update the `test_paths_shape.ts` snapshot.
- **Tests:** remove the `test/sources/*` + `test/workspace/news/*` suites (and any `news`/`sources` route tests).
- **Note:** existing users' on-disk `data/sources/` + `artifacts/news/` files are left in place (a clean code removal, not a data wipe) unless we decide otherwise — see migration question.

> NOTE: feeds copied (not imported) the RSS parser + polite-fetch logic into `server/workspace/feeds/fetch/`, so deleting the `sources` tree does **not** break feeds. Verify no stray cross-imports before deleting.

### E. Remove the dead `manageBookmarks` references
`@mulmoclaude/bookmarks-plugin` is a sample plugin and is **not** in `PRESET_PLUGINS` (`server/plugins/preset-list.ts`), so it's never loaded — yet `manageBookmarks` is still gated. Remove the dead references:
- `src/config/toolNames.ts` (~line 80): drop `manageBookmarks: "manageBookmarks"`.
- `src/config/roles.ts`: drop `TOOL_NAMES.manageBookmarks` from the Personal role's `availablePlugins`.
- Keep the plugin **source** at `packages/plugins/bookmarks-plugin/` as a sample (same treatment as `recipe-book-plugin`); do not add it to `PRESET_PLUGINS`.
- Grep to confirm no other `manageBookmarks` references remain.

## Open questions
1. Migration: existing `data/sources/*.md` + `artifacts/news/*` files — leave on disk (clean code removal, default), or also delete the data?
2. Calendar data: when removing `manageCalendar`, also delete the server-side calendar store (`data/calendar`, its IO), or leave the data and only drop the tool + UI?
3. Calendar vs. Automations routes: which `scheduler` plugin routes are calendar-only and safe to remove without breaking Automations?

## Resolved
- **Server-side sources/news backend: remove it fully** (see §D). This PR is the legacy-stack retirement, not just a UI trim.
- **Feeds launcher icon: `rss_feed`** (replacing `dynamic_feed`, freed up by removing Sources). See §B.

## Verification
- `mc-manage-sources` no longer in the skills list; no stale copy after a fresh boot sync.
- Launcher shows only the intended entries; removed routes redirect/404 cleanly.
- `format` / `lint` / `typecheck` (server / vue all-8-locale / test) / `build` / unit tests green; update `test_paths_shape.ts` + `docs/ui-cheatsheet.md` for any removed dirs/surfaces.

## Follow-ups
- Move `plans/refactor-feeds-skill-managed.md` and this file to `plans/done/` once shipped. (`plans/done/feat-feeds.md` is already archived.)
