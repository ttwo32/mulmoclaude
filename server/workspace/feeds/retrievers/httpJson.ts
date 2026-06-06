// Generic JSON-API retriever. Fetches JSON, walks `ingest.itemsAt` to
// the array of raw items, and projects each through `ingest.map` (whose
// source paths are dot/bracket paths into each raw item).

import { fetchJson } from "../fetch/httpClient.js";
import { getItemsArray } from "../pathResolver.js";
import { projectRecord } from "../projectItem.js";
import { registerRetriever, type RetrieveFn } from "./index.js";

const retrieveHttpJson: RetrieveFn = async (ingest, schema) => {
  const json = await fetchJson(ingest.url);
  const rawItems = getItemsArray(json, ingest.itemsAt);
  const items = rawItems.map((raw) => projectRecord(raw, ingest, schema));
  return { items, cursor: {} };
};

registerRetriever("http-json", retrieveHttpJson);

export { retrieveHttpJson };
