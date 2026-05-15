# MCP servers and the Docker sandbox

MulmoClaude can run Claude inside a Docker sandbox to isolate it from your host system (`yarn dev` without `DISABLE_SANDBOX=1`, or `Settings → Docker sandbox`). When the sandbox is on, **stdio MCP servers cannot be used**; HTTP MCP servers continue to work. This page explains why.

## TL;DR

- **stdio MCP servers** run as **child processes of Claude**. When Claude is sandboxed, the child process lands inside the sandbox too. The sandbox image is intentionally minimal (`node:22-slim` + `claude` + `tsx`) — most stdio MCPs need a richer environment to start.
- **HTTP MCP servers** run on the host (or remote) and Claude inside the sandbox talks to them over the network. The MCP server keeps its proper environment; the sandbox just opens a network path.
- When the sandbox is on, MulmoClaude **drops stdio entries from the per-session MCP config**. Disabling sandbox (`DISABLE_SANDBOX=1`) loads them all.

## The full story

### How stdio MCP servers work

stdio is the original MCP transport. Claude CLI spawns the MCP server as a child process and the two communicate over stdin/stdout using JSON-RPC:

```
[Claude CLI] ──spawn──> [MCP server process]
              │
              └── stdin / stdout pipes
                  carrying MCP JSON-RPC
```

The MCP server inherits Claude's environment — current directory, environment variables, the file system as Claude sees it. That inheritance is the source of every problem listed below.

### Why the sandbox is "minimal"

The sandbox image bakes in only what Claude itself needs to run:

- Node.js 22 (slim variant — no build-essential, no Python, no compilers)
- The `claude` binary
- `tsx` (used by hook subprocesses)

That's intentional. A bigger image means a bigger attack surface, longer pull times, and slower cold starts. The sandbox exists to **isolate** Claude — adding every possible runtime to it would defeat that goal.

### Why stdio MCP servers don't fit

When Claude lives inside the sandbox, every stdio MCP server it spawns also lives inside the sandbox. The following all break at once:

#### 1. Runtimes aren't there

A typical stdio MCP server invocation:

```
npx -y @modelcontextprotocol/server-memory
```

needs Node + npm cache + outbound network to npm registry. The sandbox image has Node but **no warmed npm cache** and (by policy) **no outbound network beyond an allowlist**. The first `npx -y` either fails immediately (no network) or downloads hundreds of megabytes per cold start (with network).

Python / Ruby / Go / .NET MCPs need their respective runtimes, none of which are in the image.

To "fix" this by bundling every runtime, we'd ship a multi-gigabyte image and still couldn't keep up with new entries. That's a non-starter for the isolation use case.

#### 2. Filesystem boundary

Many stdio MCPs assume host-level filesystem access:

| MCP | Reads / writes |
|---|---|
| `server-memory` | Memory state file |
| `server-filesystem` | An arbitrary tree the user passes |
| GitHub MCP | `~/.config/github` token |
| Spotify-style MCPs | OAuth tokens at fixed host paths |

The sandbox mounts only the workspace (`~/mulmoclaude/`). Everything else doesn't exist from inside. Even paths that DO exist are read-only or volume-mounted with different ownership. Most MCPs that work fine on the host immediately fail when their expected directory is missing.

#### 3. Authentication

OAuth tokens, API keys stored in `~/.config/...`, system keyrings — all out of reach inside the sandbox. The MCP starts, fails its first authenticated request, and exits.

#### 4. Network policy

