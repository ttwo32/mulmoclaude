// Encore tick — the DSL interpreter.
//
// Each tick, for every `active` obligation:
//
//   1. Read DSL (index.md) + current cycle file.
//   2. For each open (target, step), compute (currentPhase,
//      currentSeverity, fireDate) by walking firingPlan in order
//      and picking the latest phase whose `at` resolves to a date
//      ≤ today.
//   3. Group un-fired pairs by (stepId, severity, fireDate) within
//      the obligation. Each group becomes ONE notification —
//      the "multi-target → one ding" UX. Store the same
//      activeNotificationId on each target.step entry.
//   4. For pairs that already have an activeNotificationId, check
//      if the current severity differs from lastPublishedSeverity;
//      if so, escalate (clear+publish, same pendingId/navigateTarget,
//      different severity).
//
// The tick NEVER calls chat.start. It writes a pending-clear ticket
// with the seed prompt; chat creation is deferred to the user's
// click on the bell, handled by Step 5's /encore page.

import { randomUUID } from "node:crypto";

import { log as defaultLog } from "../system/logger/index.js";
import { compareIsoDates, isoDate } from "./dsl/cadence.js";
import { parseAtExpression } from "./dsl/at-expression.js";
import { resolveAtExpression } from "./dsl/at-resolver.js";
import type { EncoreDsl, Severity, StepDef } from "./dsl/schema.js";
import { parseIndexFile } from "./obligation.js";
import { parseCycleFile, serializeCycleFile, type CycleState, type StepState } from "./cycle.js";
import { obligationDir, obligationIndexPath, pendingClearPath, PENDING_CLEAR_DIRNAME, OBLIGATIONS_DIRNAME } from "./paths.js";
import { readDir, readTextOrNull, writeText, unlink } from "../utils/files/encore-io.js";
import * as encoreNotifier from "./notifier.js";

const ORPHAN_TICKET_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface TickDeps {
  now: Date;
  log?: typeof defaultLog;
}

/** Shape of a pending-clear ticket on disk. The /encore page reads
 *  this on the user's click (Step 5), starts the chat with
 *  `seedPrompt`, and returns navigateTo: /chat/<chatId>. The handler
 *  side reads it from markStepDone/markTargetSkipped to clear the
 *  bell entry. */
export interface PendingClearTicket {
  pendingId: string;
  obligationId: string;
  cycleId: string;
  notificationId: string;
  stepId: string;
  /** Target ids covered by this bundled notification. */
  targets: string[];
  severity: Severity;
  /** Initial message the chat opens with — embeds the
   *  bundle scope, the relevant formSchema fields, and the
   *  pendingId so the LLM can call back with the right args. */
  seedPrompt: string;
  createdAt: string;
  /** Filled by resolveNotification on the user's first bell click.
   *  Subsequent clicks reuse it (idempotent) so a double-click
   *  doesn't spawn two chats for the same bell entry. */
  chatSessionId?: string;
}

