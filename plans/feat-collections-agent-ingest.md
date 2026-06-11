# feat: `ingest.kind: "agent"` — scheduled agent refresh for collections

## Motivation

A stock-quotes collection should be able to update its records daily without the
user doing anything: a hidden chat fetches the quotes and edits the record files.
Today that's expressible only as a `manageAutomations` task whose free-form prompt
happens to mention the collection — the schedule lives in
`config/scheduler/tasks.json`, detached from the schema. It doesn't travel when
the skill directory is copied, it drifts when the schema changes, and it
contradicts the Collections thesis (`docs/collections-architecture.md`): *the
schema is the application definition*.

The host already has both halves of the mechanism; they just don't meet:

- **Feeds own the scheduling half.** The ingest engine
  (`server/workspace/feeds/engine.ts`) has cadence (`hourly`/`daily`/`weekly`/
  `on-demand`), per-collection state (`lastFetchedAt`, `consecutiveFailures`),
  an hourly due-loop (`system:feed-refresh`, `server/index.ts:1077`), a manual
  refresh route (`server/api/routes/collections.ts:278` — already commented
  "generic over kind"), and a first-open auto-refresh. The `ingest` block is
  already accepted by `CollectionSchemaZ` on every source — it's just never
  executed for non-feeds. And `ingestTypes.ts:7-9` explicitly reserves an
  LLM-performed retriever kind "without reshaping the engine".
- **`spawnBackgroundChat` owns the hidden-execution half**
  (`plans/feat-spawn-background-chat.md`): `origin: system` sessions are
  invisible, capped at 4 via an atomic reserve
  (`server/agent/backgroundSessions.ts`), auto-deleted on success, retained on
  error.

The declarative retrievers (`rss`/`atom`/`http-json`) can't do stock quotes
anyway — no auth headers, static URL, no judgment about which symbols to fetch.
That's exactly the "business logic becomes language" case: the *what/how* belongs
in a prose template, the *when* in the schema.

This plan joins the halves at the seam the engine left open:

```json
"ingest": {
  "kind": "agent",
  "schedule": "daily",
  "role": "general",
  "template": "templates/refresh.md"
}
```

on an ordinary (skill-backed) collection. When due, the host assembles the same
seed a collection-level action gets (template + all-records summary) and
dispatches it as a hidden background chat in the declared role. The host stays
domain-free; everything stock-specific lives in the collection's template.

## Design

### Schema shape

`ingest` becomes a discriminated union on `kind`:

- **Declarative** (`rss` | `atom` | `http-json`) — unchanged: `url`, `map`,
  `schedule`, `itemsAt?`, `idFrom?`, `maxItems?`.
- **Agent** (`agent`) — `schedule` (same `FEED_SCHEDULES` vocabulary), `role`
  (non-empty string), `template` (skill-relative path validated by
  `isSafeActionTemplatePath`, like action templates). No `url`/`map`/`maxItems`
  — the agent owns retrieval and record shape; record writes are still
  schema-validated by the existing validate-and-repair loop.

`kind: "agent"` is meaningful on any source. The template resolves against
`collection.skillDir` (`discovery.ts:644` sets it for feeds too —
`feeds/<slug>/templates/…` works), but the primary consumer is skill-backed
collections; feeds keep their declarative kinds.

### Dispatch flow (`refreshOne`, agent branch)

