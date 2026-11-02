import { scanChannels, type ScanEvent, type ScanProgressEvent } from '@whc/shared';
import { Redis } from 'ioredis';
import type { Logger } from './logger';

type Listener = (event: ScanEvent) => void;

/**
 * Bridge between the scanner's Redis messages and browsers watching a scan:
 *   scanner → Redis channel "whc:scan:<id>:events" → this hub → SSE response(s)
 * One Redis subscription serves every open browser tab (fan-out in memory).
 */
export interface ScanEventHub {
  subscribe(scanId: string, listener: Listener): () => void;
  latest(scanId: string): Promise<ScanProgressEvent | null>;
  publish(event: ScanEvent): Promise<void>;
  requestCancel(scanId: string): Promise<void>;
  close(): Promise<void>;
}

export function createRedisScanEventHub(
  redisUrl: string,
  publisher: Redis,
  logger: Logger,
): ScanEventHub {
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const listeners = new Map<string, Set<Listener>>();
  subscriber.on('error', (error) =>
    logger.warn({ err: error.message }, 'scan event subscriber error'),
  );
  void subscriber.psubscribe(scanChannels.eventsPattern);
  subscriber.on('pmessage', (_pattern, channel: string, message: string) => {
    const scanId = channel.split(':')[2];
    const set = scanId ? listeners.get(scanId) : undefined;
    if (!set) return;
    try {
      const event = JSON.parse(message) as ScanEvent;
      for (const listener of set) listener(event);
    } catch {
      logger.warn({ channel }, 'invalid scan event message');
    }
  });

  return {
    subscribe(scanId, listener) {
      const set = listeners.get(scanId) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(scanId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(scanId);
      };
    },
    async latest(scanId) {
      try {
        const raw = await publisher.get(scanChannels.latest(scanId));
        return raw ? (JSON.parse(raw) as ScanProgressEvent) : null;
      } catch {
        return null; // Redis down: callers fall back to the database
      }
    },
    async publish(event) {
      await publisher
        .publish(scanChannels.events(event.scanId), JSON.stringify(event))
        .catch(() => {});
    },
    async requestCancel(scanId) {
      await publisher.publish(scanChannels.cancel, scanId);
    },
    async close() {
      await subscriber.quit().catch(() => {});
    },
  };
}
