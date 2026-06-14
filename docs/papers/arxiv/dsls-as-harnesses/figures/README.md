# Figure screenshots for Figure 1 (custom views)

The paper's Figure 1 shows three agent-authored custom views. Until the PNGs below
exist, `main.tex` renders labeled placeholder boxes (via `\viewfig` + `\IfFileExists`),
so the paper still compiles. Drop the files in here and rebuild to swap them in.

Capture from the running app (`yarn dev`), open each collection's custom view, and
screenshot the rendered iframe (retina / 2× is fine; arXiv handles large PNGs).
Crop to the view content; aim for similar aspect ratios so the three line up.

| File | Source view |
|---|---|
| `restaurants-map.png` | `restaurants` → "東京レストラン路線図" (transit-style map) |
| `portfolio-allocation.png` | `portfolio` → "資産配分" (allocation donut + host-computed valuations) |
| `feed-gallery.png` | `lex-fridman-podcast` feed → gallery (read–write: rating/notes/resume) |

Chosen 2026-06-14 for visual variety (map + chart + gallery). Other captured views
(watchlist poster gallery, nyt magazine) are available if a different mix is wanted;
drop the PNG here and edit the `\viewfig{...}` calls + subcaptions in `main.tex`.

To use different views, edit the three `\viewfig{figures/...}` calls and the
subcaptions in `main.tex` (search for `fig:views`).

Tips: prefer light-background views (legible in print/grayscale); avoid PII in the
shots; PNG preferred over JPG for UI screenshots.
