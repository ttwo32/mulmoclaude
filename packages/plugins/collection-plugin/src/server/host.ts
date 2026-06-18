// Host binding for the server-side collection engine.
//
// The engine is parameterized over the host's workspace + services, but
// threading those through every call would be invasive. Instead each host
// (MulmoClaude, MulmoTerminal) configures the binding ONCE at startup via
// `configureCollectionHost`, and the engine reads it through the getters
// below. This keeps the existing call sites (which default to the live
// workspace root) unchanged while removing the package's dependency on
// host-only modules (`server/workspace/workspace.ts`, the host logger).

/** Logger shape the engine logs through — matches the host `Logger`
 *  (prefix, message, optional structured data). */
export interface CollectionLogger {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  info: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => void;
}

export interface CollectionHost {
  /** Absolute path to the host workspace root (e.g. `~/mulmoclaude`). The
   *  default root for every path/containment check that isn't given an
   *  explicit override. */
  workspaceRoot: string;
  /** Host logger; the engine logs under the `"collections"` prefix. */
  log: CollectionLogger;
}

let current: CollectionHost | null = null;

/** Wire the engine to a host. Call once at server startup, before any
 *  collection storage operation. */
export function configureCollectionHost(host: CollectionHost): void {
  current = host;
}

function requireHost(): CollectionHost {
  if (current === null) {
    throw new Error("@mulmoclaude/collection-plugin/server: configureCollectionHost() was not called by the host");
  }
  return current;
}

/** The configured workspace root. Throws if the host never configured one. */
export function getWorkspaceRoot(): string {
  return requireHost().workspaceRoot;
}

/** Logger proxy so engine modules can `import { log }` and use it exactly
 *  like the host logger — each call resolves the live host binding. */
export const log: CollectionLogger = {
  error: (prefix, message, data) => requireHost().log.error(prefix, message, data),
  warn: (prefix, message, data) => requireHost().log.warn(prefix, message, data),
  info: (prefix, message, data) => requireHost().log.info(prefix, message, data),
  debug: (prefix, message, data) => requireHost().log.debug(prefix, message, data),
};
