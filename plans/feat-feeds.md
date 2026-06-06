# feat: "Feeds" — a generic declarative data-retrieval mechanism reusing Collections

Status: implemented (not yet released). Built alongside the legacy `sources`/`news` stack; that stack is untouched and slated for a separate retirement PR.

## Context / motivation

The legacy RSS/news stack (`server/workspace/sources/*` + `server/workspace/news/*` + `NewsView.vue`) is a bespoke pipeline (fetch → dedup → LLM-summarize → daily-markdown + monthly-archive → custom reader). It is RSS/news-specific and doesn't generalize to other internet data.

**Feeds** is a generic, declarative data-retrieval layer: the user gives a URL/API, Claude authors a schema + retrieval config once and registers it as *data*, and the host periodically refreshes it into a self-updating collection. RSS news, podcasts, weather, and arbitrary JSON are just different retriever *kinds*. Storage + rendering reuse the existing Collections machinery verbatim.

## Core decisions

1. **A Feed IS a `CollectionSchema` + an optional `ingest` block.** Same `CollectionSchemaZ` validator (extended, `ingest` optional so every skill schema still validates), same `collections/io.ts` storage, same `CollectionView` rendering.
2. **Feeds live in a separate non-skill registry** `<workspace>/feeds/<slug>/schema.json` (state at `_state.json`), discovered from their own root so they **never enter the agent prompt** (the whole reason they aren't skills). Managed by ONE generic MCP tool `manageFeed` (register/list/refresh/remove) — N feeds cost one prompt entry.
3. **Retrieval is declarative, via a pluggable `kind` registry.** First kinds: `rss`/`atom` (XML parser + field map) and `http-json` (`itemsAt` path + field map). Future `code`/`prompt` kinds slot in without engine changes.
4. **Refresh = keyed upsert** by `primaryKey` (`writeItem(..., {refuseOverwrite:false})`). News/podcast accumulate by guid; weather self-replaces by date — same call. Feed-native keys (guids/URLs/ISO datetimes) are slugified into stable, filename-safe ids.
5. **LLM summarization out of scope.** Pure retrieval.
6. **Dedicated `/feeds` top-bar surface.** Feeds get their own launcher icon + list view; they are filtered OUT of the Collections index (no double-listing). Records still open in `CollectionView` at `/collections/:slug`.

## Implementation map

**Module `server/workspace/feeds/`:** `ingestTypes` (IngestSpec, kinds, schedules), `paths`, `state`, `registry` (writeFeed/listFeeds/removeFeed), `pathResolver` (dot/bracket `getByPath`/`getItemsArray`), `projectItem` (map → record + stable safe-slug id), `fetch/{httpClient,rssParser}` (own copies — no cross-import into legacy `sources/`), `retrievers/{index,rss,httpJson,registerAll}` (pluggable registry), `engine` (`refreshOne`/`refreshDue`), `index` (barrel).

**Reuse edits:** `collections/types.ts` (`ingest?`, `CollectionSource` += `"feed"`); `collections/discovery.ts` (export + extend `CollectionSchemaZ`; third "feed" discovery root, skills win on slug collision); `collections/index.ts` (export `CollectionSchemaZ`).

**Routes/scheduling:** `server/api/routes/feeds.ts` (`POST /api/feeds/manage`); `collections.ts` (`POST /api/collections/:slug/refresh`); `server/index.ts` (hourly `system:feed-refresh` task + route mount).

**Plugin:** `src/plugins/manageFeed/{meta,definition,index,View.vue,Preview.vue}` (auto-wired via `yarn plugins:codegen`). `manageFeed` added to the Personal role.

**Frontend surface:** `src/router/pageRoutes.ts` + `router/index.ts` (`/feeds`); `PluginLauncher.vue` (`feeds` target, icon `dynamic_feed`, separator index → 7); `App.vue` (mount `FeedsView`); `FeedsView.vue` (new list view — open/refresh/add-via-chat); `CollectionsIndexView.vue` (filter out `source==="feed"`); `CollectionView.vue` (Refresh button when `schema.ingest`); `collectionTypes.ts` (`ingest?`, source += `"feed"`). i18n: 8 locales × `collectionsView.{refreshFeed,feedsTitle,feedsEmpty,addFeedPrompt}` + `pluginLauncher.feeds.label`. `docs/ui-cheatsheet.md` top-chrome block updated.

**Tests:** `test/workspace/feeds/test_{pathResolver,projectItem,engine}.ts`; `test/workspace/test_paths_shape.ts` snapshot updated for the new `feeds` workspace dir.

## Verification

- Register an RSS feed via `manageFeed register` (schema with `ingest:{kind:"rss",url,schedule,idFrom:"feedId",map:{...}}`) → records appear under `data/<slug>/*.json`; open `/feeds` → card → `/collections/<slug>` renders; Refresh upserts.
- Register a weather/JSON feed (`kind:"http-json"`, `itemsAt:"hourly[]"`) → one record per slot, self-replacing on refresh.
- `system:feed-refresh` appears in the scheduler; due feeds (per `ingest.schedule`) fetch hourly with per-feed failure isolation.
- Confirm a feed schema is absent from the agent prompt (lives in `feeds/`, not `.claude/skills/`).

## Deferred / follow-ups

- No robots.txt / rate-limit in the new fetch client (engine fetches sequentially to stay gentle) — port or extract from legacy `httpFetcher` later.
- `removeFeed` retains records under `dataPath` (a `purge:true` flag is a trivial add).
- Retire the legacy `sources`/`news`/`NewsView` stack once Feeds is proven; migrate existing RSS sources over.
