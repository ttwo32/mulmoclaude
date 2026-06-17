# Extract present* + X tools as shared npm plugins (MulmoTerminal-importable)

Goal: extract `presentMulmoScript`, `presentChart`, `presentSpreadsheet`, and the X
API tools (`readXPost`, `searchX`) into standalone `@mulmoclaude/*` npm packages so
**MulmoTerminal can import them exactly like it already imports `presentDocument`
(`@mulmoclaude/markdown-plugin`) and `presentForm` (`@mulmoclaude/form-plugin`)**.

These four are still **built-ins**. None has been extracted yet. This plan mirrors the
proven form-plugin / markdown-plugin migration (the in-tree "task #6" pattern).

## The established pattern (from form-plugin / markdown-plugin)

Three layers. The **package** owns schema + logic + UI; the **host** keeps a thin
adapter; a **HostApp bridge** lets the package call host backends (file I/O, render).

### A. Package `@mulmoclaude/<name>-plugin` (the single source of truth)

```
packages/plugins/<name>-plugin/
  src/
    core/
      definition.ts   TOOL_NAME, TOOL_DEFINITION, arg/data types
      contract.ts     HostApp interface + dispatch-arg union (server capabilities)
      plugin.ts       pluginCore (ToolPluginCore): execute() + pure orchestration
      index.ts        barrel
    vue/
      View.vue, Preview.vue
      index.ts        browser plugin (ToolPlugin = pluginCore + components)
    lang/             8 locales + messages.ts + useT()   (i18n travels with plugin)
    <engine|render>/  heavy PURE logic (spreadsheet engine, chart option build, marp)
    style.css, env.d.ts
  package.json        dual exports "." (server) + "./vue" + "./style.css"
  vite.config.ts      two entries (index.ts, vue.ts), externalize vue + gui-chat-protocol/vue
  tsconfig.build.json vue-tsc --emitDeclarationOnly for d.ts
```

package.json shape (copy `form-plugin`): `"@mulmoclaude/<name>-plugin"`, `type:module`,
`exports` with `.` / `./vue` / `./style.css` (each: types + import + require(.cjs) +
default), `files:["dist"]`, `publishConfig.access:public`, peerDeps
`gui-chat-protocol ^0.3.0` + `vue ^3.5.0`, build = `vite build && vue-tsc -p
tsconfig.build.json --emitDeclarationOnly`.

### B. Host built-in adapter (MulmoClaude stays a consumer)

`src/plugins/<name>/` shrinks to thin shims:
- `meta.ts` — UNCHANGED: keeps host routing (`toolName`, `apiNamespace`, `apiRoutes`,
  `mcpDispatch`). Plugin codegen still scans this.
- `definition.ts` — re-export `TOOL_DEFINITION` from the package (`default` export is
  what `scripts/codegen-plugin-barrels.ts` scans).
- `index.ts` — import `View`/`Preview`/`plugin` from `@mulmoclaude/<name>-plugin/vue`,
  `import "@mulmoclaude/<name>-plugin/style.css"`, wrap with `wrapWithScope(scope, …)`,
  export `REGISTRATION`. (Coerce the package's `Component` via `as unknown as Component`
  — yarn-4 dual-`vue` makes nominal types distinct; see markdown/index.ts comment.)
- `plugin.ts` / `types.ts` — re-export from package for back-compat importers.

### C. Server code ships IN the package, reached only via generic `context`

**Core constraint (user directive):** the plugin's server-side logic must live in the
npm package — exported from the `.` entry, NOT duplicated in the host `server/` tree —
and it must reach the host only through the **generic gui-chat-protocol runtime/context**,
never a plugin-specific host method. The host's job shrinks to providing one
**conformant, generic** context implementation that every plugin shares.

The generic surface the package may rely on (from `PluginRuntime` / `ToolContext`,
gui-chat-protocol 0.3.x):

| Primitive | Shape | Scope |
|---|---|---|
| `files.data` / `files.config` | `FileOps` (read/write/list/delete) | per-plugin dirs `~/mulmoclaude/{data,config}/plugins/<pkg>/` |
| `fetch` / `fetchJson` | timeout + host allowlist; `fetchJson<T>(url,{parse})` | — |
| `pubsub.publish(event, payload)` | scoped → `plugin:<pkg>:<event>` | per-plugin channel |
| `log.{debug,info,warn,error}` | prefixed `plugin/<pkg>` | — |
| `locale` | snapshot string (server) / `Ref<string>` (browser) | — |
| `context.app` | `ToolContextApp` = `getConfig`/`setConfig` + arbitrary backend fns | generic escape hatch |

