// Regression tests for the WhatsApp webhook verify-challenge
// narrowing helper. Pins both directions per Codex's review on
// #1328: accepted forms (Meta's known nonce shapes) must continue
// to verify, rejected forms (anything outside the regex) must NOT
// be echoed back so the `js/reflected-xss` sanitiser holds.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { narrowChallenge, SAFE_CHALLENGE_RE } from "../../../../packages/bridges/whatsapp/src/verify.js";

describe("WhatsApp narrowChallenge — accepted forms", () => {
  it("typical Meta nonce (alphanumeric, ~32 chars)", () => {
    assert.equal(narrowChallenge("ABC123xyz789"), "ABC123xyz789");
  });

  it("base64url shape (alphanumeric + _ + -)", () => {
    assert.equal(narrowChallenge("aB-cD_eF1"), "aB-cD_eF1");
  });

  it("single char (minimum length)", () => {
    assert.equal(narrowChallenge("a"), "a");
  });

  it("256-char string (current upper bound)", () => {
    const long = "a".repeat(256);
    assert.equal(narrowChallenge(long), long);
  });
});

describe("WhatsApp narrowChallenge — rejected forms", () => {
  it("rejects empty string", () => {
    assert.equal(narrowChallenge(""), null);
  });

  it("rejects beyond 256 chars (length cap)", () => {
    assert.equal(narrowChallenge("a".repeat(257)), null);
  });

  it("rejects non-string types (number, undefined, null)", () => {
    assert.equal(narrowChallenge(123), null);
    assert.equal(narrowChallenge(undefined), null);
    assert.equal(narrowChallenge(null), null);
  });

  it("rejects array (defeats `?hub.challenge[]=...` bypass)", () => {
    // Express parses `?hub.challenge=a&hub.challenge=b` as an
    // array. The narrowing must NOT toString-coerce that — the
    // string check at the top of narrowChallenge catches it.
    assert.equal(narrowChallenge(["abc"]), null);
  });

  it("rejects HTML-meta / XSS probe payloads", () => {
    assert.equal(narrowChallenge("<script>alert(1)</script>"), null);
    // eslint-disable-next-line no-script-url -- payload fixture, asserting it is REJECTED
    assert.equal(narrowChallenge("javascript:alert(1)"), null);
    assert.equal(narrowChallenge('" onload="evil"'), null);
  });

  it("rejects characters outside the base64url alphabet", () => {
    // Padding `=`, traditional base64 `+`/`/`, whitespace, etc.
    // are not in the regex by design. If Meta ever sends these,
    // widen `SAFE_CHALLENGE_RE` and add a positive test above.
    assert.equal(narrowChallenge("abc="), null);
    assert.equal(narrowChallenge("a+b"), null);
    assert.equal(narrowChallenge("a/b"), null);
    assert.equal(narrowChallenge("with space"), null);
    assert.equal(narrowChallenge("with\nnewline"), null);
  });

  it("rejects non-ASCII characters", () => {
    assert.equal(narrowChallenge("café"), null);
    assert.equal(narrowChallenge("日本語"), null);
  });
});

describe("WhatsApp SAFE_CHALLENGE_RE — anchor sanity", () => {
  it("regex is fully anchored (no partial match leakage)", () => {
    // Without `^` / `$` anchors, a payload like
    // `abc<script>` would substring-match `abc`. The anchored
    // form below + the test above pins this contract.
    assert.equal(SAFE_CHALLENGE_RE.source.startsWith("^"), true);
    assert.equal(SAFE_CHALLENGE_RE.source.endsWith("$"), true);
  });
});
