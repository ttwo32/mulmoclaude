// HTTP route for the data-source Feeds registry — a single MCP-friendly
// dispatch endpoint (mirrors manageSource). Every action returns the
// full feed list as `data` so the canvas View re-renders without a
// separate fetch.
//
//   POST /api/feeds/manage   body: { action, slug?, schema? }
//     action="list"     → all registered feeds
//     action="register" → validate + persist a feed schema, fetch once
//     action="refresh"  → fetch one feed now
//     action="remove"   → delete a feed (records retained)
//
// A "feed" is a CollectionSchema-with-`ingest` stored under
// <workspace>/feeds/<slug>/; records are stored + rendered by the
// collections layer. This route owns only registry CRUD + retrieval
// triggering — all file I/O goes through the feeds domain modules.

import { Router, Request, Response } from "express";
import { workspacePath } from "../../workspace/workspace.js";
import { log } from "../../system/logger/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { bindRoute } from "../../utils/router.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { badRequest } from "../../utils/httpError.js";
import { listFeeds, readFeedState, refreshOne, removeFeed, writeFeed } from "../../workspace/feeds/index.js";
import { loadCollection } from "../../workspace/collections/index.js";

const router = Router();

interface FeedSummary {
  slug: string;
  title: string;
  icon: string;
  kind: string;
  schedule: string;
  lastFetchedAt: string | null;
}
interface FeedRefreshSummary {
  slug: string;
  written: number;
  errors: string[];
}
interface ManageFeedData {
  feeds: FeedSummary[];
  highlightSlug?: string;
  lastRefresh?: FeedRefreshSummary;
}
interface ManageFeedSuccess {
  message: string;
  instructions: string;
  // Omitted by `register` — it returns only a confirmation message, not
  // the full feed list (avoids echoing the registry back into context
  // and a redundant canvas render). list / refresh / remove include it.
  data?: ManageFeedData;
}
interface ErrorResponse {
  error: string;
}
interface ManageFeedBody {
  action?: unknown;
  slug?: unknown;
  schema?: unknown;
}

type FeedRes = Response<ManageFeedSuccess | ErrorResponse>;

async function buildSummaries(): Promise<FeedSummary[]> {
  const feeds = await listFeeds(workspacePath);
  const summaries: FeedSummary[] = [];
  for (const feed of feeds) {
    const state = await readFeedState(workspacePath, feed.slug);
    const { ingest } = feed.schema;
    summaries.push({
      slug: feed.slug,
      title: feed.schema.title,
      icon: feed.schema.icon,
      kind: ingest?.kind ?? "rss",
      schedule: ingest?.schedule ?? "on-demand",
      lastFetchedAt: state.lastFetchedAt,
    });
  }
  return summaries;
}

async function respondWithList(res: FeedRes, message: string, extra: Partial<ManageFeedData> = {}): Promise<void> {
  const feeds = await buildSummaries();
  res.json({ message, instructions: "The current data-source feeds are now displayed in the canvas.", data: { feeds, ...extra } });
}

// Load a feed by slug and fetch it now. Returns undefined when the slug
// names no feed (or names a non-feed skill collection).
async function refreshNow(slug: string): Promise<FeedRefreshSummary | undefined> {
  const collection = await loadCollection(slug);
  if (!collection || !collection.schema.ingest) return undefined;
  const result = await refreshOne(workspacePath, collection);
  return { slug: result.slug, written: result.written, errors: result.errors };
}

async function handleRegister(body: ManageFeedBody, res: FeedRes): Promise<void> {
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) {
    badRequest(res, "slug is required for action='register'");
    return;
  }
  if (!body.schema || typeof body.schema !== "object") {
    badRequest(res, "schema (a CollectionSchema with an `ingest` block) is required for action='register'");
    return;
  }
  const result = await writeFeed(workspacePath, slug, body.schema);
  if (result.kind === "error") {
    badRequest(res, result.message);
    return;
  }
  log.info("feeds", "feed registered (manage)", { slug: result.slug });
  const lastRefresh = await refreshNow(result.slug);
  // Register returns ONLY a confirmation message — no `data`. The records
  // render at /feeds/<slug>; call action='list' to show the registry.
  res.json({
    message: registerMessage(result.slug, lastRefresh),
    instructions: `Feed "${result.slug}" is registered; its records render at /feeds/${result.slug}. Call action='list' to display the full feed registry in the canvas.`,
  });
}

// Surface the first-fetch outcome in the register message so the model
// gets one-call confirmation that records actually arrived (or why not).
function registerMessage(slug: string, lastRefresh: FeedRefreshSummary | undefined): string {
  if (!lastRefresh) return `Registered feed "${slug}".`;
  if (lastRefresh.errors.length > 0) return `Registered feed "${slug}", but the first fetch failed: ${lastRefresh.errors[0]}`;
  return `Registered feed "${slug}" and fetched ${lastRefresh.written} record(s).`;
}

async function handleRefresh(body: ManageFeedBody, res: FeedRes): Promise<void> {
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) {
    badRequest(res, "slug is required for action='refresh'");
    return;
  }
  const summary = await refreshNow(slug);
  if (!summary) {
    badRequest(res, `no feed '${slug}' is registered`);
    return;
  }
  await respondWithList(res, `Refreshed feed "${slug}": ${summary.written} record(s).`, { lastRefresh: summary });
}

async function handleRemove(body: ManageFeedBody, res: FeedRes): Promise<void> {
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) {
    badRequest(res, "slug is required for action='remove'");
    return;
  }
  const removed = await removeFeed(workspacePath, slug);
  await respondWithList(res, removed ? `Removed feed "${slug}" (records retained).` : `No feed "${slug}" to remove.`);
}

const MANAGE_ACTIONS = new Set(["list", "register", "refresh", "remove"]);

bindRoute(
  router,
  API_ROUTES.feeds.manage,
  asyncHandler<Request<object, unknown, ManageFeedBody>, FeedRes>("feeds", "manageFeed dispatch failed", async (req, res) => {
    const action = req.body?.action;
    if (typeof action !== "string" || !MANAGE_ACTIONS.has(action)) {
      badRequest(res, `action must be one of: ${[...MANAGE_ACTIONS].join(", ")}`);
      return;
    }
    switch (action) {
      case "list":
        await respondWithList(res, "Loaded data-source feeds.");
        return;
      case "register":
        await handleRegister(req.body, res);
        return;
      case "refresh":
        await handleRefresh(req.body, res);
        return;
      case "remove":
        await handleRemove(req.body, res);
    }
  }),
);

export default router;
