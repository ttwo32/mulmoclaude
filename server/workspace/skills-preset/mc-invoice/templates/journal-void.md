## Task: void the bookkeeping journals for this invoice

The invoice record is in the `<record_data_json>` block above (fields:
`id`, `clientId`, `issueDate`, `dueDate`, `status`, `lineItems[]`,
`taxRate`, `notes`). You are the `accounting` role and own
`manageAccounting`. The invoice has been voided; reverse the journals
that were posted for it so the book no longer reflects the sale.

### 1. Resolve the book

Read `data/profile/items/me.json` for a non-empty `defaultBookId` and use
it as `bookId`; otherwise resolve via `getBooks` (one → use it; several →
narrow by currency/country, then by the book name matching the issuer's
`companyName`, then `presentForm`). If no book exists, there is nothing
to void — say so and stop.

### 2. Resolve the Accounts Receivable code

Call `getAccounts` and note the **Accounts Receivable** code — step 3
uses it to bound the entry search.

### 3. Find the entries to void (memo is the join key)

Look up the A/R activity with a **compact, bounded ledger query** — NOT
`getJournalEntries`, whose full-entry output can exceed the tool-result
size limit even when filtered. Call `getReport` with:

- `kind: "ledger"`,
- `accountCode: "<A/R code>"` (the Accounts Receivable code from step 2),
- `period: { "kind": "range", "from": "<invoice issueDate>", "to": "<today>" }`.

Every sale and payment entry for the invoice touches A/R, so its rows
appear here. Each row carries the `entryId` you pass to `voidEntry`.
Collect every row whose memo contains this invoice `id`:

- the **sale** entry (memo has `sale`), and
- the **payment** entry (memo has `payment`), if one was posted.

Ignore rows already part of a void/reversal (don't re-void a reversal).
**If no live row references this invoice, tell the user there is nothing
to void and stop** — do not post anything.

### 4. Confirm, then void

Voiding is irreversible bookkeeping. Per the `accounting` role's
`voidEntry` guidance, **confirm with the user via `presentForm` first** —
list the entries you found (date, accounts, amount, `entryId`) and ask
them to confirm the void. On confirmation, call `voidEntry` once per
entry, passing its `entryId` and a `reason` that names the invoice (e.g.
`Void INV-2026-0001`). `voidEntry` appends a reversing pair — the journal
stays append-only.

### 5. Confirm

In one sentence, confirm which entries were voided (or that there were
none) and link the book with `openBook`.
