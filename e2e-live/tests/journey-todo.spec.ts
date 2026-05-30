import { randomUUID } from "node:crypto";

import { type Locator, type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";

// Per-test wall-time budget — no LLM call, so the only latency is
// SPA boot + a couple of `/api/todos` round trips. Keeping the
// ceiling roomy lets the spec ride through CI cold-start jitter.
const JOURNEY_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

// L-JOURNEY-TODO net (plans/feat-e2e-live.md §「未確定事項 / TODO」
// L-JOURNEY-*). The existing L-DISPATCH-TODO covers the LLM →
// `manageTodoList` dispatch path only; this spec covers the human
// path — user opens `/todos`, fills the Add dialog, ticks the
// completed checkbox, reloads, and the todo (and its checked state)
// is still there. No LLM call, no `setupRoleSession`, no chat
// turn — the regressions this catches are pure SPA + REST + file
// write/read (TodoExplorer.vue ↔ `/api/todos` ↔ data/todos/todos.json
// ↔ post-reload hydration).
test.describe("L-JOURNEY-TODO — UI からの正常系 add + check + reload", () => {
  test.describe.configure({ timeout: JOURNEY_TIMEOUT_MS });

  test("UI から todo を add → check → reload で残る", async ({ page }) => {
    const marker = `L-JOURNEY-TODO-${Date.now()}-${randomUUID().slice(0, 6)}`;

    try {
      await openTodosView(page);
      await addTodoWithMarker(page, marker);

      const card = scopeCardByMarker(page, marker);
      await expect(card, "newly added todo must be visible in kanban").toBeVisible();

      const checkbox = card.locator('input[type="checkbox"]').first();
      await expect(checkbox, "new todo starts un-completed").not.toBeChecked();
      await checkbox.check();
      await expect(checkbox, "checkbox state flips immediately").toBeChecked();

      await page.reload();
      await expect(page.getByTestId("todo-view-root")).toBeVisible();

      const cardAfter = scopeCardByMarker(page, marker);
      await expect(cardAfter, "todo persists across reload").toBeVisible();
      await expect(cardAfter.locator('input[type="checkbox"]').first(), "completed state persists across reload").toBeChecked();
    } finally {
      await deleteTodoByMarker(page, marker);
    }
  });
});

async function openTodosView(page: Page): Promise<void> {
  await page.goto("/todos");
  await expect(page.getByTestId("todo-view-root"), "/todos route must mount TodoExplorer").toBeVisible();
}

async function addTodoWithMarker(page: Page, marker: string): Promise<void> {
  await page.getByTestId("todo-add-btn").click();
  const textInput = page.getByTestId("todo-add-dialog-text");
  await expect(textInput, "add dialog must be open and focused").toBeVisible();
  await textInput.fill(marker);
  await page.getByTestId("todo-add-dialog-submit").click();
  await expect(textInput, "add dialog must close on submit").toHaveCount(0);
}

function scopeCardByMarker(page: Page, marker: string): Locator {
  return page.locator('[data-testid^="todo-card-"]').filter({ hasText: marker }).first();
}

async function deleteTodoByMarker(page: Page, marker: string): Promise<void> {
  try {
    if (page.isClosed()) return;
    const card = scopeCardByMarker(page, marker);
    if ((await card.count()) === 0) return;
    page.once("dialog", (dialog) => {
      dialog.accept().catch(() => undefined);
    });
    await card.click();
    await page.getByTestId("todo-edit-dialog-delete").click();
  } catch (err) {
    console.warn(`deleteTodoByMarker: best-effort cleanup skipped for marker ${marker}`, err);
  }
}
