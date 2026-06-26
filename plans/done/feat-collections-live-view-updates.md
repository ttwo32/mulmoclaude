# Plan: live collection-view updates via pubsub (built-in **and** custom views)

Make a collection's view re-render when its underlying record data changes —
no matter who changed it (the agent via `manageCollection`, the UI via the
collections routes, or a host-driven `spawn` successor). Cover **both** view
surfaces: built-in Vue views (`CollectionView.vue`) and **LLM-authored custom
HTML views** running in a sandboxed iframe.

The custom-view path is the headline goal: an LLM authoring a `views/*.html`
file should be able to opt into live refresh with a single documented call.

---

## 1. Today's behaviour (the gap)

Collections have **no data-change pubsub path**. The view refetches only on
explicit user actions:

- `CollectionView.vue` refetches on route change, and after a create/delete it
  *itself* performed; inline edits update optimistically in memory.
- Custom views are **fetch-on-load** + manual refresh inside the iframe
  (`plans/done/feat-collections-custom-views.md` listed "live data push" as an
  explicit out-of-scope follow-up).

So when the **agent** adds or mutates a record mid-chat (the common case), an
open view shows stale data until the user manually reloads.

What *is* already live — and is easy to mistake for data updates — is the
**completion bell**: `collection-watchers` runs `fs.watch` and reconciles bell
state through the **notifier** pubsub. That is a per-record *status indicator*,
not a data broadcast, and it only covers collections that declare
`triggerField`/`spawn` (`packages/services/collection-watchers/src/watcher.ts:173`).

### Gap table

| Layer | Status | Anchor |
| --- | --- | --- |
| Channel declared for collection data | ❌ none | `src/config/pubsubChannels.ts` |
| Server publishes on record write/delete | ❌ none | `server/api/routes/collections.ts`, `…/collection-plugin/src/server/io.ts` |
| Built-in view subscribes + refetches | ❌ none | `…/collection-plugin/src/vue/components/CollectionView.vue` |
| Custom-view iframe receives change signal | ❌ none (no parent→iframe channel) | `…/components/CollectionCustomView.vue` |

---

## 2. What already exists to build on (reuse, don't rebuild)

The transport and the registry are in place — collections simply aren't wired
in. Two **proven templates** already ship:

1. **`accounting` plugin** — the closest analog (per-entity data channel).
   `accountingBookChannel(bookId)` is declared in `staticChannels`, the server
   publishes on mutation, and `View.vue` subscribes (`useAccountingBooksChannel`)
   and bumps a `bookVersion` that triggers a refetch. This is the model for
   built-in collection views.
2. **`useFileChange(filePath)`** (`src/composables/useFileChange.ts`, used by
   presentSVG / markdown / html) — a per-file `version` bump.

Transport primitives:

- **Server publish**: `pubsub.publish(channel, data)` (`server/events/pub-sub/index.ts`).
- **Client subscribe**: `usePubSub().subscribe(channel, cb)` (`src/composables/usePubSub.ts`) — Socket.IO over `/ws/pubsub`, replays subscriptions on reconnect.
- **Channel registry**: `src/config/pubsubChannels.ts` + per-plugin `META.staticChannels`.
- **Parent↔iframe messaging ALREADY EXISTS** (one-way, height only):
  the iframe height reporter posts `{ type: "mc-iframe-height", … }` to the
  parent (`src/utils/html/iframeHeightReporterScript.ts`), and the parent
  listens in `StackView.vue`. This proves the bridge works — we add the
  **reverse** direction (parent → iframe) for change signals.

---

## 3. Design

Two decisions drive everything: **where we publish** and **how a sandboxed
iframe receives the signal**.

### 3.1 Channel — one semantic channel per collection

Add a factory to the collection plugin's `meta.ts` and the registry:

```ts
// channel name: "collection:<slug>"
export const collectionChannel = (slug: string) => `collection:${slug}`;
```

Payload (small — the view re-fetches; we do **not** stream record bodies):

```ts
interface CollectionChangePayload {
  slug: string;
  /** Record ids that changed, when known; omitted ⇒ "something changed,
   *  refetch". Lets a future view do targeted refetch, but v1 consumers may
   *  ignore it and refetch the whole collection. */
  ids?: string[];
  /** "upsert" | "delete" — advisory; absent ⇒ unspecified. */
  op?: "upsert" | "delete";
}
```

Keep it a "ping to refetch", not a data feed — mirrors accounting's
`bookVersion` bump. No record content crosses the channel, so it carries no
secrets and is safe to relay into an opaque-origin iframe (§3.3).

### 3.2 Publish chokepoint — the host-side write path (NOT the fs watcher)

The watcher is **not** a universal hook: it skips collections without
`triggerField`/`spawn` (`watcher.ts:173`). Publishing there would silently miss
every plain-list collection — exactly the kind a custom view is built for.

Publish instead from the **host-side write functions** in
`packages/plugins/collection-plugin/src/server/io.ts` (`writeItem` /
`deleteItem`, and through them `putItems`). Every writer funnels through these:

- UI → `server/api/routes/collections.ts` → `writeItem`/`deleteItem`
- Agent → `manageCollection` (`putItems`) → `writeItem`
- Host-driven recurrence → `maybeSpawnSuccessor` → `writeItem`
  (`…/server/spawn.ts`)

So one hook here catches **all three writers**, including spawn successors — a
view live-updates even when a record is auto-generated.

**Injection (no new coupling):** the plugin is isomorphic and already takes a
host binding via `configureCollectionHost`. Add an optional
`publishChange?: (payload: CollectionChangePayload) => void` to that host
config, default no-op (tests / MulmoTerminal standalone stay silent unless they
wire it). `writeItem`/`deleteItem` invoke it **after** a successful atomic
write. The server wires `publishChange` to `pubsub.publish(collectionChannel(slug), payload)`.

> **Slug threading.** `writeItem(dataDir, id, …)` currently has no `slug`.
> Thread the slug (or the channel string) into the io layer so there is a
> **single** publish call, rather than sprinkling `pubsub.publish` across the
> 3–4 callers and risking a missed one. This is the main mechanical change.

**Coalescing.** `writeItem` is called once per record; a `putItems` of N rows
fires N writes. Debounce on the **publish/relay side** (per slug, ~50–100 ms)
so a bulk write yields one refetch, not N. (The watcher's existing single-flight
coalesce in `watcher.ts:286-313` is the reference shape.)

### 3.3 Delivery to a custom view — parent relays via postMessage (recommended)

A custom view runs in an iframe with **opaque origin** and
`connect-src <server-origin>` CSP. It *could* open its own WebSocket to
`/ws/pubsub`, but it has **no global bearer** to authenticate, so that path
needs a brand-new scoped pubsub-token type, reconnect/expiry handling inside the
sandbox, and CSP review. **Reject that for v1.**

Instead, **the parent subscribes and relays** (Option A):

```
record write → io.writeItem → publishChange
  → pubsub.publish("collection:<slug>")
    → CollectionCustomView.vue (parent) usePubSub().subscribe(...)
      → iframe.contentWindow.postMessage({ type: "mc-collection-changed", slug }, "*")
        → injected window.__MC_VIEW.onChange(cb) fires → author re-fetches via existing token
```

Why this is the right call:

- **No new auth.** The iframe re-fetches through the token it already holds. No
  pubsub token, no websocket-in-sandbox.
- **Reuses the proven bridge.** The height reporter already establishes a
  parent↔iframe `message` channel; we add the reverse direction. The parent
  already holds a live `usePubSub` connection.
- **Carries no secrets.** The relayed message is just `{ type, slug }` — safe
  to post to an opaque-origin iframe with `"*"`.
- **Symmetric with built-in views.** Both surfaces consume the *same*
  `collection:<slug>` channel; only the last hop differs (direct subscribe vs.
  postMessage relay).

**Security of the relay:**

- The iframe handler MUST verify `event.source === parent` (or
  `event.origin === <expected host origin>`) and `event.data.type ===
  "mc-collection-changed"` before acting. The injected helper does this so the
  author can't get it wrong.
- The signal triggers only a **re-fetch through the existing scoped token** —
  it grants no new capability and exposes no data the view couldn't already
  read.

### 3.4 The custom-view authoring contract (the headline deliverable)

Extend the injected `window.__MC_VIEW` global (built in
`src/utils/html/customViewSrcdoc.ts`) with a documented, mistake-proof helper so
the LLM author opts into live refresh in **one line**:

```js
// window.__MC_VIEW already provides: { slug, token, dataUrl }
// NEW: onChange(callback) — invokes callback (debounced) whenever this
// collection's data changes server-side. Returns an unsubscribe function.
window.__MC_VIEW.onChange(() => loadAndRender());
```

Implementation of the helper (injected, not author-written): adds a single
`window.addEventListener("message", …)` that validates source + type + slug and
calls the callback through a ~150 ms debounce. The author never touches
`postMessage` directly — they get a clean callback, matching the ergonomics of
the existing `fetch(dataUrl, …)` contract.

Full author-facing example to add to the docs (`custom-view.md`):

```html
<script>
  const { dataUrl, token } = window.__MC_VIEW;
  async function render() {
    const res = await fetch(dataUrl, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) return;               // (error handling per existing contract)
    const { items } = await res.json();
    // …draw items…
  }
  render();                             // initial paint
  window.__MC_VIEW.onChange(render);    // live refresh on any server-side change
</script>
```

> **Doc emphasis (per request):** the `custom-view.md` section must state
> plainly that (a) `onChange` fires for **all** writers — agent, UI, and
> auto-spawned records; (b) the callback should be **idempotent / full-refetch**
> (it may fire once for a bulk change); (c) it is **debounced**, so authors
> should not add their own throttle; (d) it requires no extra capability — a
> `read`-only view can subscribe. Include the one-liner in BOTH worked examples
> (year-overview and weekly-planner) so the pattern is unmissable.

### 3.5 Built-in `CollectionView.vue`