1. Build the seed with the **same assembly as collection-level actions**
   (`buildCollectionActionSeed`, `server/api/routes/collections.ts:349`):
   template text + compact summary of every record, with the existing
   `sanitizeDeep` / SECURITY-BOUNDARY framing. Extract that helper from the
   route file into the collections workspace layer so both the route and the
   engine call it (it's pure assembly; the route keeps only HTTP concerns).
2. Reserve a background slot (`tryReserveBackgroundSession`) and `startChat`
   with `origin: SESSION_ORIGINS.system` — identical semantics to
   `spawnBackgroundChat({hidden: true})`. Roll back the reservation if
   `startChat` throws.
3. **`lastFetchedAt` records dispatch time, not completion.** This is what
   gates the due-loop, so a slow worker can't cause double-dispatch.
4. **Cap miss ⇒ retry next tick.** If the reserve fails (4 hidden workers in
   flight), do *not* touch `lastFetchedAt`; the hourly tick redials. Return it
   in `errors` so a manual refresh surfaces "busy" honestly.

### Completion feedback (don't let it die silently)

Fire-and-forget is fine for lesson prefetch; a daily refresher that fails for a
week unnoticed is the worst failure mode. `finalizeRun`
(`server/api/routes/agent.ts:971`) already branches on `origin === system` to
release the slot — add a generic completion-hook registry there:
`backgroundSessions.ts` gains `registerCompletionHook(chatId, cb)` /
`takeCompletionHook(chatId)`, and `finalizeRun` invokes the hook with
`{ didError }`. This is generic host infra (any spawner of hidden workers can
use it), not ingest-specific.

The ingest dispatcher registers a hook per run:

- **success** → reset `consecutiveFailures`, clear any failure bell entry.
- **error** → increment `consecutiveFailures`, publish a bell entry
  ("Collection refresh failed: `<slug>`", navigate-to-collection action,
  stable id `collection-ingest:<slug>` for dedup/clear — same pattern as
  `server/workspace/collections/notifications.ts`). The errored session's
  files are already retained for inspection.

### State location

Feed state lives at `feeds/<slug>/_state.json`. Skill collections must NOT
write there (a `feeds/<slug>/` dir without `schema.json` confuses feed
discovery, and `_state.json` must never live in `dataDir`, where `listItems`
would read it as a record). Generalize the state path: feeds keep their
current location; non-feed collections store at `data/ingest-state/<slug>.json`
(new `WORKSPACE_DIRS` entry, per the constants rule).

### Scheduling

`refreshDue` (`engine.ts:126`) currently iterates `listFeeds()`. Widen it to
every discovered collection whose schema carries `ingest` (feeds and
skill-backed alike); `isFeedDue` is already source-agnostic. The hourly system
task keeps its id (`system:feed-refresh` — renaming would orphan its
scheduler-state row); update its comment. Cadence stays elapsed-based
(`daily` = "≥24 h since last dispatch, checked hourly"); time-of-day anchoring
("daily at 09:00") is out of scope.

### What this does NOT add

No new top-level mechanism, no new storage format, no `manageAutomations`
coupling, no per-record fan-out (one run = one collection-scoped worker that
edits whatever records it judges necessary). Host purity holds: "scheduled
agent refresh" is generic; the stock-quotes logic is prose in the template.

## Per-file edits

### Phase 1 — schema + types

- **`server/workspace/feeds/ingestTypes.ts`** — split `IngestSpec` into
  `DeclarativeIngestSpec` (current shape, kinds `rss`/`atom`/`http-json`) and
  `AgentIngestSpec` (`kind: "agent"`, `schedule`, `role`, `template`);
  `IngestSpec` becomes the union. Update the header comment (the reserved
  "prompt" kind ships as `agent`).
- **`server/workspace/collections/discovery.ts`** — replace `IngestSchemaZ`
  (`:300`) with `z.discriminatedUnion("kind", [DeclarativeIngestZ,
  AgentIngestZ])`; `AgentIngestZ` validates `role` non-empty and `template`
  via `isSafeActionTemplatePath` (same rule as `ActionSpecSchema`).
- **`test/workspace/collections/test_discovery.ts`** — accept/reject cases:
  agent ingest with valid shape; missing role; unsafe template path
  (`../x`, absolute); declarative kinds unaffected.

### Phase 2 — seed assembly extraction

- **`server/workspace/collections/io.ts`** (or a sibling `seeds.ts` if io.ts
  grows past taste) — move `buildCollectionActionSeed`'s assembly
  (template read + records summary + `buildActionSeedPrompt` framing) out of
  `server/api/routes/collections.ts:349` into an exported
  `buildCollectionSeed(collection, { role, template })`. Route delegates to it;
  behavior unchanged.
- **`server/api/routes/collections.ts`** — collection-action route calls the
  extracted helper.

### Phase 3 — engine dispatch + DI

- **`server/workspace/feeds/state.ts`** — state path branches on collection
  source: feeds → `feeds/<slug>/_state.json` (unchanged); otherwise →
  `data/ingest-state/<slug>.json`. Read/write signatures gain the source (or
  take the `LoadedCollection`).
- **`server/workspace/paths.ts`** — add `ingestState: "data/ingest-state"` to
  `WORKSPACE_DIRS`.
- **`server/workspace/feeds/agentIngest.ts`** (new) —
  - `setAgentWorkerRunner(runner)` DI seam; `runner({ message, roleId }) →
    Promise<{ ok: true; chatId } | { ok: false; error }>` (wired in Phase 4;
    avoids `workspace/ → api/routes/` imports).
  - `refreshViaAgent(workspaceRoot, collection)`: build seed via
    `buildCollectionSeed`, reserve slot, dispatch, set `lastFetchedAt` to now,
    register the completion hook (Phase 5). Returns a `RefreshResult`
    (`written: 0`, new `dispatched?: true` flag; cap-miss / template-missing →
    `errors`, state untouched).
- **`server/workspace/feeds/engine.ts`** —
  - `refreshOne` branches: `ingest.kind === "agent"` → `refreshViaAgent`;
    declarative kinds unchanged.
  - `refreshDue` iterates all discovered collections with `schema.ingest`
    instead of `listFeeds()`.
- **`server/index.ts`** — comment touch-up on `system:feed-refresh` (`:1077`):
  it now drives all scheduled ingest, not just feeds.

### Phase 4 — hidden-worker spawn extraction (host)

- **`server/api/routes/agent.ts`** — extract the reserve→`startChat`→rollback
  sequence (currently inside the `spawnBackgroundChat` handler) into an
  exported `spawnSystemWorker({ message, roleId })` living next to `startChat`.
- **`server/agent/mcp-tools/spawnBackgroundChat.ts`** — `hidden: true` path
  delegates to `spawnSystemWorker`; behavior identical.
- **`server/index.ts`** — `setAgentWorkerRunner(spawnSystemWorker)` at boot,
  next to the existing `registerUserTasks({ taskManager, startChat })` wiring.

### Phase 5 — completion hooks + failure bell

- **`server/agent/backgroundSessions.ts`** — add
  `registerCompletionHook(chatSessionId, cb)` / `takeCompletionHook` (Map,
  one-shot). Hooks are best-effort: a server restart mid-run drops them; the
  next due-tick re-dispatches anyway.
- **`server/api/routes/agent.ts`** — in `finalizeRun`'s `origin === system`
  branch, invoke the hook with `{ didError }` (after slot release, before
  file deletion).
- **`server/workspace/feeds/agentIngest.ts`** — the registered hook updates
  `consecutiveFailures` and publishes/clears the failure bell entry via
  `server/notifier/engine.ts` (stable id `collection-ingest:<slug>`,
  navigate-to-collection action, warning severity — mirror the entry shape
  used by `server/workspace/collections/notifications.ts`).
- **`test/agent/`** — hook registry: one-shot semantics; invoked with
  `didError`; unknown chatId is a no-op.

### Phase 6 — UI + i18n

- **`src/components/CollectionView.vue`** — refresh button already renders for
  any `schema.ingest`. Handle the `dispatched` response: show a transient
  "refresh started in the background" note instead of a written-count; keep
  the in-flight hourglass while the POST is pending only (the worker is
  detached). Button label/tooltip: generic "Refresh", not "Refresh feed".
- **`src/lang/en.ts` + all 7 other locales** — new key(s) for the dispatched
  toast and label change, all 8 in lockstep, properly translated.
- **`src/components/` feeds card grid** — no change (agent ingest on feeds is
  possible but not promoted; cards already render kind/schedule generically).

### Phase 7 — docs + recipe (independently shippable)

- **`server/workspace/helps/portfolio-tracker.md`** — the existing
  stock-quotes + portfolio recipe is the canonical consumer; upgrade it
  rather than inventing a parallel example:
  - the `stock-quotes` `schema.json` gains
    `ingest: { kind: "agent", schedule: "daily", role: "investor",
    template: "templates/refresh-quotes.md" }`;
  - add `data/skills/stock-quotes/templates/refresh-quotes.md` to the recipe,
    showing the prose contract: fetch the latest Yahoo Finance quote for
    every record's ticker (the investor role prompt already documents the
    endpoints + the 15-minute-delay caveat), `Edit` each record's
    `price`/`pe`/`yield`, fix any validation issues, stop — no `present*`
    calls, no one is watching the canvas;
  - note the knock-on effect the recipe already sets up: the portfolio's
    derived `price`/`value` revalue from the refreshed quotes with no copying.
