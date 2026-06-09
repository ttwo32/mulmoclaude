# feat(marp): カスタム CSS / テーマのインポート

Issue: receptron/mulmoclaude#1649

## 背景

現状 Marp は `@marp-team/marp-core` の組み込みデフォルトテーマしか効かない。`MarpView.vue` の iframe にハードコード CSS でスライド余白だけ調整しているが、ユーザがブランド色やフォントを差し込む手段がない。PDF エクスポート (`server/api/routes/pdf.ts`) も同じ default 見た目。

## ゴール

`config/marp-themes/<name>.css` に置いた CSS を:
- frontmatter `theme: <name>` で named 参照可能
- 複数 .md から共有
- client preview (`MarpView`) と server PDF export の両方で同一テーマ適用
- 起動時 + テーマ更新時に reactive 反映

## 設計

### Marp の標準仕様の利用

Marp は `marp.themeSet.add(css)` で動的にテーマを登録できる。テーマ CSS の先頭に `/* @theme <name> */` directive が必要。frontmatter `theme: <name>` がその name を参照する。

→ **filename = theme name** の規約を採用。`corporate.css` なら自動で `/* @theme corporate */` を CSS 先頭に追記して `themeSet.add` する。ユーザに directive 必須を強制しない方が DX が良い。

### Backend

1. `server/workspace/paths.ts` — `HOST_WORKSPACE_DIRS.marpThemes: "config/marp-themes"` 追加
2. `server/workspace/marp-themes/io.ts` (新規) — `listMarpThemes()` / `loadMarpTheme(name)` / `sanitizeMarpThemeCss(raw)`
3. `server/api/routes/marp-themes.ts` (新規) — `GET /api/marp-themes` で `{name, css}[]` 返す
4. `server/api/routes/pdf.ts` — Marp instance 生成後に全テーマ `themeSet.add()`
5. `src/config/apiRoutes.ts` — `marpThemes.list` ルート定数追加

### Frontend

6. `src/plugins/markdown/MarpView.vue` — `marp.render` 前にテーマを一括 fetch + `themeSet.add()`
7. テーマ更新 (file 変更) を pubsub で受けて再 fetch — 最初は startup only でも良い。後追い可

### 共有モジュール

`src/utils/markdown/marpThemeName.ts` (新規) — テーマ name 正規化 (filename → name の規則)。client / server 双方から import。

### Security gate

`sanitizeMarpThemeCss(raw)`:
- `@import url(...)` を含む CSS は **reject** (外部 fetch 防止)
- `url(http[s]?://...)` を含む CSS は **reject** (外部リソース読み込み防止 — fonts 等)
- `data:` URL は許容 (inline font 等)
- 違反したテーマは server で no-op (list から除外、log.warn)

### スコープ外 (フォローアップ)

- pubsub による live reload (最小では mount 時 fetch のみ)
- テーマプレビュー / 切替 UI
- テーマファイルの editor (workspace 直編集前提)

## 触るファイル

- `server/workspace/paths.ts` — dir 定義追加 (+1 line)
- `server/workspace/marp-themes/io.ts` (新規) — 60-100 行
- `server/api/routes/marp-themes.ts` (新規) — 20-30 行
- `server/api/routes/pdf.ts` — `renderMarpPdf` で themeSet.add 注入
- `server/api/index.ts` — route 登録
- `src/config/apiRoutes.ts` — ルート定数 (+2 lines)
- `src/plugins/markdown/MarpView.vue` — fetch + themeSet.add 配線
- `src/utils/markdown/marpThemeName.ts` (新規) — 10-20 行
- `test/workspace/marp-themes/test_io.ts` (新規)
- `test/utils/markdown/test_marpThemeName.ts` (新規)

## 受け入れ基準

- [ ] `config/marp-themes/corporate.css` を置いて、別の .md で frontmatter `theme: corporate` を指定すると client preview に反映
- [ ] 同じ .md から PDF を出すと preview と同じ見た目で出る
- [ ] テーマ name が見つからないときは default にフォールバック (Marp の組み込みテーマ "default" を使う)
- [ ] `@import url(http://...)` を含む CSS は load されない (security gate)
- [ ] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test` 全 pass
- [ ] unit test:
  - `listMarpThemes()` empty dir / valid theme / sanitized rejection
  - `marpThemeNameFromFilename("corporate.css") === "corporate"`
  - `sanitizeMarpThemeCss` の reject / accept パターン
