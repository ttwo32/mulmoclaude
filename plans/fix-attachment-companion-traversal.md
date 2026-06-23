# fix: close "pre-write safeResolve on not-yet-written path" bug class

Tracks: #1754 (root-cause issue) — surfaces as #1744 (PPTX upload symptom).

## Symptom

Uploading a `.pptx` whenever LibreOffice / Docker sandbox is available throws
`path traversal rejected: data/attachments/YYYY/MM/<id>.pdf`.

## Root cause

`server/utils/files/safe.ts::resolveWithinRoot()` is a **read-time** primitive:
its boundary check is `realpathSync(resolved)`, which throws `ENOENT` on a
missing leaf. The `try`/`catch` swallows ENOENT and a genuine traversal escape
into the same `null` return.

`server/utils/files/attachment-store.ts::saveCompanion()` calls this via
`safeResolve()` **before writing the PDF**:

```
relativePath = "data/attachments/YYYY/MM/<id>.pdf"   ← not on disk yet
safeResolve(relativePath)
  → resolveWithinRoot(root, "YYYY/MM/<id>.pdf")
  → realpathSync(...)  → ENOENT
  → null
→ throws "path traversal rejected: <path>"
```

PPTX is the only current patient because every other writer either uses
`path.join` directly (`saveAttachment`, `saveImage`, `saveSpreadsheet`) or
operates on already-existing files (`overwriteImage`, `overwriteSpreadsheet`,
all `loadXxx`). But `safeResolve` is name-cloned across three stores with no
hint that "write" is unsafe, so the next companion-style writer would hit it.

## Repro (no LibreOffice / Docker)

```ts
process.env.MULMOCLAUDE_WORKSPACE_PATH = await mkdtemp(path.join(tmpdir(), "x-"));
const { saveAttachment, saveCompanion } = await import("…/attachment-store.ts");
const original = await saveAttachment(Buffer.from("x").toString("base64"), PPTX_MIME);
await saveCompanion(original.relativePath, Buffer.from("%PDF-1.4\n%%EOF\n"), ".pdf");
// throws — bug reproduced
```

Diagrammed:

```text
saveCompanion("data/attachments/YYYY/MM/<id>.pptx", buf, ".pdf")
  → derives target "data/attachments/YYYY/MM/<id>.pdf"  (does not exist)
  → safeResolve  → resolveWithinRoot  → realpathSync(target)
                                       ↑ ENOENT (leaf missing)
                                     → null
  → "path traversal rejected: data/attachments/YYYY/MM/<id>.pdf"
```

## Fix layers

### Layer 1 — `resolveWriteWithinRoot` in `safe.ts`

Write-time sibling of `resolveWithinRoot`:

- string-validate `relPath` (NUL, absolute, empty/`.`/`..` segments)
- `mkdir -p` the parent dir inside `rootReal`
- `realpath`-check the **parent** (leaf is about to be created)
- return absolute write path or `null` on unsafe input

Read-side `resolveWithinRoot` stays unchanged — ENOENT → null is correct for
reads (delete races, dangling symlinks).

### Layer 2 — `saveCompanion` uses Layer 1 + `writeFileAtomic`

Replace `safeResolve(...)` with the write-time helper, and switch the raw
`writeFile` to `writeFileAtomic` per CLAUDE.md "All writes go through
`writeFileAtomic`".

### C-2 — Share the per-store `safeResolve` wrapper

`attachment-store`, `image-store`, `spreadsheet-store` each define an
identically-shaped `safeResolve`. Replace all three with one factory in
`server/utils/files/store-resolvers.ts`:

```ts
export function makeStoreResolvers(getRoot: () => string, dirPrefix: string): {
  forRead: (rel: string) => Promise<string>;
  forWrite: (rel: string) => Promise<string>;
};
```

Naming the methods after the **side** they're safe on means a future
companion-style writer reaches for `.forWrite` rather than re-creating the
bug.

## Tests

- `test/utils/files/test_safe_write.ts` (new) — `resolveWriteWithinRoot`:
  happy path, traversal segment, absolute path, NUL, double slash, Windows
  drive-relative, symlink-escape via parent, symlink-escape via intermediate
  ancestor.
- `test/utils/files/test_attachment_store.ts` (new) — `saveCompanion`:
  companion lands under original's id + partition; traversal-shaped paths
  rejected; absolute path rejected.

## Out of scope

- `saveAttachment` / `saveImage` / `saveSpreadsheet`: server-generated paths,
  no security gain from extra realpath syscall.
- Read-time semantics of `resolveWithinRoot`: unchanged.
