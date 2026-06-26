import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { claudeConfigDir, claudeConfigJson, claudeCredentialsPath, claudeSkillsDir } from "../../server/utils/claudeConfigPath.js";

// Each helper accepts an explicit `override` whose default is the
// frozen `env.claudeConfigDir` / `env.claudeConfigJson` snapshot
// (captured at module load from `process.env.CLAUDE_*`). Passing the
// override directly here exercises the env-set branch without
// requiring a subprocess. The propagation into the Docker bind
// mounts in `buildDockerSpawnArgs` is the existing
// `test_agent_config.ts` "mounts the .claude credentials from the
// home dir" test (line ~378) — that asserts the helper's return
// value lands verbatim in the `-v` arg, which holds regardless of
// whether the value came from env or the homedir fallback.

const FAKE_HOME = "/fake/home/user";
const ENV_DIR = "/sandboxed/claude-config";
const ENV_JSON = "/sandboxed/claude.json";

describe("claudeConfigDir", () => {
  it("defaults to <home>/.claude when override is undefined", () => {
    assert.equal(claudeConfigDir(FAKE_HOME, undefined), join(FAKE_HOME, ".claude"));
  });

  it("returns the override verbatim when set", () => {
    assert.equal(claudeConfigDir(FAKE_HOME, ENV_DIR), ENV_DIR);
  });

  it("override wins over home param", () => {
    assert.equal(claudeConfigDir("/some/other/home", ENV_DIR), ENV_DIR);
  });
});

describe("claudeConfigJson", () => {
  it("defaults to <home>/.claude.json when override is undefined", () => {
    assert.equal(claudeConfigJson(FAKE_HOME, undefined), join(FAKE_HOME, ".claude.json"));
  });

  it("returns the override verbatim when set", () => {
    assert.equal(claudeConfigJson(FAKE_HOME, ENV_JSON), ENV_JSON);
  });
});

describe("claudeCredentialsPath", () => {
  it("derives <claudeConfigDir>/.credentials.json from the default dir", () => {
    assert.equal(claudeCredentialsPath(FAKE_HOME), join(FAKE_HOME, ".claude", ".credentials.json"));
  });

  it("derives <override>/.credentials.json when an override dir is provided", () => {
    assert.equal(claudeCredentialsPath(FAKE_HOME, ENV_DIR), join(ENV_DIR, ".credentials.json"));
  });
});

describe("claudeSkillsDir", () => {
  it("derives <claudeConfigDir>/skills from the default dir", () => {
    assert.equal(claudeSkillsDir(FAKE_HOME), join(FAKE_HOME, ".claude", "skills"));
  });

  it("derives <override>/skills when an override dir is provided", () => {
    assert.equal(claudeSkillsDir(FAKE_HOME, ENV_DIR), join(ENV_DIR, "skills"));
  });
});
