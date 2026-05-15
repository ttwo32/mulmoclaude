# Live E2E testing (`e2e-live/`)

> Read this before adding a new `e2e-live/tests/*.spec.ts` file.

Two Playwright suites live in this repo. They have different
contracts — pick the right one before writing a new test.

| Suite | Server | LLM | Network mocks | Use it when |
|---|---|---|---|---|
| `e2e/` | Vite + Express (port 45173) auto-spawned | none | `mockAllApis(page)` mandatory | Asserting a UI flow that doesn't depend on real agent output. |
| `e2e-live/` | Long-running `yarn dev` (port 5173) | real or fake | no mocks | Asserting end-to-end behavior that exercises the agent / tool / plugin chain. |

Everything below is about `e2e-live/`.

## How `e2e-live/` works

The Playwright config (`e2e-live/playwright.config.ts`) **assumes a
live server is already up** at `E2E_LIVE_BASE_URL` (default
`http://localhost:5173`). Specs send real chat messages via the SPA
and assert on whatever lands on the canvas.

Two boot modes:

- **Dev mode** (default): `yarn dev` on port 5173. What
  developers use for routine regression checks.
- **Pre-release mode**: `npx mulmoclaude@<tarball>` on port 3001,
  used to verify the published artifact before a release. Override
  with `E2E_LIVE_BASE_URL=http://localhost:3001`.

Output knobs:

- `HEADED=1` — flip to headed Chromium for QA scenarios.
- `E2E_LIVE_WORKERS=<n>` — override the default 3-worker parallelism.
- `E2E_LIVE_REPORT_SUBDIR=<name>` — isolate the HTML report when
  running per-category skills (see `test:e2e:live:wiki` etc. in
  `package.json`).

## Two backends behind the agent

The chat flow goes through an `LLMBackend` (see
`server/agent/backend/types.ts`). There are two implementations:

| Backend | Activation | Where it runs |
|---|---|---|
| `claudeCodeBackend` | Default | Local dev, pre-release, weekly Claude-credentialed cron |
| `fakeEchoBackend` | `MULMOCLAUDE_FAKE_AGENT=1` at server boot | The `.github/workflows/e2e_live_no_llm.yaml` matrix |

The boot wiring is in `server/index.ts`:

```ts
if (process.env.MULMOCLAUDE_FAKE_AGENT === "1") {
  setActiveBackend(fakeEchoBackend);
}
```

No dynamic imports; production never branches per request — the
decision is made once at module load.

### What `fakeEchoBackend` does

- **Text replies** are the concatenated per-session message history,
  so `await sendChatMessage(page, X)` followed by an assertion on the
  assistant body finds `X` in the rendered text.
- **Slash-command turns** (`/<slug>`) read the seeded
  `<workspacePath>/.claude/skills/<slug>/SKILL.md` and echo the
  `respond with this exact line: <X>` line if present. This is what
  makes `skills/L-22` pass without a real LLM.
- **Tool calls** for the present-family plugins are detected from
  the prompt (see `detectPresentForm` / `detectPresentHtml` /
  `detectPresentChart` / `detectPresentMulmoScript` in
  `server/agent/backend/fake-echo.ts`). fake-echo POSTs to the same
  internal API the MCP bridge uses (`/api/form`, `/api/html`,
  `/api/chart`, `/api/mulmoScript/save`), so the actual server-side
  handler runs and the canvas mounts the View.

> **Fake at the LLM seam only**, real from tool dispatch downward.

### What `fakeEchoBackend` does NOT do

- It cannot fake plugins that hit an external service (`generateImage`
  hits Gemini, `generateMovie` shells out to ffmpeg, etc.). Tests
  that exercise those stay gated on `E2E_LIVE_NO_LLM=1` — see the
  "Skipping the right way" section below.
- It cannot fake genuine reasoning. A test whose assertion depends
  on the model recalling intent from a free-form prompt won't be
  satisfied by an echo + history join.

## Writing a new `e2e-live` spec

