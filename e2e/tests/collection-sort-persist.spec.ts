// E2E: the standalone /collections/:slug table persists the user's active
// column sort across a page reload (localStorage, keyed by slug). Pins the
// behaviour requested in the collections UI pass — a sorted Todo-style list
// must reopen sorted instead of resetting to the file order.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const SCORES = {
  collection: {
    slug: "scores",
    title: "Scores",
    icon: "leaderboard",
    source: "user",
    schema: {
      title: "Scores",
      icon: "leaderboard",
      dataPath: "data/scores/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name" },
        points: { type: "number", label: "Points" },
      },
    },
  },
  // File order is a(30), b(10), c(20) — deliberately NOT sorted by points.
  items: [
    { id: "a", name: "Alpha", points: 30 },
    { id: "b", name: "Bravo", points: 10 },
    { id: "c", name: "Charlie", points: 20 },
  ],
};

async function mockCollection(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections/scores",
    (route) => route.fulfill({ json: SCORES }),
  );
}

/** Assert the table rows render top-to-bottom in `order` (by primary key). */
async function expectRowOrder(page: Page, order: string[]): Promise<void> {
  const rows = page.locator('[data-testid^="collections-row-"]');
  await expect(rows).toHaveCount(order.length);
  for (let index = 0; index < order.length; index++) {
    await expect(rows.nth(index)).toHaveAttribute("data-testid", `collections-row-${order[index]}`);
  }
}

test("standalone table sort persists across a reload", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page);

  await page.goto("/collections/scores");
  await expectRowOrder(page, ["a", "b", "c"]); // file order, unsorted

  // One click on the Points header → ascending: b(10), c(20), a(30).
  await page.getByTestId("collections-sort-points").click();
  await expectRowOrder(page, ["b", "c", "a"]);

  // Reload: the ascending Points sort must survive (localStorage), so the
  // table reopens in the same order — not the file order.
  await page.reload();
  await expectRowOrder(page, ["b", "c", "a"]);
  const sortedHeader = page.locator('th[aria-sort="ascending"]');
  await expect(sortedHeader).toHaveCount(1);
  await expect(sortedHeader).toContainText("Points");
});

test("clearing the sort is also persisted", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page);

  await page.goto("/collections/scores");
  // Cycle Points none → asc → desc → none, then reload: back to file order.
  const sortButton = page.getByTestId("collections-sort-points");
  await sortButton.click(); // asc
  await sortButton.click(); // desc
  await sortButton.click(); // none
  await expectRowOrder(page, ["a", "b", "c"]);

  await page.reload();
  await expectRowOrder(page, ["a", "b", "c"]);
  await expect(page.locator("th[aria-sort=ascending], th[aria-sort=descending]")).toHaveCount(0);
});
