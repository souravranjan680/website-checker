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
