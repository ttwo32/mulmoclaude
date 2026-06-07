# UI Cheatsheet — ASCII layouts anchored to component / testid names

A quick visual reference so chat instructions about UI ("the bell at the top right has stale state") can be unambiguous without screenshots. Names in `[brackets]` are real `data-testid` values from the source — so you can `grep -rn 'data-testid="<name>"' src/` to jump to the rendering site, and `gh pr review` comments can reference them in plain text.

## Conventions

- `[name]` — a real `data-testid` you can grep for.
- `<Component>` — a Vue component name (also greppable: `grep -rn 'name: "Component"' src/` or import sites).
- `(:route)` — the URL route the surface lives under.
- ASCII art captures **layout intent**, not pixels. Animation, hover state, exact spacing, and CSS regressions are out of scope — use a screenshot for those.
- This file goes **out of date as the UI evolves**. When you change a layout or rename a testid, update the matching block here in the same PR. Treat it like CHANGELOG entries — small, mechanical updates per PR keep the doc honest.

## Top-level chrome (every route)

```
┌─[App.vue root]────────────────────────────────────────────────────────┐
│ ┌─[#header]────────────────────────────────────────────────────────┐  │
│ │  ⌂[Go to latest chat / brand]  🔓lock_open  🔔[notification-bell]│  │
│ │                          ⚙ settings (→ Skills / Roles tabs)      │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│ ┌─<PluginLauncher> [plugin-launcher]──────────────────────────────────┐│
│ │ ⏰Actions│📖Wiki│▦Collections│📡Feeds ‖ 📁Files ‖ ▦Invoices│📡Weather    ││
│ │ [plugin-launcher-automations] … [plugin-launcher-feeds] …            ││
│ │   [plugin-launcher-shortcuts]→[plugin-launcher-shortcut-<kind>-<slug>]││
│ │ data plugins (0–3) │ ‖ │ management (Files) │ ‖ │ pinned shortcuts (scrolls) ││
│ │ Skills & Roles moved into Settings (gear → Management group)           ││
│ └─────────────────────────────────────────────────────────────────────┘│
│ ┌─[main pane — route-specific]────┐ ┌─<SessionHistoryPanel>────────┐  │
│ │                                 │ │ [session-history-side-panel] │  │
│ │  (the active /route's content)  │ │ ┌─[session-filter-bar]─────┐ │  │
│ │                                 │ │ │ All │Unread│Running│...   │ │  │
│ │                                 │ │ │ [session-filter-<key>]    │ │  │
│ │                                 │ │ └──────────────────────────┘ │  │
│ │                                 │ │ • [session-item-<uuid>]      │  │
│ │                                 │ │ • [session-item-<uuid>]      │  │
│ └─────────────────────────────────┘ └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

Sidebar visibility toggles via the canvas-layout state. When closed, the main pane is full-width.

## `<SessionSidebar>` — left column on every chat session (single layout)

The `w-80` left column inside the chat page (and any other view that mounts it). Despite the historical name `ToolResultsPanel` (renamed in #842), it owns the whole left chrome of an active session: role header, layout / tool-call-history toggles, the tool-result preview list, and the run-time "thinking" indicator.

```
┌─<SessionSidebar>──────────────────────────────┐
│ ┌─[sidebar-role-header]─────────────────────┐ │
│ │ ⭐ General              [copy-chat-md] 🔧 ▦/▥│ │  ← role icon + name
│ │                                            │ │     copy session as Markdown (content_copy)
│ │                                            │ │     toggle right sidebar (build icon)
│ │                                            │ │     <CanvasViewToggle> single/stack
│ └────────────────────────────────────────────┘ │
│ ┌─[tool-results-scroll]────────────────────┐   │  ← scrollable list,
│ │ ┌─card (selected: ring-blue-500)──────┐ │   │     click → emit("select", uuid)
│ │ │ source •          • smart-time       │ │   │
│ │ │ [<plugin>.previewComponent]         │ │   │
│ │ └──────────────────────────────────────┘ │   │
│ │ ┌─card──────────────────────────────────┐ │   │
│ │ │ ...                                   │ │   │
│ │ └──────────────────────────────────────┘ │   │
│ └──────────────────────────────────────────┘   │
│ ┌─Thinking indicator (only while isRunning)─┐  │  ← role="status" aria-live="polite"
│ │ status • • • • [run-elapsed] (≥1s)        │  │
│ │   • pendingToolName · 2.3s                │  │
│ │   • pendingToolName · 0.8s                │  │
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