export async function runTick(deps: TickDeps): Promise<void> {
  const log = deps.log ?? defaultLog;
  const todayIso = isoDate(deps.now);

  const obligationIds = await readDir(OBLIGATIONS_DIRNAME);
  for (const obligationId of obligationIds) {
    try {
      await tickOneObligation(obligationId, todayIso, log);
    } catch (err) {
      log.warn("encore", "tick: obligation failed", { obligationId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  await pruneOrphanTickets(deps.now, log);
}

async function tickOneObligation(obligationId: string, todayIso: string, log: typeof defaultLog): Promise<void> {
  const indexRaw = await readTextOrNull(obligationIndexPath(obligationId));
  if (indexRaw === null) return;
  const { dsl } = parseIndexFile(indexRaw);
  if (dsl.status !== "active") return;

  const cycleRel = await pickCurrentCycle(obligationId);
  if (!cycleRel) return;
  const cycleRaw = await readTextOrNull(cycleRel);
  if (cycleRaw === null) return;
  const { state, body } = parseCycleFile(cycleRaw);
  if (state.status !== "open") return;

  let dirty = false;

  // Phase 1: escalate existing notifications when current phase
  // severity ≠ lastPublishedSeverity.
  const byActiveId = groupByActiveId(state);
  for (const [notificationId, members] of byActiveId.entries()) {
    const escalated = await maybeEscalate(dsl, state, members, todayIso, notificationId, log);
    if (escalated) dirty = true;
  }

  // Phase 2: publish for un-fired (target, step) pairs.
  const unfired = collectUnfired(dsl, state, todayIso);
  const groups = groupForBundling(unfired);
  for (const group of groups) {
    await fireGroup(dsl, state, group, log);
    dirty = true;
  }

  if (dirty) {
    await writeText(cycleRel, serializeCycleFile(state, body));
  }
}

async function pickCurrentCycle(obligationId: string): Promise<string | null> {
  const entries = await readDir(obligationDir(obligationId));
  const cycleFiles = entries.filter((name) => name !== "index.md" && name.endsWith(".md")).sort();
  if (cycleFiles.length === 0) return null;
  // The latest file alphabetically is the current cycle (cycle ids
  // are zero-padded date-like strings: 2026-05, 2026-W19, 2026-h1).
  return `${obligationDir(obligationId)}/${cycleFiles[cycleFiles.length - 1]}`;
}

// ── escalation ────────────────────────────────────────────────────

interface ActiveMember {
  targetId: string;
  stepId: string;
  step: StepState;
}

function groupByActiveId(state: CycleState): Map<string, ActiveMember[]> {
  const byId = new Map<string, ActiveMember[]>();
  for (const [targetId, record] of Object.entries(state.records)) {
    if (record.status !== "open") continue;
    for (const [stepId, step] of Object.entries(record.steps)) {
      if (step.status !== "open") continue;
      if (!step.activeNotificationId) continue;
      const list = byId.get(step.activeNotificationId) ?? [];
      list.push({ targetId, stepId, step });
      byId.set(step.activeNotificationId, list);
    }
  }
  return byId;
}

async function maybeEscalate(
  dsl: EncoreDsl,
  state: CycleState,
  members: ActiveMember[],
  todayIso: string,
  notificationId: string,
  log: typeof defaultLog,
): Promise<boolean> {
  if (members.length === 0) return false;
  const [firstMember] = members;
  const stepDef = dsl.steps.find((step) => step.id === firstMember.stepId);
  if (!stepDef) return false;
  const phase = currentPhaseFor(stepDef, firstMember.step, state, todayIso);
  if (!phase) return false;
  // All members of the same notification share the same step (one
  // notification fires for one stepId), so the severity comparison
  // is uniform.
  const lastSeverity = firstMember.step.lastPublishedSeverity;
  if (phase.severity === lastSeverity) return false;

  // Severity transition → escalate by clear+publish (host doesn't
  // expose an `update` op).
  const ticket = await readTicketForNotification(notificationId);
  if (!ticket) {
    log.warn("encore", "escalate: pending-clear ticket missing; skipping", { notificationId });
    return false;
  }

  await encoreNotifier.clear(notificationId);
  const navigateTarget = encoreUrlFor(ticket.pendingId);
  const title = bundleTitle(dsl, stepDef, members);
  const body = bundleBody(dsl, stepDef, members);
  const { id: newId } = await encoreNotifier.publish({
    severity: phase.severity,
    title,
    body,
    navigateTarget,
  });

  await writeTicket({ ...ticket, notificationId: newId, severity: phase.severity });

  // Mutate the step references in place; the caller will persist.
  for (const member of members) {
    member.step.activeNotificationId = newId;
    member.step.lastPublishedSeverity = phase.severity;
  }

  log.info("encore", "tick: escalated notification", {
    obligationId: dsl.id,
    cycleId: state.cycleId,
    stepId: firstMember.stepId,
    from: lastSeverity,
    to: phase.severity,
    notificationId: newId,
    pendingId: ticket.pendingId,
  });
  return true;
}

// ── un-fired collection + bundling ────────────────────────────────

interface UnfiredPair {
  targetId: string;
  stepId: string;
  step: StepState;
  stepDef: StepDef;
  severity: Severity;
  fireDate: string;
}

function collectUnfired(dsl: EncoreDsl, state: CycleState, todayIso: string): UnfiredPair[] {
  const out: UnfiredPair[] = [];
  const stepDefById = new Map(dsl.steps.map((step) => [step.id, step] as const));
  for (const [targetId, record] of Object.entries(state.records)) {
    if (record.status !== "open") continue;
    collectUnfiredForTarget(out, targetId, record.steps, stepDefById, state, todayIso);
  }
  return out;
}

function collectUnfiredForTarget(
  out: UnfiredPair[],
  targetId: string,
  steps: Record<string, StepState>,
  stepDefById: Map<string, StepDef>,
  state: CycleState,
  todayIso: string,
): void {
  for (const [stepId, step] of Object.entries(steps)) {
    if (step.status !== "open") continue;
    if (step.activeNotificationId) continue;
    const stepDef = stepDefById.get(stepId);
    if (!stepDef) continue;
    const phase = currentPhaseFor(stepDef, step, state, todayIso);
    if (!phase) continue;
    out.push({ targetId, stepId, step, stepDef, severity: phase.severity, fireDate: phase.fireDate });
  }
}

interface BundleGroup {
  stepId: string;
  stepDef: StepDef;
  severity: Severity;
  fireDate: string;
  members: { targetId: string; step: StepState }[];
}

function groupForBundling(unfired: UnfiredPair[]): BundleGroup[] {
  const byKey = new Map<string, BundleGroup>();
  for (const pair of unfired) {
    const key = `${pair.stepId} ${pair.severity} ${pair.fireDate}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.members.push({ targetId: pair.targetId, step: pair.step });
    } else {
      byKey.set(key, {
        stepId: pair.stepId,
        stepDef: pair.stepDef,
        severity: pair.severity,
        fireDate: pair.fireDate,
        members: [{ targetId: pair.targetId, step: pair.step }],
      });
    }
  }
  return [...byKey.values()];
}

async function fireGroup(dsl: EncoreDsl, state: CycleState, group: BundleGroup, log: typeof defaultLog): Promise<void> {
  const pendingId = randomUUID();
  const navigateTarget = encoreUrlFor(pendingId);
  const members = group.members.map((member) => ({ targetId: member.targetId, stepId: group.stepId, step: member.step }));
  const title = bundleTitle(dsl, group.stepDef, members);
  const body = bundleBody(dsl, group.stepDef, members);

  const { id: notificationId } = await encoreNotifier.publish({
    severity: group.severity,
    title,
    body,
    navigateTarget,
  });

  const ticket: PendingClearTicket = {
    pendingId,
    obligationId: dsl.id ?? "",
    cycleId: state.cycleId,
    notificationId,
    stepId: group.stepId,
    targets: group.members.map((member) => member.targetId),
    severity: group.severity,
    seedPrompt: buildSeedPrompt(dsl, group, pendingId, state.cycleId),
    createdAt: new Date().toISOString(),
  };
  await writeTicket(ticket);

  // Mutate the live step objects so the cycle state we return
  // carries the new ids.
  for (const member of group.members) {
    member.step.activeNotificationId = notificationId;
    member.step.lastPublishedSeverity = group.severity;
  }

  log.info("encore", "tick: fired bundled notification", {
    obligationId: dsl.id,
    cycleId: state.cycleId,
    stepId: group.stepId,
    severity: group.severity,
    targets: group.members.map((member) => member.targetId),
    notificationId,
    pendingId,
  });
}

// ── phase eval ────────────────────────────────────────────────────

interface ResolvedPhase {
  severity: Severity;
  fireDate: string;
}

function currentPhaseFor(stepDef: StepDef, stepState: StepState, cycleState: CycleState, todayIso: string): ResolvedPhase | null {
  // Resolve each phase's `at` against the cycle + step anchors,
  // walking firingPlan in declared order (which the schema
  // validates is chronological) and picking the latest whose date
  // is ≤ today.
  const anchors = {
    cycleStart: cycleState.cycleStart,
    cycleDeadline: cycleState.cycleDeadline,
    stepDeadline: stepState.stepDeadline,
  };
  let latest: ResolvedPhase | null = null;
  for (const phase of stepDef.firingPlan) {
    let resolved: string;
    try {
      const expr = parseAtExpression(phase.at, { allowStepDeadline: true });
      resolved = resolveAtExpression(expr, anchors);
    } catch {
      continue;
    }
    if (compareIsoDates(resolved, todayIso) <= 0) {
      latest = { severity: phase.severity, fireDate: resolved };
    } else {
      break; // phases are chronological; no later phase fires
    }
  }
  return latest;
}

// ── titles + bodies + seed prompts ────────────────────────────────

function bundleTitle(dsl: EncoreDsl, stepDef: StepDef, members: { targetId: string }[]): string {
  if (members.length === 1) {
    const [{ targetId }] = members;
    const target = dsl.targets.find((entry) => entry.id === targetId);
    return `${dsl.displayName} — ${stepDef.displayName} (${target?.displayName ?? targetId})`;
  }
  return `${dsl.displayName} — ${stepDef.displayName} (${members.length} targets)`;
}

function bundleBody(dsl: EncoreDsl, stepDef: StepDef, members: { targetId: string }[]): string {
  if (members.length === 1) return "";
  const names = members
    .map((member) => {
      const target = dsl.targets.find((entry) => entry.id === member.targetId);
      return target?.displayName ?? member.targetId;
    })
    .join(", ");
  return names;
}

function buildSeedPrompt(dsl: EncoreDsl, group: BundleGroup, pendingId: string, cycleId: string): string {
  const targetLines = group.members
    .map((member) => {
      const target = dsl.targets.find((entry) => entry.id === member.targetId);
      return `- ${target?.displayName ?? member.targetId} (id: ${member.targetId})`;
    })
    .join("\n");
  const fieldList = group.stepDef.fields.length === 0 ? "(no fields to record for this step)" : group.stepDef.fields.map((name) => `- ${name}`).join("\n");

  return [
    `An Encore reminder for the obligation "${dsl.displayName}" (id: ${dsl.id ?? "unknown"}, cycle: ${cycleId}).`,
    "",
    `Step: ${group.stepDef.displayName} (id: ${group.stepId})`,
    `Severity: ${group.severity}. Fire date: ${group.fireDate}.`,
    "",
    `Targets covered by this notification:`,
    targetLines,
    "",
    `Fields to collect on each target's record:`,
    fieldList,
    "",
    `Please help the user record what happened for each target. When done, call manageEncore with the matching kind:`,
    `- kind: "markStepDone" — step is complete (pass any field values you collected via \`values\`)`,
    `- kind: "markTargetSkipped" — user is skipping this target for this cycle`,
    `- kind: "recordValues" — partial info only (no closing)`,
    `- kind: "snooze" — defer the bell entry`,
    "",
    `Pass \`pendingId: "${pendingId}"\` and \`obligationId: "${dsl.id ?? ""}"\` and \`cycleId: "${cycleId}"\` on every call so Encore can clear the bell entry when the cycle progresses.`,
  ].join("\n");
}

// ── ticket I/O ────────────────────────────────────────────────────

async function writeTicket(ticket: PendingClearTicket): Promise<void> {
  await writeText(pendingClearPath(ticket.pendingId), JSON.stringify(ticket, null, 2));
}

async function readTicketForNotification(notificationId: string): Promise<PendingClearTicket | null> {
  // We don't index tickets by notificationId; scan the
  // pending-clear directory. Cardinality is small (one per
  // outstanding bell entry), so a linear scan is fine.
  const entries = await readDir(PENDING_CLEAR_DIRNAME);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const raw = await readTextOrNull(`${PENDING_CLEAR_DIRNAME}/${entry}`);
    if (!raw) continue;
    try {
      const ticket = JSON.parse(raw) as PendingClearTicket;
      if (ticket.notificationId === notificationId) return ticket;
    } catch {
      continue;
    }
  }
  return null;
}

async function pruneOrphanTickets(now: Date, log: typeof defaultLog): Promise<void> {
  const entries = await readDir(PENDING_CLEAR_DIRNAME);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const rel = `${PENDING_CLEAR_DIRNAME}/${entry}`;
    const raw = await readTextOrNull(rel);
    if (!raw) continue;
    let ticket: PendingClearTicket;
    try {
      ticket = JSON.parse(raw) as PendingClearTicket;
    } catch {
      // Unparsable ticket — remove.
      await unlink(rel);
      continue;
    }
    const ageMs = now.getTime() - new Date(ticket.createdAt).getTime();
    if (ageMs > ORPHAN_TICKET_AGE_MS) {
      log.info("encore", "tick: pruning orphan ticket", { pendingId: ticket.pendingId, ageMs });
      await unlink(rel);
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────

function encoreUrlFor(pendingId: string): string {
  return `/encore?pendingId=${encodeURIComponent(pendingId)}`;
}
