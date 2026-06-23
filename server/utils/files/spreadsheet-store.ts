import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { shortId } from "../id.js";
import { writeFileAtomic } from "./atomic.js";
import { yearMonthUtc } from "./naming.js";
import { makeStoreResolvers } from "./store-resolvers.js";

const resolvers = makeStoreResolvers(() => WORKSPACE_PATHS.spreadsheets, WORKSPACE_DIRS.spreadsheets);

// #764 sharded under spreadsheets/YYYY/MM/ (UTC) so the dir doesn't grow unbounded; #881 atomic.
export async function saveSpreadsheet(sheets: unknown[]): Promise<string> {
  const partition = yearMonthUtc();
  const filename = `${shortId()}.json`;
  const absPath = path.join(WORKSPACE_PATHS.spreadsheets, partition, filename);
  await writeFileAtomic(absPath, JSON.stringify(sheets));
  return path.posix.join(WORKSPACE_DIRS.spreadsheets, partition, filename);
}

export async function overwriteSpreadsheet(relativePath: string, sheets: unknown[]): Promise<void> {
  const absPath = await resolvers.forWrite(relativePath);
  await writeFileAtomic(absPath, JSON.stringify(sheets));
}

// Reject "spreadsheets/../outside.json" early; realpath check still runs server-side, but catch obvious cases here.
export function isSpreadsheetPath(value: string): boolean {
  if (!value.startsWith(`${WORKSPACE_DIRS.spreadsheets}/`)) return false;
  if (!value.endsWith(".json")) return false;
  const normalized = path.posix.normalize(value);
  if (normalized !== value) return false;
  if (normalized.includes("..")) return false;
  return true;
}
