# Drop `--strict-mcp-config` to expose claude.ai connectors (#1617)

Single-line config change. Frontend/server-side wiring only.

## Why

Claude Code 2.1.x's `--mcp-config` is **additive** by default. The
`--strict-mcp-config` flag opts in to "this file is the only source".
MulmoClaude currently passes `--strict` because a #1043 C-2 debug
session found the merge dropped the local mulmoclaude broker. CLI
2.1.163 no longer exhibits that — verified live both via the init
message's `mcp_servers` array and a real MulmoClaude session.

Dropping `--strict` lets the agent see the user's already-configured
claude.ai connectors (Gmail / Calendar / Drive / Slack) on top of
the local broker, without any MulmoClaude-side OAuth or per-connector
mcp.json hand-rolling.

## Change

`server/agent/config.ts:279-291` — remove
`args.push("--strict-mcp-config")`, rewrite the comment to capture
the new intent.

## Verification (already done locally)

- `claude --help`: `--mcp-config` documented additive, `--strict-mcp-config` opt-in.
- `claude -p ... --mcp-config <local-stdio>.json --output-format=stream-json`
  init message shows BOTH `everything: pending` (local stdio) AND the
  4 `claude.ai *: pending|needs-auth` (connectors) in `mcp_servers`.
  Local broker survives the merge.
- Live MulmoClaude (`yarn dev`, edit applied, session started): chat
  enumeration confirmed the full mulmoclaude 12-tool surface
  (presentDocument, presentHtml, presentMulmoScript, generateImage,
  presentForm, manageCalendar, manageTodoList, manageBookmarks,
  managePhotoLocations, manageSpotify, mapControl, notify) AND the
  4 claude.ai connectors listed with their pending/needs-auth state.

## Out of scope

- No MulmoClaude-side UI for connector OAuth lifecycle — refreshing
  tokens / connect / disconnect still happens via the `claude` CLI's
  interactive `/mcp` UI. Can revisit if pain emerges.
- No first-turn-latency mitigation (connectors handshake while the
  first agent turn runs; subsequent turns see them as connected).
  In practice acceptable.
- No tool-allowlist heuristic to dampen tool-name bloat in workspaces
  with many connectors — opt-in mental model: if you enabled a
  connector via `/mcp`, you want it.

## Acceptance

- `--strict-mcp-config` no longer pushed.
- Live: agent sees its broker AND any claude.ai connector tools the
  user has enabled.
- Existing GUI plugin flows unchanged.
- `format` / `lint` / `typecheck` / `build` / full test clean.
EOF
)
