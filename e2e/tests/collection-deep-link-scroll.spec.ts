// E2E coverage for the `?selected=<id>` deep link (the path a
// collection-item notification takes): opening a collection with a
// selected id that loaded far down a long list must open that record's
// detail. It now opens in the shared, viewport-centred record modal, so
// the record is on screen no matter where its row sits in the list — the
// old inline-expansion era needed an explicit scroll-into-view; the modal
// makes that moot.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Enough rows that the targeted id near the bottom renders well below the
// fold on the default 720px-tall viewport.
const ITEM_COUNT = 60;
const TARGET_ID = "item-55";

const LONG_LIST = {
  collection: {
    slug: "long-list",
    title: "Long List",
    icon: "list",
    source: "user",
    schema: {
      title: "Long List",
      icon: "list",
      dataPath: "data/long-list/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name" },
      },
    },
  },
  items: Array.from({ length: ITEM_COUNT }, (_, i) => ({ id: `item-${i}`, name: `Row ${i}` })),
};

async function mockCollection(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections/long-list",
    (route) => route.fulfill({ json: LONG_LIST }),
  );
}

test("a `?selected=` deep link opens the record in the centred modal", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page);

  await page.goto(`/collections/long-list?selected=${TARGET_ID}`);

  // The targeted record opens in the shared modal...
  const modal = page.getByTestId("collections-record-modal");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("collections-detail-title")).toHaveText(TARGET_ID);

  // ...and the modal is on screen regardless of the row's position in the
  // long list (it's viewport-centred, so this needs no scroll).
  await expect(page.getByTestId("collections-detail")).toBeInViewport();
});
