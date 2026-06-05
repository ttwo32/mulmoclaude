// E2E for the inline "/" command palette (useSlashCommandMenu wired into
// ChatInput). The menu lists skills from a mocked GET /api/skills; selecting
// one POPULATES the textarea (it must never send), so "no send" is verified
// the same way ime-enter.spec does — by asserting POST /api/agent never fired.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { chatInput, fillChatInput } from "../fixtures/chat";

const SKILLS = [
  { name: "archive", description: "Archive things", source: "user" },
  { name: "android", description: "Android helper", source: "project" },
  { name: "publish", description: "Publish a package", source: "user" },
];

test.describe("slash command menu", () => {
  let agentCalls: string[];

  test.beforeEach(async ({ page }) => {
    agentCalls = [];
    await mockAllApis(page);

    // Registered after mockAllApis so this wins (last-registered first).
    await page.route(
      (url) => url.pathname === "/api/skills",
      (route) => route.fulfill({ json: { skills: SKILLS } }),
    );

    await page.route(
      (url) => url.pathname === "/api/agent",
      (route) => {
        if (route.request().method() === "POST") {
          agentCalls.push(route.request().postData() ?? "");
          return route.fulfill({ status: 202, json: { chatSessionId: "mock-session" } });
        }
        return route.fallback();
      },
    );

    await page.goto("/");
    await expect(page.getByTestId("user-input")).toBeVisible();
  });

  test("typing a bare / token opens the menu and filters by name prefix", async ({ page }) => {
    await fillChatInput(page, "/a");

    await expect(page.getByTestId("slash-command-menu")).toBeVisible();
    await expect(page.getByTestId("slash-command-item-archive")).toBeVisible();
    await expect(page.getByTestId("slash-command-item-android")).toBeVisible();
    // `publish` does not start with "a" — filtered out.
    await expect(page.getByTestId("slash-command-item-publish")).toHaveCount(0);

    // A space turns it into a command-with-args → menu closes.
    await fillChatInput(page, "/a ");
    await expect(page.getByTestId("slash-command-menu")).toHaveCount(0);
  });

  test("Enter selects the highlighted item, populating the input without sending", async ({ page }) => {
    await fillChatInput(page, "/a");
    await expect(page.getByTestId("slash-command-menu")).toBeVisible();

    await chatInput(page).press("Enter");

    // Populated with a trailing space (ready for args), and NOT sent.
    await expect(chatInput(page)).toHaveValue("/archive ");
    await expect(page.getByTestId("slash-command-menu")).toHaveCount(0);
    await expect.poll(() => agentCalls.length, { timeout: 500 }).toBe(0);
  });

  test("ArrowDown moves the highlight before Enter selects", async ({ page }) => {
    await fillChatInput(page, "/a");
    await expect(page.getByTestId("slash-command-menu")).toBeVisible();

    const input = chatInput(page);
    await input.press("ArrowDown");
    await input.press("Enter");

    await expect(input).toHaveValue("/android ");
    await expect.poll(() => agentCalls.length, { timeout: 500 }).toBe(0);
  });

  test("Escape dismisses the menu and leaves the text untouched", async ({ page }) => {
    await fillChatInput(page, "/a");
    await expect(page.getByTestId("slash-command-menu")).toBeVisible();

    await chatInput(page).press("Escape");

    await expect(page.getByTestId("slash-command-menu")).toHaveCount(0);
    await expect(chatInput(page)).toHaveValue("/a");
  });

  test("clicking an item populates the input", async ({ page }) => {
    await fillChatInput(page, "/a");
    await expect(page.getByTestId("slash-command-menu")).toBeVisible();

    await page.getByTestId("slash-command-item-android").click();

    await expect(chatInput(page)).toHaveValue("/android ");
    await expect.poll(() => agentCalls.length, { timeout: 500 }).toBe(0);
  });
});
