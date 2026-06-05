import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";
import { parseSlashQuery, filterSkillsByPrefix, useSlashCommandMenu, handleSlashMenuKeydown } from "../../src/composables/useSlashCommandMenu.ts";
import type { SkillSummary } from "../../src/composables/useSkillsList.ts";

interface FakeKeyEvent {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  preventDefault: () => void;
  defaultPrevented: boolean;
}

function fakeKeydown(opts: { key: string; shiftKey?: boolean; isComposing?: boolean }): FakeKeyEvent {
  const evt: FakeKeyEvent = {
    key: opts.key,
    shiftKey: opts.shiftKey ?? false,
    isComposing: opts.isComposing ?? false,
    defaultPrevented: false,
    preventDefault() {
      evt.defaultPrevented = true;
    },
  };
  return evt;
}

const SKILLS: SkillSummary[] = [
  { name: "archive", description: "Archive things", source: "user" },
  { name: "android", description: "Android stuff", source: "project" },
  { name: "publish", description: "Publish a package", source: "user" },
];

describe("parseSlashQuery", () => {
  it("returns the token after a leading slash when there is no space yet", () => {
    assert.equal(parseSlashQuery("/"), "");
    assert.equal(parseSlashQuery("/a"), "a");
    assert.equal(parseSlashQuery("/archive"), "archive");
  });

  it("returns null once a space appears (command-with-args) or no leading slash", () => {
    assert.equal(parseSlashQuery("/foo "), null);
    assert.equal(parseSlashQuery("/foo bar"), null);
    assert.equal(parseSlashQuery("hello"), null);
    assert.equal(parseSlashQuery(" /foo"), null);
    assert.equal(parseSlashQuery(""), null);
  });
});

describe("filterSkillsByPrefix", () => {
  it("matches case-insensitively on the name prefix", () => {
    assert.deepEqual(
      filterSkillsByPrefix(SKILLS, "a").map((skill) => skill.name),
      ["archive", "android"],
    );
    assert.deepEqual(
      filterSkillsByPrefix(SKILLS, "AR").map((skill) => skill.name),
      ["archive"],
    );
  });

  it("returns everything for an empty query and nothing for a non-match", () => {
    assert.equal(filterSkillsByPrefix(SKILLS, "").length, 3);
    assert.equal(filterSkillsByPrefix(SKILLS, "zzz").length, 0);
  });
});

describe("useSlashCommandMenu", () => {
  it("opens only for a bare /token with matches, closes on space or no match", () => {
    const value = ref("");
    const menu = useSlashCommandMenu(value, () => SKILLS);

    assert.equal(menu.isOpen.value, false);

    value.value = "/a";
    assert.equal(menu.isOpen.value, true);
    assert.deepEqual(
      menu.items.value.map((skill) => skill.name),
      ["archive", "android"],
    );

    value.value = "/zzz"; // no match → closed
    assert.equal(menu.isOpen.value, false);

    value.value = "/archive "; // trailing space → command-with-args → closed
    assert.equal(menu.isOpen.value, false);
  });

  it("wraps highlight navigation and resets to the top on a new keystroke", () => {
    const value = ref("/a");
    const menu = useSlashCommandMenu(value, () => SKILLS); // [archive, android]

    assert.equal(menu.highlightedIndex.value, 0);
    menu.moveHighlight(1);
    assert.equal(menu.highlightedSkill.value?.name, "android");
    menu.moveHighlight(1); // wraps back to top
    assert.equal(menu.highlightedSkill.value?.name, "archive");
    menu.moveHighlight(-1); // wraps to bottom
    assert.equal(menu.highlightedSkill.value?.name, "android");

    value.value = "/ar"; // new keystroke resets highlight
    assert.equal(menu.highlightedIndex.value, 0);
  });

  it("stays dismissed until the next keystroke", () => {
    const value = ref("/a");
    const menu = useSlashCommandMenu(value, () => SKILLS);

    assert.equal(menu.isOpen.value, true);
    menu.dismiss();
    assert.equal(menu.isOpen.value, false);

    value.value = "/ar"; // typing un-dismisses
    assert.equal(menu.isOpen.value, true);
  });
});

describe("handleSlashMenuKeydown", () => {
  const neverIme = () => false;

  function harness() {
    const value = ref("/a");
    const menu = useSlashCommandMenu(value, () => SKILLS); // [archive, android]
    const selected: SkillSummary[] = [];
    return { value, menu, selected, onSelect: (skill: SkillSummary) => selected.push(skill) };
  }

  it("ArrowDown/ArrowUp navigate and consume the event", () => {
    const { menu } = harness();
    const down = fakeKeydown({ key: "ArrowDown" });
    assert.equal(handleSlashMenuKeydown(menu, down as unknown as KeyboardEvent, { isImeConfirmation: neverIme, onSelect: () => {} }), true);
    assert.equal(down.defaultPrevented, true);
    assert.equal(menu.highlightedSkill.value?.name, "android");
  });

  it("Enter selects the highlighted skill and consumes the event", () => {
    const { menu, selected, onSelect } = harness();
    const enter = fakeKeydown({ key: "Enter" });
    assert.equal(handleSlashMenuKeydown(menu, enter as unknown as KeyboardEvent, { isImeConfirmation: neverIme, onSelect }), true);
    assert.equal(enter.defaultPrevented, true);
    assert.deepEqual(
      selected.map((skill) => skill.name),
      ["archive"],
    );
  });

  it("Escape dismisses the menu", () => {
    const { menu } = harness();
    const esc = fakeKeydown({ key: "Escape" });
    assert.equal(handleSlashMenuKeydown(menu, esc as unknown as KeyboardEvent, { isImeConfirmation: neverIme, onSelect: () => {} }), true);
    assert.equal(menu.isOpen.value, false);
  });

  it("Shift+Enter is not treated as a selection", () => {
    const { menu, selected, onSelect } = harness();
    const shiftEnter = fakeKeydown({ key: "Enter", shiftKey: true });
    assert.equal(handleSlashMenuKeydown(menu, shiftEnter as unknown as KeyboardEvent, { isImeConfirmation: neverIme, onSelect }), false);
    assert.equal(selected.length, 0);
  });

  it("does NOT select on an IME-confirming Enter (Safari race regression)", () => {
    const { menu, selected, onSelect } = harness();
    // Safari: compositionend already fired, so event.isComposing is false, but
    // isImeConfirmation still flags it. The menu must let it fall through.
    const confirm = fakeKeydown({ key: "Enter", isComposing: false });
    assert.equal(handleSlashMenuKeydown(menu, confirm as unknown as KeyboardEvent, { isImeConfirmation: () => true, onSelect }), false);
    assert.equal(confirm.defaultPrevented, false);
    assert.equal(selected.length, 0);
  });

  it("ignores keys while composing", () => {
    const { menu } = harness();
    const composing = fakeKeydown({ key: "ArrowDown", isComposing: true });
    assert.equal(handleSlashMenuKeydown(menu, composing as unknown as KeyboardEvent, { isImeConfirmation: neverIme, onSelect: () => {} }), false);
  });
});
