import type { SecurityReportDto } from '@whc/shared';
import { CheckCircle2, CircleSlash, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { FindingLevelBadge } from '@/components/common/StatusBadges';
import { ErrorState } from '@/components/common/ErrorState';
import { canEdit } from '@/components/common/RoleBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { useSecurityReport } from './api';
import { ReportIssues } from './ReportIssues';
import { MetricTile } from './report-parts';

const HEADER_LABEL: Record<string, string> = {
  'content-security-policy': 'CSP',
  'strict-transport-security': 'HSTS',
  'x-frame-options': 'X-Frame-Options',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'Referrer-Policy',
};

/**
 * Passive security configuration. Only what any visitor receives is read; no attacks,
 * port scans or exploit attempts. Findings say how sure we are (level).
 */
export function SecurityReport() {
  const { scanId = '' } = useParams();
  const report = useSecurityReport(scanId);
  const [ruleId, setRuleId] = useState<string | undefined>();
  if (report.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (report.isError)
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;

  if (!r.site && r.checks.length === 0) {
    return (
      <Alert>
        <CircleSlash aria-hidden="true" />
        <AlertTitle>No security data for this scan</AlertTitle>
        <AlertDescription>
          This scan ran before the security audit was added (Phase 6). Rescan the website to get
          results. Nothing is estimated.
        </AlertDescription>
      </Alert>
    );
  }
  const current = r.checks.find((c) => c.ruleId === ruleId);

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <ShieldAlert aria-hidden="true" />
        <AlertTitle>Passive configuration check, not a penetration test</AlertTitle>
        <AlertDescription>
          <p>
            We only read what any visitor receives: response headers, cookie attributes, the
            certificate and the page&apos;s own HTML. <b>Confirmed</b> means we directly observed an
            insecure configuration, not that it was exploited. <b>Warning</b>: a recommended
            protection is missing. <b>Observation</b>: worth knowing, often fine.
          </p>
        </AlertDescription>
      </Alert>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile
          label="Security score"
          value={r.scan.securityScore}
          suffix="/100"
          hint="Our heuristic: 100 minus a weight for each failed check (e.g. no HTTPS −40, no CSP −15). Not a certification."
        />
        <MetricTile label="Confirmed" value={r.levels.CONFIRMED} />
        <MetricTile label="Warnings" value={r.levels.WARNING} />
        <MetricTile label="Observations" value={r.levels.OBSERVATION} />
      </dl>

      {r.site ? <TransportCards site={r.site} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Findings</CardTitle>
          <CardDescription>Choose one to filter the issue list below</CardDescription>
        </CardHeader>
        <CardContent>
          {r.checks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No security configuration problems found.
            </p>
          ) : (
            <ul className="divide-y">
              {r.checks.map((c) => (
                <li
                  key={`${c.ruleId}-${c.findingLevel}`}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <FindingLevelBadge level={c.findingLevel} />
                  <span className="flex-1 text-sm">{c.title}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {c.count} issue{c.count === 1 ? '' : 's'}
                  </span>
                  <Button
                    size="sm"
                    variant={ruleId === c.ruleId ? 'secondary' : 'outline'}
                    aria-pressed={ruleId === c.ruleId}
                    onClick={() => setRuleId(ruleId === c.ruleId ? undefined : c.ruleId)}
                  >
                    {ruleId === c.ruleId ? 'Showing' : 'Show'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <HeaderMatrix headers={r.headers} />

      <ReportIssues
        key={ruleId ?? 'all'}
        scanId={scanId}
        category="SECURITY"
        canEdit={canEdit(r.scan.myRole)}
        extraFilters={{ ruleId }}
        title={current ? current.title : 'All security findings'}
      />
    </div>
  );
}

function StatusIcon({ state }: { state: 'ok' | 'bad' | 'unknown' }) {
  const Icon = state === 'ok' ? CheckCircle2 : state === 'bad' ? XCircle : CircleSlash;
  return (
    <Icon
      className={`size-4 ${state === 'ok' ? 'text-emerald-600' : state === 'bad' ? 'text-red-600' : 'text-muted-foreground'}`}
      aria-hidden="true"
    />
  );
}

function TransportCards({ site }: { site: NonNullable<SecurityReportDto['site']> }) {
  const { tls, httpRedirect } = site;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StatusIcon state={!tls?.checked ? 'unknown' : tls.valid ? 'ok' : 'bad'} />
            HTTPS certificate
          </CardTitle>
          <CardDescription>{tls ? `${tls.host}:${tls.port}` : 'Not checked'}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {!tls || !tls.checked ? (
            <p>
              No HTTPS connection could be made{tls?.error ? ` (${tls.error})` : ''}.
              {site.servedOverHttps ? '' : ' The site was served over plain http://.'}
            </p>
          ) : (
            <dl className="grid gap-1.5">
              <Row label="Status">
                {tls.valid ? 'Valid and trusted' : `Not valid (${tls.error})`}
              </Row>
              <Row label="Issued to">{tls.subject ?? '–'}</Row>
              <Row label="Issued by">{tls.issuer ?? '–'}</Row>
              <Row label="Valid until">
                {tls.validTo ? formatDate(tls.validTo) : '–'}
                {tls.daysRemaining !== null
                  ? tls.daysRemaining >= 0
                    ? ` (${tls.daysRemaining} days left)`
                    : ` (expired ${-tls.daysRemaining} days ago)`
                  : ''}
              </Row>
              <Row label="Protocol">{tls.protocol ?? '–'}</Row>
            </dl>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StatusIcon
              state={
                !site.servedOverHttps
                  ? 'bad'
                  : !httpRedirect || httpRedirect.status === null
                    ? 'unknown'
                    : httpRedirect.redirectsToHttps
                      ? 'ok'
                      : 'bad'
              }
            />
            http:// → https:// redirect
          </CardTitle>
          <CardDescription>{httpRedirect?.url ?? 'Not checked'}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {!site.servedOverHttps ? (
            <p>The scanned pages were served over plain http://.</p>
          ) : !httpRedirect || httpRedirect.status === null ? (
            <p>
              No answer on http:// ({httpRedirect?.error ?? 'not checked'}). Nothing is served
              insecurely.
            </p>
          ) : (
            <p>
              HTTP {httpRedirect.status}
              {httpRedirect.location ? ` → ${httpRedirect.location}` : ''}.{' '}
              {httpRedirect.redirectsToHttps
                ? 'Redirects to HTTPS.'
                : 'Does not redirect to HTTPS.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HeaderMatrix({ headers }: { headers: SecurityReportDto['headers'] }) {
  if (headers.length === 0) return null;
  const names = Object.keys(headers[0]!.present);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Security headers per page</CardTitle>
        <CardDescription>Which recommended headers each scanned page sent</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Page</TableHead>
              {names.map((n) => (
                <TableHead key={n} className="text-center">
                  {HEADER_LABEL[n] ?? n}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {headers.map((row) => (
              <TableRow key={row.url}>
                <TableCell className="max-w-72 truncate pl-6">{row.url}</TableCell>
                {names.map((n) => (
                  <TableCell key={n} className="text-center">
                    <span className="sr-only">{row.present[n] ? 'present' : 'missing'}</span>
                    <StatusIcon state={row.present[n] ? 'ok' : 'bad'} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </div>
  );
}
