// Inline slash-command autocomplete for the chat input. When the whole
// input is a bare `/token` (no space yet), the menu lists matching skills
// and the user can filter by typing, navigate with Arrow keys, and pick
// one to populate the textarea (selection populates, it does NOT send).
//
// Data comes from the same `useSkillsList()` module-level store the
// lightbulb Skills tab uses — this composable only owns the open/filter/
// highlight state; the keyboard interception lives in ChatInput so it can
// coordinate with `useImeAwareEnter` before Enter sends.

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type { SkillSummary } from "./useSkillsList";

// Whole input must be a single `/token` with no whitespace. The moment a
// space appears (`/foo `) it's a command-with-args and the menu closes.
const SLASH_QUERY_RE = /^\/(\S*)$/;

/** Returns the query after `/` when the input is a bare `/token`, else null. */
export function parseSlashQuery(value: string): string | null {
  const match = SLASH_QUERY_RE.exec(value);
  return match ? match[1] : null;
}

/** Case-insensitive prefix match on skill name (empty query matches all). */
export function filterSkillsByPrefix(skills: readonly SkillSummary[], query: string): SkillSummary[] {
  const needle = query.toLowerCase();
  return skills.filter((skill) => skill.name.toLowerCase().startsWith(needle));
}

export interface SlashCommandMenu {
  isOpen: ComputedRef<boolean>;
  query: ComputedRef<string | null>;
  items: ComputedRef<SkillSummary[]>;
  highlightedIndex: Ref<number>;
  highlightedSkill: ComputedRef<SkillSummary | null>;
  moveHighlight: (delta: number) => void;
  setHighlight: (index: number) => void;
  dismiss: () => void;
}

export function useSlashCommandMenu(value: Ref<string>, getSkills: () => readonly SkillSummary[]): SlashCommandMenu {
  const dismissed = ref(false);
  const highlightedIndex = ref(0);

  const query = computed(() => parseSlashQuery(value.value));
  const items = computed(() => {
    const prefix = query.value;
    return prefix === null ? [] : filterSkillsByPrefix(getSkills(), prefix);
  });
  const isOpen = computed(() => !dismissed.value && query.value !== null && items.value.length > 0);
  const highlightedSkill = computed(() => items.value[highlightedIndex.value] ?? null);

  // Any keystroke un-dismisses (Escape/blur only suppress until the user
  // types again) and resets the highlight so it never points past the
  // freshly-filtered list. `flush: "sync"` so the reset lands in the same
  // tick as the keystroke — a deferred reset would leave the highlight stale
  // for one frame of navigation.
  watch(
    value,
    () => {
      dismissed.value = false;
      highlightedIndex.value = 0;
    },
    { flush: "sync" },
  );

  function moveHighlight(delta: number): void {
    const count = items.value.length;
    if (count === 0) return;
    highlightedIndex.value = (highlightedIndex.value + delta + count) % count;
  }

  function setHighlight(index: number): void {
    highlightedIndex.value = index;
  }

  function dismiss(): void {
    dismissed.value = true;
  }

  return { isOpen, query, items, highlightedIndex, highlightedSkill, moveHighlight, setHighlight, dismiss };
}
