# Plan: Solopreneur Invoice Plugin with Accounting Bookkeeping & Dynamic settings

This plan describes the implementation of the `@mulmoclaude/invoice-plugin` completely from scratch, including automated double-entry bookkeeping via the host's Accounting plugin, dynamic issuer configurations (zero hardcoded values), and AI-native invoice layout generation using a Japanese/English template.

## Requirements & Scope

1. **Standalone Invoice Management**:
   - Standard CRUD-like commands for billing candidates and committed invoices.
   - Dual-panel UI dashboard showing candidates next to committed invoices.
   - Dynamic settings page for setting issuer details (Company Name, T-number, Address, Email, Bank Details).

2. **Strict Decoupling (疎結合) Sibling Lookups**:
   - Query client and worklog data dynamically via host registry API commands first, degrading gracefully to parsing `data/clients/*.md` or `committed/*.jsonl` respectively if registry is unavailable.

3. **Automated Journal Postings**:
   - **Approval**: Debit A/R (`1100`) and Credit Revenue (`4000`) for the invoice total. If tax > 0 and account `2400` ("Sales Tax Payable") exists, split Credit between `4000` (subtotal) and `2400` (tax), attaching the issuer's T-number to the tax line.
   - **Mark Paid**: Debit checking bank (`1010`) and Credit A/R (`1100`) for the total.
   - **Void**: Scan the active book's entries, find the entry or entries matching `invoice.id` in their memos, and call `voidEntry` on the service layer to post reversing entries.
   - **Graceful Error Handling**: All bookkeeping operations are wrapped defensively so any failures (e.g. no books, missing accounts) are caught and logged as warnings, leaving the invoice lifecycle intact.

4. **AI Invoice Layout Generation**:
   - Clicking "Generate Layout (AI)" dispatches `startPrintableGenerationChat` on the backend.
   - Spawns a new chat in the `"accounting"` role via the host's `runtime.chat.start` runtime API.
   - Seeds the chat with a precise prompt containing the invoice items, totals, and dynamic issuer settings, instructing the LLM to output a beautiful Japanese/English print-ready invoice based on the 有限会社パーベイシブ template design and save it directly to `artifacts/invoices/<invoice-id>.md`.
   - Redirects the user to the resulting `/chat/<chatId>`.

5. **No Hardcoded Issuer Values**:
   - No company names or registration numbers are hardcoded in the source code or prompts. Everything is dynamically injected from `settings.json` configured in the UI.

---

## File Deliverables

### 1. Backend Plugin Infrastructure
- **[NEW] [accounting.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/accounting.ts)**: Dynamic ESM host import wrapper of `server/accounting/service` with book search, automated journals (`recordInvoiceApproval`, `recordInvoicePayment`), and journal scan-and-void logic (`recordInvoiceVoid`).
- **[MODIFY] [types.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/types.ts)**: Incorporates `InvoiceSettingsSchema` (Zod) and exports type `InvoiceSettings`.
- **[MODIFY] [io.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/io.ts)**: Implements Zod-validated configuration loading and saving (`loadSettings`, `saveSettings`) to write issuer data to `settings.json`.
- **[NEW] [index.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/index.ts)**: Entry point for `definePlugin` orchestrating `manageInvoice` dispatches. Sets up candidates on creation, commits invoice records on approval, marks paid, and voids invoices. Handles `startPrintableGenerationChat` and wraps accounting tasks in defensive try/catch blocks.
- **[NEW] [handlers/llm.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/handlers/llm.ts)**: Specialized LLM-callable handlers to create candidates or query data.
- **[MODIFY] [definition.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/definition.ts)**: Tool descriptor for `manageInvoice` including settings configuration actions and notes prompt.

### 2. Role Permissions & Registry
- **[MODIFY] [toolNames.ts](file:///Users/satoshi/git/ai/mulmoclaude/src/config/toolNames.ts)**: Registers `manageInvoice: "manageInvoice"`.
- **[MODIFY] [roles.ts](file:///Users/satoshi/git/ai/mulmoclaude/src/config/roles.ts)**: Grants access to `manageWorklog`, `manageClient`, and `manageInvoice` in the `accounting` role.
- **[MODIFY] [preset-list.ts](file:///Users/satoshi/git/ai/mulmoclaude/server/plugins/preset-list.ts)**: Registers `@mulmoclaude/invoice-plugin` in the runtime engine preset list.

### 3. Premium Frontend UI Component
- **[NEW] [View.vue](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/View.vue)**: HSL-tuned premium glassmorphic Solopreneur Invoicing board with Candidate vs Committed lists, a specialized "Settings" editor, dynamic warning banners when settings are missing, and an AI generation button redirecting users to the newly seeded chat session. Uses `marked` to render invoice markdown beautifully on the details sheet.
- **[NEW] [vue.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/vue.ts)**: Frontend plugin binder exporting `View.vue` and custom menus.
- **[NEW] [shared.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/shared.ts)**: Shared utilities (constants or helpers).
- **[NEW] [shims-vue.d.ts](file:///Users/satoshi/git/ai/mulmoclaude/packages/plugins/invoice-plugin/src/shims-vue.d.ts)**: Vue shim definitions.

---

## Verification & Launch Plan

1. Build & transpile all modules.
2. Confirm strict type-safety via compiler checks.
3. Validate dynamic import and fallback gracefully under standalone run conditions.
4. Perform user tests in local environment before preparing PR.