Target shape = the `definePlugin` factory model (bookmarks / edgar), not markdown's
transitional host-side `MarkdownHostApp`:

```ts
export default definePlugin(({ files, fetch, fetchJson, pubsub, log, locale }) => ({
  TOOL_DEFINITION,
  async presentChart(args) { /* validate + files.data.write(...) — all in-package */ },
}));
```

**markdown-builtin.ts is the anti-pattern to avoid repeating.** It still keeps
plugin-specific glue (loadDoc/saveDoc/exportPdf/fillImages) host-side and injects it as
`context.app`. We want those bodies INSIDE the package, written against the generic
primitives above. Where a capability genuinely isn't generic (process exec, headless
Chrome, ffmpeg, mulmocast), that's a **protocol gap** to resolve deliberately (§D),
not a reason to scatter plugin code back into the host.

### D. Capability gaps — generic primitives vs. what each plugin needs

The generic context covers `fetch`, scoped `files`, `pubsub`, `log`, `config`. Two
recurring gaps surface:

1. **Artifacts-area writes.** `files.data` is sandboxed to `~/mulmoclaude/data/plugins/
   <pkg>/`, but chart/spreadsheet/mulmoscript currently write to the shared,
   Files-explorer-visible `artifacts/{charts,spreadsheets,stories}/`. Decision needed:
   (a) relocate outputs under the plugin sandbox (simplest, fully generic, changes where
   files appear), or (b) add ONE generic `files.artifacts` capability to gui-chat-protocol
   (reusable by every present* plugin) so packages can write browsable artifacts without a
   per-plugin host method.
2. **Heavy backends** (mulmoscript: ffmpeg movie render, headless-Chrome PDF, mulmocast,
   AI image/audio gen). These are not generic primitives. Options: bundle into the package
   (mulmocast is npm; ffmpeg is a binary — breaks the sandbox), expose generic capabilities
   on the runtime (e.g. a sanctioned `exec`/`render` primitive), or pass them as
   `context.app` backend fns. Whichever we pick should be GENERIC (benefits multiple
   plugins), per the CLAUDE.md plugin-vs-host boundary.

Resolving these two gaps in gui-chat-protocol first is the unblock for chart/spreadsheet
(gap 1) and mulmoscript (gaps 1+2). x-plugin needs neither.

---

## Per-target extraction notes

### 4. X tools → `@mulmoclaude/x-plugin`  (CLEANEST FIT — do first)
- Source: `server/agent/mcp-tools/x.ts` (~210 LOC), registered in
  `server/agent/mcp-tools/index.ts`. Exports `readXPost` + `searchX` (MCP tools, **no GUI**).
- **Server-only shape**: single `.` export, NO `/vue`, NO `style.css`. Template =
  `@mulmoclaude/edgar-plugin`.
- **Fully satisfiable by the generic context today** — needs only `fetch`/`fetchJson`
  (replacing `fetchWithTimeout`/`safeResponseText`) + the bearer token via
  `context.app.getConfig("xBearerToken")` (replacing `env.xBearerToken`). `errorMessage`/
  `toUtcIsoDate` are tiny pure helpers that move into the package. **No capability gap.**
- Host stays a consumer: `mcp-tools/index.ts` imports the two tool defs+handlers from the
  package; gating on token presence stays host-side. Zero blast radius → ideal pilot to
  prove the "server code in package, via context" contract end-to-end.

### 1. presentChart → `@mulmoclaude/chart-plugin`  (EASY — pending gap 1)
- Source: `src/plugins/chart/` (5 files, ~344 LOC) + `server/api/routes/chart.ts` (~113 LOC).
- External dep: `echarts ^6` (browser/View only). Schema + validation are pure → into package.
- Tool `presentChart`, namespace `chart`, route POST `/api/chart`, dir `artifacts/charts/`.
- Server logic in-package `executeChart`: validate ECharts doc + write `<slug>.chart.json`.
  Generic mapping: `files.<area>.write(...)`. **Hits gap 1** (writes to shared
  `artifacts/charts/`, not the plugin sandbox) — resolve §D gap 1 first, or relocate output.

### 2. presentSpreadsheet → `@mulmoclaude/spreadsheet-plugin`  (MEDIUM — pending gap 1)
- Source: `src/plugins/spreadsheet/` (30 files, ~5,900 LOC) incl. `engine/` (22 files,
  ~4,600 LOC) + handlers in `server/api/routes/plugins.ts` (L171–230) +
  `server/utils/files/spreadsheet-store.ts`.