In **Stack layout** this sidebar isn't rendered; the same data flows through `<StackView>` which inlines result bodies into the main column. Only single layout shows the preview list. `<StackView>`'s own header (`[stack-role-header]`) carries the same control cluster — `[copy-chat-md]` (content_copy → check on success), tool-call-history toggle, and `<CanvasViewToggle>` — so the affordance lives in the same visual slot regardless of layout.

## NotificationBell expanded

```
🔔[notification-bell]──┐
   🔴[notification-badge: "N"] (worst-severity color; shown when active > 0)
   │  ┌─[notification-panel] (opens on click) ─────────────────┐
   │  │ Notifications                                          │
   │  ├─ Active (N) ──────────────── [notification-clear-all]  │ (fyi rows only)
   │  │ 🔔 Active row title                  ✕ (action only)   │
   │  │     N min ago · pluginPkg                              │
   │  │ … [notification-item-<id>]                             │
   │  ├─ History (N) ─────────────────────────────────────────┤
   │  │ ✓ / ✗  History row title                              │
   │  │        N min ago · cleared|cancelled · pluginPkg      │
   │  │ … initial 5 rows; rest hidden behind toggle           │
   │  ├──────────────────────────────────────────────────────┤
   │  │ [notification-history-toggle]                          │
   │  │   "Show more (N)" / "Show less" (only when > 5 items) │
   │  └──────────────────────────────────────────────────────┘
   └─ active rows: [notification-item-<id>]
      history rows: [notification-history-<id>]
```

- **Active** rows: fyi (body click clears + navigates) vs action (× cancels; body click navigates only).
- **History** rows: read-only; navigate on click when `navigateTarget` is present. Capped at `HISTORY_CAP` (50) FIFO server-side; bell collapses to the first 5 with a toggle so repetitive entries (e.g. recurring "docker not running") don't bury the rest. Toggle state resets each time the popup closes.

## /chat — the chat page

```
┌─[main pane (chat)] ────────────────────────────────────────────────────┐
│ ┌─[chat column — left, single layout]──┐ ┌─[canvas column — right]──┐  │
│ │                                       │ │                          │  │
│ │  scrollback transcript (text-results, │ │ Selected tool result UI: │  │
│ │  tool-call cards, agent responses)    │ │  • <AutomationsView>     │  │
│ │                                       │ │  • <MarkdownView>        │  │
│ │  • text-response (user) ──────────╮   │ │  • <SpreadsheetView>     │  │
│ │  • text-response (assistant) ─────╯   │ │  • <ChartView>           │  │
│ │  • tool-call card                     │ │  • ...                   │  │
│ │    ↳ <Preview> (compact summary)      │ │                          │  │
│ │      click → selectedResultUuid       │ │ "Edit / Apply / PDF"     │  │
│ │                                       │ │ buttons may appear at    │  │
│ │                                       │ │ the top of certain views │  │
│ │  ┌─<ChatInput> [chat-input/wrapper]─┐ │ │                          │  │
│ │  │ <SuggestionsPanel> (when open)   │ │ │                          │  │
│ │  │ <SlashCommandMenu> (typing "/")  │ │ │                          │  │
│ │  │   [slash-command-menu]           │ │ │                          │  │
│ │  │ [user-input]                  …  │ │ │                          │  │
│ │  │ [suggestions-btn] (if queries)   │ │ │                          │  │
│ │  │ [send-btn] [stop-btn]            │ │ │                          │  │
│ │  │ [attach-file-btn]                │ │ │                          │  │
│ │  └──────────────────────────────────┘ │ │                          │  │
│ └───────────────────────────────────────┘ └──────────────────────────┘  │
│                                                                         │
│ Stack-layout collapses both columns into one (responsive / user-pref).  │
└─────────────────────────────────────────────────────────────────────────┘
```

