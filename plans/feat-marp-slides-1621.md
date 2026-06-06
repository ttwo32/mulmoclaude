# feat-marp-slides-1621

Render `presentDocument` markdown as **Marp slides** when frontmatter has `marp: true`. PDF export via server-side `marp-cli`.

Tracking issue: [#1621](https://github.com/receptron/mulmoclaude/issues/1621)

## Why

- Existing slide-shaped surfaces: `presentMulmoScript` (JSON storyboard), `pptx` skill (programmatic build). Neither covers "agent writes a `.md` and it becomes a slide deck."
- Marp's authoring format is just markdown + `---` slide breaks + a `marp: true` frontmatter flag. The `presentDocument` plugin (= `src/plugins/markdown/`) already parses frontmatter and renders a body — Marp slots in as a render-mode branch.
- Smallest viable wedge: render-only on client, PDF export only on server, no nav, no theme picker.

## Choice recap

User picked **B 案** (extend `presentDocument`, vertical stack layout) with **PDF export included**. PPTX / HTML / PNG / per-slide nav are out of scope for this PR.

## Files

> **Note**: this section was rewritten after implementation to match
> what actually shipped. The original draft proposed `marp-cli` as a
> separate spawned binary with a new `/api/plugins/markdown/export-pdf`
> route — both were dropped during implementation in favour of
> reusing the existing puppeteer-backed `/api/pdf/markdown` route with
> a `marp: true` flag, saving a dependency + a route + ~140 lines.

| Path | Change | Lines (est.) |
|---|---|---|
| `package.json` + `packages/mulmoclaude/package.json` | + `@marp-team/marp-core` (single new dep, used both client- and server-side) | +1 / +1 |
| `src/plugins/markdown/View.vue` | branch on `frontmatter.marp === true` → render `<MarpView>` instead of markdown body | ~15 |
| `src/plugins/markdown/MarpView.vue` | **new** — instantiate `Marp` from `marp-core`, render stacked HTML in a sandboxed iframe srcdoc with a CSP, header with Export PDF button | ~150 |
| `src/plugins/markdown/Preview.vue` | Marp-aware chat-stream tile (slide-count badge instead of stripped-text dump) | ~25 |
| `src/components/FileContentRenderer.vue` | Files-pane branch: `marp: true` → `<MarpView>` (lazy-loaded) | ~30 |
| `src/utils/markdown/marpDetect.ts` | **new** — pure helper `isMarpDocument(meta: Record<string, unknown>): boolean`; covers `marp: true`, `marp: yes` / `"true"` / `1` etc. | ~15 |
| `src/composables/usePdfDownload.ts` | + `marp?: boolean` + `baseDir?: string` options forwarded to the server PDF route | +5 |
| `server/api/routes/pdf.ts` | + `marp?: boolean` body field on the existing `/api/pdf/markdown` route → `renderMarpPdf()` (marp-core HTML → `inlineImages()` → puppeteer 1280×720 / margin 0) | ~30 |
| `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` | + `marpSlidesMode`, `marpExportPdf`, `marpRenderFailed` (8 locales lockstep) | +3 × 8 |
| `test/utils/markdown/test_marpDetect.ts` | **new** — unit tests for the detection helper (9 cases) | ~50 |

## Tasks

1. **Dep**: `yarn add @marp-team/marp-core -W` (single dep, used both sides; mirror to `packages/mulmoclaude/package.json` so the published launcher resolves it).
2. **Detect helper** + tests: `marpDetect.ts` + `test_marpDetect.ts`.
3. **Client render**: `MarpView.vue` — dynamic `import("@marp-team/marp-core")`, `inlineSVG: true`, srcdoc-iframe with CSP + override Marp's `100vh/100vw` SVG sizing to use the viewBox-driven aspect.
4. **View.vue branching**: when `isMarpDocument(frontmatter)` → `<MarpView :markdown :pdf-filename :base-dir>` instead of `<MarkdownView>`. Surface `refreshFailed` banner above MarpView too.
5. **Preview.vue / FileContentRenderer**: surface Marp recognition to the chat-stream tile and the Files pane.
6. **Server**: extend `/api/pdf/markdown` with a `marp?: boolean` flag; new `renderMarpPdf()` reuses the existing `inlineImages()` helper + puppeteer at 1280×720, margin 0.
7. **i18n 8 locales** in lockstep (`de.ts` uses ASCII-safe strings per the German-quote rule).
8. **Local checks**: `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`.
9. **Push + PR** with User Prompt section.

## Trade-offs / known limits

- **Puppeteer reuse over marp-cli**: the originally-planned `@marp-team/marp-cli` spawn was dropped because the markdown PDF route already runs puppeteer in-process. Sharing the engine cuts the dep, the new route, and the Chromium-detection / disable-button code paths.
- **`marp-core` size**: ~120 KB min+gz — loaded lazily in `MarpView.vue` via `await import("@marp-team/marp-core")` inside `renderMarp()`. The `MarpView` shell itself stays a static import from both call sites (`markdown/View.vue` and `FileContentRenderer.vue`): the shell is ~150 lines / ~4 KB, and `defineAsyncComponent`-wrapping it would add a Suspense boundary + a flash of loading state every time a Marp document opens, for marginal payoff once the real weight is already on its own chunk via the inner dynamic import. (Acceptable exception to the "no dynamic import for always-needed packages" rule because Marp itself is conditional.)
- **iframe CSP**: srcdoc carries `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' 'self'; font-src 'self' data:;` plus `referrer: no-referrer` so a malicious deck can't exfiltrate via subresource fetches even if the `sandbox=""` boundary leaks.
- **Preview-side images**: srcdoc iframes have no base URL, so workspace-relative `<img src>` won't load in the in-browser preview. Server PDF inlines them via the existing helper so the exported deck is complete. A `<base href>` for the preview is deferred until requested.
- **No slide nav**: deliberately deferred. If the stacked view feels too "wall of slides", add `◀/▶ + counter` in a follow-up.
- **No PPTX export**: marp-cli supports it; we don't ship marp-cli, so PPTX is out. PDF covers 90% of the "send it" use case.
- **Theme**: marp-core default. `<!-- theme: gaia -->` directives work because marp-core ships gaia/uncover/default.

## Acceptance

- Agent writing a markdown doc with `marp: true` frontmatter → right pane shows the Marp-rendered slide stack (not the markdown body)
- Removing `marp: true` → falls back to existing `<MarkdownView>` rendering (no regression)
- Export PDF button → PDF lands in `artifacts/documents/`, accessible via Files pane
- Chromium missing → Export PDF disabled + tooltip explanation
- 8 locales lockstep pass `vue-tsc`
- `yarn format` / `lint` / `typecheck` / `build` / `test` all green

## Out of scope (future)

- Slide pagination / keyboard nav
- PPTX / HTML / PNG export
- Per-slide thumbnails sidebar
- Marp theme picker UI
- "Convert presentMulmoScript ↔ Marp" round-trip