Add a `useCollectionChannel(slug)` composable (thin wrapper over `usePubSub`,
modeled on `useAccountingBooksChannel`) that bumps a reactive `version` /
invokes a refetch on `collection:<slug>` events. Wire `CollectionView.vue` to
debounce-refetch `getItems` on bump. Guard against clobbering an in-flight
optimistic inline edit (e.g. skip/defer refetch while a row edit is unsaved, or
reconcile by id) — see §6.

---

## 4. Files touched

| File | Change |
| --- | --- |
| `src/config/pubsubChannels.ts` (+ collection plugin `meta.ts` `staticChannels`/factory) | Declare `collectionChannel(slug)` = `collection:<slug>`. |
| `packages/plugins/collection-plugin/src/server/host.ts` (host config) | Add optional `publishChange(payload)` to the injected host binding (default no-op). |
| `packages/plugins/collection-plugin/src/server/io.ts` | Thread `slug`/channel into `writeItem`/`deleteItem`; call `publishChange` after a successful write/delete. |
| `server/events/…` / collections wiring | Wire `publishChange` → `pubsub.publish(collectionChannel(slug), payload)`, with a per-slug debounce. |
| `src/utils/html/customViewSrcdoc.ts` | Inject `window.__MC_VIEW.onChange(cb)` helper (validated `message` listener + debounce). |
| `packages/plugins/collection-plugin/src/vue/components/CollectionCustomView.vue` | Parent subscribes via `usePubSub` and relays `mc-collection-changed` into the iframe. |
| `src/composables/collections/useCollectionChannel.ts` (new) + `CollectionView.vue` | Built-in view subscribe + debounced refetch. |
| `packages/services/workspace-setup/assets/helps/custom-view.md` | Document `onChange` contract + update both worked examples. **Bump `@mulmoclaude/workspace-setup`** (shared pkg — version-bump guard). |
| docs (`collection-skills.md` cross-ref if relevant) | Optional pointer to the live-refresh capability. |
| tests | See §7. |

> **Shared-package version bumps** (CI `version-bump` guard, and MulmoTerminal
> consumes both): bump `@mulmoclaude/collection-plugin` and
> `@mulmoclaude/workspace-setup` when their `src`/`assets` change in this work.
> See `plans/done/feat-collections-field-driven-spawn.md` for the same dance.

---

## 5. Backward compatibility

- `publishChange` defaults to no-op: existing tests, the standalone launcher,
  and MulmoTerminal behave identically until they wire it.
- Custom views that don't call `onChange` are unaffected — fetch-on-load still
  works byte-identically. `onChange` is purely additive to `window.__MC_VIEW`.
- No schema change. No new token type. No CSP change (the relay is
  postMessage, not a new `connect-src`).

---

## 6. Edge cases & risks

| Case | Handling |
| --- | --- |
| Bulk write (`putItems` of N rows) | Per-slug debounce on publish/relay → one refetch. |
| Optimistic inline edit in `CollectionView.vue` races a refetch | Defer/skip the channel-driven refetch while a row edit is unsaved, or reconcile by id; never overwrite an unsaved field. |
| Self-echo (the view that wrote the record gets its own change event) | Idempotent refetch makes it harmless; optionally tag writes with an origin id to suppress. |
| Custom-view iframe re-mints its token (`exp − 60s`) | Independent of the relay; `onChange` keeps working across re-mints because it re-fetches with whatever token is current. |
| Malicious `postMessage` into the iframe | Injected helper validates `event.source === parent` + `type` + `slug`; payload carries no secret and only triggers a token-scoped refetch. |
| Collection with no watcher (no `triggerField`/`spawn`) | Fully covered — we publish from the write path, not the watcher. |
| External/manual file edit (not via host writers) | NOT covered in v1 (no publish). Acceptable — rare, and the user can manually refresh. A future phase could broaden the watcher to publish for all collections. |

---

## 7. Testing

- **Publish**: `writeItem`/`deleteItem` invoke `publishChange` once per write
  with the right `{ slug, ids, op }`; no-op when unconfigured. Spawn successor
  (`maybeSpawnSuccessor`) also publishes.
- **Debounce**: a `putItems` of N rows yields one relayed change (fake timers).
- **Custom-view helper**: `onChange` ignores messages with wrong
  `source`/`type`/`slug`; fires (debounced) on a valid `mc-collection-changed`;
  unsubscribe stops it. (jsdom/Playwright.)
- **Built-in view**: an injected channel event triggers a `getItems` refetch;
  an unsaved inline edit is not clobbered.
- **E2E (optional)**: open a collection view, write a record via the API in the
  background, assert the grid updates without a manual reload.

---

## 8. Scope & phasing

- **Phase 1 (this plan): Go.** Channel + write-path publish + built-in view
  subscribe + custom-view `onChange` relay + docs. Covers agent, UI, and spawn
  writers for both surfaces.
- **Phase 2 (deferred):** broaden coverage to external/manual file edits (watch
  all collection data dirs and publish), and/or targeted refetch using the
  payload `ids` instead of full reload. Revisit once Phase 1 usage shows whether
  full-refetch is too coarse.

The result: a record changes anywhere — agent, button, or auto-spawn — and both
the built-in grid and any LLM-authored custom view refresh on their own, with
the custom-view author opting in via a single documented `window.__MC_VIEW.onChange(...)`.
