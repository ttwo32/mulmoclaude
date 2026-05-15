// Coverage for the wrapper's `legacyActionToNavigateTarget` helper —
// the migrated server-side equivalent of the deleted client-side
// `resolveNotificationTarget`. Each `NotificationAction` shape that
// the legacy callers emit must flatten to a relative URL the engine
// will accept (`navigateTarget` validation requires a single leading
// `/`, no scheme, no `//`).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { legacyActionToNavigateTarget } from "../../server/events/notifications.ts";
import { NOTIFICATION_ACTION_TYPES, NOTIFICATION_VIEWS } from "../../src/types/notification.ts";

describe("legacyActionToNavigateTarget — non-navigate actions", () => {
  it("returns undefined for `none`", () => {
    assert.equal(legacyActionToNavigateTarget({ type: NOTIFICATION_ACTION_TYPES.none }), undefined);
  });
  it("returns undefined when action is missing", () => {
    assert.equal(legacyActionToNavigateTarget(undefined), undefined);
  });
});

describe("legacyActionToNavigateTarget — chat target", () => {
  it("returns /chat/:sessionId for sessionId only", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.chat, sessionId: "sess-1" },
    });
    assert.equal(result, "/chat/sess-1");
  });
  it("returns undefined when sessionId is missing", () => {
    // The chat route requires :sessionId — without it the user would
    // bounce off the catch-all redirect.
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      // @ts-expect-error intentionally invalid — testing runtime guard
      target: { view: NOTIFICATION_VIEWS.chat },
    });
    assert.equal(result, undefined);
  });
});

describe("legacyActionToNavigateTarget — todos / automations / sources", () => {
  it("/todos with optional itemId", () => {
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.todos, itemId: "todo-42" },
      }),
      "/todos/todo-42",
    );
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.todos },
      }),
      "/todos",
    );
  });
  it("/automations with optional taskId", () => {
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.automations, taskId: "task-1" },
      }),
      "/automations/task-1",
    );
  });
  it("/sources with optional slug", () => {
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.sources, slug: "fed" },
      }),
      "/sources/fed",
    );
  });
  it("/calendar (no identifier)", () => {
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.calendar },
      }),
      "/calendar",
    );
  });
});

describe("legacyActionToNavigateTarget — files", () => {
  it("encodes nested path segments individually", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "sources/fed/2026-04-25.md" },
    });
    assert.equal(result, "/files/sources/fed/2026-04-25.md");
  });
  it("encodes spaces / special characters per segment", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "with space/file?.md" },
    });
    assert.equal(result, "/files/with%20space/file%3F.md");
  });
  it("falls back to /files when path is missing", () => {
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.files },
      }),
      "/files",
    );
  });
});

describe("legacyActionToNavigateTarget — wiki", () => {
  it("includes /pages/:slug and the optional anchor", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, slug: "daily-briefing", anchor: "front-page" },
    });
    assert.equal(result, "/wiki/pages/daily-briefing#front-page");
  });
  it("anchor without slug lands on /wiki", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, anchor: "intro" },
    });
    assert.equal(result, "/wiki#intro");
  });
});

describe("legacyActionToNavigateTarget — reserved characters", () => {
  // Each user/content-derived segment (sessionId, itemId, taskId,
  // slug, anchor) must ride through encodeURIComponent so reserved
  // chars don't change the URL's structure when interpolated.
  it("encodes a slug containing '?' so it doesn't become a query string", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.sources, slug: "weird?slug" },
    });
    assert.equal(result, "/sources/weird%3Fslug");
  });

  it("encodes an anchor containing '#' so the fragment isn't doubled", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, slug: "page", anchor: "#mid" },
    });
    assert.equal(result, "/wiki/pages/page#%23mid");
  });

  it("encodes a slug containing '/' so route matching stays single-segment", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.sources, slug: "a/b" },
    });
    assert.equal(result, "/sources/a%2Fb");
  });

  it("encodes an itemId containing '%' so it isn't seen as a stray escape", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.todos, itemId: "x%y" },
    });
    assert.equal(result, "/todos/x%25y");
  });

  it("encodes a sessionId with whitespace", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.chat, sessionId: "id with space" },
    });
    assert.equal(result, "/chat/id%20with%20space");
  });

  it("encodes a taskId containing '&' so it doesn't merge with following query params", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.automations, taskId: "task&id" },
    });
    assert.equal(result, "/automations/task%26id");
  });

  it("preserves URL-safe slugs unchanged (kebab-case, digits, dots)", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, slug: "daily-briefing-2026-04-25", anchor: "front-page" },
    });
    assert.equal(result, "/wiki/pages/daily-briefing-2026-04-25#front-page");
  });
});

