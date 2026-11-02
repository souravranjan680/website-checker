import { Router } from 'express';
import type { HealthService } from './health.service';

/**
 * GET /api/health/live → is the API process running? (no dependencies checked)
 * GET /api/health      → can the API reach PostgreSQL and Redis? 200 if yes, 503 if not.
 */
export function createHealthRouter(healthService: HealthService): Router {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });

  router.get('/', async (_req, res) => {
    const report = await healthService.getReport();
    res
      .status(report.status === 'ok' ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json(report);
  });

  return router;
}
