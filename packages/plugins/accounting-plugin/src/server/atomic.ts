// Self-contained file-I/O primitives for the accounting backend.
//
// Reimplemented inside the package (rather than injected) because they
// are small and generic — owning them keeps the host-injection surface
// down to the truly host-specific bits (workspace root, pub/sub,
// logger). Mirrors the host's server/utils/files/{atomic,json,safe}.ts:
// atomic write = tmp file alongside destination + rename (readers never
// see a half-written file).

import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface WriteAtomicOptions {
  /** Adds a unique suffix to the tmp filename so concurrent writers to
   *  the same destination don't collide at the OS layer. */
  uniqueTmp?: boolean;
}

/** True for a `not found` filesystem error. */
export function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "ENOENT";
}

/** Atomic write: tmp alongside destination, then rename. */
export async function writeFileAtomic(filePath: string, content: string, opts: WriteAtomicOptions = {}): Promise<void> {
  const tmp = opts.uniqueTmp ? `${filePath}.${randomUUID()}.tmp` : `${filePath}.tmp`;
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fsPromises.writeFile(tmp, content, { encoding: "utf-8" });
    await fsPromises.rename(tmp, filePath);
  } catch (err) {
    await fsPromises.unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Atomic JSON write (2-space indent), the only serialization shape the
 *  accounting io layer needs. */
export async function writeJsonAtomic(filePath: string, data: unknown, opts: WriteAtomicOptions = {}): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2), opts);
}
