import { jwtVerify, SignJWT } from 'jose';
import type { UserRole } from '@whc/shared';
import { AppError } from './errors';

const ISSUER = 'whc-api';
const AUDIENCE = 'whc-web';

export interface AccessTokenClaims {
  userId: string;
  role: UserRole;
}

export interface JwtService {
  sign(claims: AccessTokenClaims): Promise<string>;
  /** Throws 401 TOKEN_EXPIRED or 401 UNAUTHENTICATED. */
  verify(token: string): Promise<AccessTokenClaims>;
}

/**
 * Short-lived access tokens (JWT, HS256). A JWT is three base64url parts:
 *   header.payload.signature
 * The payload is readable by anyone; the signature (HMAC with our secret) proves we
 * created it and nobody changed it. Expired, tampered or foreign tokens fail verify().
 */
export function createJwtService(secret: string, ttlSeconds: number): JwtService {
  const key = new TextEncoder().encode(secret);

  return {
    async sign({ userId, role }) {
      return new SignJWT({ role })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(key);
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: ISSUER,
          audience: AUDIENCE,
          algorithms: ['HS256'], // never accept "none" or other algorithms
        });
        if (typeof payload.sub !== 'string') throw new Error('missing subject');
        return { userId: payload.sub, role: payload.role === 'ADMIN' ? 'ADMIN' : 'USER' };
      } catch (error) {
        const expired = (error as { code?: string }).code === 'ERR_JWT_EXPIRED';
        throw expired
          ? new AppError(401, 'TOKEN_EXPIRED', 'Your session token expired.')
          : new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
      }
    },
  };
}
