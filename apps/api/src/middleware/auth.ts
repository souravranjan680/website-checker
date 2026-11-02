import type { PrismaClient } from '@whc/db';
import type { Request, RequestHandler } from 'express';
import { ACCESS_COOKIE } from '../lib/cookies';
import { AppError } from '../lib/errors';
import type { JwtService } from '../lib/jwt';
import type { AuthUser } from '../types/express';

/**
 * requireAuth: the gate in front of every protected route.
 * 1. Read the access token from the HttpOnly cookie (browsers) or
 *    "Authorization: Bearer <token>" (scripts, the Chrome extension later).
 * 2. Verify the JWT signature and expiry.
 * 3. Load the user from the database, so deactivated users and role changes take
 *    effect immediately instead of when the token expires.
 */
export function createRequireAuth(deps: { prisma: PrismaClient; jwt: JwtService }): RequestHandler {
  return async (req, _res, next) => {
    const token = readAccessToken(req);
    if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in.'));

    const claims = await deps.jwt.verify(token); // throws 401 on bad/expired tokens
    const user = await deps.prisma.user.findUnique({
      where: { id: claims.userId },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in.'));
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  };
}

/** Only global admins pass. Use after requireAuth. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return next(new AppError(403, 'FORBIDDEN', 'Administrator access required.'));
  }
  next();
};

function readAccessToken(req: Request): string | undefined {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  const cookie: unknown = req.cookies?.[ACCESS_COOKIE];
  return typeof cookie === 'string' && cookie ? cookie : undefined;
}

/** The signed-in user. Only call in handlers behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
  return req.user;
}
