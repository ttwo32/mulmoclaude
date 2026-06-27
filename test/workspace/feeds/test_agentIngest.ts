import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { refreshViaAgent, setAgentWorkerRunner, type AgentWorkerResult } from "../../../server/workspace/feeds/agentIngest.js";
import { readFeedState } from "../../../server/workspace/feeds/state.js";
import { _setFilePathsForTesting, initNotifier } from "../../../server/notifier/engine.js";
import type { LoadedCollection } from "../../../server/workspace/collections/index.js";

// The failure path publishes/clears a notifier bell — point the engine at temp
// files and inject a no-op pub-sub so publish/clear don't throw in tests.
function configureTempNotifier(): void {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-ingest-notifier-"));
  _setFilePathsForTesting({ active: path.join(dir, "active.json"), history: path.join(dir, "history.json") });
  initNotifier({ publish: () => {} });
}

// Hand-build a skill-backed collection with agent ingest. `withTemplate`
// controls whether the on-disk template exists (the missing-template path).
function makeAgentCollection(root: string, slug: string, withTemplate: boolean): LoadedCollection {
  const skillDir = path.join(root, ".claude", "skills", slug);
  const dataDir = path.join(root, "data", slug);
  mkdirSync(dataDir, { recursive: true });
  if (withTemplate) {
    mkdirSync(path.join(skillDir, "templates"), { recursive: true });
    writeFileSync(path.join(skillDir, "templates", "refresh.md"), "Refresh each record. Edit and stop.\n");
  }
  return {
    slug,
    source: "user",
    schema: {
      title: "Quotes",
      icon: "trending_up",
      dataPath: `data/${slug}`,
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
      ingest: { kind: "agent", schedule: "daily", role: "investor", template: "templates/refresh.md" },
    },
    dataDir,
    skillDir,
  } as unknown as LoadedCollection;
}

beforeEach(() => {
  configureTempNotifier();
});

describe("refreshViaAgent — dispatch", () => {
  it("dispatches a worker and stamps lastFetchedAt on a successful launch", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-ingest-"));
    const collection = makeAgentCollection(root, "quotes-ok", true);
    let seenRole: string | null = null;
    let seenHidden: boolean | undefined;
    setAgentWorkerRunner(async (args): Promise<AgentWorkerResult> => {
      seenRole = args.roleId;
      seenHidden = args.hidden;
      return { ok: true, chatId: "chat-1" };
    });

    const result = await refreshViaAgent(root, collection);
    assert.equal(result.dispatched, true);
    assert.equal(result.errors.length, 0);
    assert.equal(seenRole, "investor", "worker runs in the ingest role");
    assert.equal(seenHidden, true, "scheduled refresh runs a hidden worker by default");

    const state = await readFeedState(root, collection);
    assert.ok(state.lastFetchedAt, "lastFetchedAt stamped at dispatch time");
  });

  it("runs a VISIBLE worker with no completion hook when hidden:false (manual Refresh)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-ingest-"));
    const collection = makeAgentCollection(root, "quotes-manual", true);
    let seenHidden: boolean | undefined;
    let seenOnComplete: unknown = "unset";
    setAgentWorkerRunner(async (args): Promise<AgentWorkerResult> => {
      seenHidden = args.hidden;
      seenOnComplete = args.onComplete;
      return { ok: true, chatId: "chat-manual" };
    });

    const result = await refreshViaAgent(root, collection, { hidden: false });
    assert.equal(result.dispatched, true);
    assert.equal(seenHidden, false, "manual refresh runs a visible session");
    assert.equal(seenOnComplete, undefined, "a visible run carries no completion hook (the user watches it)");
  });

  it("leaves state untouched and reports the error on a cap-miss", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-ingest-"));
    const collection = makeAgentCollection(root, "quotes-cap", true);
    setAgentWorkerRunner(async (): Promise<AgentWorkerResult> => ({ ok: false, error: "too many background sessions" }));

    const result = await refreshViaAgent(root, collection);
    assert.equal(result.dispatched, false);
    assert.equal(result.errors.length, 1);

    const state = await readFeedState(root, collection);
    assert.equal(state.lastFetchedAt, null, "no dispatch ⇒ no lastFetchedAt, so the next tick retries");
  });

  it("reports a missing template without dispatching", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-ingest-"));
    const collection = makeAgentCollection(root, "quotes-notmpl", false);
    let launched = false;
    setAgentWorkerRunner(async (): Promise<AgentWorkerResult> => {
      launched = true;
      return { ok: true, chatId: "chat-x" };
    });

    const result = await refreshViaAgent(root, collection);
    assert.equal(result.dispatched, undefined);
    assert.equal(result.errors.length, 1);
    assert.equal(launched, false, "no worker launched when the template can't be read");
  });
});

describe("refreshViaAgent — completion outcome", () => {
  it("increments consecutiveFailures and raises a bell on error, then clears on success", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-ingest-"));
    const collection = makeAgentCollection(root, "quotes-outcome", true);
    let onComplete: ((o: { didError: boolean }) => void | Promise<void>) | undefined;
    setAgentWorkerRunner(async (args): Promise<AgentWorkerResult> => {
      ({ onComplete } = args);
      return { ok: true, chatId: "chat-2" };
    });

    await refreshViaAgent(root, collection);
    assert.ok(onComplete, "runner received an onComplete hook");

    // Worker failed.
    await onComplete?.({ didError: true });
    let state = await readFeedState(root, collection);
    assert.equal(state.consecutiveFailures, 1);
    assert.ok(state.failureBellId, "a failure bell id is persisted");

    // A second failure doesn't pile up a second bell.
    const firstBell = state.failureBellId;
    await onComplete?.({ didError: true });
    state = await readFeedState(root, collection);
    assert.equal(state.consecutiveFailures, 2);
    assert.equal(state.failureBellId, firstBell, "same bell, deduped");

    // Worker succeeded → counter resets and the bell clears.
    await onComplete?.({ didError: false });
    state = await readFeedState(root, collection);
    assert.equal(state.consecutiveFailures, 0);
    assert.equal(state.failureBellId, undefined, "bell cleared on success");
  });
});
