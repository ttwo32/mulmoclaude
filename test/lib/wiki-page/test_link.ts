// Unit tests for parseWikiLink + WIKI_LINK_PATTERN.
//
// The renderer, the page resolver, and the lint all route through
// these two exports; bugs here would re-introduce the #1297
// false-positive broken-link warnings, so the cases below cover
// every edge the three consumers care about:
//
//   - plain `[[foo]]` (no pipe)
//   - `[[target|display]]` (canonical aliased form)
//   - `[[|display]]` and `[[target|]]` (empty halves — caller's
//     diagnostic, not the parser's)
//   - whitespace handling (target trimmed, display preserved)
//   - multiple pipes (`[[a|b|c]]` → target "a", display "b|c")
//   - the global-flag regex extracting multiple links per body
//   - bracket-body length cap (200 chars) and newline rejection

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WIKI_LINK_PATTERN, parseWikiLink } from "../../../src/lib/wiki-page/link.js";

describe("parseWikiLink", () => {
  it("returns the same string for both halves when no pipe is present", () => {
    assert.deepEqual(parseWikiLink("foo"), { target: "foo", display: "foo" });
    assert.deepEqual(parseWikiLink("さくら"), { target: "さくら", display: "さくら" });
  });

  it("splits on the first pipe", () => {
    assert.deepEqual(parseWikiLink("foo|Bar Baz"), { target: "foo", display: "Bar Baz" });
    assert.deepEqual(parseWikiLink("keith-rabois-ai-pm-end|キース・ラボイス"), {
      target: "keith-rabois-ai-pm-end",
      display: "キース・ラボイス",
    });
  });

  it("preserves additional pipes in the display half", () => {
    // The display side can legitimately contain `|` characters
    // (e.g. a sub-title separator). Only the first pipe acts as
    // the target/display delimiter.
    assert.deepEqual(parseWikiLink("a|b|c"), { target: "a", display: "b|c" });
  });

  it("trims whitespace on the target but preserves it on the display", () => {
    // A slug-comparable target with surrounding space is always a
    // typo — trim. Display whitespace is intentional formatting.
    assert.deepEqual(parseWikiLink("  foo  |  bar  "), { target: "foo", display: "  bar  " });
  });

  it("exposes empty halves so the caller can diagnose them", () => {
    // `[[|x]]` and `[[y|]]` are malformed but the parser doesn't
    // throw — the lint flags the empty target, the renderer
    // shows the display text.
    assert.deepEqual(parseWikiLink("|orphan"), { target: "", display: "orphan" });
    assert.deepEqual(parseWikiLink("orphan|"), { target: "orphan", display: "" });
    assert.deepEqual(parseWikiLink("|"), { target: "", display: "" });
    assert.deepEqual(parseWikiLink(""), { target: "", display: "" });
  });
});

describe("WIKI_LINK_PATTERN", () => {
  it("captures every `[[...]]` occurrence in a body", () => {
    const body = "see [[foo]] and [[bar|alias]] for context";
    const matches = [...body.matchAll(WIKI_LINK_PATTERN)].map((match) => match[1]);
    assert.deepEqual(matches, ["foo", "bar|alias"]);
  });

  it("does not span newlines (`[[a\\nb]]` is not a link)", () => {
    const matches = [...`[[foo\nbar]]`.matchAll(WIKI_LINK_PATTERN)];
    assert.equal(matches.length, 0);
  });

  it("rejects bracket bodies longer than 200 chars", () => {
    const huge = "x".repeat(201);
    const matches = [...`[[${huge}]]`.matchAll(WIKI_LINK_PATTERN)];
    assert.equal(matches.length, 0);
  });

  it("accepts bracket bodies up to 200 chars", () => {
    const big = "x".repeat(200);
    const matches = [...`[[${big}]]`.matchAll(WIKI_LINK_PATTERN)].map((match) => match[1]);
    assert.deepEqual(matches, [big]);
  });

  it("doesn't match bare `[`/`]` or `[ foo ]`", () => {
    // Only `[[…]]` is a wiki link — single brackets are markdown
    // link syntax and must pass through untouched.
    assert.equal([...`[foo]`.matchAll(WIKI_LINK_PATTERN)].length, 0);
    assert.equal([...`[foo](url)`.matchAll(WIKI_LINK_PATTERN)].length, 0);
  });
});
