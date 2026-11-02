import { randomUUID } from 'node:crypto';
import type { InsecureReference } from '@whc/dom-checks';
import { fingerprint, type IssueDraft, type Severity } from '../issues';
import { describeCertificateError, type TlsFacts } from './tls';

/**
 * Passive security configuration audit. It only reads what any visitor receives
 * (response headers, cookies' attributes, the certificate, the page's own HTML).
 * No attack payloads, no port scans, no login attempts, no exploit checks.
 *
 * Finding levels:
 *   OBSERVATION: worth knowing, often fine
 *   WARNING:     a recommended protection is missing
 *   CONFIRMED:   an insecure configuration we directly observed (NOT a tested exploit)
 */

export type SecurityCheck =
  | 'NO_HTTPS'
  | 'HTTP_NOT_REDIRECTED'
  | 'INVALID_CERTIFICATE'
  | 'CERTIFICATE_EXPIRING'
  | 'MIXED_CONTENT'
  | 'INSECURE_FORM'
  | 'MISSING_CSP'
  | 'WEAK_CSP'
  | 'MISSING_HSTS'
  | 'MISSING_FRAME_PROTECTION'
  | 'MISSING_X_CONTENT_TYPE_OPTIONS'
  | 'MISSING_REFERRER_POLICY'
  | 'INSECURE_COOKIE'
  | 'VERSION_DISCLOSURE';

export type FindingLevel = 'OBSERVATION' | 'WARNING' | 'CONFIRMED';

/** Certificates expiring within this many days get a warning. */
export const CERT_EXPIRY_WARNING_DAYS = 14;
/** HSTS max-age below this (180 days) is reported as weak. */
export const HSTS_MIN_SECONDS = 15_552_000;

const TEXT: Record<SecurityCheck, { title: string; fix: string }> = {
  NO_HTTPS: {
    title: 'The site is not served over HTTPS',
    fix: 'Install a TLS certificate (free from Let’s Encrypt) and serve every page over https://. Without it, anyone on the network can read or change what visitors see and send.',
  },
  HTTP_NOT_REDIRECTED: {
    title: 'http:// does not redirect to https://',
    fix: 'Redirect every http:// request to the same https:// address with a 301 (or 308) redirect, then add HSTS.',
  },
  INVALID_CERTIFICATE: {
    title: 'The HTTPS certificate is not valid',
    fix: 'Renew or replace the certificate so it is issued by a trusted authority, covers this host name, is within its validity dates and the server sends the full chain.',
  },
  CERTIFICATE_EXPIRING: {
    title: 'The HTTPS certificate expires soon',
    fix: 'Renew the certificate now and enable automatic renewal (e.g. certbot / your host’s auto-renew).',
  },
  MIXED_CONTENT: {
    title: 'HTTPS page loads content over plain HTTP',
    fix: 'Change every http:// resource URL on https pages to https:// (or a relative URL). Browsers block insecure scripts and styles, which breaks the page, and insecure media can be swapped by an attacker.',
  },
  INSECURE_FORM: {
    title: 'Form sends data over plain HTTP',
    fix: 'Make the form action an https:// address (or a relative URL). Data typed into this form would travel unencrypted.',
  },
  MISSING_CSP: {
    title: 'No Content-Security-Policy header',
    fix: 'Add a Content-Security-Policy header that lists where scripts, styles and images may come from, e.g. "default-src \'self\'". It limits the damage of cross-site scripting. Start with Content-Security-Policy-Report-Only to test.',
  },
  WEAK_CSP: {
    title: 'Content-Security-Policy allows unsafe sources',
    fix: "Remove 'unsafe-inline', 'unsafe-eval' and wildcard (*) sources from script-src; use nonces or hashes for inline scripts.",
  },
  MISSING_HSTS: {
    title: 'No Strict-Transport-Security (HSTS) header',
    fix: 'Send "Strict-Transport-Security: max-age=31536000; includeSubDomains" on https responses so browsers always use HTTPS for this site.',
  },
  MISSING_FRAME_PROTECTION: {
    title: 'Page can be embedded in other sites (clickjacking)',
    fix: 'Send "Content-Security-Policy: frame-ancestors \'self\'" (or "X-Frame-Options: SAMEORIGIN") so other sites cannot frame your pages.',
  },
  MISSING_X_CONTENT_TYPE_OPTIONS: {
    title: 'No X-Content-Type-Options header',
    fix: 'Send "X-Content-Type-Options: nosniff" so browsers do not guess file types (which can turn an upload into a script).',
  },
  MISSING_REFERRER_POLICY: {
    title: 'No Referrer-Policy header',
    fix: 'Send "Referrer-Policy: strict-origin-when-cross-origin" (or stricter) so full URLs, which may contain private data, are not leaked to other sites. Modern browsers already default to this, so the risk is low.',
  },
  INSECURE_COOKIE: {
    title: 'Cookie is missing security attributes',
    fix: 'Set cookies with Secure (only sent over HTTPS), HttpOnly (not readable by JavaScript, for session cookies) and SameSite=Lax or Strict.',
  },
  VERSION_DISCLOSURE: {
    title: 'Server reveals software versions',
    fix: 'Hide exact version numbers in Server / X-Powered-By headers (e.g. "server_tokens off" in nginx, "expose_php = Off" in PHP). It does not fix anything by itself but gives attackers less to go on.',
  },
};

