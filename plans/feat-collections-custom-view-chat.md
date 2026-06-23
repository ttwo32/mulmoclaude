# feat(collections): let custom-view buttons start a new chat (draft, user-approved)

Issue: #1742 — custom-view buttons should trigger backend work, not just flip a
flag. PR #1748 (`openItem`) established the bridge pattern; this is its action-
oriented successor, scoped to **Option A: route through a visible, user-approved
chat** (no headless side-effects).

## Goal

A custom view can hand the host a **prefilled prompt** for a brand-new chat
session. The host opens the session and drops the prompt into the **standard
composer as an editable draft** — it does NOT auto-send. The user reviews, edits
if they want, then presses Send (or clears it). The agent in that approved chat
does the real work (file the GitHub issue, fetch URL metadata + write back, start
from the task record), so all three beta use cases in #1742 resolve through one
primitive.

```js
window.__MC_VIEW.startChat("Start work on this task:\n\n" + recordText);
window.__MC_VIEW.startChat(prompt, "research");   // optional role id
```

## Why this is safe (capability model)

Strictly safer than `openItem` (#1748): the view's code only *proposes text into
an input field*. Nothing is created, fetched, or written until the **user** presses
Send, at which point it is an ordinary agent run the user authored through trusted
first-party UI. So — like `openItem` — **no capability gate is required**; a
`["read"]` view can call it. There is deliberately no headless "run skill in the
background" path in this plan (that was Option B; deferred until a real no-human-in-
the-loop need appears, because it would need a new per-skill capability gate).

## Protocol

View → parent: `{ type: "mc-start-chat", slug, prompt, role? }`, posted to the
**known parent origin** (`v.origin`), never `*`. Carries no secret. Host verifies
`event.source === iframe.contentWindow` + `slug === props.slug` before acting —
identical guard to `mc-open-item`.

`prompt` is coerced to a string; empty/whitespace-only → ignored (no empty chat).
`role` is optional; the host validates it against the known role list and falls
back to General when absent or unknown (see note below).

## Scope decision (from design discussion)

**Prompt + optional role.** The view may pass a role id to preselect the new
session's role; host validates and falls back to General. Rationale: a triage view
may want a chat that already carries the tools its follow-up needs.

## Files

### View bootstrap
- `src/utils/html/customViewSrcdoc.ts`
  - Add `v.startChat = function(prompt, role){ ... postMessage({type:'mc-start-chat',
    slug:v.slug, prompt:String(prompt), role: typeof role==='string'?role:undefined},
    v.origin); }` to `viewBridgeBootstrap()` (alongside `openItem`).
  - Update the file header + the `viewBridgeBootstrap` doc-comment to list the new
    bridge (same prose discipline as the `openItem` block).

### Host — collection plugin
- `packages/plugins/collection-plugin/src/vue/components/CollectionCustomView.vue`
  - Extend `onWindowMessage` (or add a sibling branch) to handle `mc-start-chat`:
    same source+slug verification, then `emit("startChat", { prompt, role })`.
  - Add `startChat` to `defineEmits`.
- `packages/plugins/collection-plugin/src/vue/components/CollectionView.vue`
  - `@start-chat="onCustomViewStartChat"` on `<CollectionCustomView>` (line ~399).
  - `function onCustomViewStartChat({ prompt, role }) {`
    `  const text = (prompt ?? "").trim(); if (!text) return;`
    `  appApi.startNewChatDraft(text, role);  // role validated host-side`
    `}`
- `packages/plugins/collection-plugin/src/vue/uiContext.ts`
  - Add `startNewChatDraft: (prompt: string, role?: string) => void;` to the
    UI-context type (next to `startChat`).

### Host — app wiring
- `src/composables/collections/uiHost.ts`
  - Add a `startNewChatDraft` binding slot mirroring `startChat` (module-level fn ref,
    installed via `installCollectionAppBindings`, exposed on the context object).
- `src/App.vue`
  - New `function startNewChatDraft(message: string, roleId?: string): void`:
    ```ts
    const rId = roleId && roles.value.some(r => r.id === roleId)
      ? roleId
      : BUILTIN_ROLE_IDS.general;   // validate; fall back to General
    createNewSession(rId);
    userInput.value = message;       // prefill composer; do NOT sendMessage
    // focus the composer input so the user lands ready to review/edit
    ```
    (Contrast with `startNewChat`, which calls `void sendMessage(message)` — this
    one intentionally stops at the draft.)
  - Thread `startNewChatDraft` into `installCollectionAppBindings(...)` alongside the
    existing `startChat` binding.
  - Wire composer focus: reuse whatever ref/method the `+`-new-session flow already
    uses to focus `userInput` (confirm during impl; add a `nextTick` focus if none).

### Docs + tests
- `packages/services/workspace-setup/assets/helps/custom-view.md`
  - New "Starting a chat" contract section: `startChat(prompt, role?)`, the
    draft-not-send semantics, the no-capability-needed note, and a wired example
    (e.g. an "Start work" chip that builds a prompt from the record).
  - Bump `@mulmoclaude/workspace-setup` patch version (shipped asset) — consumed by
    MulmoTerminal too, so keep versions in lockstep ([[project_shared_pkg_version_bump]]).
- `packages/plugins/collection-plugin/package.json`
  - Patch-bump `@mulmoclaude/collection-plugin` (Vue component change).
- `test/utils/html/test_customViewSrcdoc.ts`
  - Assert `startChat` helper + `mc-start-chat` wiring is injected and targets the
    parent origin (not `*`), mirroring the existing `openItem`/`origin` assertions.
- `plans/feat-collections-custom-views.md`
  - Add `startChat` to the authoring-contract list (same spot `openItem` was added).

## Out of scope (explicit)
- Headless background skill execution with external side-effects (Option B).
- Auto-sending the prompt (defeats the approve/edit/reject gate — never do this).
- Letting the view target an existing session; always a fresh session.

## Checks
`yarn format` · `yarn lint` · `yarn typecheck` · `yarn build`; unit suite incl.
`test_customViewSrcdoc`. Manual smoke (not unit-coverable): mount a real view, call
`__MC_VIEW.startChat(text, role)`, confirm a new session opens with the prompt
prefilled-but-unsent in the composer, role preselected, and that an unknown role id
falls back to General.
