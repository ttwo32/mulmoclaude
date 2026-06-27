// @mulmoclaude/core/feeds — isomorphic surface of the Feeds module: the
// declarative ingest vocabulary + types. Safe to import from a browser bundle
// (no node-only I/O). The path helpers import `node:path`, so they stay on the
// dedicated `@mulmoclaude/core/feeds/paths` subpath rather than this browser-safe
// barrel; the retrieval engine + host DI live on `@mulmoclaude/core/feeds/server`.

export * from "./ingestTypes.js";
