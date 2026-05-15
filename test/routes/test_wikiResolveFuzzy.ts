// Unit tests for the score-based fuzzy match used by
// `resolvePagePath` in `server/api/routes/wiki.ts` (#1194).
//
// Pins three properties of the new resolver:
//
//   1. Slugs shorter than `MIN_FUZZY_SLUG_LEN` (6 chars) skip fuzzy
//      altogether — protects against the CJK-stripped noise tail
//      that originally motivated the issue.
//   2. The candidate whose key is closest in length (= highest
//      `min/max` score) wins. Iteration order does not.
//   3. Ties at the top score return null — the caller falls back to
//      its index.md title-match path rather than silently picking
//      whichever Map entry came first.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pickFuzzyMatch } from "../../server/api/routes/wiki.js";

describe("pickFuzzyMatch — wiki resolvePagePath fuzzy fallback (#1194)", () => {
  it("returns the unique candidate when only one slug fuzzy-matches", () => {
    const slugs = new Map([
      ["foobar", "foobar.md"],
      ["unrelated", "unrelated.md"],
    ]);
    // `bar` length 3 — under MIN_FUZZY_SLUG_LEN, so even a real
    // match would skip. Use a longer slug that still triggers fuzzy.
    assert.equal(pickFuzzyMatch("foobar-page", slugs), "foobar.md");
  });

  it("returns null when the slug is shorter than MIN_FUZZY_SLUG_LEN", () => {
    const slugs = new Map([
      ["foobar", "foobar.md"],
      ["barbaz", "barbaz.md"],
    ]);
    // 3-char slug `bar` is `includes`-contained in both keys but
    // semantically meaningless — skip fuzzy entirely.
    assert.equal(pickFuzzyMatch("bar", slugs), null);
    // Same for `bars` (4) and `barfo` (5) — all below the gate.
    assert.equal(pickFuzzyMatch("bars", slugs), null);
    assert.equal(pickFuzzyMatch("barfo", slugs), null);
    // 6 chars passes the gate — `barbaz` is an exact hit which the
    // resolver normally handles before fuzzy, but here we're driving
    // the picker directly, so the score path returns it.
    assert.equal(pickFuzzyMatch("barbaz", slugs), "barbaz.md");
  });

  it("picks the candidate whose key is closest in length to the slug", () => {
    // slug = `chromium-test` (13 chars).
    //  - key `chromium-test-page` (18) → score 13/18 ≈ 0.72
    //  - key `chromium-test-extra-suffix-noise` (32) → score 13/32 ≈ 0.41
    // The closer-length candidate must win regardless of map order.
    const slugs = new Map([
      ["chromium-test-extra-suffix-noise", "noisy.md"],
      ["chromium-test-page", "close.md"],
    ]);
    assert.equal(pickFuzzyMatch("chromium-test", slugs), "close.md");
  });

  it("is order-independent (regression: original bug was iteration-first)", () => {
    // Same inputs as above but the Map is constructed in the opposite
    // order. The pre-fix code returned the FIRST inserted key that
    // partial-matched; the fixed code picks the higher score either way.
    const slugs = new Map([
      ["chromium-test-page", "close.md"],
      ["chromium-test-extra-suffix-noise", "noisy.md"],
    ]);
    assert.equal(pickFuzzyMatch("chromium-test", slugs), "close.md");
  });

  it("returns null on a tie at the top score (caller falls back to title-match)", () => {
    // slug `target-page` length 11.
    //  - key `target-page-foo` (15) → 11/15 ≈ 0.733
    //  - key `bar-target-page` (15) → 11/15 ≈ 0.733
    // Same score → ambiguous → null (better than silent wrong page).
    const slugs = new Map([
      ["target-page-foo", "left.md"],
      ["bar-target-page", "right.md"],
    ]);
    assert.equal(pickFuzzyMatch("target-page", slugs), null);
  });

  it("returns null when no key fuzzy-matches", () => {
    const slugs = new Map([
      ["alpha", "alpha.md"],
      ["beta", "beta.md"],
    ]);
    assert.equal(pickFuzzyMatch("gamma-delta", slugs), null);
  });

  it("handles an empty slugs index", () => {
    assert.equal(pickFuzzyMatch("anything-long", new Map()), null);
  });
});
