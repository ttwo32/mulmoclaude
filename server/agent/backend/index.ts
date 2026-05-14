// Backend factory. Today there is only ClaudeCodeBackend; future
// backends (OpenAI, Ollama native, Gemini) are selected here based on
// env / settings. Callers go through getActiveBackend() rather than
// importing a concrete adapter so adding a backend doesn't require
// touching every call site.
//
// `MULMOCLAUDE_FAKE_AGENT=1` swaps in the echo-stub backend
// (./fake-echo.ts). The fake is `await import()`ed so it never lands
// in the production bundle / hot path — production users pay zero
// runtime cost for the test seam.

import { claudeCodeBackend } from "./claude-code.js";
import type { LLMBackend } from "./types.js";

export type { AgentInput, BackendCapabilities, LLMBackend } from "./types.js";

const FAKE_AGENT = process.env.MULMOCLAUDE_FAKE_AGENT === "1";
let fakeBackendPromise: Promise<LLMBackend> | null = null;

export async function getActiveBackend(): Promise<LLMBackend> {
  if (!FAKE_AGENT) return claudeCodeBackend;
  if (!fakeBackendPromise) {
    fakeBackendPromise = import("./fake-echo.js").then((mod) => mod.fakeEchoBackend);
  }
  return fakeBackendPromise;
}
