import {
  createWebsiteSchema,
  idSchema,
  listQuerySchema,
  trackedIssueQuerySchema,
  updateWebsiteSchema,
  websiteListQuerySchema,
} from '@whc/shared';
import { Router } from 'express';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import type { WebsitesService } from './websites.service';

/** /api/websites/*. Every route is behind requireAuth (see app.ts). */
export function createWebsitesRouter({ websites }: { websites: WebsitesService }): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await websites.list(currentUser(req), parseInput(websiteListQuerySchema, req.query)));
  });

  router.post('/', async (req, res) => {
    const input = parseInput(createWebsiteSchema, req.body);
    res.status(201).json({ data: await websites.create(currentUser(req), input) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await websites.get(currentUser(req), parseInput(idSchema, req.params.id)) });
  });

  router.put('/:id', async (req, res) => {
    const input = parseInput(updateWebsiteSchema, req.body);
    res.json({
      data: await websites.update(currentUser(req), parseInput(idSchema, req.params.id), input),
    });
  });

  router.delete('/:id', async (req, res) => {
    await websites.remove(currentUser(req), parseInput(idSchema, req.params.id));
    res.status(204).end();
  });

  router.get('/:id/scans', async (req, res) => {
    const query = parseInput(listQuerySchema, req.query);
    res.json(
      await websites.listScans(currentUser(req), parseInput(idSchema, req.params.id), query),
    );
  });

  router.get('/:id/stats', async (req, res) => {
    res.json({ data: await websites.stats(currentUser(req), parseInput(idSchema, req.params.id)) });
  });

  router.get('/:id/issues', async (req, res) => {
    const query = parseInput(trackedIssueQuerySchema, req.query);
    res.json(
      await websites.trackedIssues(currentUser(req), parseInput(idSchema, req.params.id), query),
    );
  });

  return router;
}
