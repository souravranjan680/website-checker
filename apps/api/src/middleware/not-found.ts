import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors';

/** Runs when no route matched: turns it into the standard JSON 404. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} does not exist`));
};
