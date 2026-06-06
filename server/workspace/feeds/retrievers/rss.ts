// RSS / Atom retriever. Fetches the feed, parses it into
// `ParsedFeedItem[]`, and projects each through `ingest.map`. The map's
// source paths reference parsed-item keys: `feedId`, `title`, `link`,
// `publishedAt`, `summary`, `content`.

import { fetchText } from "../fetch/httpClient.js";
import { parseFeed } from "../fetch/rssParser.js";
import { projectRecord } from "../projectItem.js";
import { registerRetriever, type RetrieveFn } from "./index.js";

const retrieveRss: RetrieveFn = async (ingest, schema) => {
  const body = await fetchText(ingest.url);
  const feed = parseFeed(body);
  if (!feed) return { items: [], cursor: {} };
  const items = feed.items.map((item) => projectRecord(item, ingest, schema));
  return { items, cursor: {} };
};

// Atom shares the same parser + projection path.
registerRetriever("rss", retrieveRss);
registerRetriever("atom", retrieveRss);

export { retrieveRss };
