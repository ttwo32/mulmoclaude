// Unit tests for `claudeBinPath()` cross-platform resolution. The
// helper accepts injectable `platform` / `spawnSync` / `existsSync` /
// `env` so we can simulate every install layout without actually
// having `@anthropic-ai/claude-code` on disk.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { claudeBinPath, type ResolveOptions } from "../../server/utils/claudeBin.js";

// All probed paths in claudeBin.ts use `path.win32`, so tests must
// compose / normalise expected paths the same way to compare equal
// regardless of which OS the test runner is on.
const winPath = path.win32;

const FAKE_NPM_PREFIX = "C:\\Users\\test\\AppData\\Roaming\\npm";
const FAKE_YARN_BIN = "C:\\Users\\test\\AppData\\Local\\Yarn\\bin";
const NPM_CLAUDE_EXE = winPath.join(FAKE_NPM_PREFIX, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
const YARN_CLAUDE_EXE = winPath.join(
  "C:\\Users\\test\\AppData\\Local\\Yarn",
  "config",
  "global",
  "node_modules",
  "@anthropic-ai",
  "claude-code",
  "bin",
  "claude.exe",
);

interface FakeSpawnCase {
  readonly command: string;
  readonly stdout: string;
  readonly status?: number;
}

function makeSpawnSync(cases: readonly FakeSpawnCase[]): typeof import("node:child_process").spawnSync {
  return ((cmd: string): SpawnSyncReturns<string> => {
    const hit = cases.find((entry) => entry.command === cmd);
    if (!hit) return { pid: 0, output: [], stdout: "", stderr: "", status: 1, signal: null };
    return { pid: 0, output: [], stdout: hit.stdout, stderr: "", status: hit.status ?? 0, signal: null };
  }) as never;
}

function makeExistsSync(existingPaths: readonly string[]): typeof import("node:fs").existsSync {
  const set = new Set(existingPaths.map((candidate) => winPath.normalize(candidate)));
  return ((candidate: string | URL | Buffer): boolean => {
    if (typeof candidate !== "string") return false;
    return set.has(winPath.normalize(candidate));
  }) as typeof import("node:fs").existsSync;
}

function commonOpts(overrides: Partial<ResolveOptions> = {}): ResolveOptions {
  return {
    platform: "win32",
    env: {},
    resetCache: true,
    spawnSync: makeSpawnSync([]),
    existsSync: makeExistsSync([]),
    ...overrides,
  };
}

describe("claudeBinPath — non-Windows", () => {
  it("returns the literal 'claude' on darwin", () => {
    assert.equal(claudeBinPath({ platform: "darwin", resetCache: true }), "claude");
  });

  it("returns the literal 'claude' on linux", () => {
    assert.equal(claudeBinPath({ platform: "linux", resetCache: true }), "claude");
  });

  it("never probes spawnSync on non-Windows (no install required)", () => {
    let calls = 0;
    const spawnSync = ((cmd: string): SpawnSyncReturns<string> => {
      calls++;
      return { pid: 0, output: [], stdout: "", stderr: "", status: 0, signal: null, command: cmd } as never;
    }) as never;
    claudeBinPath({ platform: "darwin", spawnSync, resetCache: true });
    assert.equal(calls, 0);
  });
});

describe("claudeBinPath — Windows resolution", () => {
  it("resolves via `where claude.cmd` (npm layout: bin/claude.cmd sibling of node_modules)", () => {
    const claudeCmd = winPath.join(FAKE_NPM_PREFIX, "claude.cmd");
    const opts = commonOpts({
      spawnSync: makeSpawnSync([{ command: "where", stdout: `${claudeCmd}\r\n` }]),
      existsSync: makeExistsSync([NPM_CLAUDE_EXE]),
    });
    assert.equal(claudeBinPath(opts), NPM_CLAUDE_EXE);
  });

  it("resolves via `where claude.cmd` (yarn layout: walk up to find node_modules)", () => {
    // Yarn classic puts claude.cmd in AppData\Local\Yarn\bin\ but the
    // real package lives in AppData\Local\Yarn\config\global\node_modules\…
    // — two directories above bin/.
    const claudeCmd = winPath.join(FAKE_YARN_BIN, "claude.cmd");
    const opts = commonOpts({
      spawnSync: makeSpawnSync([{ command: "where", stdout: claudeCmd }]),
      existsSync: makeExistsSync([YARN_CLAUDE_EXE]),
    });
    assert.equal(claudeBinPath(opts), YARN_CLAUDE_EXE);
  });

  it("falls back to `npm config get prefix` when `where` returns nothing", () => {
    const opts = commonOpts({
      spawnSync: makeSpawnSync([
        { command: "where", stdout: "", status: 1 },
        { command: "npm", stdout: `${FAKE_NPM_PREFIX}\r\n` },
      ]),
      existsSync: makeExistsSync([NPM_CLAUDE_EXE]),
    });
    assert.equal(claudeBinPath(opts), NPM_CLAUDE_EXE);
  });

  it("falls back to %APPDATA%\\npm default when neither `where` nor `npm` produce a hit", () => {
    const opts = commonOpts({
      spawnSync: makeSpawnSync([]),
      existsSync: makeExistsSync([NPM_CLAUDE_EXE]),
      env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
    });
    assert.equal(claudeBinPath(opts), NPM_CLAUDE_EXE);
  });

  it("throws a descriptive error listing every probed path when nothing is found", () => {
    const opts = commonOpts({
      env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
    });
    assert.throws(
      () => claudeBinPath(opts),
      (err: Error) => {
        assert.match(err.message, /claude CLI binary not found/);
        assert.match(err.message, /Install with: npm install -g @anthropic-ai\/claude-code/);
        assert.match(err.message, /AppData\\Roaming\\npm/);
        assert.match(err.message, /Yarn\\config\\global/);
        assert.match(err.message, /pnpm/);
        return true;
      },
    );
  });
});

describe("claudeBinPath — caching", () => {
  it("caches the resolved path on Windows — second call doesn't re-probe", () => {
    let spawnCalls = 0;
    const spawnSync = ((cmd: string): SpawnSyncReturns<string> => {
      spawnCalls++;
      if (cmd === "where") {
        return { pid: 0, output: [], stdout: winPath.join(FAKE_NPM_PREFIX, "claude.cmd"), stderr: "", status: 0, signal: null } as never;
      }
      return { pid: 0, output: [], stdout: "", stderr: "", status: 1, signal: null } as never;
    }) as never;
    const opts = commonOpts({
      spawnSync,
      existsSync: makeExistsSync([NPM_CLAUDE_EXE]),
      resetCache: true,
    });
    assert.equal(claudeBinPath(opts), NPM_CLAUDE_EXE);
    const callsAfterFirst = spawnCalls;
    // Second call without resetCache should hit the module-level cache.
    assert.equal(claudeBinPath({ ...opts, resetCache: false }), NPM_CLAUDE_EXE);
    assert.equal(spawnCalls, callsAfterFirst, "spawnSync should NOT be called again after the first resolution");
  });
});
