import { idSchema } from '@whc/shared';
import { Router, type RequestHandler } from 'express';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import type { AiService } from './ai.service';

/**
 * /api/ai
 *   GET  /status                    is AI configured, model, limits, today's usage
 *   GET  /issues/:issueId           saved explanation or null (never calls the AI)
 *   POST /issues/:issueId/explain   cached answer, or one AI call (rate limited per user)
 * The browser only ever sends an issue ID; the prompt is built on the server.
 */
export function createAiRouter(deps: { ai: AiService; explainLimit: RequestHandler }): Router {
  const { ai } = deps;
  const router = Router();

  router.get('/status', async (_req, res) => {
    res.json({ data: await ai.status() });
  });

  router.get('/issues/:issueId', async (req, res) => {
    res.json({ data: await ai.get(currentUser(req), parseInput(idSchema, req.params.issueId)) });
  });

  router.post('/issues/:issueId/explain', deps.explainLimit, async (req, res) => {
    const { insight, cached } = await ai.explain(
      currentUser(req),
      parseInput(idSchema, req.params.issueId),
    );
    res.status(cached ? 200 : 201).json({ data: insight, meta: { cached } });
  });

  return router;
}
