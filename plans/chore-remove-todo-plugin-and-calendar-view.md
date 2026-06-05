# Remove the Todo plugin (fully) and the Calendar view + manageCalendar tool

**Status:** planning · **Owner:** snakajima · **Created:** 2026-06-04 · **Do NOT commit yet**

## Scope (decided)

1. **Todo plugin → full removal.** The runtime plugin `@mulmoclaude/todo-plugin`
   is superseded by the collection recipe `config/helps/todo-collection.md` (which
   already ships a "Migrating the legacy todo-plugin" section). Remove the package,
   its tool (`manageTodoList`), route (`/todos`), view, i18n, data-path wiring,
   tests, and docs.
2. **Calendar → remove the VIEW + the `manageCalendar` TOOL only; KEEP the
   scheduler plugin/backend.** Drop `CalendarView` + `/calendar` + the
   `manageCalendar` LLM tool, but leave the `src/plugins/scheduler/` module, the
   shared `/api/scheduler` route + handlers, `data/scheduler/items.json`, the
   task-manager, and **all of automations** (`manageAutomations`,
   `AutomationsView`, `/automations`) intact.

The generic collection **`calendarField`** view (`CollectionCalendarView`) stays —
it is the collection-native replacement for a calendar-of-dated-items.

## CRITICAL constraint — relocate the scheduler route ownership

**Verified:** `src/plugins/scheduler/calendarMeta.ts` is the **sole declarer** of
the entire `/api/scheduler` apiRoutes namespace — including the routes automations
depends on (`dispatch`, `/tasks`, `/tasks/:id`, `/tasks/:id/run`, `/logs`) and
`mcpDispatch: "dispatch"`. `automationsMeta.ts` declares only `toolName`.

➡️ **Deleting `calendarMeta.ts` outright would delete `/api/scheduler` for
automations too — breaking the whole scheduler.** The removal MUST **move
`apiNamespace: "scheduler"` + the `apiRoutes` block + `mcpDispatch: "dispatch"`
from `calendarMeta.ts` into `automationsMeta.ts`** (automations becomes the owner
of the shared namespace), then delete `calendarMeta.ts`. Validation must confirm
`/automations` and `manageAutomations` still work end-to-end.

(The calendar-item GET `list` + the calendar-action branch in
`server/api/routes/scheduler.ts` / `schedulerHandlers.ts` are left **in place but
dormant** — nothing calls them once the tool + view are gone. This deliberately
avoids the risky `/api/scheduler` route surgery; clean them up later if desired.)

---

## Part 1 — Todo plugin (full removal)

### Delete wholesale
- `packages/plugins/todo-plugin/` — the entire runtime-plugin workspace (View.vue,
  Preview.vue, definition.ts, index.ts, handlers/priority-notifier.ts, composables,
  package.json, dist, …). Auto-discovered build tier 4 drops it with the dir.
- `src/components/TodoExplorer.vue` — the `/todos` standalone view.
- `src/utils/filesPreview/todoPreview.ts` — `todos.json` file-preview fixture.
- `test/plugins/test_todo_plugin_integration.ts`
- `e2e-live/tests/journey-todo.spec.ts`

### Edit — de-register from host
- `package.json` (root) — drop the `@mulmoclaude/todo-plugin` dependency; re-run
  `yarn install` to refresh `yarn.lock`. (Added in 0.6.5 per CHANGELOG.)
- `server/plugins/preset-list.ts` — drop the `{ packageName: "@mulmoclaude/todo-plugin" }` row.
- `src/config/toolNames.ts` — drop `manageTodoList: "manageTodoList"` (and the
  "now a runtime plugin" comment).
- `src/config/roles.ts` — drop `TOOL_NAMES.manageTodoList` from the Personal role
  `availablePlugins`; the plugin-comment above it can stay (covers bookmarks/spotify).
- `src/router/index.ts` + `src/router/pageRoutes.ts` — drop the `/todos` route and
  the `todos` PAGE_ROUTES key.
