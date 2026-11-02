import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'whc-web';

/**
 * CSRF protection: an evil website could make your browser submit a form to our API,
 * and the browser would attach your cookies automatically. But a plain cross-site
 * form cannot add a custom header, and sending one triggers a CORS check that our
 * API only allows for our own frontend. So we require
 *   X-Requested-With: whc-web
 * on every state-changing request. (SameSite cookies are a second layer.)
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  // Non-browser clients authenticate with a Bearer token, which browsers never add on their own.
  if (req.get('authorization')?.startsWith('Bearer ')) return next();
  if (req.get(CSRF_HEADER) === CSRF_HEADER_VALUE) return next();
  next(new AppError(403, 'CSRF_HEADER_MISSING', 'Missing or invalid X-Requested-With header.'));
};