- **Zero external npm deps** — the calc engine is pure TS, moves cleanly into the package.
- Tool `presentSpreadsheet`, namespace `spreadsheet`, routes POST `/api/spreadsheet`
  (create) + PUT `/api/spreadsheet/update`, dir `artifacts/spreadsheets/`.
- Server logic in-package: `executeSpreadsheet` validation + create/overwrite via
  `files.<area>` (replacing `spreadsheet-store`). Only gap is gap 1 (artifacts path).

### 3. presentMulmoScript → `@mulmoclaude/mulmoscript-plugin`  (HARDEST — gaps 1+2)
- Source: `src/plugins/presentMulmoScript/` (6 files, ~2,300 LOC; View.vue alone 1,836)
  + `server/api/routes/mulmo-script.ts` (~1,111 LOC).
- Heavy deps: `mulmocast`, `@mulmocast/types`, `@mulmocast/deck-web`, plus optional
  `ffmpeg` **binary** (movie render).
- Tool `presentMulmoScript`, namespace `mulmoScript`, **14 routes** (save, updateBeat,
  updateScript, beatImage/Audio, generateBeatAudio, renderBeat, uploadBeatImage,
  character image/render/upload, movieStatus/generateMovie/downloadMovie,
  pdfStatus/generatePdf/downloadPdf), dir `artifacts/stories/`.
- Server orchestration (save/update/render flow) moves into the package against generic
  `files`/`fetch`/`pubsub`. **Hits both gaps**: artifacts writes (gap 1) AND heavy backends
  (gap 2 — ffmpeg/mulmocast/AI gen aren't generic primitives). Needs the §D gap-2 decision
  resolved (generic `exec`/`render` capability vs. bundling mulmocast) before extraction.
  Do last, once the contract is proven on x/chart/spreadsheet.

---

## Build / publish wiring (already automatic)

- Dropping each dir under `packages/plugins/<name>-plugin/` with name `@mulmoclaude/
  <name>-plugin` + a `build` script makes `scripts/build-workspaces.mjs` auto-discover
  it in **tier 4** (no `package.json` edit) — per CLAUDE.md build orchestration.
- Add each as a dependency of the host (`packages/mulmoclaude/package.json` /root) so the
  host build resolves it, same as form/markdown today.
- Update `packages/create-mulmoclaude-plugin/src/template.ts` only if toolchain versions drift.
- Publish per existing convention: tag `@mulmoclaude/<name>-plugin@X.Y.Z`,
  `gh release create … --latest=false`; update `docs/CHANGELOG.md`. Use `/publish` skill.

## Suggested order & phasing
0. **Resolve §D gaps in gui-chat-protocol first** (artifacts-write primitive; heavy-backend
   capability). This is the real unblock — without it chart/spreadsheet/mulmoscript can't
   keep their server code in-package against a generic context.
1. **x-plugin** (pilot — needs ZERO gaps; proves "server code in package, via context").
2. **chart-plugin** (after gap 1 — small, validates the artifacts-write primitive).
3. **spreadsheet-plugin** (after gap 1 — bulk mechanical move; pure engine).
4. **mulmoscript-plugin** (after gaps 1+2 — largest surface; do once the contract is proven).

Each plugin = its own PR: create package → move server logic INTO package against generic
`context` → reduce host to a thin consumer (no plugin-specific server code) → wire deps →
`yarn build` + `yarn typecheck` green → host integration test.

## Decisions (locked)
- **Order:** ship `x-plugin` first (zero gaps), then `chart-plugin`, then spreadsheet, then mulmoscript.
- **Gap 1 (artifacts writes):** **DECIDED — add a generic `files.artifacts` primitive** to
  gui-chat-protocol (keeps Files-explorer visibility; reusable by chart/spreadsheet/mulmoscript).
  Required before chart-plugin's server code can live in-package against a generic context.

## Open questions for confirmation
- **Gap 2 (heavy backends for mulmoscript):** sanctioned generic `exec`/`render` capability
  on the runtime, bundle mulmocast into the package, or accept `context.app` backend fns for
  the ffmpeg/puppeteer/AI-gen pieces? (Affects how "pure" the in-package server code can be.)
- Package names: `x-plugin` / `chart-plugin` / `spreadsheet-plugin` / `mulmoscript-plugin`?
- i18n: move strings into each package's `lang/` (form/markdown do) or stay host-side initially?
