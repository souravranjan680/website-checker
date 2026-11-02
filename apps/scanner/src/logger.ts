import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    name: 'scanner',
    level,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss' },
          },
        }
      : {}),
  });
}
