# refactor: drop the `manageFeed` MCP tool — manage feeds like Collections (skill + help file)

Status: proposed. Follows the Feeds feature (PR #1627, merged).

## Context / motivation

Feeds today are managed by a dedicated MCP tool, `manageFeed` (register / list / refresh / remove). But Collections — the system Feeds was modelled on — have **no CRUD tool**: Claude reads a help file (e.g. `config/helps/collection-skills.md`), then authors `schema.json` and CRUDs record JSON files directly with its file tools; the only collection tool, `presentCollection`, just displays. Validation happens at *discovery* time, not via a tool call.

Feeds can follow the same model. The agent's only job is to **author `feeds/<slug>/schema.json`** once (fetch the URL, infer the shape, write the file). Everything else — fetching/parsing/upserting records — is done by the **host retrieval engine on the hourly scheduler** (and the `[Refresh feed]` button), not by the agent. So the agent never needs a tool to *trigger* retrieval, and register/list/remove are plain file operations.

**Benefits:** one fewer always-loaded MCP tool in the prompt (the same prompt-budget win that motivated feeds-not-being-skills), full consistency with Collections, and less bespoke surface (delete a plugin + a route). Matches the project philosophy: "the workspace is the database; Claude is the interface."

## What stays host-side (cannot be a skill)

- The **retrieval engine** (`server/workspace/feeds/engine.ts` + `fetch/` + `retrievers/`): network fetch, SSRF guard, RSS/JSON parse, keyed upsert, maxItems prune.
- The **hourly `system:feed-refresh` scheduler task** (drives retrieval without the agent).
- **Discovery** of feed schemas (so the engine + UI find them) and **CollectionView rendering** + the `[Refresh feed]` button (→ `POST /api/collections/:slug/refresh`, an existing host route).

## Plan

### Remove (the agent-facing tool surface)
- Delete `src/plugins/manageFeed/` (`meta`, `definition`, `index`, `View.vue`, `Preview.vue`).
- Delete the MCP dispatch route `server/api/routes/feeds.ts` `POST /api/feeds/manage`; unmount `feedsRoutes` in `server/index.ts`.
- Remove `TOOL_NAMES.manageFeed` from the Personal role in `src/config/roles.ts`.
- Re-run `yarn plugins:codegen` to regenerate `_generated/{metas,registrations,server-bindings}.ts` without `manageFeed`.

### Add (the skill/help surface)
- `server/workspace/helps/feeds.md` (provisioned to `config/helps/feeds.md`): the schema + `ingest` spec — essentially the old `manageFeed` tool description, rewritten as instructions for Claude to (1) fetch + inspect the URL, (2) write `feeds/<slug>/schema.json` with `fields` + `ingest` + `displayField`, (3) tell the user it'll fetch on the next refresh / Refresh button. Covers: object-keyed `fields`, the type enum, `primaryKey`+`primary:true`, optional `icon`/`dataPath`, the `ingest` block (kind/url/schedule/map/itemsAt?/idFrom?/maxItems?), raw-item path mapping (`@_attr`, namespaced tags), date→YYYY-MM-DD, and "set `displayField`."
- Update the Personal role: the existing "Register this feed…" query stays; its seed prompt (`collectionsView.addFeedPrompt`) and `FeedsView`'s Add prompt change to "read `config/helps/feeds.md`, then author `feeds/<slug>/schema.json`" instead of "use the manageFeed tool."

### Rewire the UI (no MCP tool, host routes only)
- Keep a slim **read-only** `server/api/routes/feeds.ts` with just `GET /api/feeds` → feed summaries (slug, title, icon, kind, schedule, lastFetchedAt) for `FeedsView` (the collections list omits kind/schedule/lastFetched). Register `feeds.list` in `HOST_API_ROUTES` (host-fixed, not a plugin META). *(Alternative: drop this too and have FeedsView use `GET /api/collections` filtered to `source:"feed"`, losing the kind/schedule/lastFetched columns. Recommend keeping the slim GET.)*
- `FeedsView.vue`: list via `GET /api/feeds`; per-feed refresh via the existing `POST /api/collections/:slug/refresh`; the Add modal seeds the help-based chat (no API).
- Move `icon`/`dataPath` defaulting out of the deleted `writeFeed` into discovery/`loadOneCollection` for `source:"feed"` (so agent-written schemas still get defaults), or document in the help that the agent must include them.

### Optional (nice-to-have for parity with today's UX)
- A **feeds file-watcher** (mirroring `startCollectionWatchers`) that fetches a feed once when its `schema.json` first appears — restores "immediate fetch on create" without a tool. Without it, first data lands on the next hourly tick or on a manual Refresh.

### Keep / tests
- `server/workspace/feeds/{registry(listFeeds/removeFeed only),state,paths,engine,retrievers,fetch,projectItem,pathResolver}` — engine + discovery side unchanged. `writeFeed` can be dropped (agent writes files) or retained only for the watcher/tests.
- Existing engine/parser/projection/SSRF tests stay. Update `test_registry.ts` (writeFeed may go) and add a discovery test that an agent-written feed `schema.json` (no tool) is discovered with `source:"feed"` and defaults applied.

## Trade-offs (eyes open)
1. **No synchronous validation feedback** — a malformed schema is skipped at discovery (+ bell diagnostic) instead of a tool error. Same as Collections.
2. **No immediate fetch on create** unless the optional watcher is added — first data at the next tick / manual Refresh.
3. **Slightly more agent file I/O** (write the JSON) vs. one tool call — but identical to how Collections already work.

## Verification
- Ask Personal role "Register this feed. <url>": agent reads `config/helps/feeds.md`, fetches + inspects the URL, writes `feeds/<slug>/schema.json` (no `manageFeed` call). `/feeds` lists it; opening it renders records (after the next refresh / Refresh button); calendar + maxItems still work.
- Confirm `manageFeed` no longer appears in the agent's tool list, and `_generated` barrels no longer reference it.
- `format` / `lint` / `typecheck` (server/vue all-8-locale/test) / `build` / feed tests green.

## Follow-ups
- Once shipped, move this file to `plans/done/`. (`plans/done/feat-feeds.md` is already archived.)
- Retire the legacy `sources`/`news`/`NewsView` stack (still untouched).
