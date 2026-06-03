# Plan: collections calendar view — a second view type for any date-bearing collection

Follow-up to the collections line (`feat-skill-driven-apps`,
`feat-collections-actions`, `feat-present-collection`,
`feat-collections-time-trigger`). Adds a **second way to render a
collection**: alongside the existing table, any collection that has a
`date` field gains a **table ↔ calendar** view toggle. The calendar lays
each record on the day cell matching its date field.

This is explicitly **not** a scheduler port. The scheduler's calendar-items
half (`manageCalendar`) is a bespoke plugin; its automations half
(`manageAutomations` + the task-manager/scheduler-adapter execution engine)
is untouched and out of scope. We are adding a *generic collection
capability*, not cloning a feature. A "Renewals" collection with a `due`
date, an "Events" collection with an `on` date, an "Invoices" collection
with an `issued` date — all get a calendar for free.

## Hard constraint: zero domain-specific host code

Same discipline as every collections primitive. The host learns ONE generic
concept — "a `date` field can anchor a calendar view" — and holds no
event / reminder / appointment domain literals. All meaning stays in
`schema.json` and the records. The calendar is a *rendering* of existing
data; it adds no new storage, no new CRUD path, no new MCP tool.

---

## The core idea

The table view is today the *only* renderer (`CollectionView.vue`, a
hardcoded `<table>`). We introduce a minimal notion of "view" with exactly
two concrete types — `table` (today's behaviour, unchanged default) and
`calendar` — selected by a local UI toggle. The calendar groups records by
the value of a single `date` field into a month grid; clicking a record
opens the **same inline detail/edit panel** the table already uses.

### Trigger condition (zero-config)

The view toggle is shown **only when the schema has ≥1 `date` field**.
Collections with no date field render exactly as today — no toggle, no
schema change, nothing to opt into. That auto-derivation is what makes this
a platform feature rather than a per-collection setting.

### Which date field anchors the calendar

- **Exactly one `date` field** → use it, no config.
- **Multiple `date` fields** → default to the first (schema field order),
  with an in-view dropdown to switch which date drives the grid.
- **Optional schema hints** (author override): `calendarField?: string`
  pins the anchor; `calendarEndField?: string` names a second `date` field
  for multi-day spans (record renders across `calendarField`→`calendarEndField`).

The hints are optional; the common single-date collection needs none.

### View choice is local UI state, NOT schema

The active view (`table` | `calendar`) and the chosen date field are
component state, **never written back to schema.json or any settings file**.
This mirrors the `layoutMode` discipline (see `feedback_layoutmode_user_only`):
only the user's toggle interaction may change it; the host never flips it
programmatically. Default on load: `table` (no behaviour change for anyone).

---

## Part 1 — schema additions (optional hints only)

`server/workspace/collections/types.ts` — extend `CollectionSchema`
(currently ends at line 250) with two optional fields:

```ts
  /** Name of a `date` field that anchors the optional calendar view.
   *  When unset, the calendar toggle still appears if the schema has any
   *  `date` field (the first one is used by default, switchable in-view).
   *  Pins the default anchor when the author wants a specific one. Must
   *  name a real `date` field. */
  calendarField?: string;
  /** Name of a second `date` field marking the END of a multi-day span on
   *  the calendar (record renders from `calendarField` to this date).
   *  Requires `calendarField`. Must name a real `date` field. Absent ⇒
   *  single-day placement. */
  calendarEndField?: string;
```

- **Validation** (`server/workspace/collections/discovery.ts`, Zod schema):
  if `calendarField` is set it must name a field whose `type === "date"`;
  if `calendarEndField` is set, `calendarField` must also be set and it too
  must name a `date` field. Invalid → surfaced as a boot-time schema
  diagnostic on the bell, same channel as existing collection validation
  errors. (Find the existing per-field cross-reference checks for
  `completionField` / `triggerField` / `displayField` and mirror them.)
- No change to records, I/O, or any API route.

## Part 2 — view-type seam in `CollectionView.vue`

`src/components/CollectionView.vue` is 2150 lines and hardcodes a `<table>`.
We do the **minimum** split to host a second renderer without over-building
a registry:

1. **Derive available views.** A computed `dateFields` (schema fields with
   `type === "date"`, in declaration order) and `hasCalendar = dateFields.length > 0`.
   A `view` ref (`"table" | "calendar"`, default `"table"`) and an
   `anchorField` ref (default `schema.calendarField ?? dateFields[0]`).
2. **View switcher control** in the existing sub-header row (the search-bar
   row at template line 65, `px-6 py-3 ... flex items-center justify-between`).
   Render it only when `hasCalendar`. Use the standard chrome sizing from
   CLAUDE.md: a two-segment toggle of `h-8 px-2.5 flex items-center gap-1`
   pills (table / calendar), `data-testid="collection-view-toggle-table"` /
   `"collection-view-toggle-calendar"`. When >1 date field and `view ===
   "calendar"`, also render a small anchor-field `<select>`
   (`data-testid="collection-calendar-field"`).
3. **Conditional render** of the scroll region (template line 92,
   `flex-1 overflow-auto`): keep the existing table markup under
   `v-show="view === 'table'"` (use `v-show`, not `v-if`, so table search/
   scroll state survives a round-trip), and mount
   `<CollectionCalendarView v-if="view === 'calendar'">` beside it.
4. **No behaviour change when `hasCalendar` is false** — the toggle is
   absent and the table renders exactly as today.

### Reuse the detail/edit contract

The hard-won part of `CollectionView.vue` is the inline detail + edit panel
(field rendering per type, validation, save/delete). The calendar MUST NOT
re-implement editing. Two viable structurings — pick during implementation
after reading the open/edit state code (the `select` emit at line 953, the
open-row state, and the edit form):

- **Preferred:** lift the detail/edit panel into a child component
  (`<CollectionRecordPanel>`) that both the table rows and the calendar
  cells open. This is the clean seam and pays off for any future view.
- **Fallback if the lift is too invasive for one PR:** keep the panel in
  the parent and have the calendar emit the same "open record id" signal the
  table rows use, so the existing panel renders below/over the grid. Document
  the debt and the follow-up to lift it.

Either way the calendar's only job is **placement + click-to-open**; create,
edit, delete all flow through the existing code paths and REST routes.

## Part 3 — `CollectionCalendarView.vue` (new component)

`src/components/CollectionCalendarView.vue`. Props mirror what the table
already has access to (pass down from parent, don't refetch):

```ts
defineProps<{
  schema: CollectionSchema;
  items: Record<string, unknown>[];
  anchorField: string;         // which date field drives placement
  endField?: string;           // optional multi-day span end
  selected?: string;           // currently-open record id
}>();
defineEmits<{ select: [id: string | null]; createOn: [isoDate: string] }>();
```

- **Month grid:** a 6×7 day grid for the visible month, prev/next-month
  nav + "Today" button in a header strip (chrome sizing: `h-8 w-8` icon
  buttons for nav, `h-8 px-2.5` for Today). Show leading/trailing days of
  adjacent months greyed, standard calendar convention.
- **Placement:** for each record, parse `record[anchorField]` (ISO
  `YYYY-MM-DD`); drop it on the matching cell. With `endField`, render the
  record across the inclusive span. Records with an empty/invalid anchor
  date are listed in a small "No date" tray below the grid (don't silently
  drop them — visibility over truncation).
- **Day granularity only.** Collections store `date` (no time-of-day). No
  intra-day ordering, no week/day time-grid — a month grid is the whole
  scope. Sort same-day records by `displayField` (or primaryKey) for stable
  order.
- **Record chip:** show `schema.displayField` value (fallback primaryKey),
  truncated. Click → `emit("select", id)` → parent opens the shared panel.
  Reuse any per-type formatting helpers the table already exports; do not
  duplicate money/enum/ref formatting.
- **Create-on-click (v1 decision — DEFAULT IN):** clicking an empty cell
  emits `createOn(isoDate)`; the parent opens its existing create form with
  the anchor date prefilled. Parent owns the create flow. *(If this proves
  to balloon the PR, ship read/navigate-only and emit nothing on empty-cell
  click; leave a TODO. Note the cut in the PR description per the no-silent-
  caps rule.)*
- **i18n:** all strings (`Today`, `No date`, weekday/month labels) via
  `useI18n().t` — extract to `src/lang/en.ts` first, then translate into all
  8 locales (`ja, zh, ko, es, pt-BR, fr, de`) in the same PR, keys in lockstep.
  Prefer `Intl.DateTimeFormat(locale, …)` for weekday/month names over
  hand-rolled tables (locale already available via `useI18n()`).

## Part 4 — `presentCollection` embedded mode

`CollectionView.vue` is reused embedded in chat via `presentCollection`
(`src/plugins/presentCollection/`). The toggle works there too, but the
**default view and open record persist in the tool-result `viewState`** (the
same mechanism the `select` emit already feeds, per the comment at
lines 950-953). Extend that persisted `viewState` to also carry the chosen
`view` and `anchorField` so a re-render keeps the calendar open if the user
switched to it. Verify the embedded card height accommodates a month grid
(it may need a min-height; check the card wrapper).

## Part 5 — agent-facing help (`collection-skills.md`)

`server/workspace/helps/collection-skills.md` is the DSL reference Claude
reads at runtime to author collections. A schema key that isn't documented
there is a key Claude won't know to emit, so the calendar view must be taught
there **in the same PR** that ships it (and NOT before — the live help must
never describe unbuilt behaviour). Three edits:

1. **Intro (line ~9)** — the host currently "renders a table / form / detail
   view". Add calendar to that list so the opening sentence reflects the
   second view type.
2. **Top-level schema-key table (lines ~94–108)** — add two rows after `spawn`:
   - `calendarField` — *Optional. Name of a `date` field that anchors an
     optional **calendar view** (a month grid; records land on their date
     cell). When unset, the calendar toggle still appears if the schema has
     any `date` field — the first one is used, switchable in-view. Set this to
     pin a specific anchor. Must name a real `date` field.*
   - `calendarEndField` — *Optional. A second `date` field marking the END of
     a multi-day span on the calendar (the record renders across
     `calendarField`→ this date). Requires `calendarField`. Must name a real
     `date` field.*
3. **New "### Calendar view" section** (place it after "Recurring obligations
   (`spawn`)", before "## Records") covering:
   - The zero-config trigger: *any collection with ≥1 `date` field gets a
     table ↔ calendar toggle; no schema change needed.* The hints only pin
     the anchor / add multi-day spans.
   - Day granularity only (no time-of-day), month grid only (no week/day
     time-grid), records with empty/invalid anchor dates listed in a "No date"
     tray (not dropped).
   - The view is a **rendering** — it adds no storage, no notification, no
     CRUD; it composes with `triggerField`/`spawn` but does not fire anything.
   - A short JSON example: a collection with `date` fields and a
     `calendarField` (e.g. an `events` collection with `on` / `until` dates).
   - One line clarifying the relationship to the **scheduler's** calendar:
     this is a generic collection view, not the `manageCalendar` plugin.
4. **Discovery troubleshooting (line ~456)** — extend the validation checklist
   ("…`spawn` has `triggerField`…") to mention `calendarField`/`calendarEndField`
   must name real `date` fields.

Keep the prose terse and operational, matching the existing section voice.

---

## Files touched

| File | Change |
|---|---|
| `server/workspace/collections/types.ts` | `+calendarField? +calendarEndField?` on `CollectionSchema` (after line 249) |
| `server/workspace/collections/discovery.ts` | Zod validation for the two new fields (mirror `triggerField`/`displayField` cross-ref checks) |
| `src/components/CollectionView.vue` | view ref + toggle control + `dateFields`/`anchorField` computeds + conditional render; (preferred) lift detail/edit into `CollectionRecordPanel` |
| `src/components/CollectionCalendarView.vue` | **new** — month grid renderer |
| `src/components/CollectionRecordPanel.vue` | **new (preferred path)** — lifted shared detail/edit panel |
| `src/plugins/presentCollection/*` | persist `view` + `anchorField` in embedded `viewState` |
| `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` | calendar strings, all 8 in lockstep, key order consistent |
| `server/workspace/helps/collection-skills.md` | **agent-facing DSL doc** — add the two new schema keys + a "Calendar view" section (see Part 5) |
| `docs/ui-cheatsheet.md` | update the collections ASCII block to show the table/calendar toggle |
| `docs/shared-utils.md` | append a line IF a reusable date helper (e.g. month-grid builder / ISO-date parse) is extracted |

## Tests

- **Unit** (`test/`, node:test) — pure helpers only: month-grid construction
  (6×7, leading/trailing days, leap Feb), record→cell bucketing including
  multi-day span and invalid/empty dates landing in the "No date" tray.
  Extract these as exported pure functions so they're testable without the DOM.
- **E2E** (`e2e/`, Playwright, mocked) — collection *with* a date field shows
  the toggle; switching to calendar renders records on correct cells; clicking
  a chip opens the detail panel; clicking an empty cell opens prefilled create
  (if create-on-click ships). Collection *without* a date field shows **no**
  toggle (guard the trigger condition). Use `data-testid`s above; call
  `mockAllApis(page)` before `goto`.
- Reuse an existing date-bearing fixture collection if one exists; else add a
  minimal one to the E2E fixtures.

## Out of scope (explicit)

- The scheduler's `manageCalendar` / `manageAutomations` plugins and the
  task-manager/scheduler-adapter execution engine — untouched.
- Time-of-day / datetime field type — collections remain day-granularity;
  no week/day time-grid views.
- Kanban / gallery / other view types — the seam is structured so a third
  view is a small addition, but none ship here. No generic view *registry*
  is built; `table`/`calendar` is a two-arm switch, not a plugin point yet.
- Recurrence/notifications — already handled by `triggerField`/`spawn`; the
  calendar only *renders*, it does not fire anything.

## Open decision (carried from design chat)

**Create-on-click in v1?** Defaulting IN (empty-cell click → prefilled
create) because it's the natural calendar affordance and the create flow
already exists. The fallback is read/navigate-only with a TODO. Confirm
before building Part 3's empty-cell handler.

## Sequencing

1. Part 1 (schema + validation) — small, independently landable.
2. Part 2 seam + Part 3 calendar (the bulk). Decide the panel-lift vs.
   fallback after reading the edit-state code.
3. Part 4 embedded persistence.
4. i18n + cheatsheet + tests, then `yarn format && yarn lint && yarn typecheck && yarn build`.

Move this file to `plans/done/` when the PR lands.
