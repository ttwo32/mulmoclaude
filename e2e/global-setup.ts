import { chromium, type FullConfig } from "@playwright/test";

// Pre-warm the Vite dev server so the first navigation per spec doesn't
// pay Vite's on-demand module-compile cost. Without this, parallel test
// workers race to trigger the cold compile of route-level chunks and
// `page.goto` can exceed the 30 s test timeout — observed flaking on
// the `/files?path=...` non-ASCII redirects and the
// `accounting-action-routing` `/chat/<id>` navigation, all under the
// same shared `localhost:45173` dev server.
//
// We hit the three route shapes whose first compile is expensive enough
// to matter: SPA root, File Explorer, chat session. The work isn't the
// page render — it's the compile cache Vite warms up while serving the
// request. Errors are swallowed: even a failed goto still triggered the
// module compile that the real tests will then hit warm.

const PREWARM_ROUTES = ["/", "/files", "/chat/prewarm-warmup"] as const;
const PREWARM_TIMEOUT_MS = 60_000;
const DEFAULT_BASE_URL = "http://localhost:45173";

async function preWarmRoute(baseURL: string, route: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    try {
      await page.goto(route, { waitUntil: "load", timeout: PREWARM_TIMEOUT_MS });
    } catch {
      // First request after webServer boots can still fail if Vite is
      // mid-compile; the compile work it triggered is what we want.
    }
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const [project] = config.projects;
  const baseURL = project?.use?.baseURL ?? DEFAULT_BASE_URL;
  for (const route of PREWARM_ROUTES) {
    await preWarmRoute(baseURL, route);
  }
}
