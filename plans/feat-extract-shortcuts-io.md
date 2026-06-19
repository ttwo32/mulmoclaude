# Share the launcher-shortcuts (favorites) format across MulmoClaude + MulmoTerminal

Why: MulmoClaude and MulmoTerminal **share a workspace**, so a favorited collection must show up in both
apps. Favorites are the pinned launcher shortcuts at **`<workspace>/config/shortcuts.json`**. Once both
apps' servers read/write that one file, the **on-disk format becomes a cross-app contract** — two
independent implementations *will* drift (one adds a field; the other's `PUT` rewrites the whole array
and silently drops it). This plan extracts the format so there's one source of truth.

Context: `../mulmoterminal/docs/collection-plugin-integration.md` (favorites section + foundational model).

## What exists today (MulmoClaude)

- **Format / contract** — `src/types/shortcuts.ts`: `SHORTCUT_KINDS = ["collection","feed"]`,
  `Shortcut` (`{ kind, slug, title, icon }`), `ShortcutsFile`, `sameShortcut()`. **Pure, no host deps.**
- **IO** — `server/utils/files/shortcuts-io.ts`: `normalizeShortcuts` (pure validate/dedupe),
  `readShortcuts` / `writeShortcuts` (depend on `WORKSPACE_FILES.shortcuts` + `workspacePath`,
  `writeFileAtomic`, `readTextSafe`).
- **Route** — `server/api/routes/shortcuts.ts`: `GET`/`PUT /api/shortcuts` (thin host glue).
- **Frontend store** — `src/composables/useShortcuts.ts`: load/pin/unpin/reconcile over the route.

## The split

| Layer | Shared? | Why |
|---|---|---|
| Format types + `normalizeShortcuts` + `sameShortcut` + the `config/shortcuts.json` filename | **YES — extract** | the contract; must not drift |
| `read/writeShortcuts` (atomic write, safe read, workspace path) | optional | generic but host-flavoured; can be shared via a binding or kept per-app |
| `GET`/`PUT /api/shortcuts` route | per-app | host glue (Express wiring) |
| `useShortcuts` frontend store | per-app | UI; each app has its own (MulmoTerminal's backs the plugin's `pinToggle`/`unpin`/`reconcileShortcuts`) |

## Option A — minimal (recommended first): extract the format only

A small **pure** package — no node, no Vue — owning the contract:

- `SHORTCUT_KINDS`, `ShortcutKind`, `Shortcut`, `ShortcutsFile`, `sameShortcut`, `normalizeShortcuts`,
  and the `SHORTCUTS_FILE = "config/shortcuts.json"` constant.
- Each app's server keeps its own thin `read/writeShortcuts` (its own atomic/safe helpers) but imports
  the format + `normalizeShortcuts` from the package — so validation/dedupe/shape are identical.
- Add a **shared fixture/golden test** (a sample `shortcuts.json` round-tripped through
  `normalizeShortcuts`) so a format change in one repo that isn't mirrored fails CI.

Naming/placement: `@mulmobridge/shortcuts` (the shared-code namespace), or `@mulmoclaude/shortcuts`
(NOT `…-plugin` — it's a library, so it must be added to the **explicit tier-2 enumeration** in
`package.json`'s `build:packages`, per the build-orchestration rules in CLAUDE.md; tier-4 auto-discovery
only picks up `*-plugin`). Pure TS, dual ESM+CJS like the collection core.

MulmoClaude change: `src/types/shortcuts.ts` + `shortcuts-io.ts`'s `normalizeShortcuts` re-export from
the package (thin shims), so existing importers (`useShortcuts`, the route, the collection index pages'
`reconcileShortcuts`) keep working unchanged.

## Option B — full: also share the IO behind a host binding

Move `read/writeShortcuts` into the package behind a `configureShortcutsHost({ workspaceRoot, atomicWrite,
readText })` binding (mirrors `configureCollectionHost`). Both servers call the same reader/writer.
Strongest drift guarantee, but more surface; do this only if Option A's golden test proves insufficient.

## Sequence

1. Create the package; move the format types + `normalizeShortcuts` + `sameShortcut` + filename const.
2. Re-export from MulmoClaude's `src/types/shortcuts.ts` + `shortcuts-io.ts` (shims); add it to the
   tier-2 build enumeration; green MulmoClaude (typecheck/lint/build/test).
3. Add the golden fixture test (shared sample → normalize → assert).
4. Publish; pin in MulmoClaude.
5. MulmoTerminal: its server's `GET`/`PUT /api/shortcuts` + `config/shortcuts.json` IO import the
   package's format + `normalizeShortcuts`; its `useShortcuts`-equivalent backs the collection plugin's
   `pinToggle`/`unpin`/`reconcileShortcuts`. (Tracked in the mulmoterminal integration doc.)

## Relationship to the collection plugin

Independent of `feat-collection-plugin-0.5.0.md`. The collection plugin only *calls* the host's
`reconcileShortcuts`/`unpin`/`pinToggle` — it doesn't own shortcut storage (shortcuts are a generic
launcher concept covering feeds too). So this extraction is a **host-shared-format** concern, separate
from the plugin release, and can land before, after, or in parallel.

## Open question

- One package for both formats, or fold `shortcuts` into an existing `@mulmobridge/*` lib? (Recommend a
  dedicated tiny package — the format is small, stable, and the explicit dependency is clearer than
  burying it in a grab-bag.)
