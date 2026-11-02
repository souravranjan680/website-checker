import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Structured JSON logger. In development the output is pretty-printed;
 * in production each line is JSON so log tools can search it.
 * Secrets are replaced with "[Redacted]" before anything is written.
 */
export function createLogger(options: { level: string; pretty: boolean }): Logger {
  return pino({
    level: options.level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.apiKey',
        '*["x-api-key"]',
        'err.headers',
      ],
      censor: '[Redacted]',
    },
    ...(options.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss' },
          },
        }
      : {}),
  });
}
