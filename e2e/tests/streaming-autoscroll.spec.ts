// E2E regression for the streaming auto-scroll bug (PR #529).
//
// Background: the sidebar's useChatScroll composable and StackView's
// own scroll watcher BOTH keyed only on `toolResults.length`. During
// assistant text streaming, `appendToLastAssistantText` appends to
// the last card in place — length does not change — so auto-scroll
// silently stopped after the first chunk, leaving the newest text
// below the fold.
//
// The fix watches a key that includes the last result's message
// length so every streaming chunk triggers a scroll. This test
// guards both scroll paths (sidebar in Single mode, StackView in
// Stack mode) because a future refactor that introduces a new view
// mode with its own scroll container must extend the same pattern.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { mockAgentWithPubSub, waitForScrollHeightStable, scrollMetrics } from "../fixtures/pubsub";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";

// Build a streaming transcript: the first text event creates the
// assistant card (length 0 → 1), every subsequent event appends to
// the same card via appendToLastAssistantText (length stays at 1).
// Generates enough total bytes to overflow the visible viewport so
// the scroll container actually has room to scroll.
function buildStreamingEvents(chunkCount: number, chunkBody: string) {
  return Array.from({ length: chunkCount }, () => ({
    type: "text",
    source: "assistant",
    message: chunkBody,
  }));
}

// We accept "near-bottom" rather than exact equality — browser
// rounding and late iframe sizing can leave a handful of pixels.
const BOTTOM_TOLERANCE_PX = 50;

// The sidebar SessionSidebar only renders preview titles for each
// result, so long streamed text never makes it overflow — the
// streaming bug wasn't observable there in practice. StackView on
// the other hand renders the full message body, where the stalled
// scroll was visible to users. That's the case this test guards.
test.describe("assistant text streaming — auto-scroll follows the stream", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("StackView (Stack mode) stays pinned to the bottom during streaming", async ({ page }) => {
    const chunk = "Streaming chunk with enough text to matter. ".repeat(5);
    await mockAgentWithPubSub(page, buildStreamingEvents(40, chunk));

    // Stack layout is a localStorage preference on /chat. Set it
    // before navigating so the first render is already in stack mode.
    await page.addInitScript(() => localStorage.setItem("canvas_layout_mode", "stack"));
    await page.goto("/chat");
    await page.getByTestId("user-input").fill("stream me in stack");
    await page.getByTestId("send-btn").click();

    await expect(page.locator("text=Streaming chunk").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await waitForScrollHeightStable(page, "stack-scroll");

    const { scrollTop, scrollHeight, clientHeight } = await scrollMetrics(page, "stack-scroll");
    expect(scrollHeight).toBeGreaterThan(clientHeight);
    expect(scrollHeight - scrollTop - clientHeight).toBeLessThan(BOTTOM_TOLERANCE_PX);
  });
});
