import type { BrowsersReportDto, BrowserStateName } from '@whc/shared';
import { CircleSlash, Info } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { ErrorState } from '@/components/common/ErrorState';
import { canEdit } from '@/components/common/RoleBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { formatDateTime } from '@/lib/format';
import { BROWSER_LABEL, COMPATIBILITY_CHECK_LABEL } from '@/lib/labels';
import { useBrowsersReport } from './api';
import { ReportIssues } from './ReportIssues';

/** Each state in words, and how strongly it is shown. Never a success unless it was one. */
const STATE: Record<
  BrowserStateName,
  { label: string; variant: 'secondary' | 'outline' | 'destructive' }
> = {
  COMPLETED: { label: 'Completed', variant: 'secondary' },
  PARTIAL: { label: 'Partial: some pages failed', variant: 'outline' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  UNAVAILABLE: { label: 'Unavailable', variant: 'destructive' },
  TIMED_OUT: { label: 'Timed out', variant: 'outline' },
  SKIPPED: { label: 'Skipped', variant: 'outline' },
  CANCELLED: { label: 'Cancelled', variant: 'outline' },
  RUNNING: { label: 'Running', variant: 'outline' },
  DISABLED: { label: 'Off', variant: 'outline' },
  NOT_RUN: { label: 'Did not run', variant: 'outline' },
  NOT_RECORDED: { label: 'Not recorded', variant: 'outline' },
};

const CHECK_SKIPPED: Record<string, string> = {
  explorer: 'Menus and panels',
  'keyboard-probe': 'Keyboard checks',
  'form-probe': 'Form checks',
  'component-consistency': 'Component consistency',
  lighthouse: 'Lighthouse',
  'visual-regression': 'Visual baselines',
  'mobile-size': 'Phone size',
};

const CLASSIFICATION: Record<string, string> = {
  DETECTED: 'detected',
  POTENTIAL_DEFECT: 'potential',
  OBSERVATION: 'observation',
  INCONCLUSIVE: 'inconclusive',
};

/** /scans/:scanId/reports/browsers : what Chromium, Firefox and WebKit each did. */
export function BrowsersReport() {
  const { scanId = '' } = useParams();
  const report = useBrowsersReport(scanId);
  const [browser, setBrowser] = useState<'FIREFOX' | 'WEBKIT' | undefined>();
  const [checkType, setCheckType] = useState<string | undefined>();
  if (report.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (report.isError)
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;
  const ran = r.browsers.some((b) => b.role === 'COMPARED' && b.startedAt !== null);
  const checks = r.checks.filter((c) => !browser || c.browser === browser);
  const total = r.checks.reduce((n, c) => n + c.count, 0);

  return (
    <div className="flex flex-col gap-6">
      {!ran ? <NoBrowserRuns report={r} /> : null}

      <div className="grid gap-4 md:grid-cols-3">
        {r.browsers.map((b) => (
          <BrowserCard key={b.browser} browser={b} />
        ))}
      </div>

      {ran ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>How browsers are compared</AlertTitle>
          <AlertDescription>
            Chromium runs every check. Firefox and WebKit load the first pages with passive checks
            only (no clicks or typing). For each page and size, Chromium loads the page at the same
            time and only what the other browser shows on its own is reported; differences are
            loaded a second time to confirm them. Pixels are never compared, and this category is
            never part of the scores.
          </AlertDescription>
        </Alert>
      ) : null}

      {r.pages.length > 0 ? <PageResults pages={r.pages} /> : null}

      {ran ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Differences</CardTitle>
              <CardDescription>
                Choose a browser or check to filter the issue list below
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by browser">
                {([undefined, 'FIREFOX', 'WEBKIT'] as const).map((b) => (
                  <Button
                    key={b ?? 'all'}
                    size="sm"
                    variant={browser === b ? 'secondary' : 'outline'}
                    aria-pressed={browser === b}
                    onClick={() => {
                      setBrowser(b);
                      setCheckType(undefined);
                    }}
                  >
                    {b ? BROWSER_LABEL[b] : 'All browsers'} (
                    {b
                      ? r.checks.filter((c) => c.browser === b).reduce((n, c) => n + c.count, 0)
                      : total}
                    )
                  </Button>
                ))}
              </div>
              {checks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No differences from Chromium were found
                  {browser ? ` in ${BROWSER_LABEL[browser]}` : ''}.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by check">
                  {checks.map((c) => {
                    const on = checkType === c.checkType && browser === c.browser;
                    return (
                      <Button
                        key={`${c.browser}-${c.checkType}`}
                        size="sm"
                        variant={on ? 'secondary' : 'outline'}
                        aria-pressed={on}
                        onClick={() => {
                          setBrowser(c.browser);
                          setCheckType(on ? undefined : c.checkType);
                        }}
                        title={Object.entries(c.byClassification)
                          .map(([k, n]) => `${n} ${CLASSIFICATION[k] ?? k}`)
                          .join(', ')}
                      >
                        {BROWSER_LABEL[c.browser]}:{' '}
                        {COMPATIBILITY_CHECK_LABEL[c.checkType] ?? c.checkType} ({c.count})
                      </Button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <ReportIssues
            key={`${browser ?? 'all'}-${checkType ?? 'all'}`}
            scanId={scanId}
            category="COMPATIBILITY"
            canEdit={canEdit(r.scan.myRole)}
            extraFilters={{ browser, checkType }}
            title={
              checkType
                ? `${BROWSER_LABEL[browser ?? ''] ?? ''}: ${COMPATIBILITY_CHECK_LABEL[checkType] ?? checkType}`
                : browser
                  ? `Differences in ${BROWSER_LABEL[browser]}`
                  : 'All browser differences'
            }
          />
        </>
      ) : null}
    </div>
  );
}

function NoBrowserRuns({ report }: { report: BrowsersReportDto }) {
  const text =
    report.crossBrowser === 'OFF'
      ? {
          title: 'Cross-browser checks were off for this scan',
          body: 'Only Chromium checked this website. Turn on "Other browsers" in the website’s settings and rescan to also check Firefox and WebKit.',
        }
      : report.crossBrowser === 'UNKNOWN'
        ? {
            title: 'No cross-browser results for this scan',
            body: 'This scan has no record of the cross-browser setting, so nothing is claimed about Firefox or WebKit (older scans ran before these checks existed).',
          }
        : {
            title: 'Firefox and WebKit did not run in this scan',
            body: 'Cross-browser checks were on, but the scan ended before the browser stage (see each browser below).',
          };
  return (
    <Alert>
      <CircleSlash aria-hidden="true" />
      <AlertTitle>{text.title}</AlertTitle>
      <AlertDescription>{text.body}</AlertDescription>
    </Alert>
  );
}

function BrowserCard({ browser: b }: { browser: BrowsersReportDto['browsers'][number] }) {
  const state = STATE[b.state];
  // DISABLED, NOT_RUN and NOT_RECORDED: the browser never started in this scan.
  const ran = b.startedAt !== null;
  return (
    <Card aria-label={`${BROWSER_LABEL[b.browser]} status`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {BROWSER_LABEL[b.browser]}
          <Badge variant={state.variant}>{state.label}</Badge>
        </CardTitle>
        <CardDescription>
          {b.role === 'BASELINE'
            ? 'The scan’s own browser: runs every check'
            : ran
              ? 'Compared with Chromium'
              : 'Not compared in this scan'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {b.role === 'BASELINE' || ran ? (
            <>
              <dt className="text-muted-foreground">Version</dt>
              <dd>{b.version ?? 'Not recorded'}</dd>
            </>
          ) : null}
          {b.pagesChecked !== null ? (
            <>
              <dt className="text-muted-foreground">Pages checked</dt>
              <dd>
                {b.pagesChecked}
                {b.pagesPlanned !== null ? ` of ${b.pagesPlanned}` : ''}
              </dd>
            </>
          ) : null}
          {b.role === 'COMPARED' && b.startedAt ? (
            <>
              <dt className="text-muted-foreground">Differences</dt>
              <dd>{b.issues}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd>{formatDateTime(b.startedAt)}</dd>
            </>
          ) : null}
        </dl>
        {b.message ? <p className="text-muted-foreground">{b.message}</p> : null}
        {b.skippedChecks.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              Not run in {BROWSER_LABEL[b.browser]} ({b.skippedChecks.length})
            </summary>
            <ul className="mt-1 space-y-0.5">
              {b.skippedChecks.map((s) => (
                <li key={`${s.check}-${s.viewport ?? ''}`}>
                  <span className="font-medium">{CHECK_SKIPPED[s.check] ?? s.check}</span>
                  {s.viewport ? ` (${s.viewport})` : ''}
                  <span className="text-muted-foreground"> · {s.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PageResults({ pages }: { pages: BrowsersReportDto['pages'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pages</CardTitle>
        <CardDescription>Each browser’s result per page and screen size</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Page</TableHead>
              <TableHead>Browser</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Loaded</TableHead>
              <TableHead>Compared with Chromium</TableHead>
              <TableHead className="text-right">Differences</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.flatMap((page) => [
              ...page.results.map((res, i) => (
                <TableRow key={`${page.url}-${res.browser}-${res.viewport}-${i}`}>
                  <TableCell className="max-w-72 break-all whitespace-normal">
                    {i === 0 ? page.url : ''}
                  </TableCell>
                  <TableCell>{BROWSER_LABEL[res.browser]}</TableCell>
                  <TableCell>{res.viewport}</TableCell>
                  <TableCell>
                    {res.status === 'DONE' ? (
                      `Yes${res.httpStatus ? ` (HTTP ${res.httpStatus})` : ''}${res.loadTimeMs !== null ? `, ${(res.loadTimeMs / 1000).toFixed(1)} s` : ''}`
                    ) : (
                      <span className="text-destructive">
                        {res.status === 'FAILED' ? 'Failed' : 'Skipped'}
                        {res.error ? `: ${res.error}` : ''}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {res.comparison === null
                      ? 'Not recorded'
                      : res.comparison.compared
                        ? `Yes${res.comparison.baselineVersion ? ` (${res.comparison.baselineVersion})` : ''}`
                        : `No: ${res.comparison.reason ?? 'reason not recorded'}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {res.comparison?.compared
                      ? `${res.comparison.differences}${res.comparison.differences > 0 ? ` (${res.comparison.confirmed} confirmed)` : ''}`
                      : '—'}
                  </TableCell>
                </TableRow>
              )),
              ...(page.unreadable > 0
                ? [
                    <TableRow key={`${page.url}-unreadable`}>
                      <TableCell className="max-w-72 break-all whitespace-normal">
                        {page.results.length === 0 ? page.url : ''}
                      </TableCell>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        {page.unreadable} stored result{page.unreadable === 1 ? '' : 's'} could not
                        be read and {page.unreadable === 1 ? 'is' : 'are'} not shown.
                      </TableCell>
                    </TableRow>,
                  ]
                : []),
            ])}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
