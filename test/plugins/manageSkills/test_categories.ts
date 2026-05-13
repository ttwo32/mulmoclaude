// Unit tests for the /skills sidebar grouping helpers. These functions
// drive which skills land in which bucket, which group starts collapsed,
// and how the persisted collapse state survives localStorage edge cases.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_LABEL_KEYS,
  COLLAPSED_GROUPS_STORAGE_KEY,
  DEFAULT_CLOSED_CATEGORIES,
  SKILL_CATEGORY_KEYS,
  SYSTEM_SKILL_PREFIX,
  categorizeSkill,
  isSkillCategoryKey,
  loadCollapsedGroups,
  persistCollapsedGroups,
  pickInitialSelection,
} from "../../../src/plugins/manageSkills/categories.js";

// Minimal localStorage shim. Mirrors only the methods the helpers call,
// plus an opt-in `setItemThrows` to exercise the swallow-error path.
function makeStorageShim(options: { setItemThrows?: boolean } = {}) {
  const map = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    setItem(key: string, value: string): void {
      if (options.setItemThrows) throw new Error("quota exceeded");
      map.set(key, value);
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    clear(): void {
      map.clear();
    },
  };
  return { map, storage: storage as unknown as Storage };
}

interface WindowGlobal {
  window?: { localStorage: Storage };
}
const globalRef = globalThis as unknown as WindowGlobal;

describe("manageSkills categorizeSkill", () => {
  it("returns 'user' for user-source skills regardless of name", () => {
    assert.equal(categorizeSkill({ name: "anything", source: "user" }), "user");
    assert.equal(categorizeSkill({ name: "mc-foo", source: "user" }), "user");
  });

  it("returns 'system' for project skills whose name begins with mc-", () => {
    assert.equal(categorizeSkill({ name: "mc-foo", source: "project" }), "system");
    assert.equal(categorizeSkill({ name: "mc-a-b-c", source: "project" }), "system");
  });

  it("returns 'project' for project skills without the mc- prefix", () => {
    assert.equal(categorizeSkill({ name: "foo", source: "project" }), "project");
    assert.equal(categorizeSkill({ name: "my-skill", source: "project" }), "project");
  });

  it("treats names like 'mcfoo' (no dash) as project, not system", () => {
    assert.equal(categorizeSkill({ name: "mcfoo", source: "project" }), "project");
  });

  it("is case-sensitive: 'Mc-foo' is project, not system", () => {
    assert.equal(categorizeSkill({ name: "Mc-foo", source: "project" }), "project");
  });

  it("treats the bare prefix 'mc-' as system", () => {
    assert.equal(categorizeSkill({ name: "mc-", source: "project" }), "system");
  });

  it("treats an empty name + project as project (no prefix match)", () => {
    assert.equal(categorizeSkill({ name: "", source: "project" }), "project");
  });
});

describe("manageSkills isSkillCategoryKey", () => {
  it("accepts the three canonical keys", () => {
    assert.equal(isSkillCategoryKey("system"), true);
    assert.equal(isSkillCategoryKey("project"), true);
    assert.equal(isSkillCategoryKey("user"), true);
  });

  it("rejects unknown strings and non-string values", () => {
    assert.equal(isSkillCategoryKey("System"), false);
    assert.equal(isSkillCategoryKey(""), false);
    assert.equal(isSkillCategoryKey("foo"), false);
    assert.equal(isSkillCategoryKey("builtin"), false);
    assert.equal(isSkillCategoryKey(123), false);
    assert.equal(isSkillCategoryKey(null), false);
    assert.equal(isSkillCategoryKey(undefined), false);
    assert.equal(isSkillCategoryKey({}), false);
  });
});

describe("manageSkills loadCollapsedGroups", () => {
  afterEach(() => {
    delete globalRef.window;
  });

  it("returns the default closed set when window is not defined", () => {
    delete globalRef.window;
    const result = loadCollapsedGroups();
    assert.deepEqual([...result].sort(), [...DEFAULT_CLOSED_CATEGORIES].sort());
  });

  it("returns the default set when nothing is persisted", () => {
    const { storage } = makeStorageShim();
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedGroups();
    assert.deepEqual([...result].sort(), [...DEFAULT_CLOSED_CATEGORIES].sort());
  });

  it("restores the persisted set when JSON is valid and all keys are known", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(["system", "user"]));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedGroups();
    assert.deepEqual([...result].sort(), ["system", "user"]);
  });

  it("filters out unknown keys when the persisted JSON is mixed", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(["system", "wat", "user", 42]));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedGroups();
    assert.deepEqual([...result].sort(), ["system", "user"]);
  });

  it("returns an empty set when the persisted array is empty", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([]));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedGroups();
    assert.equal(result.size, 0);
  });

  it("falls back to defaults when the persisted JSON is corrupted", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_GROUPS_STORAGE_KEY, "{not-json");
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedGroups();
    assert.deepEqual([...result].sort(), [...DEFAULT_CLOSED_CATEGORIES].sort());
  });

  it("migrates the legacy 'builtin' key to 'system' (rename compat)", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(["builtin"]));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedGroups();
    assert.deepEqual([...result].sort(), ["system"]);
  });

  it("migrates 'builtin' alongside current keys without duplicating", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(["builtin", "system", "user"]));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedGroups();
    assert.deepEqual([...result].sort(), ["system", "user"]);
  });

  it("falls back to defaults when the persisted JSON is not an array", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify({ system: true }));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedGroups();
    assert.deepEqual([...result].sort(), [...DEFAULT_CLOSED_CATEGORIES].sort());
  });
});