- `src/App.vue` — drop the `currentPage === 'todos'` `<PluginScopedRoot>` block.
- `src/components/PluginLauncher.vue` — drop the `todos` launcher entry + union member.
- `src/config/workspacePaths.ts` — drop `todosItems` / `todosColumns` from `WORKSPACE_FILES`.
- `src/config/systemFileDescriptors.ts` — drop the `todosItems` / `todosColumns` descriptors.
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — drop `pluginLauncher.todos` and the
  `todo*` blocks (`todoExplorer`, `todoDialogs`, `todoKanban`, `todoTableList`) and
  the `workspaceFiles.todos*` / `systemFileDescriptor.todos*` entries. **All 8 in
  lockstep.** KEEP everything `scheduler*` / `automation*` / `calendarField`.

### Tests
- `test/plugins/test_preset_loader.ts` — remove `@mulmoclaude/todo-plugin` from the
  expected preset list/assertion.
- `test/agent/test_agent_stream.ts`, `test_agent_config.ts`, `test_mcp_smoke.ts` —
  drop `manageTodoList` from fixtures.
- `test/config/test_toolNames.ts` — drop/refresh the `manageTodoList` comment.
- `e2e-live/tests/plugin-dispatch.spec.ts` — drop the `L-DISPATCH-TODO` block.
- `e2e-live/tests/journey-llm.spec.ts` — drop the todo (`manageTodoList`) journey block.
- `test/workspace/test_paths_shape.ts` — drop todo path expectations if present.

### Data / users
- Legacy records live at `data/plugins/%40mulmoclaude%2Ftodo-plugin/todos.json`
  (+ `columns.json`). **Do NOT delete user data.** The migration path is
  `config/helps/todo-collection.md` → "Migrating the legacy `todo-plugin`". Decide:
  notify-only (point users at the recipe) vs. nothing. (Recommend a CHANGELOG note +
  the recipe; no auto-migration — matches the billing-suite precedent.)

---

## Part 2 — Calendar (view + `manageCalendar` tool only)

### Move first (the critical step)
- `src/plugins/scheduler/automationsMeta.ts` — **add** `apiNamespace: "scheduler"`,
  the full `apiRoutes` block, and `mcpDispatch: "dispatch"` (relocated verbatim from
  `calendarMeta.ts`). Automations now owns the `/api/scheduler` namespace.

### Delete wholesale
- `src/plugins/scheduler/calendarMeta.ts` (after the move above).
- `src/plugins/scheduler/calendarDefinition.ts` (the `manageCalendar` tool def).
- `src/plugins/scheduler/CalendarView.vue`.
- `src/plugins/scheduler/Preview.vue` — calendar-only preview (automations uses
  `AutomationsPreview.vue`; confirmed they cannot share, per the `#828` comment).

### Edit — de-register
- `src/plugins/scheduler/index.ts` — drop the `CalendarView` / `Preview` /
  `calendarDefinition` imports, the `manageCalendarPlugin` export, and the
  `{ toolName: MANAGE_CALENDAR, entry: manageCalendarPlugin }` REGISTRATIONS entry.
  Keep `manageAutomationsPlugin` + its registration.
- `src/plugins/_generated/metas.ts` + `server-bindings.ts` — **regenerate** via
  `yarn plugins:codegen` after the meta changes (drops the calendar META import +
  array entry; picks up automations now carrying the routes). Do not hand-edit.
- `src/config/toolNames.ts` — drop `manageCalendar` (and its migrated-to-META comment).
- `src/config/roles.ts` — drop `TOOL_NAMES.manageCalendar` from the Personal role.
- `src/router/index.ts` + `pageRoutes.ts` — drop the `/calendar` route + `calendar`
  PAGE_ROUTES key.
- `src/App.vue` — drop the `currentPage === 'calendar'` `<PluginScopedRoot>` block.
- `src/components/PluginLauncher.vue` — drop the `calendar` launcher entry + union member.
- `src/config/apiRoutes.ts` — update the "scheduler migrated to META" comment to
  point at `automationsMeta.ts`.
