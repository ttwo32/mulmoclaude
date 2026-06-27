// Agent-performed ingest (`ingest.kind: "agent"`). On schedule (or a manual
// Refresh), the host seeds a hidden background worker — origin `system`, so
// it never appears in the user's session list — in the collection's declared
// role with its template + a summary of every record, and the worker edits the
// records itself via the collections io layer. The host stays domain-free:
// everything stock-specific (or whatever the collection does) is prose in the
// template.
//
// DI seam: the worker is launched through a runner injected at boot
// (`setAgentWorkerRunner`), not imported directly, because this module lives in
// `server/workspace/` and must not import `server/api/routes/agent.ts` (that
// would form a workspace→routes cycle). `server/index.ts` wires
// `spawnSystemWorker` in as the runner.

import { log } from "../../system/logger/index.js";
import { listItems, readSkillTemplate, buildCollectionActionSeedPrompt, type LoadedCollection } from "../collections/index.js";
import { publish as publishNotifier, clear as clearNotifier } from "../../notifier/engine.js";
import { readFeedState, writeFeedState, type FeedState } from "./state.js";
import type { AgentIngestSpec } from "./ingestTypes.js";
import type { RefreshResult } from "./refreshResult.js";

/** Outcome of launching one hidden worker. `chatId` lets the caller register a
 *  completion hook so a failed refresh doesn't die silently. */
export type AgentWorkerResult = { ok: true; chatId: string } | { ok: false; error: string };

/** Launches a worker chat. Injected at boot to avoid a workspace→routes import
 *  cycle. `hidden` chooses an invisible system worker (scheduled refresh) vs a
 *  visible session the user can watch (manual Refresh — debuggable).
 *  `onComplete` is a one-shot completion hook (only honoured for hidden workers)
 *  so the dispatcher learns success/failure. Returns `ok:false` on the
 *  concurrency-cap miss or a launch error — the caller leaves state untouched
 *  and retries next tick. */
export type AgentWorkerRunner = (args: {
  message: string;
  roleId: string;
  hidden: boolean;
  onComplete?: (outcome: { didError: boolean }) => void | Promise<void>;
}) => Promise<AgentWorkerResult>;

let workerRunner: AgentWorkerRunner | null = null;

/** Wire the hidden-worker launcher. Called once at boot from `server/index.ts`. */
export function setAgentWorkerRunner(runner: AgentWorkerRunner): void {
  workerRunner = runner;
}

function result(slug: string, patch: Partial<RefreshResult>): RefreshResult {
  return { slug, written: 0, removed: 0, errors: [], ...patch };
}

/** Dispatch one agent-ingest refresh: build the seed, launch a worker, and (on a
 *  successful launch) stamp `lastFetchedAt` with the DISPATCH time — not
 *  completion. That's what gates the due-loop, so a slow worker can't cause a
 *  double-dispatch. `opts.hidden` (default true) runs an invisible system worker
 *  for SCHEDULED refreshes; a MANUAL Refresh passes `hidden:false` for a visible,
 *  debuggable session. Failure-isolated: never throws; cap-miss / template-miss /
 *  launch error leave state untouched and report via `errors`. */
export async function refreshViaAgent(workspaceRoot: string, collection: LoadedCollection, opts?: { hidden?: boolean }): Promise<RefreshResult> {
  const hidden = opts?.hidden ?? true;
  const { slug } = collection;
  const ingest = collection.schema.ingest as AgentIngestSpec | undefined;
  if (!ingest || ingest.kind !== "agent") return result(slug, { errors: ["collection has no agent ingest config"] });
  if (!workerRunner) return result(slug, { errors: ["agent ingest worker runner not configured"] });

  const template = await readSkillTemplate(collection.skillDir, ingest.template);
  if (template === null) return result(slug, { errors: [`ingest template '${ingest.template}' could not be read`] });

  const items = await listItems(collection.dataDir, { workspaceRoot });
  const message = buildCollectionActionSeedPrompt(items, collection.schema, template);

  const launch = await workerRunner({
    message,
    roleId: ingest.role,
    hidden,
    // A visible manual run is watched directly — only hidden runs get the
    // completion hook (failure bell + consecutiveFailures); `finalizeRun` only
    // fires it for system-origin sessions anyway.
    onComplete: hidden ? (outcome) => recordOutcome(workspaceRoot, collection, outcome.didError) : undefined,
  });
  if (!launch.ok) {
    // Cap-miss or launch error: do NOT touch lastFetchedAt — the next due tick
    // (or manual Refresh) redials. Surface it so a manual refresh reads honest.
    log.info("feeds", "agent ingest dispatch skipped", { slug, error: launch.error });
    return result(slug, { errors: [launch.error], dispatched: false });
  }

  const state = await readFeedState(workspaceRoot, collection);
  await writeFeedState(workspaceRoot, collection, { ...state, lastFetchedAt: new Date().toISOString() });
  log.info("feeds", "agent ingest dispatched", { slug, role: ingest.role, chatId: launch.chatId, hidden, items: items.length });
  // Surface the chatId only for a visible run so the client can open it; a hidden
  // session is excluded from every listing and can't be navigated to anyway.
  return result(slug, { dispatched: true, ...(hidden ? {} : { chatId: launch.chatId }) });
}

/** Completion hook: reconcile failure tracking when a dispatched worker
 *  finishes. On error, bump `consecutiveFailures` and raise a single failure
 *  bell (deduped via the persisted `failureBellId`). On success, reset the
 *  counter and clear any standing bell. Best-effort + failure-isolated — it
 *  runs inside the agent run's teardown, so it must never throw. */
async function recordOutcome(workspaceRoot: string, collection: LoadedCollection, didError: boolean): Promise<void> {
  const state = await readFeedState(workspaceRoot, collection);
  const next: FeedState = didError ? await onWorkerError(state, collection) : await onWorkerSuccess(state, collection);
  await writeFeedState(workspaceRoot, collection, next);
}

async function onWorkerError(state: FeedState, collection: LoadedCollection): Promise<FeedState> {
  const next: FeedState = { ...state, consecutiveFailures: state.consecutiveFailures + 1 };
  log.warn("feeds", "agent ingest worker failed", { slug: collection.slug, consecutiveFailures: next.consecutiveFailures });
  // Raise a single bell on the first failure; a standing one isn't piled onto.
  if (!state.failureBellId) {
    try {
      const { id } = await publishNotifier({
        pluginPkg: "host",
        severity: "nudge",
        lifecycle: "fyi",
        title: "Collection refresh failed",
        body: `“${collection.schema.title}” (${collection.slug}) couldn't refresh. Open it to retry.`,
        navigateTarget: `/collections/${collection.slug}`,
      });
      next.failureBellId = id;
    } catch (err) {
      log.warn("feeds", "failed to publish ingest failure bell", { slug: collection.slug, error: String(err) });
    }
  }
  return next;
}

async function onWorkerSuccess(state: FeedState, collection: LoadedCollection): Promise<FeedState> {
  log.info("feeds", "agent ingest worker completed", { slug: collection.slug });
  if (state.failureBellId) {
    await clearNotifier(state.failureBellId).catch((err) =>
      log.warn("feeds", "failed to clear ingest failure bell", { slug: collection.slug, error: String(err) }),
    );
  }
  const next: FeedState = { ...state, consecutiveFailures: 0 };
  delete next.failureBellId;
  return next;
}
