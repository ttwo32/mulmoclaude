// Self-contained ports of the few host utilities the X tools relied on,
// inlined so the package carries no dependency on MulmoClaude's server tree
// (server/utils/{errors,fetch,http,date,time}). Kept faithful to the
// originals; see the matching files in the host repo for rationale.

export const ONE_SECOND_MS = 1_000;

/** Human-readable message from an unknown thrown value.
 *  Mirrors server/utils/errors.ts `errorMessage`. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err !== null && typeof err === "object") {
    const obj = err as { details?: unknown; message?: unknown };
    if (typeof obj.details === "string" && obj.details) return obj.details;
    if (typeof obj.message === "string" && obj.message) return obj.message;
  }
  return String(err);
}

/** Best-effort response body text, capped, never throwing.
 *  Mirrors server/utils/http.ts `safeResponseText`. */
export async function safeResponseText(res: Response, maxLength = 200): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, maxLength);
  } catch {
    return "";
  }
}

/** `Date` → `YYYY-MM-DD` in UTC. Mirrors server/utils/date.ts `toUtcIsoDate`. */
export function toUtcIsoDate(timestamp: Date): string {
  const year = timestamp.getUTCFullYear();
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
  const day = String(timestamp.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type FetchWithTimeoutInit = Parameters<typeof fetch>[1] & { timeoutMs?: number };

/** `fetch` with a finite timeout that aborts the request once `timeoutMs`
 *  elapses. Compact port of server/utils/fetch.ts `fetchWithTimeout` — the X
 *  tools never pass a caller signal, so the external-signal bridging is omitted. */
export async function fetchWithTimeout(url: string | URL, init: FetchWithTimeoutInit = {}): Promise<Response> {
  const { timeoutMs = 10 * ONE_SECOND_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`fetch timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
