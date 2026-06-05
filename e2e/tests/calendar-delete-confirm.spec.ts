// Calendar (scheduler plugin) delete confirmation — every delete
// path routes through a `window.confirm` gate so a stray click on
// the ✕ button cannot silently drop an event.

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

interface Item {
  id: string;
  title: string;
  createdAt: number;
  props: Record<string, unknown>;
}

const SAMPLE_ITEM: Item = {
  id: "evt_1",
  title: "Daily standup",
  createdAt: Date.now(),
  props: {},
};

async function stubSchedulerEndpoint(page: Page, item: Item, deleteHandler: (route: Route) => void): Promise<void> {
  await mockAllApis(page);
  let currentItems = [item];
  await page.route("**/api/scheduler", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as { action?: string; id?: string };
      if (body.action === "delete") {
        deleteHandler(route);
        currentItems = currentItems.filter((each) => each.id !== body.id);
      }
    }
    await route.fulfill({ json: { data: { items: currentItems } } });
  });
}

async function openCalendarListView(page: Page, item: Item): Promise<void> {
  await page.goto("/calendar");
  await expect(page.getByTestId("scheduler-view-root")).toBeVisible();
  // Switch to list view via testid — the ✕ delete button only renders there.
  await page.getByTestId("scheduler-view-mode-list").click();
  await expect(page.getByTestId(`scheduler-item-delete-${item.id}`)).toBeVisible();
}

async function mountCalendarWithItem(page: Page, item: Item, deleteHandler: (route: Route) => void): Promise<void> {
  await stubSchedulerEndpoint(page, item, deleteHandler);
  await openCalendarListView(page, item);
}

test.describe("Calendar — delete confirmation", () => {
  test("dismissing the confirm dialog keeps the item and fires no DELETE", async ({ page }) => {
    let deleteCalls = 0;
    await mountCalendarWithItem(page, SAMPLE_ITEM, () => {
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
    await mountCalendarWithItem(page, SAMPLE_ITEM, () => {
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

  test("title with quotes and special characters round-trips into the confirm message", async ({ page }) => {
    // Guards against accidental HTML-escaping or interpolation breakage in
    // vue-i18n's `{title}` placeholder — confirm() takes a plain string, so
    // the message must contain the raw title verbatim.
    const quotedItem: Item = {
      id: "evt_quoted",
      title: 'Sync "Q3 review" & plan — 100%',
      createdAt: Date.now(),
      props: {},
    };

    await mountCalendarWithItem(page, quotedItem, () => {});

    let observedMessage = "";
    page.once("dialog", (dialog) => {
      observedMessage = dialog.message();
      dialog.dismiss().catch(() => {});
    });

    await page.getByTestId(`scheduler-item-delete-${quotedItem.id}`).click();
    expect(observedMessage).toContain(quotedItem.title);
  });
});
