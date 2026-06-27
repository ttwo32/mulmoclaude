# feat: extract the feeds engine into `@mulmoclaude/core/feeds`

Status: proposed. Unblocks MulmoTerminal's collection **Refresh** button (PR4b of the
shared-backend-services series — see `feat-shared-backend-services-mulmoterminal.md`).

## Motivation

MulmoTerminal renders feed/agent-ingest collections but **cannot refresh them**: its
`refreshCollection` binding is stubbed (`mulmoterminal/src/composables/collectionUi.ts`
→ "not supported in MulmoTerminal yet"), so clicking **Refresh** on a feed collection
(e.g. `world-cup-2026-matches`) fails. The reason is purely packaging: the retrieval
engine lives **host-side** in `server/workspace/feeds/` (16 files), not in a shared
package, so MulmoTerminal has no code to call.

The fix mirrors what we already did for **collection / notifier / scheduler**: move the
pure engine into a `@mulmoclaude/core` subpath behind a small DI seam, keep the Express
route + scheduler task host-side. Then both shells (MulmoClaude unchanged, MulmoTerminal
new) drive refresh through the same engine.

This is a clean extraction — the bulk of the engine's "couplings" are **already shared
core subpaths** (see below).

## Coordination with merged refactors (engine is stable to extract)

- **`refactor-feeds-skill-managed.md` (merged)** dropped the `manageFeed` MCP tool and
  explicitly declares the **retrieval engine "stays host-side (cannot be a skill)"** —
  i.e. it is exactly the host-side artifact we want to extract.
- **`feat-collections-agent-ingest.md` (merged)** made refresh **generic over
  `ingest.kind`**: `refreshOne(...)` dispatches to declarative retrievers OR
  `refreshViaAgent` (`engine.ts:102`), and `POST /api/collections/:slug/refresh` is
  already kind-agnostic (`server/api/routes/collections.ts:295`).

So the engine surface is settled; this plan only relocates it.

## The engine's couplings — most are already shared (the key insight)

Verified against `server/workspace/feeds/`. What the engine reaches outside its own dir:

| Coupling | Today | After extraction |
|---|---|---|
| Collection IO (`listItems`, `writeItem`, `deleteItem`, `discoverCollections`, `readSkillTemplate`, `buildCollectionActionSeedPrompt`, `loadCollection`, `resolveDataDir`, `safeSlugName`, types `LoadedCollection`/`CollectionItem`/`CollectionSchema`) | via host `../collections/index.js` | **import directly from `@mulmoclaude/core/collection` + `/collection/server`** (sibling subpath — already extracted; no DI) |
| Notifier (`publish`/`clear` failure bells, `agentIngest.ts:17`) | host `../../notifier/engine.js` | **import from `@mulmoclaude/core/notifier`** (sibling subpath — already extracted; host already calls `initNotifier`) |
| Logger (`log`, system/logger) | host import | **DI** — `FeedsHost.log` (like `CollectionLogger`) |
| Workspace root (`workspacePath`) | host const | **already a function param** (`refreshOne(workspaceRoot, …)`, `refreshDue(root?)`); the default comes from `FeedsHost.workspaceRoot` |
| Atomic writer (`writeFileAtomic`, `utils/files/atomic`) | host import | **DI** — `FeedsHost.writeFileAtomic` (matches `configureScheduler`) |
| Agent worker spawn (`agentIngest.ts` `workerRunner`) | already a seam: `setAgentWorkerRunner(spawnSystemWorker)` (`server/index.ts:1181`) | **keep the seam** — fold into `configureFeedsHost({ spawnWorker })` (genuine host-specific capability) |
| Time consts (`ONE_HOUR_MS`/`ONE_DAY_MS`) | `utils/time` | inline (trivial) |
| RSS parsing | `fast-xml-parser@^5.9.3` | **package dependency** |

→ The only genuinely host-specific seams are **log**, **writeFileAtomic**, and the
**worker runner**. Everything else is an intra-`core` import or a passed param.

## DI seam: `configureFeedsHost(...)`

Mirror `configureCollectionHost` / `configureScheduler` (module-level singleton + getter
that throws if unconfigured, plus a forwarding `log`):

```ts
// packages/core/src/feeds/server/host.ts
export interface FeedsLogger { error; warn; info; debug } // (prefix, msg, data?) — as CollectionLogger
export interface FeedsHost {
  workspaceRoot: string;                  // default root for refreshDue() / state paths
  log: FeedsLogger;
  writeFileAtomic: (filePath: string, content: string) => Promise<void>; // feeds never passes opts
  spawnWorker: AgentWorkerRunner;         // hidden/visible agent-ingest worker (was setAgentWorkerRunner)
}
let current: FeedsHost | null = null;
export function configureFeedsHost(host: FeedsHost): void { /* set once; throw on re-config w/ different host */ }
export function requireFeedsHost(): FeedsHost { /* throw if null */ }
// log forwards to the configured host and THROWS if unconfigured (no silent drop):
export const log: FeedsLogger = { error: (prefix, msg, data) => requireFeedsHost().log.error(prefix, msg, data), /* … */ };
```

`AgentWorkerRunner`/`AgentWorkerResult` types move with `agentIngest.ts`. (Keeping a
standalone `setAgentWorkerRunner` export as a thin alias is fine for a smaller host diff,
but folding it into `configureFeedsHost` is more consistent — recommend folding.)

## What moves vs. stays

**Move → `packages/core/src/feeds/`** (the 16 engine files): `engine.ts`, `agentIngest.ts`,
`registry.ts`, `state.ts`, `paths.ts`, `projectItem.ts`, `pathResolver.ts`,
`ingestTypes.ts`, `refreshResult.ts`, `index.ts`, `retrievers/{rss,httpJson,registerAll,index}.ts`,
`fetch/{rssParser,httpClient}.ts`. Rewrite their host imports per the table (collection/
notifier → sibling subpaths; log/writeFileAtomic/spawnWorker → `./server/host`).

