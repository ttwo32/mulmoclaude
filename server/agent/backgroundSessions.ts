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

export { MAX_BACKGROUND_SESSIONS };
