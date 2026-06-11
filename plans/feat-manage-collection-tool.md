# feat: `manageCollection` — computed-aware reads, validated writes for the LLM

## Motivation

The LLM's data plane for collections is raw `Read`/`Write`/`Edit` on record
JSON files. That has two structural gaps:

1. **The runtime is blind to the computation layer.** Derived fields are
   evaluated only in the browser at render time
   (`src/composables/collections/useCollectionRendering.ts:293` `deriveAll`,
   over the pure evaluator in `src/utils/collections/derivedFormula.ts`).
   Stored records never contain them, so the agent reading
   `data/portfolio/items/*.json` never sees `price`/`value`, and an action
   worker recording a payment never sees the invoice's computed total. For an
   architecture whose thesis is "Claude is the runtime"
   (`docs/collections-architecture.md`), the runtime can't read the one thing
   the host computes.
2. **Validation is advisory, not a gate.** `validateCollectionRecords`
   (`server/workspace/collections/validate.ts`) runs *after* writes — the
   `presentCollection` dispatch appends issues to the tool result
   (`server/api/routes/plugins.ts:266-285`) and the model repairs files it
   already broke. Nothing prevents writing a malformed record; a bad file is
   silently skipped at read time until the repair loop catches it.

Also a turn-economy cost: reading a 30-record collection with refs is ~30+
file Reads plus a mental join; storing 20 quote rows is 20 `Write` calls.

This plan adds one MCP tool:

```ts
manageCollection({ action: "getItems" | "putItems", slug, ... })
```

- **`getItems`** — fetch records with computed fields resolved (derived
  evaluated server-side, toggle projected, embed targets attached), with
  `ids`/`fields` selection for context economy.
- **`putItems`** — store rows through host validation: each row validated
  against the schema *before* `writeItem`; per-row accept/reject results the
  model can act on.

The `action` discriminator follows the house `manage*` pattern
(`manageAutomations`, `manageSkills`) and leaves room for future actions
(`deleteItems`, `validate`, `query`) without new tools.

## Design

### The paved road, not an enforcement boundary

Raw file I/O cannot and should not go away — "the workspace is the database"
means users, scripts, and external tools edit these files too. So
`manageCollection` is the *recommended* path (validated, atomic,
computed-aware, one call instead of N), raw `Read`/`Write`/`Edit` stays the
escape hatch, and the existing post-hoc validation loop remains the backstop
for off-road writes. Recipes that currently instruct "All I/O via
Read / Write / Edit" migrate to "use `manageCollection`; raw file I/O is the
escape hatch" (Phase 5).

### Server-side derivation must share the client's code, not mirror it

If the server reimplements derivation, UI and LLM eventually disagree on a
number. The evaluator (`derivedFormula.ts`) is already a pure shared util;
the saturation loop (`deriveAll` + `resolveRowRefs`,
`useCollectionRendering.ts:283-310`) is also pure but trapped inside the
composable. Extract both functions verbatim into
`src/utils/collections/deriveAll.ts`; the composable delegates. The server
already imports from `src/utils/collections/` (`actionVisible` in
`server/workspace/collections/notifications.ts`), so no new boundary is
crossed.

On the server, the missing piece is the `RefRecordCache` the client builds by
fetching linked collections: a new `server/workspace/collections/derive.ts`
loads each unique ref/embed target via `loadCollection` + `listItems` once per
call, then maps the shared `deriveAll` over the requested items.

### `getItems`

```ts
{ action: "getItems", slug, ids?: string[], fields?: string[] }
```

- Omitted `ids` ⇒ all records; omitted `fields` ⇒ all fields. The selectors
  are the token-economy lever — the tool prompt tells the model to use them
  on large collections rather than dumping everything.