describe("manageSkills persistCollapsedGroups", () => {
  afterEach(() => {
    delete globalRef.window;
  });

  it("writes a JSON array of category keys to localStorage", () => {
    const { map, storage } = makeStorageShim();
    globalRef.window = { localStorage: storage };
    persistCollapsedGroups(new Set(["system", "user"]));
    const raw = map.get(COLLAPSED_GROUPS_STORAGE_KEY);
    assert.ok(raw, "expected localStorage to have a value at the key");
    const parsed: unknown = JSON.parse(raw);
    assert.ok(Array.isArray(parsed));
    assert.deepEqual([...parsed].sort(), ["system", "user"]);
  });

  it("writes an empty array when the set is empty", () => {
    const { map, storage } = makeStorageShim();
    globalRef.window = { localStorage: storage };
    persistCollapsedGroups(new Set());
    assert.equal(map.get(COLLAPSED_GROUPS_STORAGE_KEY), "[]");
  });

  it("swallows errors when localStorage.setItem throws (quota / private mode)", () => {
    const { storage } = makeStorageShim({ setItemThrows: true });
    globalRef.window = { localStorage: storage };
    assert.doesNotThrow(() => persistCollapsedGroups(new Set(["system"])));
  });

  it("is a no-op when window is undefined", () => {
    delete globalRef.window;
    assert.doesNotThrow(() => persistCollapsedGroups(new Set(["system"])));
  });
});

describe("manageSkills pickInitialSelection", () => {
  const skills = [
    { name: "mc-bundled", source: "project" as const },
    { name: "my-project", source: "project" as const },
    { name: "z-user", source: "user" as const },
  ];

  it("returns null when the skill list is empty", () => {
    assert.equal(pickInitialSelection([], new Set()), null);
  });

  it("picks the first system skill when no groups are collapsed", () => {
    assert.equal(pickInitialSelection(skills, new Set()), "mc-bundled");
  });

  it("skips a collapsed system group and picks the first project skill", () => {
    assert.equal(pickInitialSelection(skills, new Set(["system"])), "my-project");
  });

  it("skips both system and project groups when both are collapsed", () => {
    assert.equal(pickInitialSelection(skills, new Set(["system", "project"])), "z-user");
  });

  it("falls back to the first skill in the list when all groups are collapsed", () => {
    assert.equal(pickInitialSelection(skills, new Set(["system", "project", "user"])), "mc-bundled");
  });

  it("returns the only available category's first skill when others are empty", () => {
    const userOnly = [{ name: "only-one", source: "user" as const }];
    assert.equal(pickInitialSelection(userOnly, new Set()), "only-one");
  });

  it("skips an empty open category and finds the next non-empty open one", () => {
    const noProject = [
      { name: "mc-a", source: "project" as const },
      { name: "u-a", source: "user" as const },
    ];
    assert.equal(pickInitialSelection(noProject, new Set(["system"])), "u-a");
  });
});

describe("manageSkills category constants", () => {
  it("declares the three category keys in the expected order", () => {
    assert.deepEqual([...SKILL_CATEGORY_KEYS], ["system", "project", "user"]);
  });

  it("maps every category to an i18n label key", () => {
    for (const key of SKILL_CATEGORY_KEYS) {
      const label = CATEGORY_LABEL_KEYS[key];
      assert.ok(typeof label === "string" && label.startsWith("pluginManageSkills.category"));
    }
  });

  it("uses the documented localStorage key and mc- prefix", () => {
    assert.equal(COLLAPSED_GROUPS_STORAGE_KEY, "skills:groupCollapsed");
    assert.equal(SYSTEM_SKILL_PREFIX, "mc-");
  });

  it("closes the system category by default", () => {
    assert.deepEqual([...DEFAULT_CLOSED_CATEGORIES], ["system"]);
  });
});
