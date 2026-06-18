// @mulmoclaude/collection-plugin/server — node-only collection engine.
//
// The host server imports from here (storage, validation, discovery, …);
// it is kept separate from the isomorphic `.` entry so the frontend bundle
// never pulls in node:fs. Configure the host binding once at startup:
//   import { configureCollectionHost } from "@mulmoclaude/collection-plugin/server";
//   configureCollectionHost({ workspaceRoot, log });

export { configureCollectionHost, getWorkspaceRoot, log, type CollectionHost, type CollectionLogger } from "./host";
export * from "./paths";
