import { dashboardQuerySchema } from '@whc/shared';
import { Router } from 'express';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import type { DashboardService } from './dashboard.service';

/** /api/dashboard/*: numbers and chart series, always limited to the user's projects. */
export function createDashboardRouter({ dashboard }: { dashboard: DashboardService }): Router {
  const router = Router();
  router.get('/summary', async (req, res) => {
    res.json({
      data: await dashboard.summary(currentUser(req), parseInput(dashboardQuerySchema, req.query)),
    });
  });
  router.get('/trends', async (req, res) => {
    res.json({
      data: await dashboard.trends(currentUser(req), parseInput(dashboardQuerySchema, req.query)),
    });
  });
  return router;
}
