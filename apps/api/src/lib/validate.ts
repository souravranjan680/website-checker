import type { z } from 'zod';
import { AppError } from './errors';

/**
 * Validates untrusted input (body, query, params) against a Zod schema.
 * Returns the cleaned, typed data, or throws a 400 listing every invalid field:
 *   { "error": { "code": "VALIDATION_ERROR", "details": [{ "path": "email", "message": "..." }] } }
 */
export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', details);
  }
  return result.data;
}
