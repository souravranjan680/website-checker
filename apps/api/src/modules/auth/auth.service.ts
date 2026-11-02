import { randomUUID } from 'node:crypto';
import type { PrismaClient, User } from '@whc/db';
import type { LoginInput, RegisterInput, UserDto } from '@whc/shared';
import type { AppConfig } from '../../config/env';
import { logActivity } from '../../lib/activity';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { AppError, isUniqueViolation } from '../../lib/errors';
import type { JwtService } from '../../lib/jwt';
import type { Logger } from '../../lib/logger';
import type { Mailer } from '../../lib/mailer';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
/** Two browser tabs may refresh at the same moment; don't treat that as token theft. */
const REFRESH_REUSE_GRACE_MS = 10_000;

export function toUserDto(
  user: Pick<User, 'id' | 'email' | 'name' | 'role' | 'createdAt'>,
): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

const sessionEnded = () =>
  new AppError(401, 'SESSION_ENDED', 'Your session has ended. Please sign in again.');

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(deps: {
  prisma: PrismaClient;
  jwt: JwtService;
  mailer: Mailer;
  config: AppConfig;
  logger: Logger;
}) {
  const { prisma, jwt, config, logger } = deps;
  // Used when an email doesn't exist, so "unknown email" takes as long as "wrong password".
  const dummyHashPromise = hashPassword('timing-equalizer-not-a-real-password');

  /**
   * Starts (or continues) a login session: a new opaque refresh token stored as a hash,
   * plus a short-lived JWT access token. All rotations of one login share a familyId
   * and the same absolute expiry, so a session can't be extended forever.
   */
  async function issueTokens(
    user: Pick<User, 'id' | 'role'>,
    meta: RequestMeta,
    family?: { familyId: string; expiresAt: Date },
  ): Promise<SessionTokens> {
    const refreshToken = randomToken();
    const refreshExpiresAt =
      family?.expiresAt ?? new Date(Date.now() + config.auth.refreshTokenTtlDays * 86_400_000);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId: family?.familyId ?? randomUUID(),
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent?.slice(0, 255),
        ipAddress: meta.ip,
      },
    });
    const accessToken = await jwt.sign({ userId: user.id, role: user.role });
    return { accessToken, refreshToken, refreshExpiresAt };
  }

  async function revokeAllSessions(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  return {
    async register(input: RegisterInput, meta: RequestMeta) {
      const emailTaken = new AppError(
        409,
        'EMAIL_TAKEN',
        'An account with this email already exists.',
        [{ path: 'email', message: 'An account with this email already exists.' }],
      );
      if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
        throw emailTaken;
      }

      let user: User;
      try {
        user = await prisma.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash: await hashPassword(input.password),
          },
        });
      } catch (error) {
        // Two sign-ups with the same email at the same moment: the unique index decides.
        if (isUniqueViolation(error)) throw emailTaken;
        throw error;
      }

      await logActivity(prisma, {
        userId: user.id,
        action: 'auth.registered',
        entityType: 'User',
        entityId: user.id,
        ipAddress: meta.ip,
      });
      return { user: toUserDto(user), tokens: await issueTokens(user, meta) };
    },

    async login(input: LoginInput, meta: RequestMeta) {
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      const passwordOk = user
        ? await verifyPassword(input.password, user.passwordHash)
        : (await verifyPassword(input.password, await dummyHashPromise), false);

      // Same message for "no such email" and "wrong password": no account enumeration.
      if (!user || !passwordOk) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      }
      if (!user.isActive) {
        throw new AppError(
          403,
          'ACCOUNT_DISABLED',
          'This account has been disabled. Contact an administrator.',
        );
      }

      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await logActivity(prisma, {
        userId: user.id,
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        ipAddress: meta.ip,
      });
      return { user: toUserDto(user), tokens: await issueTokens(user, meta) };
    },

    /**
     * Exchanges a refresh token for new tokens ("rotation"). The old refresh token
     * stops working. If an already-rotated token is presented again, someone may
     * have stolen it, so the whole session family is revoked.
     */
    async refresh(rawToken: string | undefined, meta: RequestMeta) {
      if (!rawToken) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');

      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(rawToken) },
        include: { user: true },
      });
      if (!stored) throw sessionEnded();

      if (stored.revokedAt) {
        if (Date.now() - stored.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
          await prisma.refreshToken.updateMany({
            where: { familyId: stored.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          logger.warn({ userId: stored.userId }, 'Refresh token reuse detected; session revoked');
        }
        throw sessionEnded();
      }
      if (stored.expiresAt <= new Date() || !stored.user.isActive) throw sessionEnded();

      // Revoke only if still active: of two simultaneous refreshes, exactly one wins.
      const { count } = await prisma.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) throw sessionEnded();

      const tokens = await issueTokens(stored.user, meta, {
        familyId: stored.familyId,
        expiresAt: stored.expiresAt,
      });
      return { user: toUserDto(stored.user), tokens };
    },

    /** Ends this device's session (every rotation of its refresh token). */
    async logout(rawToken: string | undefined) {
      if (!rawToken) return;
      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(rawToken) },
      });
      if (!stored) return;
      await prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    async getUser(userId: string): Promise<UserDto> {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
      return toUserDto(user);
    },

    async updateProfile(userId: string, input: { name: string }): Promise<UserDto> {
      return toUserDto(
        await prisma.user.update({ where: { id: userId }, data: { name: input.name } }),
      );
    },

    /** Changes the password and signs out every other device. */
    async changePassword(
      userId: string,
      input: { currentPassword: string; newPassword: string },
      meta: RequestMeta,
    ): Promise<SessionTokens> {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Your current password is incorrect.', [
          { path: 'currentPassword', message: 'Your current password is incorrect.' },
        ]);
      }
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(input.newPassword) },
      });
      await revokeAllSessions(userId);
      await logActivity(prisma, {
        userId,
        action: 'auth.password_changed',
        entityType: 'User',
        entityId: userId,
        ipAddress: meta.ip,
      });
      return issueTokens(user, meta);
    },

    /**
     * Emails a one-time reset link. Always succeeds from the caller's point of view,
     * so nobody can use this form to find out which emails have accounts.
     */
    async requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) return;

      const rawToken = randomToken();
      await prisma.$transaction([
        // Only the newest link works.
        prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
        prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: sha256(rawToken),
            expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          },
        }),
      ]);

      const link = `${config.appUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
      try {
        await deps.mailer.send({
          to: user.email,
          subject: 'Reset your Website Health Checker password',
          text: [
            `Hi ${user.name},`,
            '',
            'Someone (hopefully you) asked to reset your password. Open this link within 30 minutes:',
            link,
            '',
            "If you didn't ask for this, you can ignore this email. Your password won't change.",
          ].join('\n'),
        });
      } catch (error) {
        logger.error({ err: error, userId: user.id }, 'Could not send password reset email');
      }
      await logActivity(prisma, {
        userId: user.id,
        action: 'auth.password_reset_requested',
        entityType: 'User',
        entityId: user.id,
        ipAddress: meta.ip,
      });
    },

    async resetPassword(
      input: { token: string; newPassword: string },
      meta: RequestMeta,
    ): Promise<void> {
      const stored = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: sha256(input.token) },
      });
      if (!stored || stored.usedAt || stored.expiresAt <= new Date()) {
        throw new AppError(
          400,
          'INVALID_TOKEN',
          'This reset link is invalid or has expired. Request a new one.',
        );
      }
      const passwordHash = await hashPassword(input.newPassword);
      await prisma.$transaction([
        prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
        prisma.passwordResetToken.update({
          where: { id: stored.id },
          data: { usedAt: new Date() },
        }),
        // Anyone who knew the old password is signed out everywhere.
        prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      await logActivity(prisma, {
        userId: stored.userId,
        action: 'auth.password_reset',
        entityType: 'User',
        entityId: stored.userId,
        ipAddress: meta.ip,
      });
    },
  };
}
