# Marp Themes — Custom CSS for Slide Decks

MulmoClaude が表示する Marp スライド (`marp: true` frontmatter を持つ Markdown) に **自前の CSS テーマ** を適用できます。Marp 標準の named theme 機構を使うので、**1 つの CSS ファイル** を **複数の `.md`** から `theme: <name>` で参照できます。

> プレビューと PDF エクスポートが **同じテーマ** で render されるので、画面の見た目とエクスポート結果が一致します。

## クイックスタート

ワークスペースに `config/marp-themes/` ディレクトリを作って `.css` を置くだけ:

```bash
mkdir -p ~/mulmoclaude/config/marp-themes

cat > ~/mulmoclaude/config/marp-themes/corporate.css <<'CSS'
section {
  background: #1a1a2e;
  color: #f4f4f4;
  font-family: "Inter", -apple-system, sans-serif;
}
h1 {
  color: #f0a020;
  border-bottom: 4px solid #f0a020;
  padding-bottom: 0.2em;
}
h2 {
  color: #a0c0ff;
}
code {
  background: #2a2a4e;
  padding: 0.1em 0.3em;
  border-radius: 4px;
}
CSS
```

スライドの先頭で参照:

```markdown
---
marp: true
theme: corporate
---

# 私のスライド

corporate テーマの色で表示されます。
```

→ プレビューでも PDF エクスポートでも、同じ corporate テーマで render されます。

## 規約

### ファイル名 = テーマ名

`config/marp-themes/corporate.css` の **ファイル名 (拡張子除く) がテーマ名** になり、frontmatter `theme: corporate` で参照します。

- 使える文字: `[A-Za-z0-9_-]` のみ
- スペースやドット、日本語が入ったファイル名は無視されます
- 拡張子は `.css` のみ (大小区別なし)

### `/* @theme ... */` の宣言は不要

Marp は CSS の先頭に `/* @theme <name> */` コメントでテーマ名を要求しますが、MulmoClaude は **ファイル名から自動付与** するので書かなくて OK です。書いてあっても無視して **ファイル名のほうが優先** されます (`themes/foo.css` が `bar` で登録される事故を防ぐため)。

## 複数の `.md` で共有

`config/marp-themes/corporate.css` を 1 つ置けば、ワークスペース内のすべての Marp スライドが `theme: corporate` で同じ見た目を共有できます。テーマを更新すれば、参照しているすべてのスライドに反映されます (更新の反映は[反映タイミング (本実装の制限)](#反映タイミング-本実装の制限) を参照)。

## 制限とセキュリティ

### 外部リソースは使えません

以下のパターンを含む CSS は **ロード時に reject** され、適用されません (該当テーマはサーバログに `[marp-themes] skipped theme` で記録):

- `@import url("http://...")` / `@import url("https://...")`
- `@import "http://..."` (bare string 形式)
- `url(http://...)` / `url(https://...)` (任意の場所、例: `@font-face src:`)

これは:
- プレビューの iframe CSP が外部 fetch を block するため、テーマが破綻したように見えるのを防ぐ
- PDF エクスポート (puppeteer) が外部 URL を fetch しないようにする (SSRF / tracking 対策)

OK な使い方:
- `data:` URI で font / image を inline 埋め込み (`url(data:font/woff2;base64,...)`)
- 相対パス / 同一オリジン

ローカルにあるフォントを使いたい場合は data URI に埋め込んでください。

### 反映タイミング (本実装の制限)

現在の実装では、テーマファイルを **追加・編集した直後** は反映されません:

- **プレビュー側**: ブラウザでテーマを fetch するのはセッションあたり 1 回 (キャッシュ)。テーマを追加・更新したらブラウザを **リロード** してください
- **PDF エクスポート側**: リクエストごとに最新を読み込むので、ブラウザリロード不要

セッション中の live reload はフォローアップで対応予定です (#1649 の残作業)。

## トラブルシューティング

### テーマが反映されない

1. **ファイル名を確認**: `corporate.css` の `corporate` が `[A-Za-z0-9_-]` のみで構成されているか
2. **frontmatter を確認**: `theme: corporate` の値がファイル名 (拡張子除く) と一致しているか
3. **ブラウザリロード**: テーマを追加・編集した後はリロードが必要 (上記の制限を参照)
4. **サーバログを見る**: `[marp-themes] skipped theme` のログがあれば外部リソース参照が原因
5. **存在しないテーマ名を指定した場合**: Marp の組み込み default テーマで render されます (エラーにはなりません)

### サーバログの場所

`yarn dev` で起動している場合はコンソール出力に直接出ます。`npx mulmoclaude` で起動している場合は stderr に出ます。

## サンプル: minimal なテーマ

```css
/* config/marp-themes/minimal.css */
section {
  background: white;
  color: #222;
  font-family: "Helvetica Neue", Arial, sans-serif;
  padding: 60px;
}
h1 {
  font-size: 56px;
  color: #0066cc;
  margin-bottom: 0.5em;
}
h2 {
  font-size: 36px;
  color: #444;
}
ul, ol {
  font-size: 28px;
  line-height: 1.6;
}
code {
  font-family: "SF Mono", Consolas, monospace;
  background: #f0f0f0;
  padding: 0.1em 0.3em;
}
```

## inline HTML タグの使用

スライド本文に `<div>` / `<span>` / `<img>` などの inline HTML を直接書けます。`<script>` / `<iframe>` / フォーム系などは引き続き escape されます (XSS 防止)。

許可されているタグと属性:

| タグ | 許可される属性 |
|---|---|
| `div`, `span`, `sub`, `sup`, `small` | `id`, `class`, `style` |
| `img` | `src`, `alt`, `width`, `height`, `id`, `class`, `style` |
| `br` | (なし) |

例:

```markdown
---
marp: true
theme: corporate
---

# タイトル

<div class="callout">
  <img src="../images/logo.png" width="40" />
  重要なポイント<sup>1</sup>
</div>
```

- `<img>` の `src` は通常の markdown 画像と同じく相対パス / `data:` URI が使えます (`http(s)://...` は preview の CSP で block される — 普通の画像 ref と同じ挙動)
- `style` 属性も書けますが、外部 URL を含む宣言は preview / PDF の挙動が一致しないので避けたほうが無難

`<script>` を書くと escape されて画面に `&lt;script&gt;` と表示されます (= 動作はしないが見えてしまう)。

## 関連

- Marp 公式のテーマ仕様: <https://marpit.marp.app/theme-css>
- Marp の組み込み directives (`size:`, `paginate:` 等) は普通に使えます — テーマ CSS で `section { font-size: 24px }` のように上書きするのが基本パターン
