// Calendar (scheduler plugin) delete confirmation — mirrors the
// todo explorer pattern: every delete path routes through a
// `window.confirm` gate so a stray click on the ✕ button cannot
// silently drop an event. See TodoExplorer.confirmAndDelete.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const SAMPLE_ITEM = {
  id: "evt_1",
  title: "Daily standup",
  createdAt: Date.now(),
  props: {},
};

async function mountCalendarWithItem(page: import("@playwright/test").Page, deleteHandler: (route: import("@playwright/test").Route) => void): Promise<void> {
  await mockAllApis(page);

  let currentItems = [SAMPLE_ITEM];

  await page.route("**/api/scheduler", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ json: { data: { items: currentItems } } });
      return;
    }
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as { action?: string; id?: string };
      if (body.action === "delete") {
        deleteHandler(route);
        currentItems = currentItems.filter((item) => item.id !== body.id);
        await route.fulfill({ json: { data: { items: currentItems } } });
        return;
      }
    }
    await route.fulfill({ json: { data: { items: currentItems } } });
  });

  await page.goto("/calendar");
  await expect(page.getByTestId("scheduler-view-root")).toBeVisible();
  // Switch to list view — that's where the ✕ button lives.
  await page.locator('button[title="List"]').click();
  await expect(page.getByTestId(`scheduler-item-delete-${SAMPLE_ITEM.id}`)).toBeVisible();
}

test.describe("Calendar — delete confirmation", () => {
  test("dismissing the confirm dialog keeps the item and fires no DELETE", async ({ page }) => {
    let deleteCalls = 0;
    await mountCalendarWithItem(page, () => {
      deleteCalls += 1;
    });

    page.once("dialog", (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain(SAMPLE_ITEM.title);
      dialog.dismiss().catch(() => {});
    });

    await page.getByTestId(`scheduler-item-delete-${SAMPLE_ITEM.id}`).click();

    // The item should remain in the list and the dispatch endpoint
    // should never have been called with action=delete.
    await expect(page.getByText(SAMPLE_ITEM.title)).toBeVisible();
    expect(deleteCalls).toBe(0);
  });

  test("accepting the confirm dialog fires the DELETE and removes the item", async ({ page }) => {
    let deleteCalls = 0;
    await mountCalendarWithItem(page, () => {
      deleteCalls += 1;
    });

    page.once("dialog", (dialog) => {
      expect(dialog.type()).toBe("confirm");
      dialog.accept().catch(() => {});
    });

    await page.getByTestId(`scheduler-item-delete-${SAMPLE_ITEM.id}`).click();

    await expect(page.getByText(SAMPLE_ITEM.title)).toHaveCount(0);
    expect(deleteCalls).toBe(1);
  });
});