describe("legacyActionToNavigateTarget — dot-segment safety", () => {
  // `encodeURIComponent` doesn't touch '.' / '..', so without an
  // explicit guard those segments survive into the path and the
  // browser's URL normalization can collapse them, jumping out of
  // the intended view's namespace (e.g. /files/../chat/sess →
  // /chat/sess). The guards below pin the safe behaviour:
  //   - files: any unsafe segment ⇒ fall back to /files index
  //   - single-segment fields (todos, automations, sources, wiki
  //     slug): unsafe value ⇒ fall back to that view's index
  //   - chat: unsafe sessionId ⇒ drop the action (chat has no usable
  //     index without sessionId)
  it("files: rejects '..' as a path segment and falls back to /files", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "../chat/sess" },
    });
    assert.equal(result, "/files");
  });

  it("files: rejects '.' as a path segment and falls back to /files", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "./foo" },
    });
    assert.equal(result, "/files");
  });

  it("files: rejects '..' anywhere in a multi-segment path", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "a/b/../c" },
    });
    assert.equal(result, "/files");
  });

  it("files: '..foo' (substring, not whole component) is allowed and encoded normally", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "a/..foo/b" },
    });
    assert.equal(result, "/files/a/..foo/b");
  });

  it("chat: dot-segment sessionId drops the action (no usable index)", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.chat, sessionId: ".." },
    });
    assert.equal(result, undefined);
  });

  it("todos: dot-segment itemId falls back to /todos", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.todos, itemId: ".." },
    });
    assert.equal(result, "/todos");
  });

  it("automations: dot-segment taskId falls back to /automations", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.automations, taskId: "." },
    });
    assert.equal(result, "/automations");
  });

  it("sources: dot-segment slug falls back to /sources", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.sources, slug: ".." },
    });
    assert.equal(result, "/sources");
  });

  it("wiki: dot-segment slug omits the /pages/<slug> portion (anchor still rendered)", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, slug: "..", anchor: "intro" },
    });
    assert.equal(result, "/wiki#intro");
  });

  it("wiki: dot-segment anchor is allowed (fragment, not path)", () => {
    // The fragment doesn't participate in path normalization so
    // there's no traversal risk; allow whatever the user passes
    // (encoded for safety against query/path delimiters).
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, slug: "page", anchor: ".." },
    });
    assert.equal(result, "/wiki/pages/page#..");
  });
});

describe("legacyActionToNavigateTarget — engine constraints", () => {
  it("every emitted target starts with a single '/' (no scheme, no '//')", () => {
    const targets: { view: string; expected: string }[] = [
      { view: "chat", expected: "/chat" },
      { view: "todos", expected: "/todos" },
      { view: "calendar", expected: "/calendar" },
      { view: "automations", expected: "/automations" },
      { view: "sources", expected: "/sources" },
      { view: "files", expected: "/files" },
      { view: "wiki", expected: "/wiki" },
    ];
    for (const { view, expected } of targets) {
      // Build a minimal action per view, with no optional identifiers.
      const result = legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        // For chat, sessionId is required so we expect undefined here —
        // the others all return their index path.
        target: view === "chat" ? { view: "chat", sessionId: "s" } : { view },
      } as Parameters<typeof legacyActionToNavigateTarget>[0]);
      const expectedStart = view === "chat" ? "/chat/s" : expected;
      assert.equal(result, expectedStart);
      assert.ok(result?.startsWith("/"));
      assert.ok(!result?.startsWith("//"));
    }
  });
});
