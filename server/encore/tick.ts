// Encore tick — time-driven invoker for the reconciler.
//
// The tick used to carry its own copy of trim/escalate/publish logic.
// That moved into `reconcile.ts` (the sole owner of bell state). The
// tick is now a thin walker:
//
//   1. For every obligation directory, call reconcileCycleNotifications.
//   2. Prune orphan pending-clear tickets older than 30 days.
//
// `PendingClearTicket` still lives here because dispatch.ts, reconcile.ts,
// and the host UI all import the type — keeping it adjacent to the on-disk
// shape (the only consumer is `pending-clear/*.json`) makes the locus of
// schema changes obvious.

import path from "node:path";

import { log as defaultLog } from "../system/logger/index.js";
import { ONE_HOUR_MS } from "../utils/time.js";
import type { Severity } from "./dsl/schema.js";
import { PENDING_CLEAR_DIRNAME, OBLIGATIONS_DIRNAME } from "./paths.js";
import { readDir, readTextOrNull, unlink } from "../utils/files/encore-io.js";
import * as encoreNotifier from "./notifier.js";
import { reconcileCycleNotifications } from "./reconcile.js";

const ORPHAN_TICKET_AGE_MS = 30 * 24 * ONE_HOUR_MS; // 30 days

export interface TickDeps {
  now: Date;
  log?: typeof defaultLog;
}

/** Shape of a pending-clear ticket on disk. Authoritative record
 *  of every live Encore bell entry: which obligation+cycle+step it
 *  belongs to, which targets it covers, what severity it was
 *  published at (used for escalation diff), and the seed prompt
 *  resolveNotification will use to start the chat on user click. */
export interface PendingClearTicket {
  pendingId: string;
  obligationId: string;
  cycleId: string;
  notificationId: string;
  stepId: string;
  /** Target ids covered by this bundled notification. */
  targets: string[];
  /** Severity at last publish — used as the escalation-diff
   *  baseline. The cycle file used to carry
   *  `lastPublishedSeverity`; that moved here when status flags
   *  were removed. */
  severity: Severity;
  seedPrompt: string;
  createdAt: string;
  /** Filled by resolveNotification on first bell click. Subsequent
   *  clicks reuse it (idempotent). */
  chatSessionId?: string;
}

export async function runTick(deps: TickDeps): Promise<void> {
  const log = deps.log ?? defaultLog;
  const obligationIds = await readDir(OBLIGATIONS_DIRNAME);
  for (const obligationId of obligationIds) {
    try {
      await reconcileCycleNotifications({ obligationId, now: deps.now, log });
    } catch (err) {
      log.warn("encore", "tick: reconcile failed", { obligationId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await pruneOrphanTickets(deps.now, log);
}

// ── orphan ticket sweep (time-driven, lives here not in reconcile) ──
//
// Orphan tickets are pending-clear records older than 30 days that
// somehow weren't trimmed by reconcile (e.g. the cycle file was
// deleted manually, or a host crash left a ticket without its bell
// counterpart). The sweep is age-based, not state-based, so it
// belongs with the time-driven tick rather than the state-driven
// reconciler.

async function pruneOneTicket(rel: string, raw: string, now: Date, log: typeof defaultLog): Promise<void> {
  let ticket: PendingClearTicket;
  try {
    ticket = JSON.parse(raw) as PendingClearTicket;
  } catch {
    await unlink(rel);
    return;
  }
  const ageMs = now.getTime() - new Date(ticket.createdAt).getTime();
  if (ageMs <= ORPHAN_TICKET_AGE_MS) return;
  log.info("encore", "tick: pruning orphan ticket", { pendingId: ticket.pendingId, ageMs });
  // Clear the host bell entry BEFORE unlinking the ticket. Otherwise
  // the bell entry stays visible but the ticket is gone — next tick
  // treats the step as un-fired and publishes a duplicate while the
  // stale entry is still up.
  try {
    await encoreNotifier.clear(ticket.notificationId);
  } catch (err) {
    log.warn("encore", "tick: prune-bell-clear failed", { notificationId: ticket.notificationId, error: err instanceof Error ? err.message : String(err) });
  }
  await unlink(rel);
}

async function pruneOrphanTickets(now: Date, log: typeof defaultLog): Promise<void> {
  const entries = await readDir(PENDING_CLEAR_DIRNAME);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const rel = path.join(PENDING_CLEAR_DIRNAME, entry);
    const raw = await readTextOrNull(rel);
    if (!raw) continue;
    await pruneOneTicket(rel, raw, now, log);
  }
}