- `src/lang/{8 locales}.ts` — drop `pluginLauncher.calendar`. **KEEP** all
  `scheduler*` / `automation*` keys and `calendarField` (collection view).

### KEEP intact (shared / automations / replacement)
- `server/api/routes/scheduler.ts` + `schedulerHandlers.ts` (the `/api/scheduler`
  route + the calendar-item dispatch, now dormant but harmless).
- `src/plugins/scheduler/{automationsDefinition,automationsMeta,AutomationsView,AutomationsPreview,TasksTab}.*`
- `server/events/task-manager/*`, `config/scheduler/tasks.json`, `data/scheduler/items.json`.
- `src/utils/collections/calendarGrid.ts` + `CollectionCalendarView.vue` (generic `calendarField`).
- `data/calendar` workspace dir (`server/workspace/paths.ts:117`) — unused/legacy, leave it.

### Tests
- `e2e-live/tests/plugin-dispatch.spec.ts` — drop the `L-DISPATCH-CAL` block.
- `e2e-live/tests/journey-llm.spec.ts` — drop the calendar (`manageCalendar`) block.
- `test/utils/test_schedulerPreview.ts`, `test/utils/tools/test_result.ts` — drop/refactor
  `manageCalendar` fixtures.
- Add/keep a test asserting **task actions still route on `/api/scheduler`** after
  the META move (guard the automations-survival invariant).

---

## Docs (both parts)
- `docs/ui-cheatsheet.md` — delete the `/todos` and `/calendar` ASCII blocks.
- `docs/scheduler-guide*.md` — split: delete calendar-plugin / todo-plugin guidance;
  KEEP task-scheduler / automations guidance.
- `docs/manual-testing.md` — drop todo/calendar checklist items.
- `README.md` + locale READMEs, `helps/index.md` ("Manage a todo list and calendar
  scheduler" capability line) — soften to reflect collections + automations.
- `src/config/roles.ts` Personal role **prompt prose** mentions "calendar, todos" —
  optional cosmetic update.
- `docs/CHANGELOG.md` — Removed entry (todo plugin; calendar view + manageCalendar),
  noting the todo-collection migration path and that automations/scheduler are unaffected.

## Out of scope (explicitly NOT touched)
- The scheduler **execution engine** (task-manager) and **automations**
  (`manageAutomations`, `/automations`) — kept. (Collections can't run agent prompts
  on a timer; that capability stays in the scheduler — see the design discussion.)
- The calendar-item backend (`schedulerHandlers` calendar branch) — left dormant,
  not surgically removed, to avoid risking the shared `/api/scheduler` route.

## Validation
- [ ] `yarn plugins:codegen` regenerated `_generated/*` cleanly; no calendar META.
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build` clean (no dangling
      imports / i18n key mismatches across the 8 locales).
- [ ] `yarn test` green; preset-loader + agent + paths tests updated.
- [ ] `yarn test:e2e` green.
- [ ] **Automations survives:** boot → `/automations` mounts; `manageAutomations`
      dispatches; `GET/POST /api/scheduler/tasks`, `/tasks/:id/run`, `/logs` work;
      the task-manager tick loop still fires scheduled runs + notifications.
- [ ] `/todos` and `/calendar` 404 / no launcher entries; `manageTodoList` /
      `manageCalendar` absent from the agent's tools.
- [ ] A collection with a `date` field still shows the `calendarField` calendar view.

## Decisions (resolved)
1. **Todo user-data → ignore.** No migration, no notification. Any existing
   `data/plugins/%40mulmoclaude%2Ftodo-plugin/todos.json` is left orphaned on disk;
   the removal is purely mechanical (code/registration/i18n/tests/docs).
2. **Two PRs, todo first.** PR-1 = Todo plugin full removal (trivial, no shared
   infra). PR-2 = Calendar view + `manageCalendar` (needs the `calendarMeta` →
   `automationsMeta` route move + `plugins:codegen`). Splitting de-risks PR-2.
