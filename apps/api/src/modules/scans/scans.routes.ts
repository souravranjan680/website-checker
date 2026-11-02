import {
  FINISHED_SCAN_STATUSES,
  idSchema,
  issueListQuerySchema,
  scanListQuerySchema,
  startScanSchema,
  type ScanEvent,
  type ScanProgressEvent,
} from '@whc/shared';
import { Router, type RequestHandler } from 'express';
import type { ScanEventHub } from '../../lib/scan-events';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import type { ScansService } from './scans.service';

/** /api/scans/*. Every route is behind requireAuth (see app.ts). */
export function createScansRouter(deps: {
  scans: ScansService;
  events: ScanEventHub;
  startLimit: RequestHandler;
}): Router {
  const { scans, events } = deps;
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await scans.list(currentUser(req), parseInput(scanListQuerySchema, req.query)));
  });

  router.post('/', deps.startLimit, async (req, res) => {
    const input = parseInput(startScanSchema, req.body);
    res.status(201).json({ data: await scans.start(currentUser(req), input) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await scans.details(currentUser(req), parseInput(idSchema, req.params.id)) });
  });

  router.post('/:id/cancel', async (req, res) => {
    res
      .status(202)
      .json({ data: await scans.cancel(currentUser(req), parseInput(idSchema, req.params.id)) });
  });

  router.post('/:id/rescan', deps.startLimit, async (req, res) => {
    res
      .status(201)
      .json({ data: await scans.rescan(currentUser(req), parseInput(idSchema, req.params.id)) });
  });

  router.get('/:id/pages', async (req, res) => {
    res.json({ data: await scans.pages(currentUser(req), parseInput(idSchema, req.params.id)) });
  });

  router.get('/:id/issues', async (req, res) => {
    const query = parseInput(issueListQuerySchema, req.query);
    res.json(await scans.issues(currentUser(req), parseInput(idSchema, req.params.id), query));
  });

  router.get('/:id/compare', async (req, res) => {
    const other =
      typeof req.query.with === 'string' ? parseInput(idSchema, req.query.with) : undefined;
    res.json({
      data: await scans.compare(currentUser(req), parseInput(idSchema, req.params.id), other),
    });
  });

  /**
   * Live progress with Server-Sent Events: the response stays open and the server
   * writes "event: progress\ndata: {...}\n\n" whenever the scanner reports progress.
   * The browser's EventSource reads it and reconnects automatically if it drops.
   */
  router.get('/:id/events', async (req, res) => {
    const user = currentUser(req);
    const scanId = parseInput(idSchema, req.params.id);
    const scan = await scans.details(user, scanId); // permission check (404/403)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tell nginx not to buffer
    });
    const send = (event: ScanEvent) =>
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    const isFinished = (status: string) =>
      (FINISHED_SCAN_STATUSES as readonly string[]).includes(status);

    // Subscribe first, then send the current state, so no update can slip in between.
    let closed = false;
    const unsubscribe = events.subscribe(scanId, (event) => {
      if (closed) return;
      send(event);
      if (event.type === 'finished') close();
    });
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    }
    req.on('close', close);

    const latest = await events.latest(scanId);
    const snapshot: ScanProgressEvent = {
      type: 'progress',
      scanId,
      status: scan.status,
      progress: scan.progress,
      step: latest?.step ?? scan.currentStep ?? '',
      currentUrl: latest?.currentUrl ?? null,
      pagesDiscovered: Math.max(scan.pagesDiscovered, latest?.pagesDiscovered ?? 0),
      pagesScanned: Math.max(scan.pagesScanned, latest?.pagesScanned ?? 0),
      pagesFailed: scan.pagesFailed,
      issuesFound: Math.max(scan.totalIssues, latest?.issuesFound ?? 0),
      at: new Date().toISOString(),
    };
    send(snapshot);
    if (isFinished(scan.status)) {
      send({ type: 'finished', scanId, status: scan.status, at: new Date().toISOString() });
      close();
    }
  });

  return router;
}
