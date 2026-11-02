/**
 * Error thrown for failed API calls. `code` matches the API's error codes
 * (e.g. NOT_FOUND, VALIDATION_ERROR) or NETWORK_ERROR when the API is unreachable.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Low-level request helper. All API calls go through here so cookies,
 * headers and error handling are the same everywhere.
 * Paths are relative ("/api/..."): Vite (dev) or nginx (Docker) forwards them.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the API server.');
  }
}

/** Turns a non-2xx response into an ApiError using the API's { error: {...} } body. */
export async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  return new ApiError(
    response.status,
    body?.error?.code ?? 'HTTP_ERROR',
    body?.error?.message ?? `Request failed with status ${response.status}`,
  );
}
