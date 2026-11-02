import type { Severity } from '../issues';
import type { FailedRequest, PageNetworkLog, SourceLocation } from './collectors';

/**
 * What kind of problem a console message or uncaught exception points to:
 *
 *   APPLICATION         the site's own code failed
 *   INTEGRATION_CONFIG  a connected service is set up wrongly (missing/invalid API key or
 *                       access token, unauthorized domain...): the feature that uses it is broken
 *   THIRD_PARTY         an error inside someone else's script (analytics, widgets, ads...)
 *   NETWORK             a request failed (fetch/XHR, CORS); the request itself is listed separately
 *   HARMLESS            deprecation notices, browser hints, source maps: recorded, never an issue
 */
export type ConsoleKind =
  'APPLICATION' | 'INTEGRATION_CONFIG' | 'THIRD_PARTY' | 'NETWORK' | 'HARMLESS';

export interface RelatedRequest {
  url: string;
  status: number | null;
  error: string | null;
  verdict: string | null;
  /** "mentioned": the message names this URL; "same-service": same domain as a URL or script in the message. */
  relation: 'mentioned' | 'same-service';
}

export interface ConsoleClassification {
  kind: ConsoleKind;
  /** null for HARMLESS (not reported as an issue). */
  severity: Severity | null;
  /** Message with URLs' query strings, numbers and ids removed: equal for repeats of the same problem. */
  normalized: string;
  /** Script path (no query string), when known. */
  sourcePath: string | null;
  related: RelatedRequest[];
}

const HARMLESS = [
  /\[(Deprecation|Violation|Intervention)\]/i,
  /\bis deprecated\b|\bdeprecation\b/i,
  /DevTools failed to load source map/i,
  /was preloaded using link preload but not used/i,
  /Unrecognized feature: '[\w-]+'/i,
  /third-party cookie/i,
  /Download the React DevTools/i,
];

const INTEGRATION_CONFIG = [
  /\b(access|api|auth|bearer)[ _-]?(token|key)\b/i,
  /\bapi[ _-]?key\b|\bapikey\b|\bpublishable key\b|\bsite key\b|\bclient[ _-]?id\b/i,
  /\b(invalid|missing|expired|wrong|no) (credentials|token|key|license|project id)\b/i,
  /\b(unauthori[sz]ed|forbidden|not authori[sz]ed|authentication failed)\b/i,
  /\b(invalid|not allowed|unauthori[sz]ed) (domain|origin|referr?er)\b/i,
  /\bnot (configured|initiali[sz]ed)\b|\bmisconfigur/i,
];

const NETWORK = [
  /\bFailed to fetch\b|\bNetworkError\b|\bLoad failed\b|\bnet::ERR_/i,
  /blocked by CORS policy|Access-Control-Allow-Origin/i,
  /\bERR_(CONNECTION|NAME_NOT_RESOLVED|TIMED_OUT|INTERNET)/i,
];

/** "https://a.b.example.com/x" → "example.com" (good enough to group a service's hosts). */
export function serviceDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  // co.uk, com.au...: keep three labels
  const secondLevel = parts[parts.length - 2]!;
  return parts
    .slice(
      ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(secondLevel) &&
        parts.at(-1)!.length === 2
        ? -3
        : -2,
    )
    .join('.');
}

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function pathWithoutQuery(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? null;
  }
}