export function securityText(check: SecurityCheck) {
  return TEXT[check];
}

/** Score weights (our heuristic, see docs/13): each failed check counts once. */
export const SECURITY_WEIGHTS: Record<SecurityCheck, number> = {
  NO_HTTPS: 40,
  INVALID_CERTIFICATE: 40,
  INSECURE_FORM: 20,
  MIXED_CONTENT: 15,
  MISSING_CSP: 15,
  HTTP_NOT_REDIRECTED: 10,
  MISSING_HSTS: 10,
  MISSING_FRAME_PROTECTION: 10,
  CERTIFICATE_EXPIRING: 5,
  MISSING_X_CONTENT_TYPE_OPTIONS: 5,
  INSECURE_COOKIE: 5,
  MISSING_REFERRER_POLICY: 3,
  WEAK_CSP: 3,
  VERSION_DISCLOSURE: 2,
};

const VIEWPORT = '1920x1080';

interface DraftValues {
  severity: Severity;
  level: FindingLevel;
  description: string;
  headerName?: string | null;
  observedValue?: string | null;
  recommendedValue?: string | null;
  target?: string;
  details?: Record<string, unknown>;
  selector?: string | null;
  scanPageId?: string | null;
}

/** A draft plus the page row it belongs to (null = site-level). */
export interface SecurityDraft {
  scanPageId: string | null;
  draft: IssueDraft;
}

function securityDraft(
  check: SecurityCheck,
  ctx: { websiteId: string; pageUrl: string },
  values: DraftValues,
): SecurityDraft {
  const ruleId = `security/${check.toLowerCase().replace(/_/g, '-')}`;
  return {
    scanPageId: values.scanPageId ?? null,
    draft: {
      id: randomUUID(),
      category: 'SECURITY',
      severity: values.severity,
      ruleId,
      title: TEXT[check].title,
      description: values.description,
      pageUrl: ctx.pageUrl,
      viewport: VIEWPORT,
      selector: values.selector ?? null,
      htmlSnippet: null,
      boundingBox: null,
      suggestedFix: TEXT[check].fix,
      details: { findingLevel: values.level, ...values.details },
      fingerprint: fingerprint({
        websiteId: ctx.websiteId,
        category: 'SECURITY',
        ruleId,
        pageUrl: ctx.pageUrl,
        viewport: VIEWPORT,
        target: values.target ?? check,
      }),
      security: {
        checkType: check,
        findingLevel: values.level,
        headerName: values.headerName ?? null,
        observedValue: values.observedValue?.slice(0, 500) ?? null,
        recommendedValue: values.recommendedValue ?? null,
      },
    },
  };
}

// ------------------------------------------------------------------ inputs

/** Cookie attributes only. The cookie VALUE is never read or stored. */
export interface CookieFacts {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
}

