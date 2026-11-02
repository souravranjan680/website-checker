import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config/env';
import type { Logger } from './lib/logger';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { createHealthRouter } from './modules/health/health.routes';
import type { HealthService } from './modules/health/health.service';

export interface AppDependencies {
  config: Pick<AppConfig, 'corsOrigins'>;
  logger: Logger;
  healthService: HealthService;
}

/**
 * Builds the Express application. It does not open ports or connect to databases
 * itself; those are passed in, which lets tests run the app with fake dependencies.
 * Middleware runs top to bottom for every request.
 */
export function createApp({ config, logger, healthService }: AppDependencies): Express {
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
  app.use(cors({ origin: config.corsOrigins, credentials: true }));

  // 4. Parse JSON request bodies (size-limited).
  app.use(express.json({ limit: '1mb' }));

  // 5. Feature routes. Phase 3 adds /api/auth, /api/projects, /api/websites, ...
  app.use('/api/health', createHealthRouter(healthService));

  // 6. Nothing matched → 404; any error → standard JSON error.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
