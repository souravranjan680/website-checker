import {
  createVisualBaselineSchema,
  idSchema,
  replaceVisualBaselineSchema,
  updateVisualBaselineSchema,
} from '@whc/shared';
import { Router } from 'express';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import type { VisualService } from './visual.service';

/**
 * Visual regression baselines. Every change here is an explicit user action
 * (editors and owners); scans only ever read baselines.
 *   GET    /api/visual/baselines                          all baselines the user can see
 *   GET    /api/visual/websites/:websiteId/baselines
 *   POST   /api/visual/websites/:websiteId/baselines      { screenshotId, failPercent, ignoreSelectors, ignoreRects }
 *   PATCH  /api/visual/baselines/:id                      { failPercent?, ignoreSelectors?, ignoreRects? }
 *   POST   /api/visual/baselines/:id/replace              { screenshotId }
 *   DELETE /api/visual/baselines/:id
 *   GET    /api/visual/baselines/:id/comparisons
 *   GET    /api/visual/scans/:scanId                      snapshots of one scan
 */
export function createVisualRouter({ visual }: { visual: VisualService }): Router {
  const router = Router();
  const id = (value: unknown) => parseInput(idSchema, value);

  router.get('/baselines', async (req, res) => {
    res.json({ data: await visual.listAll(currentUser(req)) });
  });

  router.get('/websites/:websiteId/baselines', async (req, res) => {
    res.json({ data: await visual.listBaselines(currentUser(req), id(req.params.websiteId)) });
  });

  router.post('/websites/:websiteId/baselines', async (req, res) => {
    const input = parseInput(createVisualBaselineSchema, req.body);
    res.status(201).json({
      data: await visual.createBaseline(currentUser(req), id(req.params.websiteId), input),
    });
  });

  router.patch('/baselines/:id', async (req, res) => {
    const input = parseInput(updateVisualBaselineSchema, req.body);
    res.json({ data: await visual.updateBaseline(currentUser(req), id(req.params.id), input) });
  });

  router.post('/baselines/:id/replace', async (req, res) => {
    const { screenshotId } = parseInput(replaceVisualBaselineSchema, req.body);
    res.json({
      data: await visual.replaceBaseline(currentUser(req), id(req.params.id), screenshotId),
    });
  });

  router.delete('/baselines/:id', async (req, res) => {
    await visual.deleteBaseline(currentUser(req), id(req.params.id));
    res.status(204).end();
  });

  router.get('/baselines/:id/comparisons', async (req, res) => {
    res.json({ data: await visual.comparisons(currentUser(req), id(req.params.id)) });
  });

  router.get('/scans/:scanId', async (req, res) => {
    res.json({ data: await visual.scanSnapshots(currentUser(req), id(req.params.scanId)) });
  });

  return router;
}