/** Same problem → same text: URLs lose their query, numbers/ids/hashes become placeholders. */
export function normalizeMessage(text: string): string {
  return text
    .replace(/(https?:\/\/[^\s'")?#]+)[^\s'")]*/g, '$1')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hash>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * Failed requests the message is about (it names the URL), or that hit the same
 * service as a URL in the message or as the third-party script that logged it.
 */
export function relatedRequests(
  text: string,
  source: string | undefined,
  failedRequests: FailedRequest[],
  siteHostname: string,
): RelatedRequest[] {
  const urlsInText = text.match(/https?:\/\/[^\s'")]+/g) ?? [];
  const siteService = serviceDomain(siteHostname);
  const services = new Set(
    [...urlsInText, source]
      .map((u) => hostOf(u))
      .filter((h): h is string => h !== null)
      .map(serviceDomain)
      // The site's own failures are not "related" just because the site logged something.
      .filter((service) => service !== siteService),
  );
  const related: RelatedRequest[] = [];
  for (const request of failedRequests) {
    const base = request.url.split(/[?#]/)[0]!;
    const mentioned = urlsInText.some(
      (u) => u.startsWith(base) || request.url.startsWith(u.split(/[?#]/)[0]!),
    );
    const host = hostOf(request.url);
    const sameService = host !== null && services.has(serviceDomain(host));
    if (!mentioned && !sameService) continue;
    related.push({
      url: request.url,
      status: request.status ?? null,
      error: request.error ?? null,
      verdict: request.verdict ?? null,
      relation: mentioned ? 'mentioned' : 'same-service',
    });
    if (related.length >= 5) break;
  }
  return related;
}

export interface ConsoleGroup {
  level: 'error' | 'warning' | 'exception';
  /** First occurrence, as the browser reported it. */
  text: string;
  location: SourceLocation;
  stack?: string;
  classification: ConsoleClassification;
  occurrences: number;
}

/**
 * Classifies every console message and exception of a page, stores kind + related
 * requests on the log entries (saved with the page), and groups repeats of the same
 * problem (same kind, normalized message and script) into one group.
 */
export function classifyPageConsole(log: PageNetworkLog, siteHostname: string): ConsoleGroup[] {
  const groups = new Map<string, ConsoleGroup>();
  const add = (
    level: ConsoleGroup['level'],
    text: string,
    location: SourceLocation,
    target: { kind?: ConsoleKind; related?: RelatedRequest[] },
    stack?: string,
  ) => {
    const classification = classifyConsoleMessage(
      { level, text, ...location },
      siteHostname,
      log.failedRequests,
    );
    target.kind = classification.kind;
    if (classification.related.length > 0) target.related = classification.related;
    const key = [
      level === 'exception' ? 'exception' : 'console',
      classification.kind,
      classification.normalized,
      classification.sourcePath,
    ].join('|');
    const existing = groups.get(key);
    if (existing) existing.occurrences += 1;
    else groups.set(key, { level, text, location, stack, classification, occurrences: 1 });
  };
  for (const entry of log.consoleErrors) {
    add(
      entry.level,
      entry.text,
      { source: entry.source, line: entry.line, column: entry.column },
      entry,
    );
  }
  for (const entry of log.pageErrors) {
    add(
      'exception',
      entry.message,
      { source: entry.source, line: entry.line, column: entry.column },
      entry,
      entry.stack,
    );
  }
  return [...groups.values()];
}

/**
 * Classifies one console message (`level` error/warning) or uncaught exception
 * (`level` exception). The site's own host decides first-party vs third-party.
 */
export function classifyConsoleMessage(
  entry: { level: 'error' | 'warning' | 'exception'; text: string } & SourceLocation,
  siteHostname: string,
  failedRequests: FailedRequest[],
): ConsoleClassification {
  const related = relatedRequests(entry.text, entry.source, failedRequests, siteHostname);
  const sourceHost = hostOf(entry.source);
  const thirdPartySource =
    sourceHost !== null && serviceDomain(sourceHost) !== serviceDomain(siteHostname);
  const base = {
    normalized: normalizeMessage(entry.text),
    sourcePath: pathWithoutQuery(entry.source),
    related,
  };
  // A 401/403 from another service (or one the message names) means "not allowed in";
  // the site's own API answering 401 can simply mean "not logged in".
  const authFailure = related.some(
    (r) =>
      (r.status === 401 || r.status === 403) &&
      (r.relation === 'mentioned' ||
        serviceDomain(hostOf(r.url) ?? siteHostname) !== serviceDomain(siteHostname)),
  );

  if (entry.level !== 'exception' && HARMLESS.some((pattern) => pattern.test(entry.text))) {
    return { ...base, kind: 'HARMLESS', severity: null };
  }
  if (
    INTEGRATION_CONFIG.some((pattern) => pattern.test(entry.text)) ||
    (authFailure && entry.level !== 'warning')
  ) {
    // A service the site depends on is not set up correctly: its feature (content, maps,
    // payments, captcha...) does not work for visitors.
    return {
      ...base,
      kind: 'INTEGRATION_CONFIG',
      severity: entry.level === 'warning' ? 'LOW' : 'MEDIUM',
    };
  }
  if (entry.level === 'warning') return { ...base, kind: 'HARMLESS', severity: null };
  // Names a request that failed (e.g. "Refused to execute script from '…' because its MIME
  // type…"): the browser's echo of that failure, which is re-checked and reported on its own.
  const echoesFailedRequest =
    entry.level === 'error' && related.some((r) => r.relation === 'mentioned');
  if (echoesFailedRequest || NETWORK.some((pattern) => pattern.test(entry.text))) {
    // The failed request is reported on its own (after re-checking); this is its echo in the console.
    return { ...base, kind: 'NETWORK', severity: 'LOW' };
  }
  if (thirdPartySource) {
    return {
      ...base,
      kind: 'THIRD_PARTY',
      severity: entry.level === 'exception' ? 'MEDIUM' : 'LOW',
    };
  }
  return {
    ...base,
    kind: 'APPLICATION',
    severity: entry.level === 'exception' ? 'HIGH' : 'MEDIUM',
  };
}
