// Pure helpers for wiki/View.vue. Replaces the former
// `/\[\[([^\]]+)\]\]/g` regex — flagged by `sonarjs/slow-regex`
// for backtracking risk — with a linear walker.

import { marked } from "marked";
import { parseWikiLink } from "../../lib/wiki-page/link";
import { rewriteMarkdownImageRefs } from "../../utils/image/rewriteMarkdownImageRefs";
import { makeTasksInteractive } from "../../utils/markdown/taskList";
import { escapeHtml } from "../../utils/markdown/wikiEmbeds";

/**
 * Pure markdown→HTML pipeline shared between the standalone /wiki
 * view and the chat-inline preview (Stage 3a). Caller passes a body
 * that already has frontmatter stripped, plus the workspace-relative
 * base dir used to rewrite image refs (`data/wiki/pages` for a page,
 * `data/wiki` for log/lint).
 */
export function renderWikiPageHtml(body: string, baseDir: string): string {
  if (!body) return "";
  const withImages = rewriteMarkdownImageRefs(body, baseDir);
  return makeTasksInteractive(marked.parse(renderWikiLinks(withImages)) as string);
}

/**
 * Replace every `[[page name]]` occurrence in `content` with a
 * `<span class="wiki-link" data-page="…">…</span>` element. The
 * page name may not contain `]`; an opening `[[` that is not
 * followed later by `]]` (with no bare `]` in between) is left
 * untouched so malformed text renders as-is — matching the
 * previous regex's non-match behaviour.
 *
 * `[[target|display]]` is split via the shared `parseWikiLink`
 * helper (`src/lib/wiki-page/link.ts`) so `data-page` carries only
 * the target slug while the visible text shows the display half.
 * Pre-#1297 we shoved the whole bracket body into both fields,
 * which left the URL containing a literal `|display` after click
 * (the resolver fell back to fuzzy `includes` matching and still
 * found the file, but the URL was ugly and the lint flagged the
 * link as broken). Routing through `parseWikiLink` makes the
 * renderer, the resolver, and the lint agree.
 *
 * Both halves are HTML-escaped before interpolation — a wiki page
 * author writing `[[foo"onclick=alert(1)//|<img>]]` would
 * otherwise break out of the attribute context (target) or the
 * text context (display) and execute markup. Pre-#1297 the
 * original code interpolated the raw body too; the issue was
 * latent because everything that touched a wiki page also went
 * through `marked.parse` first, but `parseWikiLink` runs BEFORE
 * marked sees the body so escaping has to happen here.
 */
export function renderWikiLinks(content: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] === "[" && content[i + 1] === "[") {
      const closeStart = findNextCloseBrackets(content, i + 2);
      if (closeStart !== -1) {
        const inner = content.slice(i + 2, closeStart);
        const { target, display } = parseWikiLink(inner);
        out.push(`<span class="wiki-link" data-page="${escapeHtml(target)}">${escapeHtml(display)}</span>`);
        i = closeStart + 2;
        continue;
      }
    }
    out.push(content[i]);
    i++;
  }
  return out.join("");
}

/**
 * Starting at `from`, scan forward for a `]]` sequence. Returns
 * the index of the first `]` of that pair, or -1 if a bare `]`
 * (one not immediately followed by a second `]`) is encountered
 * first — mirroring the old regex's `[^\]]+` constraint that the
 * page name must contain no `]` characters. Also returns -1 if
 * nothing matched before the end of input, or if the pair sits
 * immediately after `from` (zero-length page name, which the old
 * regex rejected via the `+` quantifier).
 */
function findNextCloseBrackets(str: string, from: number): number {
  let j = from;
  while (j < str.length) {
    if (str[j] === "]") {
      if (str[j + 1] === "]" && j > from) return j;
      // Bare `]` inside the page-name span — old regex would not
      // match here, so we bail and let the caller emit the `[[`
      // as literal text.
      return -1;
    }
    j++;
  }
  return -1;
}
