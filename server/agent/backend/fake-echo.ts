// Test-only LLM backend. Echoes the user's message verbatim as the
// assistant reply, with no Claude / Docker spawn. Loaded lazily by
// `getActiveBackend()` only when `MULMOCLAUDE_FAKE_AGENT=1` — keeps
// this code (and its `randomUUID` etc. imports) out of the production
// runtime path entirely.
//
// What this unlocks in CI without a Claude binary / API key:
//   - L-LINKIFY-CODESPAN — needs the assistant to echo a codespan
//   - L-23 (workspace-link-routing) — needs the assistant to echo a
//     markdown link
//   - L-19 (ui stack layout) — needs *any* completed turn
//   - L-06..L-09 (roles) — same; one tool-free turn per role
//   - L-11 (session reload) — same
//
// What it does NOT unlock: tests that pin on the LLM actually
// reasoning / calling tools (presentForm, generateImage, skills, ...).
// Those stay gated on `E2E_LIVE_NO_LLM=1`.

import { randomUUID } from "node:crypto";

import { EVENT_TYPES } from "../../../src/types/events.js";
import type { AgentEvent } from "../stream.js";
import type { AgentInput, LLMBackend } from "./types.js";

async function* runFakeEchoAgent(input: AgentInput): AsyncGenerator<AgentEvent> {
  // Synthesize a claude session id so the orchestrator's resume
  // bookkeeping (and any session-store side-effects) sees the same
  // shape as a real run.
  yield { type: EVENT_TYPES.claudeSessionId, id: randomUUID() };

  // The single assistant text block. Echoing the user's prompt
  // verbatim gives tests a deterministic, content-controllable
  // reply — the codespan / markdown-link / role-name asserts they
  // care about land in the rendered chat without any real LLM.
  yield { type: EVENT_TYPES.text, message: input.message };
}

export const fakeEchoBackend: LLMBackend = {
  id: "fake-echo",
  // Resume-by-token / MCP aren't meaningfully replayable from an
  // echo stub. Flag them as unsupported so callers that depend on
  // the real Claude semantics opt out instead of getting silently
  // wrong behavior.
  capabilities: { sessionResume: false, mcp: false },
  runAgent: runFakeEchoAgent,
};
