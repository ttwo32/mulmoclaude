// In-flight bookkeeping for detached worker sessions launched via the
// `spawnBackgroundChat` MCP tool with `hidden: true` (origin
// `system`). Both the tool handler (which reserves a slot before
// `startChat`) and `runAgentInBackground`'s `finally` (which releases
// it when the worker finishes) run in the same Express process, so
// this module-level Set is the single shared owner of the count.
//
// Purpose: a runaway guard. Without a cap, a misbehaving agent could
// fan out an unbounded number of parallel `claude` subprocesses. The
// cap is small on purpose — the intended use is "stay one or two
// lessons ahead", not a job queue.

const MAX_BACKGROUND_SESSIONS = 4;

const inFlight = new Set<string>();

/** Atomically reserve a slot for a hidden worker session: returns
 *  `false` (without reserving) when the cap is already reached,
 *  otherwise reserves and returns `true`. The check and the insert
 *  happen together with no `await` in between, so concurrent handler
 *  calls can't all pass a separate "is there room?" check and then
 *  each launch — which would briefly exceed the cap. The caller MUST
 *  pair a `true` result with `releaseBackgroundSession` (on the
 *  worker's completion, and as rollback if the launch itself fails). */
export function tryReserveBackgroundSession(chatSessionId: string): boolean {
  if (inFlight.size >= MAX_BACKGROUND_SESSIONS) return false;
  inFlight.add(chatSessionId);
  return true;
}

/** Unconditionally mark a session as in-flight (bypasses the cap).
 *  Production code uses `tryReserveBackgroundSession`; this exists for
 *  tests that need to fill the cap deterministically. */
export function reserveBackgroundSession(chatSessionId: string): void {
  inFlight.add(chatSessionId);
}

/** Release a hidden worker session's slot. Idempotent / safe to call
 *  for non-background sessions (no-op when the id was never reserved),
 *  so the agent run's `finally` can call it without branching. */
export function releaseBackgroundSession(chatSessionId: string): void {
  inFlight.delete(chatSessionId);
}

// ── Completion hooks ────────────────────────────────────────────────
//
// A generic, one-shot callback fired when a hidden worker session finishes
// (success or error). Any host spawner of hidden workers can register one to
// learn the outcome without polling — the agent-ingest dispatcher uses it to
// track consecutive failures and raise/clear a failure bell. Best-effort: a
// server restart mid-run drops the Map, but the next scheduled tick
// re-dispatches anyway, so nothing is permanently lost.

/** Outcome handed to a completion hook. */
export type CompletionHook = (outcome: { didError: boolean }) => void | Promise<void>;

const completionHooks = new Map<string, CompletionHook>();

/** Register a one-shot completion hook for a hidden worker session. Replaces
 *  any existing hook for the same id (last writer wins). */
export function registerCompletionHook(chatSessionId: string, hook: CompletionHook): void {
  completionHooks.set(chatSessionId, hook);
}

/** Remove and return the completion hook for a session, if any. One-shot:
 *  the entry is deleted so the hook can't fire twice. */
export function takeCompletionHook(chatSessionId: string): CompletionHook | undefined {
  const hook = completionHooks.get(chatSessionId);
  if (hook) completionHooks.delete(chatSessionId);
  return hook;
}

export { MAX_BACKGROUND_SESSIONS };
