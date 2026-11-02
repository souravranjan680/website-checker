import { useQueryClient } from '@tanstack/react-query';
import type { ScanProgressEvent } from '@whc/shared';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { scanKeys } from './api';

/**
 * Live scan progress via Server-Sent Events.
 * The browser's built-in EventSource keeps one HTTP response open and calls us for
 * every "event: progress" the server writes. Cookies are sent automatically
 * (same origin), so no token handling is needed here.
 * When the scan finishes, cached results are refreshed and the stream is closed.
 */
export function useScanEvents(scanId: string, enabled: boolean): ScanProgressEvent | null {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ScanProgressEvent | null>(null);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      source = new EventSource(`/api/scans/${scanId}/events`);
      source.addEventListener('progress', (message) => {
        setProgress(JSON.parse((message as MessageEvent<string>).data) as ScanProgressEvent);
      });
      source.addEventListener('finished', () => {
        stopped = true;
        source?.close();
        void queryClient.invalidateQueries({ queryKey: scanKeys.all });
      });
      source.onerror = () => {
        // The 15-minute access token may have expired; EventSource can't refresh it.
        // Close, renew the session with a normal API call, then reconnect.
        source?.close();
        if (stopped) return;
        retry = setTimeout(() => {
          void apiFetch('/api/auth/refresh', { method: 'POST' }).finally(() => {
            if (!stopped) connect();
          });
        }, 3_000);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [scanId, enabled, queryClient]);

  return progress;
}
