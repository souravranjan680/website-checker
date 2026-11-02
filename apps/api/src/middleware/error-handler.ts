import type { ErrorRequestHandler } from 'express';
import { AppError } from '../lib/errors';

/**
 * Last middleware in the chain. Express sends every thrown error here
 * (Express 5 also catches errors from async handlers automatically).
 * Clients always get the same shape: { error: { code, message, details?, requestId } }.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong. Please try again.';
  let details: unknown;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (isBodyParserError(err)) {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  } else {
    // Unexpected bug: log the full error, but never send internals to the client.
    req.log.error({ err }, 'Unhandled error');
  }

  res.status(status).json({ error: { code, message, details, requestId: String(req.id) } });
};

function isBodyParserError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed'
  );
}
