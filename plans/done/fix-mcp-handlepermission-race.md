# fix: handlePermission "not found" race at session start (#1698)

## Problem

After upgrading to 0.7.0, a new session can fail its first permission check with:

```
Error: MCP tool mcp__mulmoclaude__handlePermission (passed via --permission-prompt-tool) not found.
```

`buildCliArgs` starts the Claude CLI with
`--permission-prompt-tool mcp__mulmoclaude__handlePermission` (`server/agent/config.ts`).
The CLI invokes that MCP tool whenever a tool's permission check is `ask`.

In `server/agent/mcp-server.ts` the `tools/list` JSON-RPC handler is gated behind
`runtimeReady` — it does not respond until preset/runtime/dev plugins finish loading
(tgz extraction + dynamic import), which can take ~10–30 s on a cold cache (the
first launch right after an upgrade). Until `tools/list` returns, the CLI has no
record of `handlePermission` (an always-on internal tool), so an ask-mode check
in that window fails with "not found". `tools/call` is likewise gated, so even
after `tools/list` resolves the permission decision would stall on plugin load.

Regression vs 0.6.5: the `runtimeReady` gate arrived with the runtime-plugin
mechanism; before that `tools/list` answered immediately.

## Fix (spec-correct, hybrid)

In `server/agent/mcp-server.ts`:

1. **Respond to `tools/list` immediately** with the current tool set instead of
   awaiting `runtimeReady`. `handlePermission` and all static tools are present
   from the start, so the permission race disappears. (Reading the mutable
   `tools` binding at call time already returns the latest set.)
2. **Advertise `capabilities.tools.listChanged = true`** in the `initialize`
   result so the client subscribes to list updates.
3. **Emit `notifications/tools/list_changed`** once `runtimeReady` resolves *and*
   the tool surface actually changed, prompting the CLI to re-fetch and pick up
   runtime plugins. Deferred until after the client's `notifications/initialized`
   per the MCP lifecycle.
4. **Un-gate `tools/call` for already-known tools** (static tools incl.
   `handlePermission`); only an as-yet-unknown name (possibly a runtime plugin
   still loading) waits for `runtimeReady`. Keeps the permission tool responsive.

The `handlePermission`-availability part (1, 4) does not depend on the client
honouring `list_changed`; only runtime-plugin re-appearance (2, 3) does. Claude
CLI 2.1.178 references `notifications/tools/list_changed`, so that precondition
holds on current CLIs.

## Tests

- `test/agent/test_mcp_smoke.ts`: assert `initialize` advertises
  `capabilities.tools.listChanged === true`, and `tools/list` includes
  `handlePermission`.

## Verification

- Inject a temporary delay into `runtimeReady`, start a session, fire a first
  tool that needs a permission prompt → before: "not found"; after: no error and
  runtime plugins still list once loaded.
