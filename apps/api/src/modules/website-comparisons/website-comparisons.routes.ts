import {
  createWebsiteComparisonSchema,
  idSchema,
  updateWebsiteComparisonSchema,
  websiteComparisonListQuerySchema,
} from '@whc/shared';
import { Router } from 'express';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import type { WebsiteComparisonsService } from './website-comparisons.service';

/** /api/website-comparisons/*. Every route is behind requireAuth (see app.ts). */
export function createWebsiteComparisonsRouter({
  comparisons,
}: {
  comparisons: WebsiteComparisonsService;
}): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(
      await comparisons.list(
        currentUser(req),
        parseInput(websiteComparisonListQuerySchema, req.query),
      ),
    );
  });

  router.post('/', async (req, res) => {
    const input = parseInput(createWebsiteComparisonSchema, req.body);
    res.status(201).json({ data: await comparisons.create(currentUser(req), input) });
  });

  router.get('/:id', async (req, res) => {
    res.json({
      data: await comparisons.get(currentUser(req), parseInput(idSchema, req.params.id)),
    });
  });

  router.put('/:id', async (req, res) => {
    const input = parseInput(updateWebsiteComparisonSchema, req.body);
    res.json({
      data: await comparisons.update(currentUser(req), parseInput(idSchema, req.params.id), input),
    });
  });

  router.delete('/:id', async (req, res) => {
    await comparisons.remove(currentUser(req), parseInput(idSchema, req.params.id));
    res.status(204).end();
  });

  return router;
}
