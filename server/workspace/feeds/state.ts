// Per-feed retrieval state — when we last fetched, the retriever's
// cursor (for incremental fetches), and a consecutive-failure counter.
// NOT committed to git; lives at `<workspace>/feeds/<slug>/_state.json`.
// Deliberately minimal: the legacy `sources` tree carries richer backoff
// state, but the Feeds engine starts simple and grows on real need.

import { mkdir, readFile } from "node:fs/promises";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { log } from "../../system/logger/index.js";
import { feedDir, feedStatePath } from "./paths.js";

export interface FeedState {
  slug: string;
  /** ISO timestamp of the last successful fetch, or null if never. */
  lastFetchedAt: string | null;
  /** Free-form retriever cursor (e.g. last-seen id / etag). */
  cursor: Record<string, string>;
  /** Consecutive failed fetches; reset to 0 on success. */
  consecutiveFailures: number;
}

export function defaultFeedState(slug: string): FeedState {
  return { slug, lastFetchedAt: null, cursor: {}, consecutiveFailures: 0 };
}

function normalizeState(slug: string, parsed: Partial<FeedState>): FeedState {
  const base = defaultFeedState(slug);
  const cursor = parsed.cursor && typeof parsed.cursor === "object" ? (parsed.cursor as Record<string, string>) : base.cursor;
  return {
    slug,
    lastFetchedAt: typeof parsed.lastFetchedAt === "string" ? parsed.lastFetchedAt : base.lastFetchedAt,
    cursor,
    consecutiveFailures: typeof parsed.consecutiveFailures === "number" ? parsed.consecutiveFailures : base.consecutiveFailures,
  };
}

/** Read a feed's state, tolerating a missing file (first run → default). */
export async function readFeedState(workspaceRoot: string, slug: string): Promise<FeedState> {
  try {
    const raw = await readFile(feedStatePath(slug, workspaceRoot), "utf-8");
    return normalizeState(slug, JSON.parse(raw) as Partial<FeedState>);
  } catch (err) {
    const error = err as { code?: string };
    if (error.code !== "ENOENT") {
      log.warn("feeds", "failed to read feed state, using default", { slug, error: String(err) });
    }
    return defaultFeedState(slug);
  }
}

/** Persist a feed's state atomically (creating the feed dir if needed). */
export async function writeFeedState(workspaceRoot: string, slug: string, state: FeedState): Promise<void> {
  await mkdir(feedDir(slug, workspaceRoot), { recursive: true });
  await writeFileAtomic(feedStatePath(slug, workspaceRoot), `${JSON.stringify(state, null, 2)}\n`);
}
