import { api, apiFetch, toApiError } from './api-client';

/** Reads the file name from `Content-Disposition: attachment; filename="..."`. */
export function filenameFrom(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

/**
 * Downloads a file from the API (cookies included) and hands it to the browser
 * as a download. Errors (403, 503 "PDF unavailable"...) are thrown as ApiError
 * so the caller can show them, instead of the browser opening a JSON error page.
 */
export async function downloadFromApi(path: string, fallbackName: string): Promise<void> {
  let response = await apiFetch(path);
  if (response.status === 401) {
    // Access token expired: any normal API call refreshes the session, then retry.
    await api('/api/auth/me');
    response = await apiFetch(path);
  }
  if (!response.ok) throw await toApiError(response);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFrom(response.headers.get('Content-Disposition'), fallbackName);
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before releasing the memory.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
