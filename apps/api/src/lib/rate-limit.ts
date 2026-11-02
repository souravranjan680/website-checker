import type { Redis } from 'ioredis';
import type { Request, RequestHandler } from 'express';
import { AppError } from './errors';
import type { Logger } from './logger';

/**
 * Counts hits per key in fixed time windows ("at most 5 logins per minute").
 * Redis is used so the count is shared by every API instance and survives restarts.
 */
export interface RateLimitStore {
  /** Adds one hit and returns the count in the current window + ms until it resets. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetInMs: number }>;
}

export function createRedisRateLimitStore(redis: Redis): RateLimitStore {
  return {
    async hit(key, windowMs) {
      const results = await redis.multi().incr(key).pttl(key).exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      let ttl = Number(results?.[1]?.[1] ?? -1);
      if (ttl < 0) {
        await redis.pexpire(key, windowMs); // first hit: start the window
        ttl = windowMs;
      }
      return { count, resetInMs: ttl };
    },
  };
}

/** In-memory store for tests (not shared between processes). */
export function createMemoryRateLimitStore(): RateLimitStore {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, windowMs) {
      const now = Date.now();
      const current = windows.get(key);
      const entry =
        current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
      entry.count += 1;
      windows.set(key, entry);
      return { count: entry.count, resetInMs: entry.resetAt - now };
    },
  };
}

export interface RateLimitRule {
  name: string;
  windowMs: number;
  max: number;
  /** One or more keys to count. A request is blocked if ANY key is over its limit. */
  keys: (req: Request) => string[];
}

export interface RateLimiterFactory {
  (rule: RateLimitRule): RequestHandler;
}

/**
 * Creates rate-limit middleware. If Redis is unreachable we "fail open" (allow the
 * request and log a warning): a Redis outage shouldn't lock every user out.
 */
export function createRateLimiter(options: {
  store: RateLimitStore;
  enabled: boolean;
  logger: Logger;
}): RateLimiterFactory {
  return (rule) => async (req, res, next) => {
    if (!options.enabled) return next();
    try {
      for (const key of rule.keys(req)) {
        const { count, resetInMs } = await options.store.hit(
          `rl:${rule.name}:${key}`,
          rule.windowMs,
        );
        if (count > rule.max) {
          res.setHeader('Retry-After', Math.ceil(resetInMs / 1000));
          return next(
            new AppError(
              429,
              'RATE_LIMITED',
              'Too many attempts. Please wait a moment and try again.',
            ),
          );
        }
      }
    } catch (error) {
      options.logger.warn(
        { err: (error as Error).message, rule: rule.name },
        'Rate limiter unavailable',
      );
    }
    next();
  };
}

/** Client IP (Express resolves X-Forwarded-For because "trust proxy" is set). */
export function clientIp(req: Request): string {
  return req.ip ?? 'unknown';
}
