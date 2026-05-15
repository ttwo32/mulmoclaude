---
name: mc-manage-sources
description: Register, list, edit, or remove a news / RSS / GitHub / arXiv information source for the workspace. Use when the user wants to subscribe to a feed ("register an RSS feed", "AI 論文の arXiv 追加して"), stop following one, or see what's registered. Writes one markdown file per source at `sources/<slug>.md` (cwd-relative — the agent already runs with cwd = workspace); the source poller picks up changes on its next cycle.
---

# Information sources manager

A bundled MulmoClaude preset skill (`mc-` prefix = launcher-managed; do not edit
this file in the workspace, it is overwritten on every server boot).

Help the user curate the **information sources** the agent polls in the
background — RSS feeds, GitHub releases / issues, arXiv queries. One file per
source under `sources/` (cwd-relative; the agent runs with cwd set to the
workspace root, so every path in this file is plain cwd-relative); the poller
re-reads the directory on every cycle, so no refresh dance is needed.

End with a one-line confirmation ("Registered ai-news-rss." / "Stopped
following old-feed.") so the user can verify without scrolling.

## Workflow 1: register a new source

**Triggers**: "register an RSS feed for X", "add the AI papers from arXiv",
"GitHub の foo/bar releases 監視して", "subscribe to <url>".

**Step 1 — figure out the kind.** Look at the URL:

- ends in `/feed`, `/rss`, `.xml` → `fetcher_kind: rss`
- `github.com/<owner>/<repo>` → `fetcher_kind: github` (ask: releases or
  issues)
- `arxiv.org` or the user says "papers" → `fetcher_kind: arxiv` (ask: query)
- ambiguous → ask the user

**Step 2 — pick a kebab-case slug.** Lowercase ASCII letters / digits,
hyphen-separated. Use a memorable handle (`ai-news-rss`, `pytorch-releases`,
`arxiv-llm`) so the user can recognise it when listing.

**Step 3 — Write `sources/<slug>.md`**:

```markdown
---
slug: ai-news-rss
title: AI News (RSS)
url: https://example.com/ai/feed.xml
fetcher_kind: rss
schedule: hourly
categories:
  - tech
  - ai
max_items_per_fetch: 20
added_at: 2026-05-11T08:00:00.000Z
---

Notes about why this source is on the list — optional body.
```

**Field rules**:

- `slug` — lowercase, hyphen-separated; matches the filename.
- `fetcher_kind` — `rss` | `github` | `arxiv`.
- `schedule` — `hourly` (news polling) / `daily` (digest) / `weekly` (low
  traffic) / `on-demand` (only when asked).
- `categories` — free-form taxonomy; ask if the user has a preferred set.
- `max_items_per_fetch` — number, typically 10-50.
- `added_at` — ISO timestamp now.
- For `github`: add `repo: owner/name` and `kind: releases | issues`.
- For `arxiv`: add `query: <search query>`.

No hook fires — the source poller re-reads files each cycle.

## Workflow 2: list / browse

**Triggers**: "show my sources", "登録した source 全部", "what am I
following?".

List `sources/*.md` and present `title` + `fetcher_kind` + `schedule` for
each in a compact form. Don't dump raw frontmatter unless the
user asks for a specific source's details.

If the user filters by category ("tech のだけ"), filter the list before
showing.

## Workflow 3: update

**Triggers**: "AI news の schedule を daily に", "change the categories for
foo".

Read the current file, Edit in place, preserve every other field unless the
user explicitly asked to change it. Confirm afterward.

## Workflow 4: remove

**Triggers**: "stop following foo", "old-feed 削除".

Only when the user explicitly asks. Quote the path:

```bash
rm "sources/<slug>.md"
```

Confirm afterward.

## Tone

Friendly, practical. If a user gives a URL with no context, ask one quick
clarifying question (cadence? category?) rather than guessing and writing
something they'll regret.
