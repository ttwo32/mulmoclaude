// Webhook verification helpers for Meta's Send/Receive protocol.
// Extracted into a pure module so the regex + narrowing logic can
// be unit-tested without spinning up the Express server.
//
// **Why the regex exists** (Codex review on #1328): we tried the
// `text/plain` content-type alone — CodeQL still flagged the
// reflected data flow on heuristic grounds, so the
// `js/reflected-xss` alert stayed open. The whitelist below IS the
// CodeQL sanitiser: it narrows `hub.challenge` to a known-shape
// before it ever reaches `res.send()`, which clears the alert and
// gives us defence-in-depth against future regressions.
//
// **Compatibility expectations**: `[A-Za-z0-9_-]{1,256}` matches
// every Meta nonce we've observed (the platform sends
// base64url-shape random tokens, typically ~32 chars). If Meta
// ever extends the format — adds padding, longer length, new
// characters — widen the regex HERE, in one place, and the
// regression test below pins the change so the new shape is the
// EXACT shape we accept.
//
// **Why not just `typeof === "string"`**: that loses the CodeQL
// sanitiser AND lets through HTML-metachar payloads from
// hand-crafted phishing URLs. Even with `text/plain` neutralising
// browser execution, having an input-validation gate is the
// cleaner contract.

export const SAFE_CHALLENGE_RE = /^[A-Za-z0-9_-]{1,256}$/;

/** Returns the challenge string when `raw` matches the shape we'll
 *  echo, or `null` to signal "drop into the verify-failure path".
 *  Non-string types (`?hub.challenge[]=...` array forms etc.)
 *  return `null` rather than coercing to "" so callers can't
 *  accidentally compare `.length > 0` against a coerced empty. */
export function narrowChallenge(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!SAFE_CHALLENGE_RE.test(raw)) return null;
  return raw;
}