1. **Decide which suite you need.** If you can satisfy the assertion
   with mocked APIs, write it in `e2e/` and call `mockAllApis(page)`.
   Only reach for `e2e-live/` when the test must observe the real
   agent → tool → artifact chain.

2. **Use `data-testid` for selectors.** Same convention as `e2e/`.
   Functional names, not positional / text-content.

3. **Seed via fixtures, not the LLM.** When the test depends on a
   workspace artifact (wiki page, mulmoScript, skill), seed it
   directly with `placeWikiPage` / `placeWorkspaceFile` /
   `placeProjectSkill` from `e2e-live/fixtures/live-chat.ts`. Asking
   the LLM to author the seed material drifts on each model update;
   seeding directly stays deterministic across backends.

4. **Use unique slugs / paths.** Project name + `randomUUID().slice(0, 6)`
   nonce. Parallel chromium / webkit workers don't share state, and
   stale-run remnants from a previous failure must not bleed into
   the next assertion.

5. **Cleanup is mandatory.** Wrap session / wiki / workspace seeds
   in `try { … } finally { deleteSession(); removeFromWorkspace(); }`.
   Sessions in particular leak into the sidebar and pollute every
   subsequent run if dropped.

### Will my test run under `fakeEchoBackend`?

Check the table:

| Your test does this | fakeEchoBackend |
|---|---|
| Asserts on assistant text body | ✅ works (history echo) |
| Asserts on a wiki / workspace artifact you seeded yourself | ✅ works |
| Asks the agent to call `presentForm` / `presentHtml` / `presentChart` / `presentMulmoScript` with a prompt shape that matches the detector | ✅ works (plugin endpoint runs for real) |
| Asks the agent to call `Skill` via `/<slug>` and the seeded SKILL.md has a "respond with this exact line: X" line | ✅ works |
| Asks the agent to call a tool fake-echo doesn't know about, OR a plugin that hits an external service | ❌ — see "Skipping the right way" |
| Asserts on real reasoning ("the model recalls the prior turn's content") | ⚠ partial — only the history-join shape works; deeper recall does not |

### Skipping the right way

If your test genuinely cannot run under fake-echo, **opt out per-test
with the env var**:

```ts
test("L-XX: …", async ({ page }) => {
  test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs <reason>");
  // …
});
```

Never gate at the `test.describe` scope if even one test in the
suite is fake-friendly. Mixed describes are normal — see
`workspace-link-routing.spec.ts` (L-23 needs the LLM, L-24 doesn't).

### Extending `fakeEchoBackend`

Add a new pattern detector when:

- A plugin has an internal endpoint the MCP bridge already uses
  (i.e. there's a `POST /api/<plugin>` route).
- The detector can extract realistic args from the prompt shape
  the spec ships.
- The artifact would actually mount the View on the canvas (test
  by running the spec locally with `MULMOCLAUDE_FAKE_AGENT=1
  yarn dev` first).

Do NOT add a detector that fakes the tool result content directly —
fake-echo's design contract is "real from tool dispatch downward".
Bypassing the handler defeats the canary value of the test.

For unit tests that want to drive a different response without
patching the prompt, use the exported `setFakeResponse(gen)` /
`resetFakeResponse()` API (pair in `beforeEach` / `afterEach`).

## CI matrix

The `.github/workflows/e2e_live_no_llm.yaml` workflow:

- Boots `yarn dev` with `MULMOCLAUDE_FAKE_AGENT=1` and
  `DISABLE_SANDBOX=1`.
- Runs each spec file as its own matrix job (`fail-fast: false`).
- Triggers: weekly Monday 00:00 UTC cron, `workflow_dispatch`, and
  `pull_request` when paths touch the workflow / e2e-live / server
  agent backend / server index.

Specs currently in the matrix and what they cover under fake-echo
are tracked in the workflow's `matrix.spec:` block. When you add a
new spec file, add it there too if at least one of its tests is
fake-friendly.
