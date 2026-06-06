// Side-effect import that registers every built-in retriever. Import
// this once (the engine does) before dispatching on `ingest.kind`.

import "./rss.js";
import "./httpJson.js";