/** Parses one Set-Cookie header into its name and flags, dropping the value. */
export function parseSetCookie(header: string): CookieFacts | null {
  const [pair, ...attributes] = header.split(';');
  const eq = pair?.indexOf('=') ?? -1;
  const name = (eq > 0 ? pair!.slice(0, eq) : '').trim();
  if (!name) return null;
  const flags = attributes.map((a) => a.trim().toLowerCase());
  const sameSite = flags.find((f) => f.startsWith('samesite='))?.slice('samesite='.length) ?? null;
  return {
    name: name.slice(0, 100),
    secure: flags.includes('secure'),
    httpOnly: flags.includes('httponly'),
    sameSite,
  };
}

export interface SecurityPageInput {
  scanPageId: string;
  url: string;
  headers: Record<string, string>;
  cookies: CookieFacts[];
  insecureReferences: InsecureReference[];
}

export interface HttpRedirectFacts {
  url: string;
  /** null = http:// could not be reached at all (fine: nothing is served insecurely). */
  status: number | null;
  location: string | null;
  redirectsToHttps: boolean | null;
  error?: string;
}

export interface SiteSecurityFacts {
  /** The protocol of the pages actually scanned (after redirects). */
  servedOverHttps: boolean;
  tls: TlsFacts | null;
  httpRedirect: HttpRedirectFacts | null;
}

// ------------------------------------------------------------------- rules

