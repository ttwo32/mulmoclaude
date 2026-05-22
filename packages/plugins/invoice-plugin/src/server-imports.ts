import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

/**
 * Robust helper to dynamically import modules from the host server.
 * Prevents Vite from bundling host modules by using URL paths and @vite-ignore.
 * Supports both development (.ts running in tsx) and production (.js) environments.
 */
export async function importServerModule(relativeModulePath: string): Promise<any> {
  const root = process.cwd();
  const possiblePaths = [
    path.resolve(root, relativeModulePath + ".ts"),
    path.resolve(root, relativeModulePath + ".js"),
    path.resolve(root, relativeModulePath),
  ];

  for (const absPath of possiblePaths) {
    if (existsSync(absPath)) {
      const fileUrl = pathToFileURL(absPath).href;
      return import(/* @vite-ignore */ fileUrl);
    }
  }

  // Fallback directly
  const fileUrl = pathToFileURL(path.resolve(root, relativeModulePath)).href;
  return import(/* @vite-ignore */ fileUrl);
}
