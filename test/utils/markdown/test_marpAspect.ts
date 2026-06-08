import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SLIDE_ASPECT, extractSlideAspect } from "../../../src/utils/markdown/marpAspect.js";

function svg(width: number, height: number): string {
  return `<svg viewBox="0 0 ${width} ${height}"></svg>`;
}

describe("extractSlideAspect — happy path", () => {
  it("16:9 default → 720/1280", () => {
    assert.equal(extractSlideAspect(svg(1280, 720)), 720 / 1280);
  });

  it("4:3 → 720/960", () => {
    assert.equal(extractSlideAspect(svg(960, 720)), 720 / 960);
  });

  it("portrait 9:16 → 1920/1080", () => {
    assert.equal(extractSlideAspect(svg(1080, 1920)), 1920 / 1080);
  });
});

describe("extractSlideAspect — clamp & fallback", () => {
  it("falls back to 16:9 when no viewBox", () => {
    assert.equal(extractSlideAspect("<div>no svg here</div>"), DEFAULT_SLIDE_ASPECT);
  });

  it("falls back when width or height is zero", () => {
    assert.equal(extractSlideAspect(svg(0, 720)), DEFAULT_SLIDE_ASPECT);
    assert.equal(extractSlideAspect(svg(1280, 0)), DEFAULT_SLIDE_ASPECT);
  });

  it("falls back for super-wide ratios (< 0.2 = 1:5)", () => {
    assert.equal(extractSlideAspect(svg(99999, 100)), DEFAULT_SLIDE_ASPECT);
  });

  it("falls back for extreme portrait ratios (> 5 = 5:1)", () => {
    assert.equal(extractSlideAspect(svg(100, 99999)), DEFAULT_SLIDE_ASPECT);
    assert.equal(extractSlideAspect(svg(1, 6)), DEFAULT_SLIDE_ASPECT);
  });

  it("honours sensible ratios at the boundary", () => {
    // 1:5 = 0.2 (allowed boundary) → keep
    assert.equal(extractSlideAspect(svg(1000, 200)), 0.2);
    // 5:1 = 5.0 (allowed boundary) → keep
    assert.equal(extractSlideAspect(svg(200, 1000)), 5);
  });

  it("picks up the FIRST viewBox in a multi-slide HTML", () => {
    const html = `${svg(960, 720)} body ${svg(1280, 720)}`;
    assert.equal(extractSlideAspect(html), 720 / 960);
  });
});