/** Parses a CSP header into directive → sources. */
export function parseCsp(header: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of header.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

/** Which unsafe sources the effective script policy allows (script-src, else default-src). */
export function unsafeScriptSources(csp: Map<string, string[]>): string[] {
  const sources = csp.get('script-src') ?? csp.get('default-src');
  if (!sources) return [];
  const hasNonceOrHash = sources.some((s) => /^'(nonce|sha256|sha384|sha512)-/.test(s));
  return sources.filter(
    (s) =>
      s === "'unsafe-eval'" ||
      s === '*' ||
      s === 'http:' ||
      s === 'https:' ||
      // With a nonce or hash, browsers ignore 'unsafe-inline' (it is only a fallback).
      (s === "'unsafe-inline'" && !hasNonceOrHash),
  );
}

const VERSION_HEADERS = ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version'];

/**
 * Header checks across all scanned pages: one issue per check for the whole site,
 * listing which pages are affected (headers usually come from one server config).
 */
export function headerSecurityDrafts(
  websiteId: string,
  startUrl: string,
  pages: SecurityPageInput[],
  servedOverHttps: boolean,
): SecurityDraft[] {
  const drafts: SecurityDraft[] = [];
  const affected = (test: (headers: Record<string, string>) => boolean) =>
    pages.filter((p) => test(p.headers));
  const summary = (list: SecurityPageInput[]) => ({
    description: `${list.length === pages.length ? 'All' : list.length} of ${pages.length} scanned page${pages.length === 1 ? '' : 's'}.`,
    details: { pages: list.slice(0, 20).map((p) => p.url) },
    scanPageId: list[0]?.scanPageId ?? null,
    pageUrl: startUrl,
  });
  const ctx = { websiteId, pageUrl: startUrl };
  const add = (
    check: SecurityCheck,
    list: SecurityPageInput[],
    values: Omit<DraftValues, 'description' | 'details' | 'scanPageId'> & { what: string },
  ) => {
    if (list.length === 0) return;
    const s = summary(list);
    drafts.push(
      securityDraft(check, ctx, {
        ...values,
        description: `${values.what} Affects ${s.description.charAt(0).toLowerCase()}${s.description.slice(1)}`,
        details: s.details,
        scanPageId: s.scanPageId,
      }),
    );
  };

  const cspOf = (h: Record<string, string>) => h['content-security-policy'] ?? null;
  add(
    'MISSING_CSP',
    affected((h) => !cspOf(h)),
    {
      severity: 'MEDIUM',
      level: 'WARNING',
      what:
        'No Content-Security-Policy header is sent' +
        (pages.some((p) => p.headers['content-security-policy-report-only'])
          ? ' (only a Report-Only policy, which does not block anything).'
          : '.'),
      headerName: 'Content-Security-Policy',
      recommendedValue: "default-src 'self'",
    },
  );
  const weak = pages
    .map((p) => ({
      p,
      unsafe: cspOf(p.headers) ? unsafeScriptSources(parseCsp(cspOf(p.headers)!)) : [],
    }))
    .filter((x) => x.unsafe.length > 0);
  if (weak.length > 0) {
    add(
      'WEAK_CSP',
      weak.map((x) => x.p),
      {
        severity: 'LOW',
        level: 'OBSERVATION',
        what: `The script policy allows ${[...new Set(weak.flatMap((x) => x.unsafe))].join(', ')}.`,
        headerName: 'Content-Security-Policy',
        observedValue: cspOf(weak[0]!.p.headers),
        recommendedValue: "script-src 'self' 'nonce-…'",
      },
    );
  }
  add(
    'MISSING_FRAME_PROTECTION',
    affected((h) => {
      const xfo = (h['x-frame-options'] ?? '').toLowerCase();
      const ancestors = cspOf(h) ? parseCsp(cspOf(h)!).get('frame-ancestors') : undefined;
      return !(xfo === 'deny' || xfo === 'sameorigin') && !ancestors;
    }),
    {
      severity: 'MEDIUM',
      level: 'WARNING',
      what: 'Neither X-Frame-Options nor a CSP frame-ancestors rule is set.',
      headerName: 'X-Frame-Options',
      recommendedValue: "Content-Security-Policy: frame-ancestors 'self'",
    },
  );
  add(
    'MISSING_X_CONTENT_TYPE_OPTIONS',
    affected((h) => (h['x-content-type-options'] ?? '').toLowerCase() !== 'nosniff'),
    {
      severity: 'LOW',
      level: 'WARNING',
      what: '"X-Content-Type-Options: nosniff" is not set.',
      headerName: 'X-Content-Type-Options',
      recommendedValue: 'nosniff',
    },
  );
  add(
    'MISSING_REFERRER_POLICY',
    affected(
      (h) => !h['referrer-policy'] || h['referrer-policy'].toLowerCase().includes('unsafe-url'),
    ),
    {
      severity: 'LOW',
      level: 'OBSERVATION',
      what: 'No Referrer-Policy header (or "unsafe-url").',
      headerName: 'Referrer-Policy',
      recommendedValue: 'strict-origin-when-cross-origin',
    },
  );
  if (servedOverHttps) {
    const missing = affected((h) => !h['strict-transport-security']);
    add('MISSING_HSTS', missing, {
      severity: 'MEDIUM',
      level: 'WARNING',
      what: 'No Strict-Transport-Security header on https responses.',
      headerName: 'Strict-Transport-Security',
      recommendedValue: 'max-age=31536000; includeSubDomains',
    });
    const short = affected((h) => {
      const match = /max-age=(\d+)/i.exec(h['strict-transport-security'] ?? '');
      return (
        Boolean(h['strict-transport-security']) && (!match || Number(match[1]) < HSTS_MIN_SECONDS)
      );
    });
    if (missing.length === 0 && short.length > 0) {
      add('MISSING_HSTS', short, {
        severity: 'LOW',
        level: 'OBSERVATION',
        what: 'HSTS is set, but max-age is shorter than 180 days.',
        headerName: 'Strict-Transport-Security',
        observedValue: short[0]!.headers['strict-transport-security'],
        recommendedValue: 'max-age=31536000; includeSubDomains',
        target: 'short-max-age',
      });
    }
  }

  const versions = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const header of VERSION_HEADERS) {
      const value = page.headers[header];
      if (value && /\d+\.\d+/.test(value)) {
        versions.set(header, (versions.get(header) ?? new Set()).add(value.slice(0, 120)));
      }
    }
  }
  if (versions.size > 0) {
    const observed = [...versions].map(([h, v]) => `${h}: ${[...v].join(' | ')}`).join('; ');
    add(
      'VERSION_DISCLOSURE',
      affected((h) => VERSION_HEADERS.some((x) => h[x] && /\d+\.\d+/.test(h[x]!))),
      {
        severity: 'LOW',
        level: 'OBSERVATION',
        what: `Response headers reveal software versions (${observed}).`,
        headerName: [...versions.keys()].join(', '),
        observedValue: observed,
        recommendedValue: 'No version numbers',
      },
    );
  }
  return drafts;
}

