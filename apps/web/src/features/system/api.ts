import { healthReportSchema, type HealthReport } from '@whc/shared';
import { ApiError, apiFetch, toApiError } from '@/lib/api-client';

/**
 * GET /api/health. A 503 still carries a full report (it says which dependency
 * is down), so both 200 and 503 are parsed. The shared Zod schema guarantees the
 * data has the shape the UI expects.
 */
export async function fetchHealth(): Promise<HealthReport> {
  const response = await apiFetch('/api/health');
  if (response.status !== 200 && response.status !== 503) {
    throw await toApiError(response);
  }
  const parsed = healthReportSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The API returned an unexpected response.',
    );
  }
  return parsed.data;
}
