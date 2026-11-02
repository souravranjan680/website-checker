import {
  bugReportExportQuerySchema,
  bugReportListQuerySchema,
  bugReportToJira,
  bugReportToMarkdown,
  idSchema,
  updateBugReportSchema,
} from '@whc/shared';
import { Router } from 'express';
import { z } from 'zod';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import type { BugReportsService } from './bug-reports.service';

const createSchema = z.object({ issueId: idSchema });

/**
 * /api/bug-reports
 *   POST   /                 { issueId }  → 201 new, or 200 with the existing open report
 *   GET    /                 ?projectId&websiteId&status&q&page
 *   GET    /:id
 *   PATCH  /:id              edit fields / status (editors and owners)
 *   DELETE /:id
 *   GET    /:id/export       ?format=markdown|jira|json  (file download)
 */
export function createBugReportsRouter(deps: {
  bugReports: BugReportsService;
  appUrl: string;
}): Router {
  const { bugReports } = deps;
  const router = Router();
  const id = (value: unknown) => parseInput(idSchema, value);

  router.post('/', async (req, res) => {
    const { issueId } = parseInput(createSchema, req.body);
    const { report, created } = await bugReports.createFromIssue(currentUser(req), issueId);
    res.status(created ? 201 : 200).json({ data: report, meta: { created } });
  });

  router.get('/', async (req, res) => {
    res.json(
      await bugReports.list(currentUser(req), parseInput(bugReportListQuerySchema, req.query)),
    );
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await bugReports.get(currentUser(req), id(req.params.id)) });
  });

  router.patch('/:id', async (req, res) => {
    const input = parseInput(updateBugReportSchema, req.body);
    res.json({ data: await bugReports.update(currentUser(req), id(req.params.id), input) });
  });

  router.delete('/:id', async (req, res) => {
    await bugReports.remove(currentUser(req), id(req.params.id));
    res.status(204).end();
  });

  router.get('/:id/export', async (req, res) => {
    const report = await bugReports.get(currentUser(req), id(req.params.id));
    const { format } = parseInput(bugReportExportQuerySchema, req.query);
    // The screenshot link needs a signed-in project member to open.
    const screenshotUrl = report.screenshotId
      ? `${deps.appUrl}/api/screenshots/${report.screenshotId}`
      : null;
    const name = `bug-report-${report.id}`;
    if (format === 'json') {
      res
        .set({
          'Content-Disposition': `attachment; filename="${name}.json"`,
          'Cache-Control': 'no-store',
        })
        .json({ ...report, screenshotUrl });
      return;
    }
    const body =
      format === 'jira'
        ? bugReportToJira(report, screenshotUrl)
        : bugReportToMarkdown(report, screenshotUrl);
    res
      .status(200)
      .set({
        'Content-Type':
          format === 'jira' ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}.${format === 'jira' ? 'jira.txt' : 'md'}"`,
        'Cache-Control': 'no-store',
      })
      .send(body);
  });

  return router;
}
