// Unit tests for `resolveWriteWithinRoot` — the write-time
// confinement helper added in #1754. Its read-time sibling
// `resolveWithinRoot` cannot be used to pre-validate a not-yet-
// written path, because the `realpathSync` boundary check throws
// ENOENT on a missing leaf and the wrapper collapses ENOENT and
// "genuine traversal escape" into the same null return (#1744).

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, stat, symlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveWriteWithinRoot } from "../../../server/utils/files/safe.ts";

let rootDir: string;
let rootReal: string;

before(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "mulmoclaude-write-helper-"));
  rootReal = await realpath(rootDir);
});

after(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

describe("resolveWriteWithinRoot — happy path", () => {
  it("returns the absolute path inside root for a flat leaf", async () => {
    const got = await resolveWriteWithinRoot(rootReal, "file.txt");
    assert.equal(got, path.join(rootReal, "file.txt"));
  });

  it("mkdir-p's the parent for a nested leaf", async () => {
    const got = await resolveWriteWithinRoot(rootReal, "a/b/c/file.txt");
    assert.equal(got, path.join(rootReal, "a", "b", "c", "file.txt"));
    const parentStat = await stat(path.join(rootReal, "a", "b", "c"));
    assert.ok(parentStat.isDirectory(), "parent dir was created on disk");
  });

  it("accepts a leaf whose parent already exists", async () => {
    await mkdir(path.join(rootReal, "existing"), { recursive: true });
    const got = await resolveWriteWithinRoot(rootReal, "existing/file.txt");
    assert.equal(got, path.join(rootReal, "existing", "file.txt"));
  });
});

describe("resolveWriteWithinRoot — rejects", () => {
  it("rejects empty input", async () => {
    assert.equal(await resolveWriteWithinRoot(rootReal, ""), null);
  });

  it("rejects an absolute path", async () => {
    assert.equal(await resolveWriteWithinRoot(rootReal, "/etc/passwd"), null);
  });

  it("rejects a `..` segment", async () => {
    assert.equal(await resolveWriteWithinRoot(rootReal, "../escape.txt"), null);
    assert.equal(await resolveWriteWithinRoot(rootReal, "a/../b/escape.txt"), null);
  });

  it("rejects a `.` segment", async () => {
    assert.equal(await resolveWriteWithinRoot(rootReal, "./file.txt"), null);
  });

  it("rejects a NUL byte", async () => {
    assert.equal(await resolveWriteWithinRoot(rootReal, "a\0b.txt"), null);
  });

  it("rejects double-slashed paths (empty segment)", async () => {
    assert.equal(await resolveWriteWithinRoot(rootReal, "a//b.txt"), null);
  });
});

describe("resolveWriteWithinRoot — symlink defense", () => {
  let escapeTarget: string;
  let escapeReal: string;

  beforeEach(async () => {
    escapeTarget = await mkdtemp(path.join(tmpdir(), "mulmoclaude-escape-target-"));
    escapeReal = await realpath(escapeTarget);
  });

  it("rejects writes whose parent realpath escapes root via symlink", async () => {
    const symlinkDirInRoot = path.join(rootReal, "linkdir");
    await rm(symlinkDirInRoot, { recursive: true, force: true });
    await symlink(escapeReal, symlinkDirInRoot, "dir");
    const got = await resolveWriteWithinRoot(rootReal, "linkdir/file.txt");
    assert.equal(got, null, "symlinked parent dir escaping root must be rejected");
    await rm(symlinkDirInRoot, { recursive: true, force: true });
    await rm(escapeTarget, { recursive: true, force: true });
  });

  it("rejects writes whose intermediate ancestor escapes root via symlink — before mkdir runs", async () => {
    // The intermediate component "linkmid" is a symlink to outside-root.
    // A naive impl would mkdir -p `<root>/linkmid/inner` first (creating
    // `escapeTarget/inner` outside root) and only THEN realpath-check
    // and reject. Algorithm walks ancestors and realpath-checks each
    // existing one BEFORE any mkdir, so no outside-root dir is created.
    const symlinkMid = path.join(rootReal, "linkmid");
    await rm(symlinkMid, { recursive: true, force: true });
    await symlink(escapeReal, symlinkMid, "dir");
    const got = await resolveWriteWithinRoot(rootReal, "linkmid/inner/file.txt");
    assert.equal(got, null, "intermediate symlink ancestor escaping root must be rejected");
    const innerOutsideRoot = await stat(path.join(escapeReal, "inner")).catch(() => null);
    assert.equal(innerOutsideRoot, null, "no directory was created outside root");
    await rm(symlinkMid, { recursive: true, force: true });
    await rm(escapeTarget, { recursive: true, force: true });
  });
});

describe("resolveWriteWithinRoot — Windows drive-qualified relative", () => {
  // path.isAbsolute("C:foo") === false (drive-relative, not absolute),
  // but path.resolve on Windows would resolve onto drive C:'s CWD.
  // The string check has to reject these explicitly.
  it("rejects `C:foo` (drive letter + relative)", async () => {
    assert.equal(await resolveWriteWithinRoot(rootReal, "C:foo"), null);
  });

  it("rejects `c:relative/path.txt` (lowercase drive letter)", async () => {
    assert.equal(await resolveWriteWithinRoot(rootReal, "c:relative/path.txt"), null);
  });
});
