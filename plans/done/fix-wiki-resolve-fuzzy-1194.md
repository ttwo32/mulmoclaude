# fix(wiki): resolvePagePath fuzzy 分岐の誤マッチを塞ぐ (#1194)

## 問題

`server/api/routes/wiki.ts:228 resolvePagePath()` の fuzzy fallback は、
`slug.includes(key) || key.includes(slug)` で当たった **最初の候補** を
iteration 順 (=実質的に readdir 順) で返す。 これにより:

- 非 ASCII slug を `wikiSlugify()` で空に近い文字列に削ぎ落とした結果、
  別ページのファイル名と部分一致する → 全く違うページが silent に返る
- ファイル一覧の並びが変わるだけで挙動が変わる reproducible でない
  インシデント源

PR #1179 の L-15 spec は spec 側で「ユニークトークンを入れて衝突回避」
という回避コメントを残しているが、 これは server 側のバグを spec で
かわしているだけで根本対応ではない。

## 採用方針: (d) + (c) + (b) のハイブリッド

issue 本文の 4 案のうち単一を取らず、 三層の防衛で締める:

1. **(d) min-length gate** — `slug.length` が閾値未満なら fuzzy 自体を
   skip。 CJK が全部剥がれた残骸 (`-chromium-{nonce}` のような) は
   "意味ある一致" にならないので scoring すら走らせない。

2. **(c) score-based pick** — `includes` で当たった全候補を `min/max`
   ratio (= 0..1, 1 に近いほど長さが近い ≒ 強い一致) で score 付け、
   最高 score を 1 件選ぶ。 iteration 順依存を排除。

3. **(b) tie → ambiguous → null** — 最高 score が複数候補で並んだら
   silent に「先勝ち」せず、 `null` を返して `index.md` の title-match
   fallback に委ねる (あるいは 404)。

## 実装スケッチ

```ts
const MIN_FUZZY_SLUG_LEN = 6;  // 経験則: CJK 剥離後の残骸の典型サイズ

async function resolvePagePath(pageName: string): Promise<string | null> {
  // ... existing exact match path (unchanged) ...

  if (slug.length >= MIN_FUZZY_SLUG_LEN) {
    type Candidate = { file: string; score: number };
    const matches: Candidate[] = [];
    for (const [key, file] of slugs) {
      if (slug.includes(key) || key.includes(slug)) {
        const shorter = Math.min(slug.length, key.length);
        const longer = Math.max(slug.length, key.length);
        matches.push({ file, score: shorter / longer });
      }
    }
    if (matches.length > 0) {
      matches.sort((left, right) => right.score - left.score);
      const [top, runner] = matches;
      if (matches.length === 1 || top.score > (runner?.score ?? 0)) {
        return path.join(dir, top.file);
      }
      // ties → fall through to index.md title-match (ambiguous)
    }
  }

  // existing index.md title-match fallback (unchanged)
}
```

`MIN_FUZZY_SLUG_LEN = 6` の根拠: 短すぎる slug (空 / 1–5 文字) は
意味ある page name の slugify 結果には足りない (実例で出ている
`-chromium-{nonce}` の "純 noise" 部は数文字)。 5 文字以下で意味ある
英数 slug を持つ wiki ページは稀。 必要なら後で実測で調整。

## テスト

新規 `test/api/routes/wiki/test_resolvePagePath.ts` を追加し以下を pin:

1. **正常 fuzzy** — slug `bar` が key `foobar` に含まれる → 唯一の
   候補なら return
2. **短すぎる slug は skip** — slug が 5 文字以下なら fuzzy 全 skip
   (title-match だけ動く)
3. **tie → null** — 2 候補が同 score (= 同 length 関係) で並ぶ
   → null (caller の title-match に委譲)
4. **異なる length は決定的** — 短い key を持つ候補が勝つ
   (`bar` slug → key `bars` (3/4) > key `barfoo-extra` (3/12))
5. **exact match 優先** — fuzzy より先に handled、 score 経路を
   通らない (回帰防止)

既存の `e2e-live/tests/wiki-nav.spec.ts` の L-15 の「ユニークトークンを
入れて回避」コメントから、 server 側で塞いだ旨に書き換える
(コードは変更不要、 コメントのみ更新)。

## 影響範囲

- 短い英数 slug を fuzzy で誤って当てていた既存 navigation が
  500 → null (= 404) に変わる可能性。 ただしそういう短 slug は
  実例で意味ある wiki page ではない (空 / 数文字 noise) ので
  実害は無い見込み。
- スコア最良が単独でない (tie) ケースは silent ヒット → 404 化。
  少なくとも誤ページを開くよりは正しい挙動。

## 影響なし

- 既存の exact match 経路 (line 235-237) は touch せず、
  fuzzy 分岐内のみ書き換え。
- `index.md` title-match fallback (line 248-257) も touch せず。
- 非 ASCII slug の通常解決経路 (= title-match で当てる) は変化なし。

## 採用しなかった他案 (issue 本文より)

- **(a) fuzzy 撤廃**: 既存の英数 slug 誤字許容 ("foo-bra" → "foo-bar"
  みたいなライト fuzzy) を失う。 採用案は (c) で score の高い一致を
  優先するので、 「ほぼ完全一致」 は引き続きヒットする。
- **(c) 単独**: 短い slug の noise マッチを許してしまう。 (d) と
  併用して 2 重防衛にすべき。
- **(b) 単独**: 短い slug ですべて 「ambiguous → 404」 になりかねない。
  (d) でガードを先に立てる方が UX 良。

## 完了基準

- [ ] `resolvePagePath` 内の fuzzy 分岐が新ロジックに置換
- [ ] `test_resolvePagePath.ts` の 5 ケース pass
- [ ] L-15 spec のコメント整理 (ユニークトークン部はそのまま残しても OK、 「server 側で塞いだので不要だがフレーキー対策で残す」 と意味付け)
- [ ] typecheck / lint / build / `yarn test` clean