/** One issue per cookie name (attributes only; values are never stored). */
export function cookieSecurityDrafts(
  websiteId: string,
  startUrl: string,
  pages: SecurityPageInput[],
  servedOverHttps: boolean,
): SecurityDraft[] {
  const seen = new Map<string, { cookie: CookieFacts; page: SecurityPageInput }>();
  for (const page of pages)
    for (const cookie of page.cookies)
      if (!seen.has(cookie.name)) seen.set(cookie.name, { cookie, page });
  const drafts: SecurityDraft[] = [];
  for (const { cookie, page } of seen.values()) {
    const problems: string[] = [];
    let level: FindingLevel = 'OBSERVATION';
    if (servedOverHttps && !cookie.secure) {
      problems.push('no Secure flag (can be sent over plain HTTP)');
      level = 'WARNING';
    }
    if (cookie.sameSite === 'none' && !cookie.secure) {
      problems.push('SameSite=None without Secure (browsers reject it)');
      level = 'WARNING';
    }
    if (!cookie.httpOnly)
      problems.push('no HttpOnly flag (readable by JavaScript; fine for non-session cookies)');
    if (!cookie.sameSite) problems.push('no SameSite attribute (browsers default to Lax)');
    if (problems.length === 0) continue;
    drafts.push(
      securityDraft(
        'INSECURE_COOKIE',
        { websiteId, pageUrl: startUrl },
        {
          severity: level === 'WARNING' ? 'MEDIUM' : 'LOW',
          level,
          description: `Cookie "${cookie.name}" (set by ${page.url}): ${problems.join('; ')}.`,
          headerName: 'Set-Cookie',
          observedValue: `${cookie.name}=…;${cookie.secure ? ' Secure;' : ''}${cookie.httpOnly ? ' HttpOnly;' : ''}${cookie.sameSite ? ` SameSite=${cookie.sameSite}` : ''}`,
          recommendedValue: `${cookie.name}=…; Secure; HttpOnly; SameSite=Lax`,
          target: cookie.name,
          scanPageId: page.scanPageId,
          details: {
            cookie: {
              name: cookie.name,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
              sameSite: cookie.sameSite,
            },
          },
        },
      ),
    );
  }
  return drafts;
}

/** Mixed content and insecure forms, per page. */
export function mixedContentDrafts(websiteId: string, pages: SecurityPageInput[]): SecurityDraft[] {
  const drafts: SecurityDraft[] = [];
  for (const page of pages) {
    const ctx = { websiteId, pageUrl: page.url };
    const active = page.insecureReferences.filter((r) => r.kind === 'active');
    const passive = page.insecureReferences.filter((r) => r.kind === 'passive');
    const forms = page.insecureReferences.filter((r) => r.kind === 'form');
    const list = (refs: InsecureReference[]) =>
      refs
        .slice(0, 5)
        .map((r) => `<${r.tag}> ${r.url}`)
        .join(', ');
    if (active.length > 0) {
      drafts.push(
        securityDraft('MIXED_CONTENT', ctx, {
          severity: 'HIGH',
          level: 'CONFIRMED',
          description: `${active.length} script/style/frame reference${active.length === 1 ? '' : 's'} use http:// on this https page: ${list(active)}.`,
          observedValue: active[0]!.url,
          recommendedValue: 'https:// or a relative URL',
          selector: active[0]!.selector,
          target: 'active',
          scanPageId: page.scanPageId,
          details: { references: active.slice(0, 20) },
        }),
      );
    }
    if (passive.length > 0) {
      drafts.push(
        securityDraft('MIXED_CONTENT', ctx, {
          severity: 'LOW',
          level: 'WARNING',
          description: `${passive.length} image/media reference${passive.length === 1 ? '' : 's'} use http:// on this https page: ${list(passive)}.`,
          observedValue: passive[0]!.url,
          recommendedValue: 'https:// or a relative URL',
          selector: passive[0]!.selector,
          target: 'passive',
          scanPageId: page.scanPageId,
          details: { references: passive.slice(0, 20) },
        }),
      );
    }
    if (forms.length > 0) {
      drafts.push(
        securityDraft('INSECURE_FORM', ctx, {
          severity: 'HIGH',
          level: 'CONFIRMED',
          description: `${forms.length} form${forms.length === 1 ? '' : 's'} submit to http://: ${list(forms)}.`,
          observedValue: forms[0]!.url,
          recommendedValue: 'https:// action',
          selector: forms[0]!.selector,
          scanPageId: page.scanPageId,
          details: { references: forms.slice(0, 20) },
        }),
      );
    }
  }
  return drafts;
}