Even when the MCP server runs locally, it often needs to reach a service over the public internet (npm, OAuth callbacks, the MCP's underlying API). The sandbox's network is intentionally narrowed to the MulmoClaude server's loopback so a compromised Claude can't exfiltrate data. Any outbound the MCP needs is blocked.

#### 5. Process lifecycle

Sandbox containers are ephemeral. `~/.npm` cache, MCP server side-effects on disk, anything the MCP relies on between runs — all wiped between container restarts. A stdio MCP that worked on first cold start will fail on the second because its state is gone.

#### 6. Silent-failure mode

Claude CLI 2.1.x tries to spawn each stdio MCP at startup and **silently exits with code 1 if any spawn fails** (no stderr line). When a sandbox image lacks a runtime the MCP needs, the user sees `[Error] claude exited with code 1` and nothing else. That's the symptom #1334 caught: the MCP-config writer was passing stdio entries into the sandbox even though we'd already decided not to support them, and the failure modes above tripped silently.

### Why HTTP MCP servers work

HTTP MCPs don't share Claude's process tree:

```
[Claude CLI (in sandbox)] ──HTTP via mapped port──> [MCP server (host or remote)]
```

The MCP server stays in its proper environment — full filesystem, full network, host's OAuth tokens, whatever. The sandbox just opens a single network path. None of the problems above apply: the runtime is on the host, the filesystem is the host's, the auth lives where it always lives, and the MCP's outbound network is its own concern.

This is why HTTP-style entries (`type: "http"`) and SSE-style entries are fine under Docker. Only `type: "stdio"` is problematic.

### Design decision

The two theoretical alternatives were:

| Option | Trade-off |
|---|---|
| **A — Fat sandbox image** | Bake every runtime in. Image inflates to gigabytes, attack surface widens, build times balloon, and the user's `~/.config` still isn't accessible — most MCPs still wouldn't work. Defeats the sandbox's purpose. |
| **B — Sidecar containers per MCP** | Spawn each stdio MCP in its own host-side container, then have Claude reach it over network. This is essentially the HTTP path with extra orchestration. Once you're talking over network, the MCP server might as well be an HTTP MCP. |

Neither pays off. MulmoClaude takes the simpler path: **stdio is disabled when the sandbox is on**. Users who need stdio MCPs run with `DISABLE_SANDBOX=1`. Users who want the sandbox use HTTP MCPs (which can be a local server — just point them at a `http://localhost:…` URL).

## What MulmoClaude does in practice

When the Docker sandbox is on, two things happen to each MCP entry from `~/mulmoclaude/config/mcp.json`:

1. `prepareUserServers` (`server/agent/config.ts`) drops any `type: "stdio"` entry from the per-session MCP config it writes. Claude CLI never sees them — no spawn attempt, no silent exit.
2. `userServerAllowedToolNames` (same file) drops the same entries from the `--allowedTools` allowlist. So even if a previously-cached `mcp__<server>` tool name somehow leaked through, the CLI wouldn't be permitted to call it.

A `log.info("mcp", "skipping stdio server in Docker mode", { serverId, transport: "stdio" })` line is emitted per drop so an operator scanning the server log knows why an entry isn't loading.

The settings UI surfaces this directly: any stdio entry shown while the Docker sandbox is on carries a warning badge plus a "Learn more" link to this page.

## Workarounds

- **You don't need the sandbox**: launch with `DISABLE_SANDBOX=1 yarn dev` (or toggle the setting). All stdio MCPs load normally.
- **You want the sandbox, you have an HTTP variant**: switch the MCP entry's `type` to `http` and point at a local server. Many MCP servers expose both transports.
- **You want the sandbox, you only have a stdio implementation**: wrap it. Run the stdio MCP on the host and put an HTTP shim in front (e.g. `@modelcontextprotocol/inspector` style). The shim runs outside the sandbox; Claude connects to it over HTTP. This is closer to Option B above but implemented per-MCP rather than as a generic feature.

## Related code

- `server/agent/config.ts` — `prepareUserServers`, `userServerAllowedToolNames` (the drop sites)
- `server/agent/index.ts` — picks `useDocker` and passes it down
- `src/components/SettingsMcpTab.vue` — the settings UI warning that links here
- `docs/sandbox-credentials.md` — orthogonal: how secrets get into the sandbox at all

## History

- **#162** introduced the Docker sandbox, established the stdio carve-out at the allowlist layer with the comment "the sandbox image is too minimal to run most of them".
- **#1334** caught the asymmetry: stdio entries were still being written to the per-session MCP config, so Claude CLI tried to spawn them, fell into the silent-exit-1 mode, and the user saw an unhelpful `[Error] claude exited with code 1`. The fix made `prepareUserServers` symmetric with the allowlist drop, and this document was added so the underlying constraint is discoverable without re-reading the issue.
