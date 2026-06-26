# `@mulmoclaude/collection-plugin@0.5.0` — make it consumable by a router-less host (MulmoTerminal)

Goal: let **MulmoTerminal** (no vue-router, no vue-i18n, Shadow-DOM plugin frame, `ToolPlugin`
registration model) import the collection UI. Full context + the MulmoTerminal-side plan:
`../mulmoterminal/docs/collection-plugin-integration.md`.

The `0.4.1` package works for MulmoClaude but still hard-assumes a router and a `body` teleport, and
offers no `ToolPlugin` entry. `0.5.0` removes those assumptions **without changing MulmoClaude's
behaviour** (MulmoClaude keeps its router by wiring the new capabilities to vue-router).

This is package-side only. None of it requires MulmoTerminal to exist yet — it's making the abstraction
honest now that there's a second consumer.

## A. `ToolPlugin` export on `./vue` — MulmoTerminal's registration model

MulmoTerminal registers a plugin as `{ plugin } from "@X/vue"` (`.toolDefinition` + `.viewComponent` +
`.previewComponent`), exactly like chart/form/markdown. The collection package exports raw components +
`configureCollectionUi`, not a `ToolPlugin`. Add one:

1. Move the host adapters `src/plugins/presentCollection/{View,Preview}.vue` into the package as
   `src/vue/chat/{View,Preview}.vue` (the chat-result adapters — map `ToolResult.viewState` →
   `CollectionView` props in embedded mode; render the small preview card). They're already thin and
   already depend only on `gui-chat-protocol` types + `CollectionView`.
2. Preview uses `pluginPresentCollection.*` keys (`fallbackTitle` / `itemLabel` / `listLabel`) — add
   those to the package i18n (`src/vue/lang/*`) so the adapter is self-contained; convert to
   `useCollectionI18n()`.
3. Export `export const plugin: ToolPlugin<PresentCollectionData, …> = { toolDefinition: TOOL_DEFINITION,
   viewComponent: View, previewComponent: Preview }` from `./vue` (mirrors chart-plugin/src/vue/index.ts).
4. **Host shrink (MulmoClaude):** `src/plugins/presentCollection/{View,Preview}.vue` become re-export
   shims (or the registration imports the package View/Preview directly via `wrapWithScope`). Verify the
   built-in registration still works unchanged. Keep `types.ts` re-export.

## B. Router-optional navigation — the one real coupling left

The binding's nav capabilities (`gotoIndex` / `gotoDetail` / `routeSlug` / `routeSelectedId` /
`isFeedRoute` / `setSelectedId`) are **already host-implemented** — MulmoClaude wires them to vue-router,
MulmoTerminal will wire them to view-state. No package change needed there. The ONLY hard vue-router
dependency inside the package is **`<router-link>`**, used for "ref" navigation in 3 components:

- `CollectionEmbedView.vue` (lines ~4, ~49) — the embed card → target record + "create it" link.
- `CollectionRecordPanel.vue` (lines ~320, ~413) — ref-field badges in the detail panel.
- `CollectionView.vue` (lines ~515, ~591) — ref-field badges in the table.

All point at `/collections/:targetSlug?selected=:recordId` (a record→record hop) or `/collections/:slug`.
Replace each `<router-link :to>` with binding-driven navigation. Add to `CollectionUi`:

```ts
/** Navigate to a record in another collection (a ref/embed hop). Host maps it to
 *  router.push or a view-state switch. */
navigateToRecord: (targetSlug: string, recordId?: string) => void;
/** Optional href for the same target, so router hosts keep real links
 *  (middle-click / a11y); router-less hosts return undefined. */
recordHref?: (targetSlug: string, recordId?: string) => string | undefined;
```

Render `<a :href="cui.recordHref?.(slug, id)" @click.prevent="cui.navigateToRecord(slug, id)">`. The
"create it" link (no record) maps to `navigateToRecord(targetSlug)`.
- **MulmoClaude wiring:** `recordHref → /collections/:slug?selected=:id`, `navigateToRecord →
  router.push(...)`. Identical UX to today.
- **MulmoTerminal wiring:** `recordHref → undefined`, `navigateToRecord → set the browse view-state`.

This drops the package's only need for a globally-registered `<router-link>`.

## C. Configurable teleport target — Shadow-DOM hosts

Only `CollectionRecordModal.vue` teleports (`<Teleport to="body">`). In a Shadow-DOM host (MulmoTerminal)
`body` is outside the shadow root → unstyled modal. Add an optional capability:

```ts
/** Where modals teleport. Defaults to "body"; a Shadow-DOM host points it at an
 *  in-shadow node so the injected styles still apply. */
modalTeleportTarget?: () => string | HTMLElement;
```

`<Teleport :to="cui.modalTeleportTarget?.() ?? 'body'">`. MulmoClaude omits it (defaults to `body`).

## D. Validate + release

- Wire the new MulmoClaude capabilities in `src/composables/collections/uiHost.ts` (recordHref +
  navigateToRecord via the router; leave teleport default). Update `installCollectionAppBindings` if
  needed.
- Full green: package build + vue-tsc + host typecheck + lint + the 49 collection e2e (ref-link click,
  embed navigation, modal still works).
- Bump `0.5.0` + launcher pin `^0.5.0`; CHANGELOG; publish; PR.

## Out of scope for 0.5.0
- MulmoTerminal-side wiring (its binding, server, toolbar) — separate, in the mulmoterminal repo.
- The shared `shortcuts-io` extraction — see `plans/feat-extract-shortcuts-io.md` (independent; needed
  for shared favorites, not for this package release).

## Risk notes
- The ToolPlugin's chat View adapter pulls `gui-chat-protocol/vue` types into `./vue` — already a peer,
  fine. Keep the adapter in `src/vue/chat/` so the non-chat surfaces (route pages) don't import it.
- Moving the Preview's i18n keys means they leave the host locale files — same lockstep discipline as
  the `collectionsView` removal (remove from all 8 host locales together).
