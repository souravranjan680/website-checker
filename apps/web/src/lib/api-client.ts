import type { ApiErrorBody } from '@whc/shared';

export interface FieldErrorDetail {
  path: string;
  message: string;
}

/**
 * Error thrown for failed API calls. `code` matches the API's error codes
 * (e.g. NOT_FOUND, VALIDATION_ERROR) or NETWORK_ERROR when the API is unreachable.
 * `details` lists per-field validation messages, which forms show under each input.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: FieldErrorDetail[];
  /**
   * Structured details that are not a field list, e.g. { count, comparisons } of a 409
   * WEBSITE_IN_COMPARISON. Read them defensively: they come from the server as-is.
   */
  readonly info: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details: FieldErrorDetail[] = [],
    info: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.info = info;
  }
}

/** Sent on every request; the API rejects state changes without it (CSRF protection). */
const CSRF_HEADERS = { 'X-Requested-With': 'whc-web' };

/** Low-level fetch: same-origin, cookies included, network failures become ApiError. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { Accept: 'application/json', ...CSRF_HEADERS, ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the API server.');
  }
}

/** Turns a non-2xx response into an ApiError using the API's { error: {...} } body. */
export async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
  const details: unknown = body?.error?.details;
  return new ApiError(
    response.status,
    body?.error?.code ?? 'HTTP_ERROR',
    body?.error?.message ?? `Request failed with status ${response.status}`,
    // Only a list of field messages goes to the forms; anything else is kept in `info`.
    Array.isArray(details) ? (details as FieldErrorDetail[]) : [],
    Array.isArray(details) ? null : (details ?? null),
  );
}

// Requests that must never trigger an automatic session refresh.
const NO_REFRESH = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
];

let refreshInFlight: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

/** The auth layer registers what to do when the session can't be renewed (go to login). */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/**
 * Asks the API for fresh tokens using the refresh cookie. If several requests fail
 * at the same time, they all wait for this ONE refresh call instead of each starting one.
 */
function refreshSession(): Promise<boolean> {
  refreshInFlight ??= apiFetch('/api/auth/refresh', { method: 'POST' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/**
 * Calls the API and returns the parsed JSON body.
 * The access token lives 15 minutes. When a request gets 401, we refresh the session
 * once and retry, so the user never notices. If that fails, the session is over.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = () =>
    apiFetch(path, {
      method: options.method ?? 'GET',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let response = await send();
  if (response.status === 401 && !NO_REFRESH.some((p) => path.startsWith(p))) {
    if (await refreshSession()) {
      response = await send();
    }
    if (response.status === 401) onSessionExpired?.();
  }
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Most endpoints wrap their result as { data: ... }; this unwraps it. */
export async function apiData<T>(path: string, options?: RequestOptions): Promise<T> {
  return (await api<{ data: T }>(path, options)).data;
}

/** Builds "?a=1&b=x" from an object, skipping empty values. */
export function toQueryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
