// Minimal HTTP client for feed retrievers. Deliberately small: a
// User-Agent, an AbortController timeout, an http(s)-only guard, and an
// `!response.ok` check. It does NOT do robots.txt / per-host rate
// limiting (the legacy `sources` tree does, but we don't import across
// into it). Polite-fetch hardening — robots, rate limit — is a tracked
// follow-up; the engine fetches feeds sequentially to stay gentle.

import { ONE_SECOND_MS } from "../../../utils/time.js";

/** Identifies the bot to site operators. */
export const FEED_USER_AGENT = "MulmoClaude-FeedBot/1.0 (+https://github.com/receptron/mulmoclaude)";

/** Per-request wall-clock cap so a hung server can't wedge a refresh. */
export const DEFAULT_FEED_TIMEOUT_MS = 30 * ONE_SECOND_MS;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`refusing non-http(s) URL: ${url}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`feed fetch timed out after ${timeoutMs}ms`, "TimeoutError")), timeoutMs);
  try {
    return await fetch(url, { headers: { "User-Agent": FEED_USER_AGENT }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a URL as text, throwing on network error or non-2xx. */
export async function fetchText(url: string, timeoutMs: number = DEFAULT_FEED_TIMEOUT_MS): Promise<string> {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
  return response.text();
}

/** Fetch a URL as parsed JSON, throwing on network error or non-2xx. */
export async function fetchJson(url: string, timeoutMs: number = DEFAULT_FEED_TIMEOUT_MS): Promise<unknown> {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
  return response.json();
}
