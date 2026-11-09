import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@whc/db';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config/env';
import type { ResolveHostname } from './lib/hostname-guard';
import { createJwtService } from './lib/jwt';
import type { Logger } from './lib/logger';
import type { Mailer } from './lib/mailer';
import { clientIp, createRateLimiter, type RateLimitStore } from './lib/rate-limit';
import { createRequireAuth, requireAdmin } from './middleware/auth';
import { CSRF_HEADER, requireCsrfHeader } from './middleware/csrf';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { createActivityRouter } from './modules/activity/activity.routes';
import { createAdminRouter } from './modules/admin/admin.routes';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createAuthService } from './modules/auth/auth.service';
import { createHealthRouter } from './modules/health/health.routes';
import type { HealthService } from './modules/health/health.service';
import { createProjectsRouter } from './modules/projects/projects.routes';
import { createProjectsService } from './modules/projects/projects.service';
import { createAiRouter } from './modules/ai/ai.routes';
import { createAiService } from './modules/ai/ai.service';
import { createBugReportsRouter } from './modules/bug-reports/bug-reports.routes';
import { createBugReportsService } from './modules/bug-reports/bug-reports.service';
import { createNotificationsRouter } from './modules/notifications/notifications.routes';
import { createDashboardRouter } from './modules/dashboard/dashboard.routes';
import { createDashboardService } from './modules/dashboard/dashboard.service';
import { createIssuesRouter } from './modules/issues/issues.routes';
import { createReportsRouter } from './modules/reports/reports.routes';
import { createReportsService } from './modules/reports/reports.service';
import { createVisualRouter } from './modules/visual/visual.routes';
import { createVisualService } from './modules/visual/visual.service';
import { createWebsitesRouter } from './modules/websites/websites.routes';
import { createWebsiteComparisonsRouter } from './modules/website-comparisons/website-comparisons.routes';
import { createWebsiteComparisonsService } from './modules/website-comparisons/website-comparisons.service';
import { createWebsitesService } from './modules/websites/websites.service';
import type { AiProvider } from './lib/ai-provider';
import type { ExportJobs } from './lib/export-jobs';
import type { ScanEventHub } from './lib/scan-events';
import type { ScanQueue } from './lib/scan-queue';
import { createScansRouter } from './modules/scans/scans.routes';
import { createScansService } from './modules/scans/scans.service';
import {
  createScreenshotsRouter,
  createTrackedIssuesRouter,
} from './modules/screenshots/screenshots.routes';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  prisma: PrismaClient;
  healthService: HealthService;
  rateLimitStore: RateLimitStore;
  mailer: Mailer;
  resolveHostname: ResolveHostname;
  scanQueue: ScanQueue;
  scanEvents: ScanEventHub;
  exportJobs: ExportJobs;
  /** null when no Anthropic key is configured: AI features answer "not configured". */
  aiProvider: AiProvider | null;
}

/**
 * Builds the Express application. It does not open ports or connect to databases
 * itself; those are passed in, which lets tests run the app with a test database,
 * an in-memory rate limiter and a fake mailer.
 * Middleware runs top to bottom for every request.
 */
