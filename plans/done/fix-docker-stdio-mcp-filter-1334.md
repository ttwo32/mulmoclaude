# Drop stdio MCP entries under Docker sandbox (#1334)

## Problem

With Docker sandbox enabled (`yarn dev` without `DISABLE_SANDBOX=1`), any enabled stdio MCP server in `~/mulmoclaude/config/mcp.json` causes Claude CLI to silently exit with code 1 within 7s of every agent run. UI shows `[Error] claude exited with code 1` and nothing else.

Root cause: `userServerAllowedToolNames` correctly drops stdio entries from `--allowedTools` under Docker (per #162: sandbox image is intentionally minimal) but `prepareUserServers` still writes them into the per-session MCP config. Claude CLI tries to spawn them inside the minimal sandbox image, the spawn fails, and the CLI's silent-exit-1 mode hides the failure.

## Fix in this PR

Four concerns from the user direction:

1. **Document the underlying constraint.** Why stdio doesn't fit the sandbox isn't obvious — process tree inheritance, minimal image, filesystem boundary, network policy, auth, ephemeral lifecycle, Claude CLI 2.1.x's silent-failure mode. Add `docs/mcp-sandbox.md` and link from `docs/README.md` under Developers.
2. **Filter stdio entries in Docker mode** at `prepareUserServers`. Symmetric with the existing `userServerAllowedToolNames` carve-out.
3. **Log per skipped entry** so an operator scanning the server log understands why their MCP didn't load.
4. **UI warning** on stdio entries when Docker sandbox is on, with a "Learn more" link to the doc (new tab).

## Files touched

- `docs/mcp-sandbox.md` — new doc (~250 lines), `TL;DR` up front + full reasoning.
- `docs/README.md` — index entry under Developers.
- `server/agent/config.ts` — `prepareUserServers` drops stdio when `useDocker`; `log.info("mcp", "skipping stdio server in Docker sandbox", { serverId, transport, reason })` per drop.
- `test/agent/test_agent_config.ts` — replace the now-unreachable "rewrites stdio args in docker mode" test with three new cases (mixed http+stdio drop, all-stdio drop, disabled-then-docker dual filter).
- `src/components/SettingsMcpTab.vue` — replace the narrow `dockerNonWorkspaceWarning` (premised on stdio-runs-but-with-broken-args, no longer reachable) with `dockerStdioUnsupported` that fires for ALL stdio entries under `dockerMode`, plus a `learnMore` link opening `docs/mcp-sandbox.md` on GitHub in a new tab. Drop the now-unused `stdioHasNonWorkspaceArg` helper.
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — swap `dockerNonWorkspaceWarning` for the new `dockerStdioUnsupported` + `learnMore` keys. All 8 locales translated per locale.

## Out of scope

- A `DISABLE_SANDBOX=1` CLI flag for the launcher (#1089) — already tracked.
- Sidecar-container approach to make stdio actually work under Docker — see docs for why this isn't pursued.

## Acceptance

- Docker sandbox + enabled stdio entries → Claude CLI no longer silently exits 1. Stdio entries are dropped before the per-session MCP config is written.
- Server log includes one `mcp` info line per dropped entry, naming the `serverId`.
- Settings → MCP tab shows an amber warning + "Learn more" link on every stdio entry while Docker sandbox is on.
- `docs/mcp-sandbox.md` reachable from `docs/README.md` and from the UI link.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
