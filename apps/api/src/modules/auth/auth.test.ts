import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CSRF,
  createTestContext,
  createTestPrisma,
  getCookie,
  resetDatabase,
  signUp,
  TEST_PASSWORD,
} from '../../../test/helpers';

const prisma = createTestPrisma();
let ctx = createTestContext(prisma);

beforeEach(async () => {
  await resetDatabase(prisma);
  ctx = createTestContext(prisma);
});
afterAll(() => prisma.$disconnect());

describe('registration', () => {
  it('creates an account, signs the user in with HttpOnly cookies, never returns the hash', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .set(CSRF)
      .send({ name: 'Asha', email: 'Asha@Example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      name: 'Asha',
      email: 'asha@example.com',
      role: 'USER',
    });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(getCookie(res, 'whc_access')).toMatch(/HttpOnly/);
    expect(getCookie(res, 'whc_refresh')).toMatch(/Path=\/api\/auth/);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'asha@example.com' } });
    expect(stored.passwordHash).toMatch(/^argon2id\$/);
    expect(stored.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    await signUp(ctx.app, { email: 'dup@example.com' });
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .set(CSRF)
      .send({ name: 'Again', email: 'DUP@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'EMAIL_TAKEN', details: [{ path: 'email' }] });
  });

  it.each([
    ['short', 'Use at least 10 characters.'],
    ['password123', 'too common'],
  ])('rejects the weak password "%s"', async (password, message) => {
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .set(CSRF)
      .send({ name: 'Weak', email: 'weak@example.com', password });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ path: 'password' });
    expect(res.body.error.details[0].message).toContain(message);
  });

  it('rejects missing fields with one message per field', async () => {
    const res = await request(ctx.app).post('/api/auth/register').set(CSRF).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'email',
      'name',
      'password',
    ]);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await signUp(ctx.app, { email: 'login@example.com' });
  });

  it('signs in with the right password', async () => {
    const agent = request.agent(ctx.app);
    const res = await agent
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'login@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('login@example.com');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(ctx.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'login@example.com', password: 'not the password' });
    const unknownEmail = await request(ctx.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'nobody@example.com', password: TEST_PASSWORD });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
      expect(getCookie(res, 'whc_access')).toBeUndefined();
    }
  });

  it('refuses disabled accounts', async () => {
    await prisma.user.update({ where: { email: 'login@example.com' }, data: { isActive: false } });
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'login@example.com', password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('records the login in the activity log', async () => {
    await request(ctx.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'login@example.com', password: TEST_PASSWORD });
    expect(await prisma.activityLog.count({ where: { action: 'auth.login' } })).toBe(1);
  });
});

