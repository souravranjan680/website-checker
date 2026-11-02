import {
  addMemberSchema,
  createProjectSchema,
  deleteProjectSchema,
  idSchema,
  listQuerySchema,
  updateMemberSchema,
  updateProjectSchema,
} from '@whc/shared';
import { Router } from 'express';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import type { ProjectsService } from './projects.service';

/** /api/projects/*. Every route is behind requireAuth (see app.ts). */
export function createProjectsRouter({ projects }: { projects: ProjectsService }): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = parseInput(listQuerySchema, req.query);
    res.json(await projects.list(currentUser(req), query));
  });

  router.post('/', async (req, res) => {
    const input = parseInput(createProjectSchema, req.body);
    res.status(201).json({ data: await projects.create(currentUser(req), input) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await projects.get(currentUser(req), parseInput(idSchema, req.params.id)) });
  });

  router.put('/:id', async (req, res) => {
    const input = parseInput(updateProjectSchema, req.body);
    res.json({
      data: await projects.update(currentUser(req), parseInput(idSchema, req.params.id), input),
    });
  });

  router.delete('/:id', async (req, res) => {
    const { confirmName } = parseInput(deleteProjectSchema, req.body ?? {});
    await projects.remove(currentUser(req), parseInput(idSchema, req.params.id), confirmName);
    res.status(204).end();
  });

  router.get('/:id/members', async (req, res) => {
    res.json({
      data: await projects.listMembers(currentUser(req), parseInput(idSchema, req.params.id)),
    });
  });

  router.post('/:id/members', async (req, res) => {
    const input = parseInput(addMemberSchema, req.body);
    const member = await projects.addMember(
      currentUser(req),
      parseInput(idSchema, req.params.id),
      input,
    );
    res.status(201).json({ data: member });
  });

  router.patch('/:id/members/:userId', async (req, res) => {
    const { role } = parseInput(updateMemberSchema, req.body);
    await projects.updateMemberRole(
      currentUser(req),
      parseInput(idSchema, req.params.id),
      parseInput(idSchema, req.params.userId),
      role,
    );
    res.status(204).end();
  });

  router.delete('/:id/members/:userId', async (req, res) => {
    await projects.removeMember(
      currentUser(req),
      parseInput(idSchema, req.params.id),
      parseInput(idSchema, req.params.userId),
    );
    res.status(204).end();
  });

  return router;
}