- **`src/config/roles.ts:349`** — update the investor role's portfolio-tracker
  sample query to sell the new behavior, e.g. "Set up a stock portfolio
  tracker — a stock-quotes watchlist that refreshes itself daily, plus a
  portfolio that values my holdings against it. First read
  `config/helps/portfolio-tracker.md` and follow it exactly to author both
  collections — do not redesign the schemas or ask me design questions."
  (`queries` are plain English strings in `roles.ts`, not i18n keys — no
  locale work.)
- **`server/workspace/helps/feeds.md` / `collection-skills.md`** — one short
  section each pointing at `ingest.kind: "agent"` for collections whose
  refresh needs judgment (auth, per-record requests) instead of a declarative
  `map`.
- **`docs/collections-architecture.md`** — the portfolio example
  (`shares * ticker.price`) can now claim its daily revaluation honestly: add
  a short "Scheduled ingest" paragraph under the workflow section.

## Testing

- **Unit (`test/workspace/`)**:
  - Zod: agent-ingest accept/reject matrix (Phase 1).
  - `agentIngest`: fake runner injected — dispatch updates `lastFetchedAt`;
    cap-miss leaves state untouched and reports the error; template-missing
    reports without dispatch; completion hook success/failure paths update
    `consecutiveFailures` and publish/clear the bell entry (fake notifier).
  - `state`: non-feed collections read/write `data/ingest-state/<slug>.json`;
    feeds stay at `feeds/<slug>/_state.json`.
  - `refreshDue`: a skill collection with agent ingest is picked up when due;
    `on-demand` never auto-dispatches.
- **Unit (`test/agent/`)**: `spawnSystemWorker` extraction keeps the
  spawnBackgroundChat handler tests green (reserve, rollback, cap race).
- **Manual** (`docs/manual-testing.md` entry): create the stock-quotes recipe
  collection, click Refresh, confirm a hidden worker updates records and the
  sidebar shows nothing; kill the network and confirm a failed run lands a
  bell entry that clears on the next success.

## Out of scope / follow-ups

- Time-of-day anchoring (`"daily at 09:00"`) — `FEED_SCHEDULES` stays
  elapsed-based; revisit if quote freshness needs market-hours alignment.
- Per-record scheduled actions (fan-out of one worker per record) — cap
  pressure and prompt design need their own plan.
- A `code` ingest kind (LLM-generated deterministic transform, the other
  reserved slot in `ingestTypes.ts`).
- Surfacing in-flight hidden workers in the UI (debug view) — carried over
  from `plans/feat-spawn-background-chat.md`.
- Raising `MAX_BACKGROUND_SESSIONS` — revisit if several agent-ingest
  collections plus lesson prefetch contend in practice.
