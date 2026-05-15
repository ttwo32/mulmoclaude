// macOS Reminder side-channel adapter for the notifier engine.
//
// Subscribes to the engine's `published` events and fires
// `pushToMacosReminder` for each one — that helper is itself a no-op
// outside darwin / when `DISABLE_MACOS_REMINDER_NOTIFICATIONS=1`, so
// the adapter is safe to start unconditionally.
//
// History: this file used to be `legacy-adapters.ts` and carried a
// second branch that fanned out to chat-service bridges based on a
// `transportId` field on `pluginData`. That branch was dead code —
// the only callers setting `transportId` were the PoC
// `/api/notifications/test` route and `scheduleTestNotification`,
// both removed in the same change. Real production publishers
// (mcp-tools/notify, sources/pipeline/notify, plugins/diagnostics,
// mcpFailureMonitor) never set the field, so no behaviour changed.
// If a future use case wants bridge fan-out it should arrive with a
// concrete caller and a designed API, not as latent scaffolding.

import { onEvent } from "./engine.js";
import { pushToMacosReminder } from "../system/macosNotify.js";

/** Wire the macOS Reminder sink as an in-process listener on the
 *  notifier engine. Returns an unsubscribe function for tests /
 *  teardown. */
export function startMacosReminderAdapter(): () => void {
  return onEvent((event) => {
    if (event.type !== "published") return;
    void pushToMacosReminder(event.entry.title, event.entry.body);
  });
}
