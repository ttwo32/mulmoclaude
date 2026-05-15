import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { truncate } from "../../server/utils/text.js";

describe("truncate", () => {
  it("returns the input unchanged when shorter than max", () => {
    assert.equal(truncate("hello", 10), "hello");
  });

  it("returns the input unchanged at exactly max", () => {
    assert.equal(truncate("hello", 5), "hello");
  });

  it("truncates with default ellipsis when longer than max", () => {
    assert.equal(truncate("hello world", 8), "hello w…");
    assert.equal(truncate("hello world", 8).length, 8);
  });

  it("reserves the ellipsis length from the slice budget", () => {
    // Naive `slice(0, max) + "…"` would yield length max+1; we want
    // exactly max.
    const out = truncate("0123456789", 5);
    assert.equal(out.length, 5);
    assert.equal(out, "0123…");
  });

  it("honours a custom ellipsis", () => {
    assert.equal(truncate("abcdefghij", 6, "..."), "abc...");
    assert.equal(truncate("abcdefghij", 6, "..."), "abc...");
    assert.equal(truncate("abcdefghij", 6, " (more)"), " (more"); // ellipsis longer than max → ellipsis clipped to max
  });

  it("returns empty string when max <= 0", () => {
    assert.equal(truncate("anything", 0), "");
    assert.equal(truncate("anything", -1), "");
  });

  it("handles empty input", () => {
    assert.equal(truncate("", 5), "");
    assert.equal(truncate("", 0), "");
  });

  it("handles single-character max with multi-char ellipsis", () => {
    assert.equal(truncate("hello", 1, "..."), ".");
  });
});
