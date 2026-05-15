# Map Plugin — Integrate `@gui-chat-plugin/google-map` + Settings API key flow

Tracking issue: [#1227](https://github.com/receptron/mulmoclaude/issues/1227)

## Pivot note (2026-05-08)

**Earlier revision of this plan proposed scaffolding `@mulmoclaude/map-plugin` from scratch as a runtime plugin.** That work was started in PR #1231 (PR-A scaffold) and PR #1235 (PR-B favorites + interactive map) before we noticed that **`@gui-chat-plugin/google-map@0.4.0` already exists on npm** (https://github.com/receptron/GUIChatPluginGoogleMap), shipped by the same author, with a strict feature superset:

- showLocation / setCenter / setZoom / addMarker / clearMarkers
- findPlaces (Google Places API, 80+ place types)
- getDirections (DRIVING / WALKING / BICYCLING / TRANSIT)
- Vue View with side panels, zoom controls, and loading/error overlays
- Vue Preview component
- Pure ESM + CJS dual export (Docker CJS-mode compatible)

PR #1231 and #1235 were closed in favour of this integration approach. This plan is rewritten end-to-end.

## User Prompt

> 1222で気がついたけどgoogle map viewってほしいよね。
> google mapでよい。api keyが設定されているときに見有効。api keyはwebの設定画面からかな。
> ユースケースはexifじゃなくて普通にお店を探して、それをfavoriteで登録したり、その一覧を表示させておみせをみたりかな。
> そう考えるとwikiの情報と連動できてもよいね。wikiに緯度経度とかうめこんで。planかいて。

## Goals

1. **Wire up `@gui-chat-plugin/google-map`** as MulmoClaude's map plugin via the same external-package binding pattern as `@gui-chat-plugin/{mindmap,present3d}` and `@mulmochat-plugin/quiz`.
2. **API key Settings UI** — let the user paste a Google Maps API key in the Settings modal; persist it in `AppSettings`; inject into the View as a `googleMapKey` prop.
3. **Favorites + wiki linking** — features missing from the upstream package. **Contributed upstream** (PR to GUIChatPluginGoogleMap) so MulmoClaude pulls them in via a version bump.

## Non-goals

- Photo EXIF auto-pinning (separate, handled by [`feat-photo-exif.md`](feat-photo-exif.md))
- Multi-key per-role / per-workspace fan-out — one key per MulmoClaude instance
- Offline maps / tile caching

## Architecture

### Existing pattern we reuse

`src/plugins/_extras.ts` already wires three external npm packages into MulmoClaude:

```ts
import { TOOL_DEFINITION as createMindMapDef } from "@gui-chat-plugin/mindmap";
import MindMapPlugin from "@gui-chat-plugin/mindmap/vue";

EXTERNAL_PLUGIN_REGISTRATIONS: [
  { toolName: TOOL_NAMES.createMindMap, entry: MindMapPlugin.plugin },
  // ...
];

EXTRA_SERVER_BINDINGS: [
  { def: createMindMapDef, endpoint: API_ROUTES.plugins.mindmap },
  // ...
];
```

The corresponding server route in `server/api/routes/plugins.ts` calls `executeMindMap` from the package and returns the result. Same shape lands here for google-map.

### What MulmoClaude side keeps

Only the **API-key flow** is MulmoClaude-specific (= the upstream package takes the key as a prop, doesn't manage UI/persistence):

| Layer | What lives in MulmoClaude | What lives upstream |
|---|---|---|
| Tool definition | imported via `_extras.ts` | `@gui-chat-plugin/google-map` |
| Tool execution | `/api/plugins/google-map` route → `executeMapControl()` | `@gui-chat-plugin/google-map` |
| Vue View / Preview | imported via `_extras.ts` | `@gui-chat-plugin/google-map/vue` |
| API key Settings UI | `SettingsModal` + new `SettingsMapTab.vue` | — |
| API key persistence | `AppSettings.googleMapsApiKey` (`server/system/config.ts`) | — |
| API key injection | host-level prop binding in `App.vue` (where the View is mounted) | upstream View accepts `googleMapKey?: string \| null` |

### API key data model

`AppSettings` already exists at `server/system/config.ts:20`. Add one optional field:

```ts
export interface AppSettings {
  extraAllowedTools: string[];
  photoExif?: { autoCapture: boolean };       // from feat-photo-exif (#1222)
  googleMapsApiKey?: string;                   // NEW
}
```

Why a top-level field rather than a plugin-scoped config like `<workspace>/config/google-maps.json`:

- The key affects host-level UI (Map launcher button visibility, Settings tab) — pulling it through `AppSettings` keeps it on the same load path as the rest of the settings UI consumes
- One read in `loadSettings()` already happens per agent invocation; no extra IO
- Avoids designing a new "plugin secrets" abstraction for a one-off

### Wiring topology

```
Settings → Map tab          ─┐
   ↓ user pastes key         │
   POST /api/config           │
   ↓                          │
   settings.json updated     ─┘                            (storage)
       ↓
       ↓ next page load                              ┌── @gui-chat-plugin/google-map/vue
App.vue mounts MapView ──── <View :googleMapKey> ───┤    (3rd party — handles render,
       ↑                                             │    Places, Directions, etc.)
       │                                             └──
   AppSettings.googleMapsApiKey
       │
       │ (server side, when LLM calls mapControl)
       ↓
   /api/plugins/google-map ──── executeMapControl()  ── @gui-chat-plugin/google-map
       (host route)               (returns ToolResult)    (3rd party)
```

## Phased rollout

### PR-A: Integration (this is the v1 ship)

**What lands**:

- `yarn add @gui-chat-plugin/google-map@^0.4.0` (root + `packages/mulmoclaude/package.json` so the launcher tarball includes it)
- `src/config/toolNames.ts`: `mapControl: "mapControl"`
- `src/config/apiRoutes.ts`: add `plugins.googleMap` route key
- `src/plugins/_extras.ts`: import the package's `TOOL_DEFINITION` + Vue plugin, register in both `EXTERNAL_PLUGIN_REGISTRATIONS` and `EXTRA_SERVER_BINDINGS`
- `server/api/routes/plugins.ts`: add `/api/plugins/google-map` handler that calls `executeMapControl` from the package
- `test/plugins/test_meta_aggregation.ts`: add `"mapControl"` to `EXTERNAL_PACKAGE_TOOL_NAMES` (sync-invariant whitelist)
- `server/system/config.ts`: extend `AppSettings` with `googleMapsApiKey?: string`, validation in `isAppSettings`
- `src/components/SettingsModal.vue`: new "Map" tab
- `src/components/SettingsMapTab.vue` (new): password-style input, Save button, "Configured / Not configured" indicator, link to Google Cloud Console credentials. Lift idea / strings from closed PR #1231's `SettingsMapTab.vue` (no need to redo this from scratch)
- `src/lang/{8 locales}.ts`: settings tab strings + launcher label, all 8 locales in lockstep
- `src/components/PluginLauncher.vue`: Map launcher button
- `src/router/{pageRoutes,index}.ts`: `PAGE_ROUTES.map = "map"` + `/map` route
- `src/App.vue`: mount the upstream `View` and pass `googleMapKey` from `AppSettings`
- Default suggested queries / role tweaks if any (TBD during implementation)

**Tests**:

- Settings round-trip: paste key → reload → key still present
- LLM tool call: `mapControl({ action: "showLocation", location: "Tokyo Station" })` returns the expected `ToolResult` shape (against the package, not the live API)
- E2E: open `/map`, confirm "Configure your Google Maps API key in Settings" message when unset; confirm map renders when set (mocked package `googleMapKey` prop)

**User-facing**: The `/map` route + launcher button work, LLM can call `mapControl` (showLocation / setCenter / addMarker / findPlaces / getDirections). Favorites / wiki linking come later.

### PR-B: Favorites — upstream contribution

Favorites (= "save this place to a list, view list later") aren't in `@gui-chat-plugin/google-map` today. Two options for where to add them:

- **Option 1 (recommended): contribute upstream** — open a PR on `receptron/GUIChatPluginGoogleMap` adding favorites as a generic feature any consumer can opt into. Ship as `@gui-chat-plugin/google-map@0.5.0`, then bump MulmoClaude's dep.
- Option 2: layer a thin MulmoClaude-side favorites plugin around the upstream one. Faster but creates a divergent feature surface; skip unless upstream rejects.

**Upstream PR scope** (Option 1):

- New tool kinds: `addFavorite` / `listFavorites` / `removeFavorite`
- `Favorite` type: `{ id, name, lat, lng, placeId?, notes?, wikiSlug?, createdAt }`
- Storage: caller-supplied via a `storage` prop (the package itself shouldn't bind to a filesystem). MulmoClaude implements the storage adapter pointing at `<workspace>/data/map/favorites.json`
- View additions: a side panel listing favorites with click-to-recenter

**MulmoClaude side after upstream lands**:

- bump `@gui-chat-plugin/google-map` to `0.5.0`
- implement the storage adapter
- add a workspace dir entry: `WORKSPACE_DIRS.map = "data/map"` (no nested files yet — favorites file is one JSON)

### PR-C: Wiki coordinate linking — upstream contribution + MulmoClaude integration

Tie favorites into wiki:

- Upstream: a `wikiSlug?: string` field on `Favorite` is already proposed in PR-B. Optional; carries no upstream behavior change.
- MulmoClaude: when a wiki page declares `coords: [lat, lng]` in its frontmatter, render a small map widget inline (uses the upstream View in a thumbnail mode — needs upstream to expose a `compact` prop). From a favorite's detail panel, "Open wiki page" jumps to `data/wiki/pages/<wikiSlug>.md`, creating it with the coords frontmatter if absent.

This depends on upstream PR-B landing + a `compact` mode (PR to upstream).

## Risks and mitigations

### Risk 1: Upstream package API change

`@gui-chat-plugin/google-map` is at `0.4.0` — semver < 1.0 means breaking changes are allowed. We pin to `^0.4.0` (allow 0.4.x patches, lock at 0.5.0 needing a deliberate bump).

### Risk 2: Upstream PR rejected / stale

If the favorites contribution gets pushback, fall back to Option 2 (MulmoClaude-side wrapper). Cost is one extra package and divergent feature surface, but isn't blocking.

### Risk 3: API key leaks into git via settings.json

`<workspace>/config/settings.json` lives in user's `~/mulmoclaude/`, which is outside any repo by default. The risk is users committing it accidentally. Mitigations:

- Settings UI uses an `<input type="password">` so the key isn't shown in screenshots
- The key is stored verbatim in `settings.json` (not encrypted) — same threat model as Spotify's `tokens.json`. Local-desktop assumption.
- `~/mulmoclaude/.gitignore` (auto-provisioned at first start) already excludes `config/` for git-cloned workspace setups (verify).

### Risk 4: Map launcher visible without key configured

Show the launcher always; clicking opens the View which displays the upstream's "Google Maps API key not configured" message + a link to Settings. Mirrors the upstream's UX, no extra logic needed.

### Risk 5: Tarball size growth (mulmoclaude npm package)

`@gui-chat-plugin/google-map` is ~91 KB packed. Tolerable. Monitor under `scripts/mulmoclaude/smoke.mjs` (drift check).

## Open questions

1. **Tool name collision** — upstream uses `mapControl`. Does anything in MulmoClaude already claim that name? → Check `src/config/toolNames.ts` + `BUILT_IN_PLUGIN_METAS` during PR-A. Likely free.
2. **`apiKey` in role prompts** — should the `mapControl` tool prompt mention the API key requirement? Probably yes — a role using `mapControl` without a configured key would otherwise silently no-op for the LLM. A prompt note pointing at Settings is the right UX.
3. **Per-locale Settings tab strings** — closed PR #1231 already had 8-locale strings; lift them. Only `Map` tab strings needed.

## Cleanup (future)

Once favorites + wiki coords ship upstream, MulmoClaude's role in the map domain shrinks back to:

- API key Settings UI (irreducible)
- Storage adapter (small, ~30 lines)
- `/map` route mount
- Wiki frontmatter `coords` reader (which is generic — could move to a `wiki-coords.ts` separate from this plan)

The plan-side complexity drops significantly post-PR-C.

## References

- Upstream package: https://github.com/receptron/GUIChatPluginGoogleMap (npm: `@gui-chat-plugin/google-map@0.4.0`)
- Existing external-package wiring: `src/plugins/_extras.ts`
- Existing route handler pattern: `server/api/routes/plugins.ts:228` (`createMindMap` example)
- Closed predecessor PRs: #1231, #1235
- Sister plan (also driven by location data): [`feat-photo-exif.md`](feat-photo-exif.md)