describe('protected routes', () => {
  it('reject requests without a session', async () => {
    for (const path of ['/api/auth/me', '/api/projects', '/api/websites', '/api/activity']) {
      const res = await request(ctx.app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('reject a tampered token', async () => {
    const { user } = await signUp(ctx.app);
    const forged = await new SignJWT({ role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('whc-api')
      .setAudience('whc-web')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-different-secret-that-is-at-least-32-chars'));

    const res = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('report TOKEN_EXPIRED for an expired access token (the client then refreshes)', async () => {
    const { user } = await signUp(ctx.app);
    const past = Math.floor(Date.now() / 1000) - 3600;
    const expired = await new SignJWT({ role: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('whc-api')
      .setAudience('whc-web')
      .setIssuedAt(past)
      .setExpirationTime(past + 60)
      .sign(new TextEncoder().encode(ctx.config.auth.jwtSecret));

    const res = await request(ctx.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('lock out a user as soon as an admin disables them, even with a valid token', async () => {
    const { agent, user } = await signUp(ctx.app);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('sessions: refresh and logout', () => {
  it('rotates the refresh token: the old one stops working', async () => {
    const { agent } = await signUp(ctx.app);
    const oldCookie = (await prisma.refreshToken.findFirstOrThrow()).tokenHash;

    const res = await agent.post('/api/auth/refresh').set(CSRF);
    expect(res.status).toBe(200);
    expect(getCookie(res, 'whc_refresh')).toBeDefined();

    const old = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: oldCookie } });
    expect(old.revokedAt).not.toBeNull();
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
  });

  it('revokes the whole session when an old refresh token is reused (token theft)', async () => {
    const agent = request.agent(ctx.app);
    const register = await agent
      .post('/api/auth/register')
      .set(CSRF)
      .send({ name: 'Victim', email: 'victim@example.com', password: TEST_PASSWORD });
    const stolen = getCookie(register, 'whc_refresh')!.split(';')[0]!;

    await agent.post('/api/auth/refresh').set(CSRF); // legitimate rotation
    // Pretend the rotation happened a while ago (outside the two-tabs grace window).
    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const attacker = await request(ctx.app)
      .post('/api/auth/refresh')
      .set(CSRF)
      .set('Cookie', stolen);
    expect(attacker.status).toBe(401);
    expect(attacker.body.error.code).toBe('SESSION_ENDED');
    // The legitimate user's current token was revoked too: the session is over.
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    expect((await agent.post('/api/auth/refresh').set(CSRF)).status).toBe(401);
  });

  it('logout ends the session server-side and clears the cookies', async () => {
    const { agent } = await signUp(ctx.app);
    const res = await agent.post('/api/auth/logout').set(CSRF);

    expect(res.status).toBe(204);
    expect(getCookie(res, 'whc_access')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await agent.post('/api/auth/refresh').set(CSRF)).status).toBe(401);
  });

  it('expired sessions cannot be refreshed', async () => {
    const { agent } = await signUp(ctx.app);
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await agent.post('/api/auth/refresh').set(CSRF)).status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the X-Requested-With header', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_HEADER_MISSING');
  });
});

describe('rate limiting', () => {
  it('blocks the 6th login attempt for the same email within a minute', async () => {
    const limited = createTestContext(prisma, { RATE_LIMIT_ENABLED: 'true' });
    const attempt = () =>
      request(limited.app)
        .post('/api/auth/login')
        .set(CSRF)
        .send({ email: 'target@example.com', password: 'wrong-password' });

    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('password reset', () => {
  it('emails a one-time link that sets a new password and signs out other sessions', async () => {
    const { agent } = await signUp(ctx.app, { email: 'forgot@example.com' });

    const ask = await request(ctx.app)
      .post('/api/auth/forgot-password')
      .set(CSRF)
      .send({ email: 'forgot@example.com' });
    expect(ask.status).toBe(202);
    expect(ctx.mailer.sent).toHaveLength(1);
    const token = new URL(ctx.mailer.sent[0]!.text.match(/http\S+/)![0]).searchParams.get('token')!;

    const reset = await request(ctx.app)
      .post('/api/auth/reset-password')
      .set(CSRF)
      .send({ token, newPassword: 'a brand new passphrase' });
    expect(reset.status).toBe(204);

    // Old session is gone, old password fails, new password works, link is single-use.
    expect((await agent.post('/api/auth/refresh').set(CSRF)).status).toBe(401);
    const login = (password: string) =>
      request(ctx.app)
        .post('/api/auth/login')
        .set(CSRF)
        .send({ email: 'forgot@example.com', password });
    expect((await login(TEST_PASSWORD)).status).toBe(401);
    expect((await login('a brand new passphrase')).status).toBe(200);
    const again = await request(ctx.app)
      .post('/api/auth/reset-password')
      .set(CSRF)
      .send({ token, newPassword: 'yet another passphrase' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  it('answers the same way for unknown emails and sends nothing', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/forgot-password')
      .set(CSRF)
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(202);
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('rejects an expired link', async () => {
    await signUp(ctx.app, { email: 'late@example.com' });
    await request(ctx.app)
      .post('/api/auth/forgot-password')
      .set(CSRF)
      .send({ email: 'late@example.com' });
    const token = new URL(ctx.mailer.sent[0]!.text.match(/http\S+/)![0]).searchParams.get('token')!;
    await prisma.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(ctx.app)
      .post('/api/auth/reset-password')
      .set(CSRF)
      .send({ token, newPassword: 'a brand new passphrase' });
    expect(res.status).toBe(400);
  });
});

describe('profile', () => {
  it('updates the name and changes the password (current password required)', async () => {
    const { agent } = await signUp(ctx.app, { email: 'me@example.com' });

    const rename = await agent.patch('/api/auth/me').set(CSRF).send({ name: 'New Name' });
    expect(rename.body.data.user.name).toBe('New Name');

    const wrong = await agent
      .post('/api/auth/change-password')
      .set(CSRF)
      .send({ currentPassword: 'wrong', newPassword: 'another long passphrase' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].path).toBe('currentPassword');

    const ok = await agent
      .post('/api/auth/change-password')
      .set(CSRF)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'another long passphrase' });
    expect(ok.status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(200); // this device stays signed in
  });
});
