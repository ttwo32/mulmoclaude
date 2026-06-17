import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTweetId, tweetBody, formatTweet } from "../src/index";

test("extractTweetId: full x.com URL", () => {
  assert.equal(extractTweetId("https://x.com/jack/status/20"), "20");
});

test("extractTweetId: twitter.com URL with query", () => {
  assert.equal(extractTweetId("https://twitter.com/user/status/1234567890?s=20"), "1234567890");
});

test("extractTweetId: bare numeric id", () => {
  assert.equal(extractTweetId("987654321"), "987654321");
});

test("extractTweetId: non-status URL returns null", () => {
  assert.equal(extractTweetId("https://x.com/jack"), null);
});

test("tweetBody: note_tweet wins over text", () => {
  assert.equal(tweetBody({ id: "1", text: "short", note_tweet: { text: "the full long-form body" } }), "the full long-form body");
});

test("tweetBody: article.plain_text joins title + body", () => {
  assert.equal(tweetBody({ id: "1", text: "https://t.co/abc", article: { title: "Title", plain_text: "Body." } }), "Title\n\nBody.");
});

test("tweetBody: falls back to text", () => {
  assert.equal(tweetBody({ id: "1", text: "plain tweet" }), "plain tweet");
});

test("formatTweet: byline includes author + UTC date", () => {
  const out = formatTweet(
    { id: "1", text: "hi", created_at: "2026-04-11T08:30:00Z", public_metrics: { like_count: 3, retweet_count: 1, reply_count: 0 } },
    { id: "u1", name: "Jane", username: "jane" },
    "https://x.com/jane/status/1",
  );
  assert.match(out, /^@jane \(Jane\) · 2026-04-11/);
  assert.match(out, /Likes: 3 \| Retweets: 1 \| Replies: 0/);
  assert.match(out, /https:\/\/x\.com\/jane\/status\/1$/);
});
