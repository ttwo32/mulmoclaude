// Pure helpers behind the /skills page sidebar grouping. Lifted out of
// View.vue so the categorization rule (mc- prefix split, user/project
// source mapping) lives in exactly one place and can be unit-tested in
// node:test without a DOM or a Vue runtime.

import type { SkillSummary } from "./index";

// categorizeSkill / pickInitialSelection only care about name + source,
// not description. Exposing a narrower input type lets unit tests build
// fixtures without padding placeholder descriptions everywhere.
export type SkillIdentity = Pick<SkillSummary, "name" | "source">;

export const SKILL_CATEGORY_KEYS = ["system", "project", "user"] as const;
export type SkillCategoryKey = (typeof SKILL_CATEGORY_KEYS)[number];

// `mc-` is the launcher-managed namespace (see
// server/workspace/skills-preset.ts). Skills under this prefix are
// shipped with mulmoclaude and overwritten on every boot, so the UI
// treats them as the "system" category and gates editing accordingly.
// Matches the wording used for system-origin tasks on /automations.
export const SYSTEM_SKILL_PREFIX = "mc-";
export const COLLAPSED_GROUPS_STORAGE_KEY = "skills:groupCollapsed";
export const DEFAULT_CLOSED_CATEGORIES: readonly SkillCategoryKey[] = ["system"];

export const CATEGORY_LABEL_KEYS: Record<SkillCategoryKey, string> = {
  system: "pluginManageSkills.categorySystem",
  project: "pluginManageSkills.categoryProject",
  user: "pluginManageSkills.categoryUser",
};

/** Group a skill into one of the three buckets shown in the sidebar. */
export function categorizeSkill(skill: SkillIdentity): SkillCategoryKey {
  if (skill.source === "user") return "user";
  if (skill.name.startsWith(SYSTEM_SKILL_PREFIX)) return "system";
  return "project";
}

/**
 * @internal exported only so the unit tests can target the type guard
 * directly. Not part of the View-layer helper surface; call sites
 * should reach the guard via loadCollapsedGroups instead.
 */
export function isSkillCategoryKey(value: unknown): value is SkillCategoryKey {
  return typeof value === "string" && (SKILL_CATEGORY_KEYS as readonly string[]).includes(value);
}

/** Read the persisted collapse state, falling back to defaults on any error. */
export function loadCollapsedGroups(): Set<SkillCategoryKey> {
  const defaults = new Set<SkillCategoryKey>(DEFAULT_CLOSED_CATEGORIES);
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
    if (raw === null) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    // Migrate the legacy "builtin" key to "system" so users who collapsed
    // that group before the rename keep their preference instead of being
    // silently reset on next load.
    const migrated = parsed.map((value) => (value === "builtin" ? "system" : value));
    return new Set<SkillCategoryKey>(migrated.filter(isSkillCategoryKey));
  } catch {
    return defaults;
  }
}

/** Persist the collapse state. Failures (e.g. localStorage disabled) are swallowed. */
export function persistCollapsedGroups(state: ReadonlySet<SkillCategoryKey>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([...state]));
  } catch {
    // localStorage may be unavailable (private mode) — swallow silently.
  }
}

/**
 * Pick the first skill whose category is currently open, so the sidebar
 * never auto-selects a row hidden under a collapsed header. Falls back to
 * the very first skill if every group is collapsed.
 */
export function pickInitialSelection(skillList: readonly SkillIdentity[], collapsed: ReadonlySet<SkillCategoryKey>): string | null {
  if (skillList.length === 0) return null;
  for (const key of SKILL_CATEGORY_KEYS) {
    if (collapsed.has(key)) continue;
    const firstInCategory = skillList.find((skill) => categorizeSkill(skill) === key);
    if (firstInCategory) return firstInCategory.name;
  }
  return skillList[0].name;
}
