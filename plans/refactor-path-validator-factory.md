# refactor: makePathValidator factory + 6-store migration

Tracks: #1761 (continuation of #1759 / #1760 catalog hygiene).

## Duplication

Six file-store modules each define `is{Attachment,Image,Markdown,Html,Spreadsheet,Svg}Path()` with the same prefix → ext → traversal shape, but with two different traversal-check strategies:

- A: `hasTraversalSegment(value)` (attachment, image)
- B: `path.posix.normalize(value) !== value` + `.includes("..")` (markdown, html, spreadsheet, svg)

## Fix

`server/utils/files/path-validator.ts` exports `makePathValidator({ prefix, ext? })` that applies **both** defenses. Each store re-exports a typed constant; public API unchanged.

## Tests

`test/utils/files/test_path_validator.ts`:
- happy path (matches prefix + optional ext + normalized + no traversal)
- rejects wrong prefix
- rejects wrong extension when ext is set; accepts any when omitted
- rejects `.` / `..` segments at any depth
- rejects empty segment (`dir//foo`)
- rejects `path.posix.normalize` non-fixpoint inputs (`dir/./foo`)
- rejects mixed `/` / `\\` traversal
- per-store smoke: `isAttachmentPath`, `isImagePath`, `isMarkdownPath`, `isHtmlPath`, `isSpreadsheetPath`, `isSvgPath` each accept the canonical shape and reject `..` traversal.

## Catalog

`docs/shared-utils.md`: add entry for `makePathValidator` under Files / Paths.

## Behavioral change

`isAttachmentPath` and `isImagePath` become stricter — empty segments and non-normalized forms are now rejected. Current call sites build paths via `path.posix.join` so produce normalized output; no observable change.