The right canvas binds to `currentSession.selectedResultUuid`. Clicking a tool-call card on the left sets the uuid; the right pane re-renders via plugin lookup (`getPlugin(toolName).viewComponent`).

### Canvas plugin views — primary testids

Stable hooks for tests / chat references when a tool result is selected on the right canvas:

| Plugin | testid | What it points at |
|---|---|---|
| `presentHtml` | `[present-html-iframe]` | The `<iframe :src="/artifacts/html/...">` rendering the saved HTML page |
| `generateImage` | `[generate-image-view]` | The wrapper around `<ImageView>` showing a generated image (`<img src="/artifacts/images/...">`) |
| `textResponse` | `[text-response-pdf-button]` | The "PDF" button on an assistant text response (`usePdfDownload` → `/api/pdf/markdown`) |
| `textResponse` | `[text-response-edit]` / `[text-response-edit-summary]` / `[text-response-edit-textarea]` / `[text-response-apply-btn]` | The collapsible source editor on an assistant text response |

(Other plugin views — `<AutomationsView>`, `<MarkdownView>`, `<SpreadsheetView>`, `<ChartView>`, etc. — are documented in their own sections below or are direct components without a stable testid yet.)

> The standalone Calendar view + `manageCalendar` tool were removed. Dated
> items now live in `calendarField` collections (see `<CollectionCalendarView>`
> under /collections below). `/calendar` and `/scheduler` redirect to
> `/automations`.

## /automations — scheduled tasks

```
┌─[<AutomationsView> mounts <SchedulerView force-tab="tasks">]──────────┐
│                                                                       │
│  ┌─<TasksTab>──────────────────────────────────────────────────────┐ │
│  │  ▾ Recommended frequencies (collapsed)  [scheduler-frequency-   │ │
│  │                                          hints]                 │ │
│  │                                                                 │ │
│  │  ┌─Task row [scheduler-task-<id>]──────────────────────────┐    │ │
│  │  │  user│Finance daily briefing            ▶  ⋯  ✕         │    │ │
│  │  │      every morning at 06:00 local  · next: tomorrow     │    │ │
│  │  │      [scheduler-task-run]                               │    │ │
│  │  │      [scheduler-task-delete]                            │    │ │
│  │  └─────────────────────────────────────────────────────────┘    │ │
│  │  ┌─Task row [scheduler-task-<id>]──────────────────────────┐    │ │
│  │  │  system│Wiki maintenance                ⋯               │    │ │
│  │  └─────────────────────────────────────────────────────────┘    │ │
│  │  ...                                                            │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

Origin badges: `system` (bg-gray) / `user` (bg-blue) / `skill` (bg-purple). Disabled tasks render at `opacity-50`.

## /wiki — wiki pages and lint report

`<WikiView>` shares one header tab strip — Index / Log / Lint / [wiki-tab-graph] — across
several layouts: the **index** (page list), a **single page** body, the activity **log**, the
**lint report**, and the **graph**.

### Index

```
┌─[<WikiView> action="index"]────────────────────────────────────┐
│ Tags filter: [wiki-tag-filter-all] [wiki-tag-filter-<tag>] ... │
│                                                                │
│ ┌─Entry list─────────────────────────────────────────────────┐ │
│ │ • [wiki-page-entry-<slug>]                                 │ │
│ │   Title  — short description  #tag #tag                    │ │
│ │   click → /wiki/pages/<slug>                               │ │
│ │ • [wiki-page-entry-<slug>]                                 │ │
│ │   ...                                                      │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                │
│ [wiki-create-page-button]   [wiki-update-page-button]          │
│ [wiki-lint-chat-button] (asks the agent to run lint_report)    │
└────────────────────────────────────────────────────────────────┘
```

### Single page

```
┌─[<WikiView> action="page" pageName="<slug>"]──────────────────┐
│ ▮ <slug>                            [wiki-update-page-button] │
│ ┌─Markdown content (.wiki-content, scrollable)──────────────┐ │
│ │ # Title                                                   │ │
│ │ markdown body...                                          │ │
│ │ ![image](relative/path)  ← rewritten to /api/files/raw    │ │
│ │ [[wiki-link]]            ← rewritten to /wiki/pages/<slug>│ │
│ └───────────────────────────────────────────────────────────┘ │
│ ┌─[wiki-linked-references] (pages whose [[links]] point here)┐ │
│ │ • [wiki-linked-reference-<slug>] → /wiki/pages/<slug>     │ │
│ └───────────────────────────────────────────────────────────┘ │
│ Per-page chat composer (<PageChatComposer>):                  │
│   [wiki-page-chat-input]  [wiki-page-chat-send]               │
│   typing "/" → <SlashCommandMenu> [slash-command-menu]        │
└───────────────────────────────────────────────────────────────┘
```

### Graph (`/wiki/graph`)

```text
┌─[<WikiView> action="graph"]───────────────────────────────────┐
│ [wiki-graph]                                                   │
│ ┌─[wiki-graph-canvas] (echarts force layout)────────────────┐ │
│ │   (•)Title ──→ (•)Title    click node → /wiki/pages/<slug>│ │
│ │        \         /         empty → "No links to graph yet"│ │
│ └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### page-edit (canvas timeline only — #963)