**Stay host-side** (MulmoClaude `packages/mulmoclaude/server/`):
- The route `POST /api/collections/:slug/refresh` (`api/routes/collections.ts:295`) — re-point its
  import from `../../workspace/feeds/index.js` to `@mulmoclaude/core/feeds/server`.
- The scheduler task `system:feed-refresh` → `refreshDue` (`server/index.ts:1137`) — re-point import.
- A new `server/workspace/feeds/configure.ts` (side-effect, imported at top of `server/index.ts`,
  like `collections/configure.ts`) that calls `configureFeedsHost({ workspaceRoot: workspacePath,
  log, writeFileAtomic, spawnWorker: spawnSystemWorker })`. This **replaces** the standalone
  `setAgentWorkerRunner(spawnSystemWorker)` call at `server/index.ts:1181`.

## Package mechanics

1. `packages/core/src/feeds/` with `index.ts` (isomorphic: `ingestTypes` constants/types,
   `paths` pure functions) and `server/index.ts` (engine + DI; re-exports the current
   `index.ts` public surface: `refreshOne`, `refreshDue`, `RefreshResult`, `listFeeds`,
   `removeFeed`, `readFeedState`/`FeedState`, the `ingestTypes` set, `configureFeedsHost`).
2. `packages/core/package.json` exports — add (patterned on `./collection`):
   `./feeds` (isomorphic), `./feeds/server` (engine+DI), `./feeds/paths` (the path helpers,
   so collection's host-config can import `feedsRoot` from here — see cross-dep below).
3. `packages/core/vite.config.ts` — add `"feeds/index"`, `"feeds/server/index"`,
   `"feeds/paths"` entries to the **CJS+ESM pass** (feeds uses only node builtins +
   fast-xml-parser; **no `import.meta.url`**, so it does NOT need the ESM-only pass).
4. Add `fast-xml-parser@^5.9.3` to `packages/core/package.json` dependencies.
5. Bump `@mulmoclaude/core` `0.2.4 → 0.2.5`; build (`vite build && vite build -c vite.esm.config.ts`); publish.

**Cross-dep to fix:** collection's host wiring imports `feedsRoot` from feeds
(`server/workspace/collections/configure.ts:11 → "../feeds/paths.js"`). After extraction,
change that to `import { feedsRoot } from "@mulmoclaude/core/feeds/paths"`. No intra-`core`
cycle: `feedsRoot(root)` is a pure root→path function the host passes into
`configureCollectionHost` (collection never imports feeds).

## MulmoClaude rewiring — ✅ gate: ZERO behavior change

After the move, MulmoClaude behaves identically: the route + scheduler call the same
`refreshOne`/`refreshDue`, now from the package; agent-ingest still dispatches
`spawnSystemWorker` via the DI seam; failure bells still fire (notifier from core).
Prove it: refresh a declarative feed (records written) and an `ingest.kind:"agent"`
collection (worker dispatched) before/after; diff the on-disk records + `_state.json`.

## Tests

- Move the engine/parser/projection/SSRF-guard tests into `packages/core/` alongside the
  code (they should be host-agnostic once the seams are injected; provide a test
  `configureFeedsHost` with a tmp workspace + no-op logger + a fake `spawnWorker`).
- Keep host route tests in `packages/mulmoclaude` (they exercise the HTTP surface).
- **SSRF guard** (the dns/net checks in `fetch/httpClient.ts`) MUST keep its test coverage —
  it's the security-critical part and now ships in a published package.

## Downstream (separate PR, MulmoTerminal repo) — the actual payoff

Once `@mulmoclaude/core@0.2.5` is published:
1. Bump `@mulmoclaude/core` in MulmoTerminal.
2. Add `server/backends/feeds.ts`: `configureFeedsHost({ workspaceRoot: CLAUDE_CWD, log,
   writeFileAtomic, spawnWorker })` where `spawnWorker` adapts MulmoTerminal's existing
   background-session spawn (it already ships `spawnBackgroundChat` as a host tool) to the
   `AgentWorkerRunner` shape. Optionally register a `system:feed-refresh` task on MT's
   `@mulmoclaude/core/scheduler` (MT already runs the user-task scheduler).
3. Mount `POST /api/collections/:slug/refresh` (port `collections.ts:295`'s handler:
   `loadCollection` → `refreshOne(CLAUDE_CWD, collection, { hidden:false })`).
4. Unstub the binding: `collectionUi.ts` `refreshCollection: (slug) =>
   apiPost(\`/api/collections/\${slug}/refresh\`, {})`.
   ✅ gate: clicking **Refresh** on `world-cup-2026-matches` in MulmoTerminal fetches +
   upserts records (declarative), and an `ingest.kind:"agent"` collection spawns a visible
   worker chat.

## Risks / watch-outs

- **SSRF guard travels into a published package** — keep it on by default and well-tested;
  do not let a consumer disable it accidentally.
- **Worker-runner shape differs per host** (MulmoClaude `spawnSystemWorker` vs MulmoTerminal's
  PTY-spawn). The `AgentWorkerRunner` interface must stay host-agnostic (message, roleId,
  hidden, onComplete) — it already is.
- **First-open auto-refresh + the optional feeds file-watcher** (from the skill-managed plan)
  are separate host wirings; this extraction doesn't change them, but MulmoTerminal may want
  the watcher later for "fetch on create" parity.
- **`role` on agent-ingest** is ignored by MulmoTerminal (no role system) — accept + drop,
  same as `spawnBackgroundChat` already does.