export function createApp(deps: AppDependencies): Express {
  const { config, logger, prisma } = deps;
  const app = express();

  // Behind nginx/Docker: trust the first proxy so req.ip is the real client IP.
  app.set('trust proxy', 1);

  // 1. Give every request an ID and log it (the ID is returned in X-Request-Id).
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Health checks run every few seconds; keep them out of the logs.
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
    }),
  );

  // 2. Security headers (X-Content-Type-Options, X-Frame-Options, ...).
  app.use(helmet());

  // 3. Only our own frontends may call the API from a browser, with cookies.
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', CSRF_HEADER],
    }),
  );

  // 4. Parse JSON bodies (size-limited) and cookies.
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // 5. CSRF check on every state-changing request, then a general rate limit.
  app.use('/api', requireCsrfHeader);
  const rateLimit = createRateLimiter({
    store: deps.rateLimitStore,
    enabled: config.rateLimitEnabled,
    logger,
  });
  app.use(
    '/api',
    rateLimit({
      name: 'global',
      windowMs: 15 * 60_000,
      max: 1000,
      keys: (req) => [`ip:${clientIp(req)}`],
    }),
  );

  // 6. Services (business logic) and the authentication gate.
  const jwt = createJwtService(config.auth.jwtSecret, config.auth.accessTokenTtlSeconds);
  const requireAuth = createRequireAuth({ prisma, jwt });
  const auth = createAuthService({ prisma, jwt, mailer: deps.mailer, config, logger });
  const projects = createProjectsService({ prisma });
  const websites = createWebsitesService({ prisma, resolveHostname: deps.resolveHostname });
  const comparisons = createWebsiteComparisonsService({ prisma });
  const scans = createScansService({
    prisma,
    queue: deps.scanQueue,
    events: deps.scanEvents,
    config,
  });
  const dashboard = createDashboardService({ prisma });
  const reports = createReportsService({ prisma });
  const visual = createVisualService({ prisma, jobs: deps.exportJobs });
  const bugReports = createBugReportsService({ prisma });
  const ai = createAiService({ prisma, provider: deps.aiProvider, config, logger });
  // AI calls cost money: a per-user hourly limit (cached answers are not counted twice).
  const aiExplainLimit = rateLimit({
    name: 'ai-explain',
    windowMs: 60 * 60_000,
    max: config.ai.userHourlyLimit,
    keys: (req) => [`user:${req.user?.id ?? clientIp(req)}`],
  });
  // Scans are expensive: at most 20 started per hour per user.
  const scanStartLimit = rateLimit({
    name: 'scan-start',
    windowMs: 60 * 60_000,
    max: 20,
    keys: (req) => [`user:${req.user?.id ?? clientIp(req)}`],
  });

  // 7. Routes. Public: health + auth. Everything else requires a signed-in user.
  app.use('/api/health', createHealthRouter(deps.healthService));
  app.use('/api/auth', createAuthRouter({ auth, config, requireAuth, rateLimit }));
  app.use('/api/projects', requireAuth, createProjectsRouter({ projects }));
  app.use('/api/websites', requireAuth, createWebsitesRouter({ websites }));
  app.use('/api/website-comparisons', requireAuth, createWebsiteComparisonsRouter({ comparisons }));
  app.use('/api/activity', requireAuth, createActivityRouter({ prisma }));
  app.use('/api/admin', requireAuth, requireAdmin, createAdminRouter({ prisma }));
  app.use(
    '/api/scans',
    requireAuth,
    createScansRouter({ scans, events: deps.scanEvents, startLimit: scanStartLimit }),
  );
  app.use(
    '/api/screenshots',
    requireAuth,
    createScreenshotsRouter({ prisma, storageDir: config.scans.storageDir }),
  );
  app.use('/api/tracked-issues', requireAuth, createTrackedIssuesRouter({ prisma }));
  app.use('/api/issues', requireAuth, createIssuesRouter({ prisma }));
  app.use('/api/visual', requireAuth, createVisualRouter({ visual }));
  app.use('/api/notifications', requireAuth, createNotificationsRouter({ prisma }));
  app.use('/api/ai', requireAuth, createAiRouter({ ai, explainLimit: aiExplainLimit }));
  app.use(
    '/api/bug-reports',
    requireAuth,
    createBugReportsRouter({ bugReports, appUrl: config.appUrl }),
  );
  app.use('/api/dashboard', requireAuth, createDashboardRouter({ dashboard }));
  app.use(
    '/api/reports',
    requireAuth,
    createReportsRouter({
      reports,
      prisma,
      pdf: deps.exportJobs,
      storageDir: config.scans.storageDir,
    }),
  );

  // 8. Nothing matched → 404; any error → standard JSON error.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