When the LLM Writes/Edits a `data/wiki/pages/<slug>.md` file via
Claude Code's built-in tools, the snapshot endpoint publishes a
synthetic `manageWiki` toolResult with `action: "page-edit"` into
the active session. The canvas (StackView) renders it via the
same `<WikiView>` component as `action: "page"`, so the body
markup is identical:

```text
┌─[<WikiView> action="page-edit" — canvas only]─────────────────┐
│ ▮ Wiki edit · <slug> · 2026-04-30 12:00                       │
│ ┌─[wiki-page-metadata-bar]────────────────────────────────┐   │
│ │ Created: ... · Updated: ... · Editor: llm · #tag1 #tag2 │   │
│ └─────────────────────────────────────────────────────────┘   │
│ [wiki-page-edit-banner] (only when snapshot was gc'd)         │
│ ┌─Markdown content from snapshot file (.wiki-content)─────┐   │
│ │ ...same render as the live page action...              │   │
│ └─────────────────────────────────────────────────────────┘   │
│ [wiki-page-edit-deleted] (only when both snapshot + page gone)│
└───────────────────────────────────────────────────────────────┘
```

Tabs / PDF / chat composer / create-update buttons are hidden —
this is a moment-in-time view, not the live page.

## /files — workspace file explorer

```
┌─[<FilesView> — [files-view-root]]──────────────────────────────────────┐
│ ┌─Tree pane──────────┐ ┌─Preview pane (route param: pathMatch)───────┐ │
│ │ ▶ artifacts/       │ │                                             │ │
│ │ ▼ config/          │ │ ┌─[system-file-banner] (#832, optional)───┐ │ │
│ │   • interests.json │ │ │ ℹ News notification filter profile · 🟢│ │ │
│ │   • mcp.json       │ │ │   Scores articles for the bell. …       │ │ │
│ │   • settings.json  │ │ │   Schema: server/.../interests.ts       │ │ │
│ │ ▶ conversations/   │ │ └─────────────────────────────────────────┘ │ │
│ │ ▶ data/            │ │                                             │ │
│ │ ▼ data/sources/    │ │  ┌─Preview rendered by FileContentRenderer┐ │ │
│ │   • foo.md   ←sel  │ │  │                                        │ │ │
│ │   • bar.md         │ │  │  • markdown → marked + Vue             │ │ │
│ │ ...                │ │  │  • images → <img>                      │ │ │
│ │                    │ │  │  • json/jsonl → syntax-highlighted     │ │ │
│ │                    │ │  │  • code → text                         │ │ │
│ │                    │ │  └────────────────────────────────────────┘ │ │
│ └────────────────────┘ └─────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

The preview pane renders by file type (markdown, images, JSON/JSONL syntax highlight, Marp slides, …). System-managed files (`config/*.json`, `data/wiki/*.md`, `conversations/memory.md`, …) get a `[system-file-banner]` above the body explaining what the file is, who writes it, and whether hand-edits survive (descriptors live in `src/config/systemFileDescriptors.ts`; #832).

## /collections — schema-driven record tables

```
┌─[<CollectionView> — /collections/:slug]────────────────────────────────┐
│ Toolbar: [collection-view-toggle-table | -calendar | -kanban] · search  │
│                                                                         │
│ [collections-inline-error] (banner, only after a failed inline write)   │
│ ┌─Table──────────────────────────────────────────────────────────────┐ │
│ │ ID        │ Yoga                  │ Status                          │ │
│ │ [collections-row-<id>] (whole row click → detail panel)            │ │
│ │  jun-03   │ ☑ [collections-      │ ▾ [collections-                 │ │
│ │           │   inline-bool-       │   inline-enum-                  │ │
│ │           │   <key>-<id>]        │   <key>-<id>]                   │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Row click expands [collections-detail] (read-only → Edit → Save).       │
└─────────────────────────────────────────────────────────────────────────┘
```

`boolean` columns render an inline checkbox and `enum` columns an inline `<select>` directly in the table cell — changing one writes the value straight to the record (`PUT .../items/:id`, optimistic + rollback on failure) without opening the detail panel. The controls use `@click.stop` so the cell click never bubbles into the row's `openView`. All other field types (and the full edit form) still go through the row → `[collections-detail]` → Edit → Save flow.

The **Calendar** toggle (`[collection-view-toggle-calendar]`) appears only when the schema has a `date` or `datetime` field; the **Kanban** toggle (`[collection-view-toggle-kanban]`) only when it has an `enum` field. In `<CollectionCalendarView>`, clicking anywhere in a day cell (`[collection-calendar-day-<key>]`, a keyboard-operable `role="button"`) opens `<CollectionDayView>` (`[collection-day-view]`) — a modal 24-hour timeline of that day; its **+** (`[collection-day-view-create]`) starts a create prefilled to that day. Record chips inside the cell `@click.stop` to select instead. Records with a clock (a `datetime` anchor/end, or a `date` plus the schema's `calendarTimeField` time-string like `"14:00-17:00"`) draw as proportional blocks (`[collection-day-view-chip-<id>]`); a start-only time draws as a single line; clock-less records sit in the bottom all-day strip (`[collection-day-view-all-day]`). Selecting an entry re-emits `select` (opens the detail panel) and closes the popup. `<CollectionKanbanView>` groups records into columns by the chosen enum field (declared `values` order + a trailing **Uncategorized** column for empty/unknown values — omitted when the chosen enum is declared `required`), with a `[collection-kanban-field]` selector when >1 enum field exists. Dragging a card (`[collection-kanban-card-<id>]`) between columns writes the group field via the same inline-edit PUT (no column drag, no within-column ordering); a card whose group field is hidden by a `when` predicate is omitted from the board. Card click opens the same detail panel below the board.

A `toggle` field is a checkbox that **projects** an `enum` field (stores nothing itself): checked when the enum equals its `onValue`, toggling writes `onValue`/`offValue` back to that enum. It renders inline in the table (`[collections-inline-toggle-<key>-<id>]`) and on the kanban card (`[collection-kanban-toggle-<id>]`, shown when it projects the board's group field — checking it also moves the card). This is how a todo-style "done" checkbox fronts a kanban `status` while keeping the enum as the single source of truth.

## Settings → Skills tab — workspace skills list

Lives inside the **Settings modal** (gear → `[settings-tab-skills]`,
**Management** group) — there is **no `/skills` route** (it redirects to
`/chat`). The same `<ManageSkillsView>` also mounts on the right canvas
when a `manageSkills` tool result is selected in chat.

Two-pane layout (`<ManageSkillsView>`): left sidebar = two collapsible
sections, **Active** (skills in `.claude/skills/`, discovered by Claude
Code and loaded into the prompt) and **Catalog** (presets the user can
browse / ★ star without bloating the prompt). Right pane renders the
selected skill's `SKILL.md` (active) or the preset/external detail with
the Star action (catalog). There is **no in-view Run** — invoke a skill
by typing its `/<name>` slash command in chat.
Within Active, provenance (System `mc-` bundled / Project / User) is a
per-row badge, not its own group; only **Project** skills expose
Edit/Delete, the rest are read-only. Collapse state per section is
persisted to `localStorage` (`skills:sectionCollapsed`); both sections
open by default. The Catalog section nests, under the **Presets**
sub-list, one collapsible subgroup per installed **external repo**
(#1383 PR-C) — repo header has a count + uninstall button, per-repo
collapse persisted to `skills:repoCollapsed`. A **+ Add skill
repository** button opens a modal (GitHub URL + optional subpath, plus
one-click seed suggestions). External rows behave like preset rows
(select → right pane Star); uninstalling a repo keeps any
already-starred skills in Active (star = fork).

```text
┌─[<ManageSkillsView>] (in Settings modal → Skills tab)──────────────┐
│ Skills                                          N available · click│
│ ┌─Sidebar (w-64)──────────┬─Detail pane──────────────────────────┐ │
│ │ ▼ ACTIVE            11  │  <skill name>                         │ │
│ │ ├ [skill-item-foo] 🏠   │  description                          │ │
│ │ ├ [skill-item-bar] 📁   │                             ✏ Edit  ✕ │ │
│ │ └ [skill-item-baz] 📁   │  rendered SKILL.md (marked + sanitize)│ │
│ │ ▼ CATALOG            4  │                                       │ │
│ │   Presets               │  (catalog row → preset/external detail│ │
│ │ ├ [skill-catalog-…] ★   │   with ★ Star)                        │ │
│ │ ▼ owner/repo (n) [⟳][🗑] │                                       │ │
│ │ ├ [skill-catalog-…] ☁   │                                       │ │
│ │ [+ Add skill repository]│                                       │ │
│ └─────────────────────────┴───────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

Testids: `skill-section-{key}` / `skill-section-toggle-{key}` /
`skill-section-count-{key}` for the two section headers
(`active` / `catalog`); `skill-item-{name}` per active row;
`skill-catalog-item-{id}` per catalog row — `id` = preset slug, or
`{repoId}/{skillFolder}` for external (stable identity, not the lossy
derived slug);
`skill-catalog-empty` when the catalog has no presets;
`skill-catalog-repo-{repoId}` / `skill-catalog-repo-toggle-{repoId}` /
`skill-catalog-repo-update-{repoId}` (re-fetch upstream) /
`skill-catalog-repo-uninstall-{repoId}` per external-repo subgroup;
`skill-catalog-add-repo` + `skill-add-repo-modal` /
`skill-add-repo-url` / `skill-add-repo-subpath` /
`skill-add-repo-submit` / `skill-add-repo-error` /
`skill-add-repo-suggestion-{url}` (click = prefill the URL/subpath
form + expand its description, NOT install) /
`skill-add-repo-suggestion-link-{url}` (opens the repo on GitHub in a
new tab) for the add-repo modal.

## Settings → Roles tab — role configuration

Lives inside the **Settings modal** (gear → `[settings-tab-roles]`,
**Management** group) — there is **no `/roles` route** (it redirects to
`/chat`). Root testid `[roles-view-root]`.

```
┌─[<RolesManager>] (in Settings modal → Roles tab)───────────────────┐
│ ┌─Built-in roles (read-only)─────────────────────────────────────┐ │
│ │ ⭐ General              "Helpful assistant w/ workspace access" │ │
│ │ 🎨 Artist                ...                                   │ │
│ │ 🎓 Tutor                 ...                                   │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ┌─Custom roles────────────────────────────────────────────────── ┐ │
│ │  + add role                                                    │ │
│ │  📖 my-role     ✏ edit   ✕                                     │ │
│ └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## `<AccountingApp>` — opt-in plugin (no route)

Mounted via the tool-result envelope `{ kind: "accounting-app" }`
returned by `manageAccounting({action:"openBook", bookId})`. **No `/accounting`
route exists.** The default (General) role cannot reach this
surface; the built-in **Accounting** role and any custom role whose
`availablePlugins` includes `manageAccounting` can trigger the
mount.

```text
┌─[<AccountingApp>] data-testid="accounting-app"───────────────────────┐
│ ┌─Header───────────────────────────────────────────────────────────┐ │
│ │  account_balance Accounting          [<BookSwitcher>]            │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─Tabs [accounting-tabs]───────────────────────────────────────────┐ │
│ │ [accounting-tab-journal] [accounting-tab-newEntry]               │ │
│ │ [accounting-tab-opening] [accounting-tab-ledger]                 │ │
│ │ [accounting-tab-balanceSheet] [accounting-tab-profitLoss]        │ │
│ │ [accounting-tab-settings]                                        │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─Body (one of)────────────────────────────────────────────────────┐ │
│ │  • [accounting-no-book]    ← empty workspace                     │ │
│ │  • <JournalList>           ← entries table; voided rows strike   │ │
│ │  • <JournalEntryForm>                                            │ │
│ │  • <OpeningBalancesForm>   ← save disabled until Σdr = Σcr       │ │
│ │  • <Ledger>                                                      │ │
│ │  • <BalanceSheet>                                                │ │
│ │  • <ProfitLoss>                                                  │ │
│ │  • <BookSettings>          ← rebuild snapshots / delete book     │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Key testids and what they target:

| testid | element | notes |
|---|---|---|
| `accounting-app` | root `<div>` of the View | mount probe |
| `accounting-no-book` | empty-state branch | shows when `activeBookId` is null |
| `accounting-tabs` | tab strip wrapper | |
| `accounting-tab-{key}` | one per tab (journal / newEntry / …) | click target |
| `accounting-book-select` | `<BookSwitcher>` `<select>` | book picker |
| `accounting-journal-table` | `<JournalList>` `<table>` | entries grid |
| `accounting-journal-row-{id}` / `accounting-journal-row-voided-{id}` | per-entry `<tr>` | voided rows use the `-voided-` variant **and** carry the strikeout class — bind to `voidedEntryIds` (server-side `voidedIdSet`), **not** to `kind === 'void'` |
| `accounting-void-{id}` | per-row void button | only on `kind === 'normal'` rows |
| `accounting-entry-line-account-{idx}` / `-debit-{idx}` / `-credit-{idx}` | per-line inputs in `<JournalEntryForm>` | one set per row |
| `accounting-entry-line-tax-registration-id-{idx}` | per-line counterparty tax-registration ID input | optional; covers JP T-number, EU VAT ID, GSTIN, ABN, … (max 32 chars; canonical home = `JournalLine.taxRegistrationId`) |
| `accounting-settings` | `<BookSettings>` root | settings tab body |
| `accounting-settings-rebuild` | rebuild snapshots button | |
| `accounting-settings-delete` | confirm-then-delete button | enabled once the typed name matches |

Persistence: data lives at `~/mulmoclaude/data/accounting/books/<bookId>/`.
Book ids are server-generated (`book-XXXXXXXX`); there is no magic
`default` id. Empty workspace ⇒ `config.json#activeBookId === null`
and the View renders `accounting-no-book`.

Async snapshot rebuild: writes call `scheduleRebuild(bookId, fromPeriod)`
after invalidating snapshot files. The View can subscribe to
`accountingBookChannel(bookId)` and observe `snapshots-rebuilding` /
`snapshots-ready` events; the lazy fallback in `getOrBuildSnapshot`
guarantees correctness even if a report is requested mid-rebuild.

## How to use this doc in chat

When asking Claude (or a teammate) to change the UI, name what you mean:

> ❌ "Make the bell smaller"
> ✅ "Reduce the badge size on `[notification-badge]` — it's overflowing the bell button on narrow screens"

> ❌ "The schedule page is broken"
> ✅ "On `/automations`, `[scheduler-task-<id>]` rows render at full opacity even when `task.enabled === false` — the `opacity-50` class isn't applying"

> ❌ "Add a button to the wiki page header"
> ✅ "Next to `[wiki-update-page-button]` in `<WikiView>` action='page', add a `[wiki-export-pdf-button]` that calls `usePdfDownload`"

If a name in this doc no longer matches the source (renamed testid, restructured layout), **update the doc in the same PR as the rename** — same discipline as updating tests when changing API.

## Out of scope

- **Pixel-accurate layout** — use Playwright screenshots or a Figma file.
- **Hover / focus / animation states** — describe in code comments next to the styles.
- **Mobile / narrow-screen breakpoints** — captured in `tailwind.config.ts` + the responsive class soup; not redrawn here.
- **Modal / popover stacking order** — surface in the relevant component's `<!-- -->` doc comment, not here.
- **Plugin-internal sub-views** that don't have their own route — TodoEditDialog, MindMap, Quiz, Form, etc. Add stubs as the cheat sheet matures.
