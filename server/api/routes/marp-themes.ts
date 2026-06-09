// GET /api/marp-themes — return every custom Marp theme registered
// in `config/marp-themes/`. Consumed by `MarpView.vue` at mount
// time to populate the previewer's themeSet.

import { Router, Request, Response } from "express";
import { listMarpThemes, type MarpTheme } from "../../workspace/marp-themes.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";

const router = Router();

router.get(API_ROUTES.marpThemes.list, (_req: Request, res: Response<MarpTheme[]>) => {
  res.json(listMarpThemes());
});

export default router;
