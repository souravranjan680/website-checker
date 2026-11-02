import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config/env';

export const ACCESS_COOKIE = 'whc_access';
export const REFRESH_COOKIE = 'whc_refresh';

/**
 * Both cookies are HttpOnly: JavaScript in the page can't read them, so an XSS bug
 * can't steal them. SameSite stops other websites from sending them.
 * The refresh cookie is only sent to /api/auth (where it's used), never elsewhere.
 */
function baseOptions(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.auth.cookieSecure, sameSite: 'lax' };
}

export function setAuthCookies(
  res: Response,
  config: AppConfig,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOptions(config),
    path: '/api',
    maxAge: config.auth.accessTokenTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions(config),
    sameSite: 'strict',
    path: '/api/auth',
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response, config: AppConfig): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions(config), path: '/api' });
  res.clearCookie(REFRESH_COOKIE, {
    ...baseOptions(config),
    sameSite: 'strict',
    path: '/api/auth',
  });
}
