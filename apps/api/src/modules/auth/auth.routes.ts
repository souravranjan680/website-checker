import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  notificationPreferencesSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@whc/shared';
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../../config/env';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../../lib/cookies';
import { clientIp, type RateLimiterFactory } from '../../lib/rate-limit';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import type { AuthService, RequestMeta } from './auth.service';

/** Session IDs are the randomUUID family IDs. */
const sessionIdSchema = z.uuid();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function requestMeta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

function emailKey(req: Request): string {
  const email: unknown = req.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * /api/auth/* routes. Each handler: validate input → call the service → set cookies
 * and send JSON. The business rules live in auth.service.ts.
 */
export function createAuthRouter(deps: {
  auth: AuthService;
  config: AppConfig;
  requireAuth: RequestHandler;
  rateLimit: RateLimiterFactory;
}): Router {
  const { auth, config, requireAuth, rateLimit } = deps;
  const router = Router();

  // Slow down password guessing: per IP and per targeted email.
  const loginLimit = rateLimit({
    name: 'login',
    windowMs: MINUTE,
    max: 5,
    keys: (req) => [`ip:${clientIp(req)}`, `email:${emailKey(req)}`],
  });
  const registerLimit = rateLimit({
    name: 'register',
    windowMs: HOUR,
    max: 10,
    keys: (req) => [`ip:${clientIp(req)}`],
  });
  const resetLimit = rateLimit({
    name: 'password-reset',
    windowMs: HOUR,
    max: 5,
    keys: (req) => [`ip:${clientIp(req)}`, `email:${emailKey(req)}`],
  });

  router.post('/register', registerLimit, async (req, res) => {
    const input = parseInput(registerSchema, req.body);
    const { user, tokens } = await auth.register(input, requestMeta(req));
    setAuthCookies(res, config, tokens);
    res.status(201).json({ data: { user } });
  });

  router.post('/login', loginLimit, async (req, res) => {
    const input = parseInput(loginSchema, req.body);
    const { user, tokens } = await auth.login(input, requestMeta(req));
    setAuthCookies(res, config, tokens);
    res.json({ data: { user } });
  });

  router.post('/refresh', async (req, res) => {
    try {
      const { user, tokens } = await auth.refresh(req.cookies?.[REFRESH_COOKIE], requestMeta(req));
      setAuthCookies(res, config, tokens);
      res.json({ data: { user } });
    } catch (error) {
      clearAuthCookies(res, config);
      throw error;
    }
  });

  // Works even with an expired access token: it only needs the refresh cookie.
  router.post('/logout', async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res, config);
    res.status(204).end();
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json({ data: { user: await auth.getUser(currentUser(req).id) } });
  });

  router.patch('/me', requireAuth, async (req, res) => {
    const input = parseInput(updateProfileSchema, req.body);
    res.json({ data: { user: await auth.updateProfile(currentUser(req).id, input) } });
  });

  router.post('/change-password', requireAuth, async (req, res) => {
    const input = parseInput(changePasswordSchema, req.body);
    const tokens = await auth.changePassword(currentUser(req).id, input, requestMeta(req));
    setAuthCookies(res, config, tokens);
    res.status(204).end();
  });

  router.get('/sessions', requireAuth, async (req, res) => {
    res.json({
      data: await auth.listSessions(currentUser(req).id, req.cookies?.[REFRESH_COOKIE]),
    });
  });

  // Declared before '/sessions/:id' so "others" is not read as an ID.
  router.delete('/sessions/others', requireAuth, async (req, res) => {
    const count = await auth.revokeOtherSessions(
      currentUser(req).id,
      req.cookies?.[REFRESH_COOKIE],
      requestMeta(req),
    );
    res.json({ data: { revoked: count } });
  });

  router.delete('/sessions/:id', requireAuth, async (req, res) => {
    const familyId = parseInput(sessionIdSchema, req.params.id);
    await auth.revokeSession(currentUser(req).id, familyId, requestMeta(req));
    res.status(204).end();
  });

  router.get('/preferences', requireAuth, async (req, res) => {
    res.json({ data: await auth.getPreferences(currentUser(req).id) });
  });

  router.put('/preferences', requireAuth, async (req, res) => {
    const input = parseInput(notificationPreferencesSchema, req.body);
    res.json({ data: await auth.updatePreferences(currentUser(req).id, input) });
  });

  router.post('/forgot-password', resetLimit, async (req, res) => {
    const { email } = parseInput(forgotPasswordSchema, req.body);
    await auth.requestPasswordReset(email, requestMeta(req));
    res.status(202).json({
      data: { message: 'If an account exists for that email, a reset link has been sent.' },
    });
  });

  router.post('/reset-password', resetLimit, async (req, res) => {
    const input = parseInput(resetPasswordSchema, req.body);
    await auth.resetPassword(input, requestMeta(req));
    res.status(204).end();
  });

  return router;
}
