# feat: export shareable `system:feed-refresh` registration from `@mulmoclaude/core`

Status: core export + MulmoClaude rewire DONE (`@mulmoclaude/core` 0.2.7 → 0.2.10;
also fixes invalid YAML in the `mc-manage-automations` preset SKILL.md. 0.2.9 was a
broken/incomplete publish — superseded by 0.2.10; publish a full build).
MulmoTerminal consumption + double-scheduling decision below remain its own follow-up.
Decisions: home = `@mulmoclaude/core/feeds/server` (Q1); double-scheduling = soft dedup,
Option 1 (Q2). Follow-up to the feeds extraction (`feat-extract-feeds-package.md`,
`@mulmoclaude/core/feeds`). Lets **standalone MulmoTerminal / MulmoBooks** run scheduled
feed refresh without hand-duplicating MulmoClaude's host code, and de-dupes the task
definition across hosts.

## Motivation

After the engine extraction, MulmoTerminal can refresh feeds on demand (the Refresh
button → `POST /api/collections/:slug/refresh`). But **scheduled** refresh is still
MulmoClaude-only: the hourly `system:feed-refresh` task is **hand-assembled inline** in
MulmoClaude's `server/index.ts` (`const systemTasks: SystemTaskDef[]`), not exported.

Two consequences:
- **Standalone MulmoTerminal** (no MulmoClaude process running) gets **no** scheduled
  refresh — feeds only update when the user clicks Refresh.
- If MulmoTerminal hand-rolled its own copy of the task, the definition (id, schedule,
  `run: refreshDue`) would drift between the two hosts.

Today the shared `~/mulmoclaude` workspace papers over this: MulmoClaude's running
scheduler refreshes the shared feeds, and MulmoTerminal sees the results. But the moment
MulmoTerminal runs **alone** (the MulmoBooks story), there's no scheduler. So the
registration should be **shareable engine code**, not host glue.

## Current state (verified)

- `system:feed-refresh` `SystemTaskDef` — `server/index.ts` (`const systemTasks`):
  ```ts
  { id: "system:feed-refresh", name: "Scheduled collection refresh",
    description: "Refresh due collections — fetch declarative feeds + dispatch agent-ingest workers",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: ONE_HOUR_MS },
    missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
    run: () => refreshDueFeeds().then(() => {}) }   // refreshDueFeeds = refreshDue from @mulmoclaude/core/feeds/server
  ```
- `SystemTaskDef` is already exported from `@mulmoclaude/core/scheduler`
  (`{ id, name, description, schedule, missedRunPolicy, run }`); `initScheduler(taskManager, tasks)`
  registers them with persistence + catch-up.
- The only feeds-specific part of the task is `run: () => refreshDue(workspaceRoot)` plus
  the id/name/description/interval — everything else is generic scheduler shape.
- MulmoTerminal does NOT use `initScheduler`; it registers tasks directly on a
  `createTaskManager()` (forward-firing, no catch-up — see
  `mulmoterminal/server/backends/scheduler.ts`).

## The export

Add to **`@mulmoclaude/core/feeds/server`** (feeds owns `refreshDue` + the task
semantics; importing `SystemTaskDef` from the sibling `@mulmoclaude/core/scheduler` is an
intra-`core` dep):

```ts
// packages/core/src/feeds/server/scheduledRefresh.ts
import { SCHEDULE_TYPES, MISSED_RUN_POLICIES } from "@receptron/task-scheduler";
import type { SystemTaskDef } from "../../scheduler/adapter.js"; // sibling subpath
import { refreshDue } from "./engine.js";

export const FEED_REFRESH_TASK_ID = "system:feed-refresh";
export const DEFAULT_FEED_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/** The hourly "refresh due collections" task, shared by every host. `intervalMs`
 *  lets a host apply its own override; `workspaceRoot` defaults to the configured
 *  FeedsHost. Returns the rich SystemTaskDef — a host using a bare task-manager can
 *  still `registerTask(...)` it (the extra `missedRunPolicy` is simply ignored). */
export function feedRefreshTaskDef(opts?: { workspaceRoot?: string; intervalMs?: number }): SystemTaskDef {
  return {
    id: FEED_REFRESH_TASK_ID,
    name: "Scheduled collection refresh",
    description: "Refresh due collections — fetch declarative feeds + dispatch agent-ingest workers",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: opts?.intervalMs ?? DEFAULT_FEED_REFRESH_INTERVAL_MS },
    missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
    run: () => refreshDue(opts?.workspaceRoot).then(() => {}),
  };
}
```

