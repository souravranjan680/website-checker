import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api-client';

/**
 * Shows API validation errors under the matching form fields.
 * Returns a message for the top of the form when no field matched (or null).
 *   API: { details: [{ path: "email", message: "Already taken" }] } → error under "email"
 */
export function applyApiErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  let matched = false;
  for (const detail of error.details) {
    const field = fields.find((f) => f === detail.path);
    if (field) {
      setError(field, { type: 'server', message: detail.message });
      matched = true;
    }
  }
  return matched ? null : error.message;
}

/** A readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
