# Feature: Standard colours for `enum` field values

## Goal

Give every `enum` field value a distinct colour, applied consistently across
**all** collection views (list, calendar, kanban, dashboard). Colours are
assigned automatically from a standard palette — **no schema change**, no
per-value config. Remove the existing `notifyWhen`-driven colouring from the
dashboard (which made every value read the same green) and replace it with
the per-value palette.

Motivating example: the `engagements` collection's `category` enum
(`business` / `personal` / `society`) should render each category in its own
colour on the calendar chips, kanban column, dashboard cards, and the inline
list cell.

## Design decisions (confirmed with user)

- **All views**, not just the dashboard.
- **List view**: colour only the enum control itself (the inline `<select>`),
  NOT the whole row.
- **notifyWhen**: it no longer drives a 3-state alert/ok/none dashboard colour.
  Instead it defines the **notification enum** (see below). `notifyWhen` also
  stays a server feature (completion bell + dashboard "alert box") — not deleted.
- **Colour source (normal enum)**: a standard, ordered palette assigned by the
  value's **index in the enum's `values` array** (declaration order), cycling
  when an enum declares more values than the palette holds. Empty / unknown /
  Uncategorized → neutral grey.
- **Notification enum** (the field a schema's `notifyWhen` targets): instead of
  the palette, its values read the **notification severity colours** to match
  the bell — the first flagged value in `notifyWhen.in` (most urgent) → red,
  the remaining flagged values → amber, every non-flagged value → neutral grey.
  e.g. todos `priority: [urgent, high, medium, low]` with
  `notifyWhen.in: [urgent, high]` → urgent=red, high=amber, medium/low=grey.
- **Palette excludes the warm warning band** (red / orange / amber) entirely —
  those are reserved for the notification severity colours — so a normal enum
  value can never draw a colour that reads like a notification. Eight
  well-separated cool/green/magenta hues: indigo, sky, cyan, teal, emerald,
  lime, violet, fuchsia.
- **No schema/type/server/i18n changes** — colouring is purely derived from
  existing `values`. (A per-value override could be a future follow-up.)
- **Primary enum**: the field a view groups by. Dashboard & kanban already use
  `kanbanGroupField` (schema `kanbanField` hint, else first enum field,
  switchable in-view). The calendar has no enum switcher; it will tint chips by
  that same primary-enum field passed down as a new `colorField` prop.

## Palette

8 colours, in order: `indigo, emerald, amber, rose, sky, violet, teal, orange`.
Tailwind only detects literal class strings, so each surface's classes are
spelled out per colour (cannot build `bg-${name}-100` at runtime).

## Files

### New: `src/utils/collections/enumColors.ts`
- `EnumColorClasses` interface: `{ card, dot, badge, border }` class strings.
  - `card` — dashboard stat card (border + fill + text + hover)
  - `dot` — small status dot (kanban header, dashboard row)
  - `badge` — pill / inline `<select>` fill + text (no border width)
  - `border` — border colour, paired with a `border` width class by caller
- `PALETTE` (8 entries) + `ENUM_NEUTRAL` (slate, for empty/uncategorized).
- `enumColorClasses(index)` → palette entry, cycling; `index < 0` → neutral.
- `enumValueIndex(values, value)` → index in `values`, or -1 when empty/unknown.

### `src/components/CollectionDashboardView.vue`
- Remove `DashboardStatus`, `STATUS_CARD_CLASS` / `STATUS_DOT_CLASS` /
  `STATUS_BADGE_CLASS`, and `statusOfValue()`.
- `StatCard` / `DashboardRow`: replace `status` with `colorIndex: number`.
- Cards use `enumColorClasses(card.colorIndex).card`; row dot uses `.dot`; row
  badge uses `.badge`. colorIndex = `enumValueIndex(groupSpec.values, value)`.
- KEEP `notify` / `alertItems` / `alertLabel` and the alert box (functional).
- Update the top-of-template comment (no longer notifyWhen-driven colour).

### `src/components/CollectionKanbanView.vue`
- Column header dot: replace fixed `bg-indigo-400` / `bg-slate-300` with
  `enumColorClasses(enumValueIndex(groupSpec.values, column.value)).dot`.

### `src/components/CollectionView.vue`
- Inline enum `<select>` cell: keep structural + focus classes; bind the
  value-based `badge` + `border` (with `border` width) so the control tints by
  its current value. Empty → neutral slate (matches current look).
- Pass `:color-field="kanbanGroupField"` to `<CollectionCalendarView>`.

### `src/components/CollectionCalendarView.vue`
- New prop `colorField?: string`.
- `CalendarEntry` gains `colorIndex` (from the record's value on `colorField`).
- Day chips + undated chips: unselected chips tint with `badge` + `border`;
  the selected chip keeps the existing indigo override. When `colorField` is
  unset/has no value → keep the current default indigo/slate styling.

### `src/components/CollectionRecordPanel.vue` (detail editor)
- Colour the top-level enum `<select>` the same way as the list cell, for
  consistency. (Table sub-row enum selects left as-is to bound scope.)

## Out of scope (this pass)
- Per-value colour overrides in the schema.
- Colouring nested `table` sub-field enum selects.
- Deleting `notifyWhen` (kept; only its dashboard-colour role is removed).

## Verification
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`.
- Manual: open `engagements` → confirm category colours match across list cell,
  calendar chips, kanban column dots, dashboard cards/dots/badges; unset value
  reads grey; alert box still appears when a `notifyWhen` schema uses it.
- Existing e2e (`collection-inline-edit.spec.ts`) asserts no colour classes, so
  no test churn expected.

## Status
- [x] enumColors.ts helper
- [x] Dashboard view
- [x] Kanban view
- [x] List inline select + calendar wiring
- [x] Calendar view
- [x] Record panel select
- [x] format / lint / typecheck / build (all green)
- [ ] manual check on engagements (run `yarn dev`, open the collection)
