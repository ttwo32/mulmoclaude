// Pure RSS 2.0 + Atom 1.0 + RSS 1.0 (RDF) parser for the Feeds engine.
//
// This is an OWN COPY of the logic in
// `server/workspace/sources/fetchers/rssParser.ts` — the Feeds tree
// deliberately does not import across into the legacy `sources` tree
// (they evolve independently; sources is slated for retirement). Output
// shape is format-agnostic: RSS and Atom both resolve into the same
// `ParsedFeedItem[]`, which `ingest.map` then projects via field paths
// (`title`, `link`, `publishedAt`, `summary`, `content`, `feedId`).
//
// Pure — no I/O. Unit-testable with fixture strings.

import { XMLParser } from "fast-xml-parser";
import { isNonEmptyString, isRecord } from "../../../utils/types.js";

export interface ParsedFeedItem {
  /** Best-effort stable identity from the feed: RSS <guid>, Atom <id>,
   *  else <link>. Map this to the schema's primaryKey via `idFrom`. */
  feedId: string | null;
  title: string;
  link: string | null;
  /** ISO 8601 when parseable, else the raw date string. */
  publishedAt: string | null;
  /** Short description (RSS <description> / Atom <summary>). May be HTML. */
  summary: string | null;
  /** Full body when the feed provides one separately. */
  content: string | null;
}

export interface ParsedFeed {
  kind: "rss" | "atom";
  title: string | null;
  items: ParsedFeedItem[];
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

/** Parse an RSS/Atom/RDF feed body. Returns null when the input doesn't
 *  look like a feed we understand. */
export function parseFeed(body: string): ParsedFeed | null {
  const text = stripBom(body);
  if (!text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = xml.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (isRecord(parsed.rss)) return parseRss(parsed.rss);
  if (isRecord(parsed.feed)) return parseAtom(parsed.feed);
  const rdf = parsed["rdf:RDF"] ?? parsed.RDF;
  if (isRecord(rdf)) return parseRss10(rdf);
  return null;
}

// --- RSS 2.0 ------------------------------------------------------------

function parseRss(rss: Record<string, unknown>): ParsedFeed | null {
  const { channel } = rss;
  if (!isRecord(channel)) return null;
  const rawItems = Array.isArray(channel.item) ? channel.item : [];
  const items: ParsedFeedItem[] = [];
  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const parsed = parseRssItem(raw);
    if (parsed) items.push(parsed);
  }
  return { kind: "rss", title: readString(channel.title), items };
}

function parseRssItem(raw: Record<string, unknown>): ParsedFeedItem | null {
  const title = readString(raw.title);
  const guid = readString(raw.guid);
  const link = readString(raw.link);
  const publishedAt = normalizeDate(readString(raw.pubDate));
  const content = readString(raw["content:encoded"]) ?? readString(raw.encoded);
  const summary = readString(raw.description) ?? content;
  if (!title) return null;
  return { feedId: guid ?? link ?? null, title, link, publishedAt, summary, content };
}

// --- RSS 1.0 (RDF) ------------------------------------------------------

function parseRss10(rdf: Record<string, unknown>): ParsedFeed | null {
  const rawItems = Array.isArray(rdf.item) ? rdf.item : [];
  const items: ParsedFeedItem[] = [];
  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const parsed = parseRssItem(raw);
    if (parsed) items.push(parsed);
  }
  const channel = isRecord(rdf.channel) ? rdf.channel : null;
  return { kind: "rss", title: channel ? readString(channel.title) : null, items };
}

// --- Atom 1.0 -----------------------------------------------------------

function parseAtom(feed: Record<string, unknown>): ParsedFeed | null {
  const rawEntries = Array.isArray(feed.entry) ? feed.entry : [];
  const items: ParsedFeedItem[] = [];
  for (const raw of rawEntries) {
    if (!isRecord(raw)) continue;
    const parsed = parseAtomEntry(raw);
    if (parsed) items.push(parsed);
  }
  return { kind: "atom", title: readString(feed.title), items };
}

function parseAtomEntry(raw: Record<string, unknown>): ParsedFeedItem | null {
  const title = readString(raw.title);
  const entryId = readString(raw.id);
  const link = resolveAtomLink(raw.link);
  const published = readString(raw.published) ?? readString(raw.updated) ?? null;
  const publishedAt = published ? normalizeDate(published) : null;
  const content = readString(raw.content);
  const summary = readString(raw.summary) ?? content;
  if (!title) return null;
  return { feedId: entryId ?? link ?? null, title, link, publishedAt, summary, content };
}

function resolveAtomLink(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  const candidates = Array.isArray(raw) ? raw : [raw];
  let fallback: string | null = null;
  for (const candidate of candidates) {
    const outcome = classifyAtomLinkCandidate(candidate);
    if (outcome.kind === "alternate") return outcome.href;
    if (outcome.kind === "fallback") fallback ??= outcome.href;
  }
  return fallback;
}

type AtomLinkOutcome = { kind: "alternate"; href: string } | { kind: "fallback"; href: string } | { kind: "skip" };

function classifyAtomLinkCandidate(candidate: unknown): AtomLinkOutcome {
  if (isNonEmptyString(candidate)) return { kind: "fallback", href: candidate };
  if (!isRecord(candidate)) return { kind: "skip" };
  const href = readString(candidate["@_href"]);
  if (!href) return { kind: "skip" };
  const rel = readString(candidate["@_rel"]);
  if (rel === "alternate" || rel === null) return { kind: "alternate", href };
  return { kind: "fallback", href };
}

// --- helpers ------------------------------------------------------------

function readString(value: unknown): string | null {
  if (isNonEmptyString(value)) return value;
  if (typeof value === "string") return null;
  if (isRecord(value)) return readStringFromRecord(value);
  if (Array.isArray(value)) return readStringFromArray(value);
  return null;
}

function readStringFromRecord(record: Record<string, unknown>): string | null {
  const text = record["#text"];
  if (isNonEmptyString(text)) return text;
  const cdata = record["#cdata"];
  if (isNonEmptyString(cdata)) return cdata;
  return null;
}

function readStringFromArray(array: readonly unknown[]): string | null {
  for (const entry of array) {
    const resolved = readString(entry);
    if (resolved !== null) return resolved;
  }
  return null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return raw;
}
