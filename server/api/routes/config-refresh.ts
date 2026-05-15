// POST /api/config/refresh — wraps `refreshScheduledSkills()` +
// `refreshUserTasks()` into one endpoint so the config-refresh
// PostToolUse hook (#1283) can fire-and-forget after Write/Edit of
// the relevant config files without knowing which refreshers exist.
// Serves the `mc-manage-skills` + `mc-manage-automations` preset
// skills (split out from the original `mc-settings` in #1295).
//
// Best-effort by design: failures from one refresher don't block the
// other; the response is always 200 with a per-refresher status so the
// caller (the hook) can log on errors but never has to abort.

import { Router, Request, Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { refreshScheduledSkills } from "../../workspace/skills/scheduler.js";
import { refreshUserTasks } from "../../workspace/skills/user-tasks.js";

const router = Router();

interface RefreshOutcome {
  ok: boolean;
  count?: number;
  error?: string;
}

interface RefreshResponse {
  skills: RefreshOutcome;
  userTasks: RefreshOutcome;
}

async function safeRefresh(label: string, refresher: () => Promise<number>): Promise<RefreshOutcome> {
  try {
    const count = await refresher();
    return { ok: true, count };
  } catch (err) {
    const error = errorMessage(err);
    log.warn("config-refresh", `${label} refresh failed`, { error });
    return { ok: false, error };
  }
}

router.post(API_ROUTES.config.refresh, async (_req: Request, res: Response<RefreshResponse>) => {
  const [skills, userTasks] = await Promise.all([safeRefresh("skills", refreshScheduledSkills), safeRefresh("userTasks", refreshUserTasks)]);
  log.debug("config-refresh", "refresh complete", { skills, userTasks });
  res.json({ skills, userTasks });
});

export default router;
