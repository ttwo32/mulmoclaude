// HTTP route for the dashboard layout (per-tile view mode + tile order
// for the favorites grid).
//
//   GET /api/dashboard  → { tiles }
//   PUT /api/dashboard  → replace the full list → { tiles }
//
// The client owns ordering / view mode and sends the whole array; the
// server normalises (non-empty slug, dedupe on slug, optional string
// viewMode) before persisting. A single replace-endpoint mirrors the
// shortcuts route.

import { Router, Request, Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import type { DashboardFile } from "../../../src/types/dashboard.js";
import { readDashboard, writeDashboard } from "../../utils/files/dashboard-io.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { log } from "../../system/logger/index.js";

const router = Router();

type DashboardResponse = DashboardFile;

router.get(API_ROUTES.dashboard, async (_req: Request, res: Response<DashboardResponse>) => {
  try {
    res.json(await readDashboard());
  } catch (err) {
    log.warn("dashboard", "read failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

router.put(API_ROUTES.dashboard, async (req: Request, res: Response<DashboardResponse>) => {
  const { tiles, rowHeights } = req.body ?? {};
  if (!Array.isArray(tiles)) {
    badRequest(res, "Request body must be { tiles: DashboardTile[], rowHeights?: number[] }");
    return;
  }
  try {
    res.json(await writeDashboard({ tiles, rowHeights }));
  } catch (err) {
    log.warn("dashboard", "write failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

export default router;
