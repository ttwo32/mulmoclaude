// Wire @mulmoclaude/collection-plugin/server to MulmoClaude's workspace +
// logger. Imported for side effect at the very top of server/index.ts so the
// binding is set before any collection storage operation runs. MulmoTerminal
// has its own equivalent shim.
import { configureCollectionHost } from "@mulmoclaude/collection-plugin/server";
import { workspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";

configureCollectionHost({ workspaceRoot: workspacePath, log });
