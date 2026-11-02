import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/**
 * Password hashing with Argon2id (built into Node.js 24, no extra package).
 * Parameters follow the OWASP Password Storage Cheat Sheet: 19 MiB memory, 2 passes.
 * Hashing is deliberately slow and memory-hungry, so a stolen database can't be
 * brute-forced quickly.
 *
 * Stored format (self-describing, so parameters can change later):
 *   argon2id$v=19$m=19456,t=2,p=1$<salt base64>$<hash base64>
 */
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2Async('argon2id', { message: password, nonce: salt, ...PARAMS });
  return `argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, , params, saltB64, hashB64] = stored.split('$');
  if (algorithm !== 'argon2id' || !params || !saltB64 || !hashB64) return false;
  const values = Object.fromEntries(params.split(',').map((pair) => pair.split('=')));
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await argon2Async('argon2id', {
    message: password,
    nonce: Buffer.from(saltB64, 'base64'),
    memory: Number(values.m),
    passes: Number(values.t),
    parallelism: Number(values.p),
    tagLength: expected.length,
  });
  // Constant-time comparison: doesn't leak how many bytes matched.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Cryptographically random token, URL-safe (refresh tokens, reset links). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored as SHA-256 hashes, so a database leak doesn't leak usable tokens. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
