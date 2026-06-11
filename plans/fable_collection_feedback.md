Here's the review — the verdict up front: the doc is 
  honest about the architecture's shape and the implementation backs most of it up, 
  often more rigorously than the doc claims. But it overclaims in three places (live 
  recomputation, "the host computes," and validation-as-guarantee), undersells in 
  others, and as a document it has a positioning problem in the comparison table.

  What the implementation genuinely delivers                               

  - Files as source of truth, no DB — literally true. Every read is a fresh filesystem
  operation; the only cache is the schema JSON inside the time-trigger watcher
  (server/workspace/collections/watcher.ts:56), never record data. Writes go through
  writeFileAtomic or O_EXCL create.
  - Path safety — stronger than the doc bothers to claim: slug whitelist +
  path.basename round-trip, realpathSync containment with symlink defense, and a
  pre/post-mkdir double containment check against TOCTOU races
  (server/workspace/collections/io.ts:144-158).
  - Schema validity — a real Zod schema-of-schemas with ~18 cross-field refinements
  (discovery.ts:313-549), including subtle ones like "spawn successors must not be born
  already matching their own predicate."
  - Zero domain-specific host code — verified by grep. Domain words (invoice,
  portfolio, ticker…) appear only in comments and in user-copyable help recipes under
  server/workspace/helps/. No seeded collection ships with the host.
  - Refs and embeds — both match the documented JSON shapes exactly, with
  auto-generated pickers, <router-link> navigation, and the embed card including a
  graceful missing-record state.
  - Actions — the four-step flow (load record → validate visibility → assemble prompt →
  Claude executes) exists as described, and crucially the when predicate is
  re-enforced server-side (409 on mismatch, server/api/routes/collections.ts:323), so
  visibility is an authorization rule, not just UI hiding.

  Where the doc overclaims

  1. "A portfolio can automatically revalue itself when a quote changes elsewhere" —
  this is the biggest gap. Derived fields are evaluated on-read, in the browser
  (src/utils/collections/derivedFormula.ts, called from
  useCollectionRendering.ts:293-310). There are no watchers, no push, no server-side
  evaluation at all. "Automatically" is true only in the weak sense that values are
  never stale at render time. Worse, because derived values are computed client-side
  and never persisted:

  - Claude never sees them. The action seed prompt embeds the raw stored record
  (readItem → buildActionSeedPrompt), so when Claude executes "Record Payment" on an
  invoice, the prompt contains line items and tax rate but not the computed
  subtotal/tax/total. For a doc whose thesis is "Claude is the runtime," the runtime
  being blind to the computation layer is a real architectural seam, not a nitpick.
  - Server-side features (notification predicates, time triggers, spawn) can't
  reference derived fields either.

  The doc's own Design Boundaries section lists "deterministic computation" as a host
  guarantee — defensible only if "host" means "host platform including the client
  bundle." A reader will assume server.

  2. "A derived field behaves similarly to a spreadsheet formula" — the language is far
  narrower than that sentence implies. The actual grammar: numbers, + - * /, parens,
  exactly one function (sum() over table columns), and single-level ref deref. No
  strings, no comparisons, no conditionals, no date math, no chaining
  (ticker.sector.growth is impossible). Even the doc's own example subtotal =
  sum(lineItems) doesn't parse — the real syntax is sum(lineItems[].amount). The
  narrowness is arguably correct per the doc's own "extend the declarative layer only
  when it outperforms the agent" principle, but the doc should state the boundary
  instead of gesturing at Excel. Cycles, by the way, are handled by bounded saturation
  (max passes = field count) and silently resolve to null — fine, but undocumented.

  3. "It validates what Claude creates" — validation is advisory, not a gate. Record
  validation (validate.ts) runs post-hoc, reports max 25 issues for the LLM to repair,
  and bad records are silently skipped at read time. Nothing prevents writing a record
  that violates the schema. Likewise an invalid schema.json is logged at warn and the
  collection just silently doesn't load — for a system whose pitch is non-programmers
  authoring schemas, "your app vanished, check the server log" is the wrong failure
  mode. The repair-loop design is reasonable; calling it a host guarantee is not.

  4. "Prompt isolation" deserves a footnote about what it actually is. The
  implementation is real and thoughtful — recursive sanitization of keys and values,
  iterative tag-stripping, a SECURITY BOUNDARY framing block (io.ts:245-287). Two
  honest caveats: the boundary is ultimately an instruction to the model, not a
  mechanism; and the sanitization is lossy — a markdown field containing legitimate
  backticks or angle brackets reaches Claude mutated, which can silently corrupt the
  very data Claude is supposed to act on (a code snippet in a record, a <10ms
  requirement, etc.).

  5. "Who designs the environment? Users." Two quibbles. First, the comparison table is
  rhetorically vulnerable: Airtable's entire market position is non-engineers building
  bases, so "Airtable → Engineers" will read as a strawman to anyone who's used it;
  the actual differentiator (the agent is the runtime, business logic stays in prose)
  is stronger than the one the table claims. Second, in practice there is no schema
  editor UI — schemas are hand-written JSON or (realistically) authored by Claude in
  chat. "Users design the harness, with Claude as the authoring interface" is the true
  story and arguably a better one, but it's not what the doc says. Also, actions bind
  to a role that must exist in host config (src/config/roles.ts) — roles are
  engineer-defined, so the environment isn't 100% user-authored.

  Where the doc undersells the implementation

  The doc covers maybe 60% of what's built. Missing entirely: the four schema-driven
  view modes (table, kanban via kanbanField, calendar via calendarField, dashboard);
  time triggers, lead days, and recurrence/spawn with carry-forward fields;
  notification predicates wired to the bell; the toggle-as-enum-projection field type;
  money with per-record currencyField; feeds/ingest; and the whole
  validation-and-repair loop, which is one of the more distinctive "Claude is the
  runtime" mechanics in the system. The "Workflow = Actions" row in the concerns table
  is the doc's weakest claim about itself — the workflow layer is much richer than
  buttons.

  One factual drift: the doc shows schema.json + records/*.json as the layout, but the
  real layout couples collections to the skills system — data/skills/<slug>/schema.json
  (mirrored to .claude/skills/) with records at a schema-declared dataPath. That
  coupling (a collection is a skill, templates live in the skill dir, SKILL.md provides
  agent context) is a core design decision the doc never mentions.

  As a document

  The one-sentence-per-line manifesto cadence works for the first third and gets
  repetitive after ("This boundary is intentional" / "This constraint is deliberate" /
  "This is intentional" appear in near-identical form three times). The ideas are
  strong enough that the doc would land better with one rhetorical section up front and
  concrete material after — the actual formula grammar, the actual action JSON, the
  actual failure modes. Right now every code sample in it is illustrative
  pseudo-syntax, and as shown above one of them doesn't parse against the real engine.

  Suggested fixes, in priority order: (1) reword the portfolio claim to "values are
  recomputed at render time" and decide whether derived values should be included in
  action prompts — that's the one finding I'd act on rather than just document; (2) add
  a "Formula language" section with the real grammar; (3) soften "validates" to
  describe the validate-and-repair loop; (4) replace the Airtable table row with the
  runtime-vs-tool framing; (5) either add the workflow/views/feeds material or mark the
  doc as covering the core model only.