/** HTTPS availability, certificate validity and the http → https redirect. */
export function transportSecurityDrafts(
  websiteId: string,
  startUrl: string,
  facts: SiteSecurityFacts,
): SecurityDraft[] {
  const drafts: SecurityDraft[] = [];
  const ctx = { websiteId, pageUrl: startUrl };
  const { tls, httpRedirect } = facts;
  const httpsWorks = Boolean(tls?.checked);

  if (!facts.servedOverHttps) {
    if (!httpsWorks) {
      drafts.push(
        securityDraft('NO_HTTPS', ctx, {
          severity: 'HIGH',
          level: 'CONFIRMED',
          description: `Pages are served over plain http:// and no HTTPS connection could be made to ${tls?.host ?? new URL(startUrl).hostname}${tls?.error ? ` (${tls.error})` : ''}.`,
          observedValue: 'http://',
          recommendedValue: 'https://',
          target: 'site',
        }),
      );
    } else {
      drafts.push(
        securityDraft('HTTP_NOT_REDIRECTED', ctx, {
          severity: 'MEDIUM',
          level: 'WARNING',
          description:
            'HTTPS is available, but the website was served over http:// without redirecting.',
          observedValue: startUrl,
          recommendedValue: '301 redirect to https://',
          target: 'site',
        }),
      );
    }
  } else if (httpRedirect && httpRedirect.status !== null && !httpRedirect.redirectsToHttps) {
    drafts.push(
      securityDraft('HTTP_NOT_REDIRECTED', ctx, {
        severity: 'MEDIUM',
        level: 'WARNING',
        description: `${httpRedirect.url} answered HTTP ${httpRedirect.status}${httpRedirect.location ? ` → ${httpRedirect.location}` : ''} instead of redirecting to https://.`,
        observedValue: `HTTP ${httpRedirect.status}`,
        recommendedValue: '301/308 to https://',
        target: 'site',
      }),
    );
  }

  if (tls?.checked && !tls.valid) {
    drafts.push(
      securityDraft('INVALID_CERTIFICATE', ctx, {
        severity: 'HIGH',
        level: 'CONFIRMED',
        description: `${describeCertificateError(tls.error)} Browsers show a full-page warning to visitors.`,
        observedValue: [
          tls.error,
          tls.subject && `subject ${tls.subject}`,
          tls.issuer && `issuer ${tls.issuer}`,
          tls.validTo && `valid to ${tls.validTo.slice(0, 10)}`,
        ]
          .filter(Boolean)
          .join(', '),
        recommendedValue: 'A trusted certificate for this host',
        target: 'site',
        details: { tls },
      }),
    );
  } else if (
    tls?.checked &&
    tls.valid &&
    tls.daysRemaining !== null &&
    tls.daysRemaining <= CERT_EXPIRY_WARNING_DAYS
  ) {
    drafts.push(
      securityDraft('CERTIFICATE_EXPIRING', ctx, {
        severity: 'MEDIUM',
        level: 'WARNING',
        description: `The certificate expires in ${tls.daysRemaining} day${tls.daysRemaining === 1 ? '' : 's'} (${tls.validTo?.slice(0, 10)}).`,
        observedValue: tls.validTo,
        recommendedValue: `More than ${CERT_EXPIRY_WARNING_DAYS} days left, with auto-renewal`,
        target: 'site',
      }),
    );
  }
  return drafts;
}

/** 100 minus the weight of each distinct failed check (our heuristic, not an industry standard). */
export function computeSecurityScore(checks: { checkType: string }[]): number {
  const failed = new Set(checks.map((c) => c.checkType));
  let penalty = 0;
  for (const check of failed) penalty += SECURITY_WEIGHTS[check as SecurityCheck] ?? 0;
  return Math.max(0, 100 - penalty);
}
