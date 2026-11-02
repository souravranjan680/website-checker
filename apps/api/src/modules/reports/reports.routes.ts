import { loadReportData, type PrismaClient } from '@whc/db';
import { exportQuerySchema, idSchema, manualChecklistUpdateSchema } from '@whc/shared';
import { Router } from 'express';
import type { PdfRenderer } from '../../lib/pdf-renderer';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { exportFilename, toCsv, toJson } from './export';
import type { ReportsService } from './reports.service';

/** /api/reports/:scanId/*. Behind requireAuth; each handler checks project access. */
export function createReportsRouter(deps: {
  reports: ReportsService;
  prisma: PrismaClient;
  pdf: PdfRenderer;
}): Router {
  const { reports } = deps;
  const router = Router();
  const scanIdOf = (value: unknown) => parseInput(idSchema, value);

  router.get('/:scanId/accessibility', async (req, res) => {
    res.json({ data: await reports.accessibility(currentUser(req), scanIdOf(req.params.scanId)) });
  });

  router.patch('/:scanId/accessibility/checklist', async (req, res) => {
    const input = parseInput(manualChecklistUpdateSchema, req.body);
    res.json({
      data: await reports.updateChecklist(currentUser(req), scanIdOf(req.params.scanId), input),
    });
  });

  router.get('/:scanId/ui-health', async (req, res) => {
    res.json({ data: await reports.uiHealth(currentUser(req), scanIdOf(req.params.scanId)) });
  });

  router.get('/:scanId/responsive', async (req, res) => {
    res.json({ data: await reports.responsive(currentUser(req), scanIdOf(req.params.scanId)) });
  });

  for (const kind of ['performance', 'seo', 'security'] as const) {
    router.get(`/:scanId/${kind}`, async (req, res) => {
      res.json({
        data: await reports.pending(currentUser(req), scanIdOf(req.params.scanId), kind),
      });
    });
  }

  /** GET /api/reports/:scanId/export?format=csv|json|pdf[&category=ACCESSIBILITY] */
  router.get('/:scanId/export', async (req, res) => {
    const scanId = scanIdOf(req.params.scanId);
    await reports.scanInfo(currentUser(req), scanId); // permission check
    const { format, category } = parseInput(exportQuerySchema, req.query);

    if (format === 'pdf') {
      const data = await loadReportData(deps.prisma, scanId, { category, maxIssues: 1 });
      const pdf = await deps.pdf.render(scanId, category);
      res
        .status(200)
        .set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${exportFilename(data, 'pdf')}"`,
          'Cache-Control': 'no-store',
        })
        .send(pdf);
      return;
    }

    const data = await loadReportData(deps.prisma, scanId, { category });
    if (format === 'csv') {
      res
        .status(200)
        .set({
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${exportFilename(data, 'csv')}"`,
          'Cache-Control': 'no-store',
        })
        .send(toCsv(data));
      return;
    }
    res
      .status(200)
      .set({
        'Content-Disposition': `attachment; filename="${exportFilename(data, 'json')}"`,
        'Cache-Control': 'no-store',
      })
      .json(toJson(data));
  });

  return router;
}
