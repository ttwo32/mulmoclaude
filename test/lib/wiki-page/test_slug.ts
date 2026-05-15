// Unit tests for the shared wiki-page slug helpers. Both
// `server/workspace/wiki-pages/io.ts:classifyAsWikiPage` and the
// hook bundle in `server/workspace/wiki-history/hook/snapshot.ts`
// import from `src/lib/wiki-page/slug.ts`, so pinning the
// behaviour here keeps the two consumers in lockstep without
// duplicating assertions in each consumer's own test file.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isSafeSlug } from "../../../src/lib/wiki-page/slug.js";
import { wikiSlugFromAbsPath } from "../../../src/lib/wiki-page/paths.js";

describe("isSafeSlug", () => {
  it("accepts ordinary slugs", () => {
    assert.equal(isSafeSlug("topic"), true);
    assert.equal(isSafeSlug("topic-with-dash"), true);
    assert.equal(isSafeSlug("topic_with_underscore"), true);
    assert.equal(isSafeSlug("さくらインターネット"), true);
  });

  it("accepts dot-prefixed names (legacy / VCS metadata files)", () => {
    // Codex iter-2 #883: aesthetic concerns are out of scope; the
    // chokepoint must keep accepting `.foo.md` etc.
    assert.equal(isSafeSlug(".foo"), true);
    assert.equal(isSafeSlug("..foo"), true);
  });

  it("rejects empty / dot-only slugs", () => {
    assert.equal(isSafeSlug(""), false);
    assert.equal(isSafeSlug("."), false);
    assert.equal(isSafeSlug(".."), false);
  });

  it("rejects slugs that contain path separators", () => {
    assert.equal(isSafeSlug("foo/bar"), false);
    assert.equal(isSafeSlug("foo\\bar"), false);
  });

  it("rejects slugs containing NUL", () => {
    assert.equal(isSafeSlug("foo\0bar"), false);
  });
});

describe("wikiSlugFromAbsPath", () => {
  const pagesDir = path.join("/tmp", "data", "wiki", "pages");

  it("returns the slug for a direct .md child", () => {
    assert.equal(wikiSlugFromAbsPath(path.join(pagesDir, "topic.md"), pagesDir), "topic");
  });

  it("returns null for nested subdirectories", () => {
    assert.equal(wikiSlugFromAbsPath(path.join(pagesDir, "subdir", "topic.md"), pagesDir), null);
  });

  it("returns null for non-md files inside pages/", () => {
    assert.equal(wikiSlugFromAbsPath(path.join(pagesDir, "topic.txt"), pagesDir), null);
  });

  it("returns null when the path escapes pagesDir via ..", () => {
    assert.equal(wikiSlugFromAbsPath(path.join(pagesDir, "..", "..", "secret.md"), pagesDir), null);
  });

  it("returns null for the pages dir itself", () => {
    assert.equal(wikiSlugFromAbsPath(pagesDir, pagesDir), null);
  });

  it("returns null for paths outside the workspace entirely", () => {
    assert.equal(wikiSlugFromAbsPath("/etc/passwd", pagesDir), null);
  });

  it("accepts page names whose basename starts with `..`", () => {
    // Codex iter-3 #883: a literal `..foo.md` is a single segment
    // and must be allowed.
    assert.equal(wikiSlugFromAbsPath(path.join(pagesDir, "..foo.md"), pagesDir), "..foo");
  });

  it("accepts dot-prefixed legitimate names like `.gitkeep.md`", () => {
    assert.equal(wikiSlugFromAbsPath(path.join(pagesDir, ".gitkeep.md"), pagesDir), ".gitkeep");
  });

  it("returns null for `<pagesDir>/.md` (slug would be empty)", () => {
    assert.equal(wikiSlugFromAbsPath(path.join(pagesDir, ".md"), pagesDir), null);
  });
});