Export from `@mulmoclaude/core/feeds/server` (`index.ts`). Bump core + publish.

> The function RETURNS the def rather than registering it — each host keeps its own
> registration mechanism (MulmoClaude `initScheduler`; MulmoTerminal `registerTask`),
> and applies its own schedule overrides before registering.

## MulmoClaude rewiring (zero behavior change)

Replace the inline `system:feed-refresh` entry in `server/index.ts` with
`feedRefreshTaskDef()` (the override loop + `loadSchedulerOverrides()` stay host-side and
keep mutating `task.schedule`). ✅ gate: identical scheduled behavior; the
scheduler-state row id is unchanged (`system:feed-refresh`), so no orphaned state.

## MulmoTerminal consumption (the payoff)

In `mulmoterminal/server/backends/scheduler.ts`, register the shared task on the existing
task-manager so a **standalone** MulmoTerminal refreshes due feeds:
```ts
taskManager.registerTask(feedRefreshTaskDef({ workspaceRoot: CLAUDE_CWD }));
taskManager.start(); // start even with zero user tasks (the system task needs the tick loop)
```
Declarative feeds fetch directly; agent-ingest dispatch HIDDEN workers via the
`spawnWorker` seam already wired in PR #129. (Note: MulmoTerminal's `spawnWorker` adapter
does not yet invoke the hidden-worker `onComplete` reconciliation — see "Open" below.)

## ⚠️ Load-bearing concern: double-scheduling on a shared workspace

If **both** MulmoClaude and MulmoTerminal run the due-loop against the **same**
`~/mulmoclaude`, they could both refresh the same feed.

- **Soft dedup already exists.** The engine's `isFeedDue()` reads `lastFetchedAt` from the
  **shared** workspace state. Whoever refreshes first stamps it; the other host's next tick
  sees "not due" and skips. For agent-ingest, `lastFetchedAt` is stamped at **dispatch**,
  which narrows the window further.
- **Residual race.** If both tick within the same small window before either stamps:
  declarative → a wasteful double-fetch (keyed upsert is idempotent, so harmless data-wise);
  agent-ingest → **two hidden workers** dispatched (wasteful, possible conflicting writes).

Options (decide in this PR):
1. **Accept the soft dedup** (recommended for v1): the standalone case — the actual target —
   has no conflict at all; the both-running race is rare and mostly benign. Document it.
2. **Workspace scheduler lease**: a `<ws>/config/scheduler/feed-refresh.lock` with a
   PID + heartbeat; only the lease-holder runs the due-loop. Hard-correct, but new
   cross-process machinery — likely its own PR if we want it.

## Versioning / publish

Patch-bump `@mulmoclaude/core` (`0.2.7` → `0.2.10`), raise the `@mulmoclaude/core` dep
floor in `packages/mulmoclaude/package.json` to `^0.2.10` (the host now imports
`feedRefreshTaskDef`), build (`vite build && vite build -c vite.esm.config.ts`), publish.
MulmoTerminal then re-pins
and registers the task (its own follow-up PR; the MulmoTerminal feeds PR #129 already
notes scheduled refresh is deferred to this work).

## Open questions

1. **Home**: `@mulmoclaude/core/feeds/server` (recommended — owns `refreshDue`) vs
   `@mulmoclaude/core/scheduler`.
2. **Double-scheduling**: soft-dedup (Option 1) vs a lease (Option 2)?
3. **MulmoTerminal catch-up**: stay forward-firing (no catch-up), or adopt
   `configureScheduler` + `initScheduler` for missed-run catch-up like MulmoClaude?
   (Forward-firing means the first refresh is up to one interval after boot.)
4. **`onComplete` for hidden workers**: MulmoTerminal's PTY session model has no clean
   turn-completion/`didError` signal yet, so scheduled agent-ingest refreshes dispatch but
   skip failure-bell / `consecutiveFailures` reconciliation. Separate concern — flag, don't
   block.
