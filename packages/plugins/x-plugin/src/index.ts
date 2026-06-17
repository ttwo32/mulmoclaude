// @mulmoclaude/x-plugin — X (Twitter) API tools.
//
// Two server-only MCP tools (no Vue View): `readXPost` and `searchX`.
// Shared by MulmoClaude and MulmoTerminal so the X integration isn't
// duplicated. Each host imports these objects and slots them into its own
// MCP tool registry; the host gates them on `requiredEnv` and supplies the
// `X_BEARER_TOKEN` env var. All formatting/fetch logic lives here.

import { errorMessage } from "./internal";
import { EXPANSIONS, extractTweetId, fetchX, formatTweet, TWEET_FIELDS, USER_FIELDS, type XApiResponse, type XTweet, type XUser } from "./client";

/** Minimal MCP-tool shape these tools conform to. Structurally compatible
 *  with the host's `McpTool` interface (server/agent/mcp-tools/index.ts), so
 *  a host can drop these straight into its `McpTool[]` registry. */
export interface XTool {
  definition: {
    name: string;
    description: string;
    inputSchema: object;
  };
  requiredEnv: string[];
  prompt: string;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export const readXPost: XTool = {
  definition: {
    name: "readXPost",
    description: "Fetch the content of a single X (Twitter) post by URL or tweet ID. Returns the author, text, and engagement metrics.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full X post URL (https://x.com/user/status/ID) or bare tweet ID.",
        },
      },
      required: ["url"],
    },
  },

  requiredEnv: ["X_BEARER_TOKEN"],

  prompt: "Use the readXPost tool whenever the user shares a URL from x.com or twitter.com.",

  async handler(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url ?? "");
    const tweetId = extractTweetId(url);
    if (!tweetId) return `Could not extract a tweet ID from: ${url}. Provide a full x.com URL or a numeric tweet ID.`;

    let data: XApiResponse;
    try {
      data = await fetchX(`/tweets/${tweetId}?${TWEET_FIELDS}&${EXPANSIONS}&${USER_FIELDS}`);
    } catch (err) {
      return errorMessage(err);
    }

    if (data.errors?.length) return `X API error: ${data.errors.map((err) => err.detail).join("; ")}`;

    const tweet = data.data as XTweet | undefined;
    if (!tweet) return "Tweet not found.";

    const author = data.includes?.users?.find((user) => user.id === tweet.author_id);
    const canonicalUrl = author ? `https://x.com/${author.username}/status/${tweet.id}` : undefined;
    return formatTweet(tweet, author, canonicalUrl);
  },
};

export const searchX: XTool = {
  definition: {
    name: "searchX",
    description: "Search recent X (Twitter) posts by keyword or query. Returns up to max_results posts (default 10, max 100).",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "X search query. Supports operators like from:user, #hashtag, -excludeword.",
        },
        max_results: {
          type: "number",
          description: "Number of results to return (10–100). Defaults to 10.",
        },
        sort_order: {
          type: "string",
          enum: ["recency", "relevancy"],
          description: "'recency' = latest tweets first (default). 'relevancy' = most relevant (Top) first.",
        },
      },
      required: ["query"],
    },
  },

  requiredEnv: ["X_BEARER_TOKEN"],

  prompt: "Use the searchX tool to find recent posts on X by keyword or topic.",

  async handler(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? "").trim();
    if (!query) return "A search query is required.";

    const maxResults = Math.min(100, Math.max(10, Number(args.max_results ?? 10)));

    let data: XApiResponse;
    try {
      const sortOrder = args.sort_order === "relevancy" ? "relevancy" : "recency";
      const params = new URLSearchParams({
        query,
        max_results: String(maxResults),
        sort_order: sortOrder,
      });
      params.append("tweet.fields", "created_at,author_id,public_metrics");
      params.append("expansions", "author_id");
      params.append("user.fields", "name,username");
      data = await fetchX(`/tweets/search/recent?${params.toString()}`);
    } catch (err) {
      return errorMessage(err);
    }

    if (data.errors?.length) return `X API error: ${data.errors.map((err) => err.detail).join("; ")}`;

    const tweets = Array.isArray(data.data) ? data.data : [];
    if (tweets.length === 0) return `No recent posts found for: "${query}"`;

    const users = data.includes?.users ?? [];
    const userMap = new Map<string, XUser>(users.map((user) => [user.id, user]));

    const lines: string[] = [`Search: "${query}" — ${tweets.length} result${tweets.length !== 1 ? "s" : ""}`, ""];
    tweets.forEach((tweet, i) => {
      const author = tweet.author_id ? userMap.get(tweet.author_id) : undefined;
      lines.push(`${i + 1}. ${formatTweet(tweet, author)}`);
      lines.push("");
    });

    return lines.join("\n").trimEnd();
  },
};

export type { XApiResponse, XTweet, XUser } from "./client";
export { extractTweetId, formatTweet, tweetBody } from "./client";
