import type { ToolDefinition } from "gui-chat-protocol";
import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";

export const TOOL_NAME = META.toolName;
export type FeedsEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description:
    "Manage the user's data-source FEEDS — recurring retrievals of internet data (RSS/Atom news, podcasts, or any JSON API that returns an ARRAY of objects) that land in a self-refreshing collection. A feed is registered ONCE as data (stored under <workspace>/feeds/, NOT as a skill, so it does not bloat the prompt) and the host re-fetches it on a schedule. Records render in the standard collection view at /collections/<slug>. " +
    "After every action the response carries the current feed list so the canvas can re-render; call action='list' to display it.\n\n" +
    "REGISTER takes `slug` + a `schema` that is a CollectionSchema PLUS an `ingest` block. The schema shape is STRICT — follow it exactly:\n" +
    "- `primaryKey` (string, required): the name of the id field.\n" +
    "- `fields` (object, required): a MAP keyed by field name — NOT an array. Each value is `{ type, label, primary? }`. Exactly one field sets `primary: true` and its key must equal `primaryKey`.\n" +
    "- `type` MUST be one of: string, text, email, number, date, boolean, markdown, enum. (There is no 'url'/'datetime'/'textarea' — use string for links, date for timestamps, text/markdown for bodies.)\n" +
    "- `title` (string, required): human-facing name. `icon` and `dataPath` are OPTIONAL — omit them and the host defaults icon to a feed glyph and dataPath to `data/feeds/<slug>`.\n" +
    "- `ingest`: { kind, url, schedule, map, itemsAt?, idFrom? }. kind = 'rss'|'atom' (XML) or 'http-json' (JSON array). schedule = 'hourly'|'daily'|'weekly'|'on-demand'. map = { <targetField>: <sourcePath> }: for rss/atom the source paths are parsed-item keys (feedId, title, link, publishedAt, summary, content); for http-json they are dot/bracket paths into each item (e.g. 'name', 'data.id'). itemsAt (http-json only) is the dot/bracket path to the items array, e.g. 'results[]' (omit when the response itself is the array). idFrom (optional) supplies a stable id source (e.g. 'feedId') when the mapped primaryKey is empty.\n\n" +
    "Map the primaryKey from a STABLE unique value (RSS guid/link, or a snapshot date) so re-fetches upsert in place. Keep display fields (title, time, name) as their own fields. Canonical RSS example:\n" +
    '{ "title": "NYT World", "primaryKey": "id",\n' +
    '  "fields": { "id": {"type":"string","label":"ID","primary":true}, "title": {"type":"string","label":"Title"}, "link": {"type":"string","label":"Link"}, "publishedAt": {"type":"date","label":"Published"}, "summary": {"type":"markdown","label":"Summary"} },\n' +
    '  "ingest": { "kind":"rss", "url":"https://rss.nytimes.com/.../World.xml", "schedule":"hourly", "idFrom":"feedId", "map": {"id":"feedId","title":"title","link":"link","publishedAt":"publishedAt","summary":"summary"} } }\n\n' +
    "NOTE: http-json needs an array of objects. Columnar/parallel-array APIs (e.g. Open-Meteo weather: hourly.time[] + hourly.temperature_2m[]) are NOT supported yet — don't register those.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "register", "refresh", "remove"],
        description:
          "What to do. 'list' = show all feeds. 'register' = add/replace a feed (needs slug + schema). 'refresh' = fetch one feed now (needs slug). 'remove' = delete a feed by slug (its records are retained).",
      },
      slug: {
        type: "string",
        description:
          "Feed slug (lowercase letters/digits/hyphens). Required for register / refresh / remove. Becomes the feed directory name and the collection's URL slug.",
      },
      schema: {
        type: "object",
        description:
          "Required for action='register'. A CollectionSchema-with-`ingest` object. `fields` is a MAP keyed by field name (not an array); field types are limited to string/text/email/number/date/boolean/markdown/enum; `title` + `primaryKey` + `ingest` are required; `icon`/`dataPath` are optional (auto-defaulted). See the tool description for the full shape and a worked example. Validated server-side; a malformed schema is rejected with a message.",
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
