const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/**
 * A server day boundary (e.g. 2026-11-02T23:59:59.999Z) as that UTC calendar day,
 * so it never shows as the next day in time zones ahead of UTC.
 */
export function formatUtcDay(iso: string): string {
  return dateFormat.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** "5 minutes ago", "yesterday", ... */
export function formatRelative(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** 4200 → "4 s", 95000 → "1 min 35 s", null → "–". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '–';
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** "Mozilla/5.0 (Windows NT 10.0; ...) Chrome/140..." → "Chrome on Windows". */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'unknown system';
  return `${browser} on ${os}`;
}
