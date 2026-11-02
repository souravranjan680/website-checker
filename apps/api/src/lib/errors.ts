/**
 * An error we expect and know how to describe to the client
 * (e.g. 404 NOT_FOUND, 400 VALIDATION_ERROR). Anything else becomes a 500.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * 404 for both "doesn't exist" and "exists but isn't yours". Answering 403 for the
 * second case would tell an attacker which IDs exist (docs/05-security.md §5).
 */
export function notFound(what: string): AppError {
  return new AppError(404, 'NOT_FOUND', `${what} not found.`);
}

export function forbidden(message: string): AppError {
  return new AppError(403, 'FORBIDDEN', message);
}

/** True when Prisma rejected a write because of a unique constraint. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
