// Regression tests for the Messenger webhook verify-challenge
// narrowing helper. Mirrors `test_verify.ts` in the WhatsApp
// bridge because Meta's Send/Receive verification protocol is
// shared — both bridges must accept and reject the same shapes.
// (Codex review on #1328.)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { narrowChallenge, SAFE_CHALLENGE_RE } from "../../../../packages/bridges/messenger/src/verify.js";

describe("Messenger narrowChallenge — accepted forms", () => {
  it("typical Meta nonce (alphanumeric)", () => {
    assert.equal(narrowChallenge("ABC123xyz789"), "ABC123xyz789");
  });

  it("base64url shape", () => {
    assert.equal(narrowChallenge("aB-cD_eF1"), "aB-cD_eF1");
  });

  it("256-char string (current upper bound)", () => {
    const long = "a".repeat(256);
    assert.equal(narrowChallenge(long), long);
  });
});

describe("Messenger narrowChallenge — rejected forms", () => {
  it("rejects empty string", () => {
    assert.equal(narrowChallenge(""), null);
  });

  it("rejects beyond 256 chars", () => {
    assert.equal(narrowChallenge("a".repeat(257)), null);
  });

  it("rejects non-string types", () => {
    assert.equal(narrowChallenge(123), null);
    assert.equal(narrowChallenge(undefined), null);
    assert.equal(narrowChallenge(null), null);
    assert.equal(narrowChallenge(["abc"]), null);
  });

  it("rejects HTML-meta / XSS probe payloads", () => {
    assert.equal(narrowChallenge("<script>alert(1)</script>"), null);
    // eslint-disable-next-line no-script-url -- payload fixture, asserting it is REJECTED
    assert.equal(narrowChallenge("javascript:alert(1)"), null);
  });

  it("rejects characters outside the base64url alphabet", () => {
    assert.equal(narrowChallenge("abc="), null);
    assert.equal(narrowChallenge("a+b"), null);
    assert.equal(narrowChallenge("with space"), null);
  });
});

describe("Messenger SAFE_CHALLENGE_RE — anchor sanity", () => {
  it("regex is fully anchored", () => {
    assert.equal(SAFE_CHALLENGE_RE.source.startsWith("^"), true);
    assert.equal(SAFE_CHALLENGE_RE.source.endsWith("$"), true);
  });
});
