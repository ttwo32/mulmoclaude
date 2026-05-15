import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderWikiLinks } from "../../../src/plugins/wiki/helpers.js";

describe("renderWikiLinks", () => {
  it("replaces a simple wiki link", () => {
    assert.equal(renderWikiLinks("See [[Home]] for details."), 'See <span class="wiki-link" data-page="Home">Home</span> for details.');
  });

  it("replaces multiple wiki links in one string", () => {
    assert.equal(renderWikiLinks("[[a]] and [[b]]"), '<span class="wiki-link" data-page="a">a</span> and <span class="wiki-link" data-page="b">b</span>');
  });

  it("leaves content without wiki links unchanged", () => {
    assert.equal(renderWikiLinks("just prose"), "just prose");
  });

  it("returns empty string for empty input", () => {
    assert.equal(renderWikiLinks(""), "");
  });

  it("leaves an empty bracket pair untouched", () => {
    // The old regex required at least one non-`]` char between
    // `[[` and `]]`. An empty `[[]]` is malformed and stays as-is.
    assert.equal(renderWikiLinks("[[]]"), "[[]]");
  });

  it("leaves a bare `[[` with no closing `]]` as literal text", () => {
    assert.equal(renderWikiLinks("open [[ but no close"), "open [[ but no close");
  });

  it("leaves `[[foo]bar]]` as literal — page name cannot contain `]`", () => {
    // The old `[^\]]+` made `]` illegal in the capture group;
    // the overall regex didn't match so the string was unchanged.
    assert.equal(renderWikiLinks("x [[foo]bar]] y"), "x [[foo]bar]] y");
  });

  it("handles triple brackets the same way the old regex did", () => {
    // `[[[foo]]]` → the old regex matched `[[[foo]]` greedily so
    // the page name became `[foo` (including the third `[`) and
    // the last `]` remained as trailing text. Preserve that quirk.
    assert.equal(renderWikiLinks("[[[foo]]]"), '<span class="wiki-link" data-page="[foo">[foo</span>]');
  });

  it("handles wiki links with spaces in the page name", () => {
    assert.equal(renderWikiLinks("[[My Page]]"), '<span class="wiki-link" data-page="My Page">My Page</span>');
  });

  it("handles adjacent wiki links with no separator", () => {
    assert.equal(renderWikiLinks("[[a]][[b]]"), '<span class="wiki-link" data-page="a">a</span><span class="wiki-link" data-page="b">b</span>');
  });

  it("preserves surrounding markdown syntax", () => {
    assert.equal(renderWikiLinks("- item: [[x]]"), '- item: <span class="wiki-link" data-page="x">x</span>');
  });

  // ── [[target|display]] alias form (#1297) ─────────────────────

  it("splits `[[slug|display]]` into data-page=slug + visible display", () => {
    // Pre-#1297 the whole bracket body went into both attributes, so
    // a click navigated to `/wiki/pages/keith-rabois-...|キース...`
    // (the resolver's fuzzy match still found the file but the URL
    // was ugly and the lint flagged the link as broken).
    assert.equal(
      renderWikiLinks("[[keith-rabois-ai-pm-end|キース・ラボイス]]"),
      '<span class="wiki-link" data-page="keith-rabois-ai-pm-end">キース・ラボイス</span>',
    );
  });

  it("trims whitespace on the target, preserves it on the display", () => {
    assert.equal(renderWikiLinks("[[  foo  |  Bar  ]]"), '<span class="wiki-link" data-page="foo">  Bar  </span>');
  });

  it("preserves additional pipes in the display half (only first pipe splits)", () => {
    // A display string can legitimately contain `|` (sub-title
    // separator etc.). Only the first pipe acts as the
    // target/display delimiter.
    assert.equal(renderWikiLinks("[[a|b|c]]"), '<span class="wiki-link" data-page="a">b|c</span>');
  });

  // ── XSS escaping (Codex review on PR #1312) ───────────────────

  it("HTML-escapes the target (attribute context)", () => {
    // A wiki page author writing `[[foo"onclick=alert(1)//]]` would
    // otherwise break out of the `data-page="…"` attribute and
    // execute the handler when the user clicks anything. Escape
    // before interpolation.
    assert.equal(
      renderWikiLinks(`[[foo"onclick=alert(1)//]]`),
      '<span class="wiki-link" data-page="foo&quot;onclick=alert(1)//">foo&quot;onclick=alert(1)//</span>',
    );
  });

  it("HTML-escapes the display (text context)", () => {
    // Same threat at the inner-text position — `[[foo|<img src=x onerror=alert(1)>]]`
    // would inject the img tag and execute the handler. Escape `<`/`>`
    // (and `&`) so the markup renders as plain text.
    assert.equal(renderWikiLinks("[[foo|<img src=x onerror=alert(1)>]]"), '<span class="wiki-link" data-page="foo">&lt;img src=x onerror=alert(1)&gt;</span>');
  });

  it("HTML-escapes `&` so existing entities aren't doubled (target + display)", () => {
    assert.equal(renderWikiLinks("[[a&b|c&d]]"), '<span class="wiki-link" data-page="a&amp;b">c&amp;d</span>');
  });
});