- Enrichment per record: derived fields evaluated (failures stay `null`,
  matching the UI's em-dash semantics), `toggle` projected from its enum,
  `embed` fields resolved to the target record object (or `null` when
  missing, matching `CollectionEmbedView`'s missing state).
- Read semantics match the UI: malformed files are skipped by `listItems`.
  Like the `presentCollection` dispatch, the result appends a
  `validateCollectionRecords` warning (issue strings passed through
  `defangForPrompt`, `src/utils/promptSafety.ts`) so skipped records are
  visible, not vanished.

### `putItems`

```ts
{ action: "putItems", slug, items: object[], mode?: "upsert" | "create" }
```

- Per-row validation **before** any write, reusing the existing per-record
  validator: export `schemaViolation` from `validate.ts` (today
  module-private at `:99`) as `validateRecordObject(record, id, schema)` —
  it already checks primaryKey↔id, required fields, enum membership, and
  skips `COMPUTED_TYPES`.
- Additional putItems-only rule: reject rows that set computed keys, with an
  actionable problem string ("'value' is derived — computed by the host,
  remove it"; toggle → "write enum field 'status' instead").
- Writes go through `writeItem` (atomic, id-sanitized, containment-checked —
  no new I/O path). `mode: "create"` maps to `refuseOverwrite: true`;
  default `upsert`.
- **Per-row results, not all-or-nothing**: valid rows are written, invalid
  rows are rejected individually —
  `{ written: string[], rejected: [{ id, problem }] }` — because the
  `RecordIssue` problem strings are already written to be LLM-actionable; the
  model fixes the rejects and retries just those. Problem strings that quote
  record-controlled values are defanged as above.

### Tool home: pure server MCP tool, available to every role

Not a built-in plugin — there is no Vue surface. The right pattern is
`server/agent/mcp-tools/` (like `readXPost`/`searchX`/`notify`): a pure
server-side handler running in the Express process with direct access to the
collections workspace layer, named in `TOOL_NAMES`. It is **`alwaysActive:
true`** (the gating mechanism `spawnBackgroundChat` introduced in
`server/agent/activeTools.ts`): available to every role without being listed
in any role's `availablePlugins`. Collections are workspace data, like files
— every role can already reach them via Read/Write/Edit, so gating the
*safer* path per-role would only push unlisted roles back onto raw file I/O.
No `src/config/roles.ts` changes.

### What v1 deliberately omits

No filters, sorts, or aggregations — `ids`/`fields` selection only. Computing
derived values is mechanical (the host's side of the boundary); filtering and
aggregating are cheap in-context judgment. "Extend the declarative layer only
when it outperforms the agent" cuts both ways. Future actions extend the
`action` enum, not the query surface.

## Per-file edits

### Phase 1 — extract the shared derive loop

- **`src/utils/collections/deriveAll.ts`** (new) — move `resolveRowRefs` and
  `deriveAll` verbatim from `useCollectionRendering.ts:283-310`; the
  `RefRecordCache` type moves (or is re-exported) with them. Pure module: no
  Vue imports.
- **`src/composables/collections/useCollectionRendering.ts`** — delete the
  local copies, import from the new util. No behavior change.
- **`docs/shared-utils.md`** — 1-line catalog entry for the new shared util
  (same PR, per the catalog rule).
- **`test/utils/collections/test_deriveAll.ts`** (new) — saturation across
  chained derived fields (`subtotal → tax → total` converges in ≤ field-count
  passes), cycle saturates to no-change, ref resolution via the cache.

### Phase 2 — server-side enrichment

- **`server/workspace/collections/derive.ts`** (new) —
  `enrichItems(collection, items, opts)`: collect unique `ref`/`embed`
  targets from the schema, `loadCollection` + `listItems` each once, build
  the `RefRecordCache`, map the shared `deriveAll`, project `toggle`, attach
  resolved `embed` records.
- **`server/workspace/collections/validate.ts`** — export the per-record
  validator as `validateRecordObject(record, id, schema)` (extracted from
  `schemaViolation`, `:99`); `inspectRecord` delegates. No behavior change to
  the file-scanning path.
- **`test/workspace/collections/`** — `enrichItems`: derived across a ref
  (`shares * ticker.price`), dangling ref ⇒ `null`, embed missing ⇒ `null`;
  `validateRecordObject` parity with the existing scan results.

### Phase 3 — the MCP tool

- **`server/agent/mcp-tools/manageCollection.ts`** (new) —
  - `definition.inputSchema`: `action` (enum `["getItems", "putItems"]`),
    `slug` (required), `ids?`/`fields?` (getItems), `items?`/`mode?`
    (putItems).
  - `prompt`: when to prefer it over raw file I/O; computed fields are
    read-only and present in getItems results; putItems validates and
    returns per-row rejects to fix-and-retry; use `ids`/`fields` on large
    collections.
  - `handler`: `loadCollection(slug)` (404-style error result on unknown
    slug), dispatch on `action`; getItems → `listItems`/`readItem` +
    `enrichItems` + validation warning; putItems → per-row
    `validateRecordObject` + computed-key rejection + `writeItem`.
  - `alwaysActive: true` — exposed to every role regardless of
    `availablePlugins` (no `roles.ts` edit).
  - Keep the handler thin; the logic lives in the workspace layer
    (Phase 2) so the function-size and complexity limits hold.
- **`server/agent/mcp-tools/index.ts`** — add to the `mcpTools` array.
- **`src/config/toolNames.ts`** — `manageCollection: "manageCollection"`
  alongside the other host-fixed mcp-tool names (`:61-66`).
- **`test/agent/test_manageCollection.ts`** (new) — getItems: enrichment +
  ids/fields selection + skipped-record warning; putItems: valid rows
  written, invalid rejected per-row with actionable problems, computed-key
  rejection, `create` mode refuses overwrite; unknown slug/action error
  results; tool present for a role with empty `availablePlugins`
  (`alwaysActive` path).

### Phase 4 — getItems/putItems hardening pass

- Defang every record-controlled string that reaches the tool result
  (problem strings, warning lines) via `defangForPrompt` — mirror
  `server/api/routes/plugins.ts:278`.
- Cap getItems response size defensively (e.g. refuse `ids`-less getItems
  over N records with a "pass ids or fields" error rather than truncating
  silently — no silent caps).

### Phase 5 — recipes + docs (independently shippable)

- **`server/workspace/helps/portfolio-tracker.md`**, **`collection-skills.md`**,
  **`todo-collection.md`**, **`lessons-collection.md`** — migrate the
  "All I/O via Read / Write / Edit" guidance in SKILL.md templates to
  "prefer `manageCollection` (validated writes, computed values in reads);
  raw file I/O is the escape hatch". The portfolio recipe's read examples
  switch to getItems so `price`/`value` are real values, not "—".
- **`docs/collections-architecture.md`** — the "host computes the result"
  claim becomes server-side true; one sentence noting computed values are
  readable by the runtime via `manageCollection`.

## Testing

Covered per-phase above; plus:

- **Determinism cross-check**: one test feeds the same schema + records to
  the client path (`evaluateDerivedAgainstItem`) and the server path
  (`enrichItems`) and asserts identical numbers — the regression that matters
  most after the extraction.
- **Manual** (`docs/manual-testing.md`): in an investor chat, ask for
  portfolio values — confirm the model calls
  `manageCollection getItems` and reports the derived `value` without
  reading record files; ask it to add a malformed holding — confirm the
  reject round-trip fixes and retries instead of writing a broken file.

## Out of scope / follow-ups

- **Action seeds with computed values** — `buildActionSeedPrompt` /
  `buildCollectionActionSeed` calling `enrichItems` so action workers see
  derived totals. Cheap once Phase 2 lands; separate PR.
- **`notifyWhen`/`spawn` predicates over derived fields** — possible once the
  watcher can call `enrichItems`; own plan.
- Future actions: `deleteItems`, `validate` (on-demand repair report),
  `getSchema` (the agent can Read `schema.json`; add only if prompting shows
  it's needed), `query` (resist until in-context filtering demonstrably fails).
- Serving the UI from server-side enrichment (single evaluation site) —
  client-side eval stays for reactivity; revisit only if drift ever appears.
