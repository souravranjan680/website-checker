import { useState } from 'react';
import { useParams } from 'react-router';
import { ErrorState } from '@/components/common/ErrorState';
import { canEdit } from '@/components/common/RoleBadge';
import { SeverityBadge } from '@/components/common/StatusBadges';
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
import { useUiHealthReport } from './api';
import { ReportIssues } from './ReportIssues';
import { MetricTile } from './report-parts';

const CHECK_LABEL: Record<string, string> = {
  BROKEN_IMAGE: 'Broken images',
  BROKEN_LINK: 'Broken links',
  HORIZONTAL_SCROLL: 'Horizontal scrolling',
  CONTENT_OVERFLOW: 'Content overflow',
  OVERLAPPING_ELEMENTS: 'Overlapping elements',
  TEXT_CLIPPING: 'Clipped text',
  OUT_OF_VIEWPORT: 'Off-screen elements',
  FAILED_STYLESHEET: 'Failed stylesheets',
  FAILED_SCRIPT: 'Failed scripts',
  CONSOLE_ERROR: 'Console errors',
  JS_ERROR: 'JavaScript errors',
  FAILED_REQUEST: 'Failed requests',
  EMPTY_BUTTON: 'Empty buttons',
  EMPTY_LINK: 'Empty links',
  BROKEN_NAVIGATION: 'Broken navigation',
  IMAGE_SIZING: 'Image sizing',
};

/** Broken links/images, layout problems, JavaScript and console errors, failed requests. */
export function UiHealthReport() {
  const { scanId = '' } = useParams();
  const report = useUiHealthReport(scanId);
  const [checkType, setCheckType] = useState<string | undefined>();
  if (report.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (report.isError)
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;
  const total = r.checks.reduce((n, c) => n + c.count, 0);
  const count = (...types: string[]) =>
    r.checks.filter((c) => types.includes(c.checkType)).reduce((n, c) => n + c.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <MetricTile label="Score" value={r.scan.uiHealthScore} suffix="/100" />
        <MetricTile label="Issues" value={total} />
        <MetricTile label="Broken links / images" value={count('BROKEN_LINK', 'BROKEN_IMAGE')} />
        <MetricTile
          label="Layout problems"
          value={count(
            'HORIZONTAL_SCROLL',
            'CONTENT_OVERFLOW',
            'OVERLAPPING_ELEMENTS',
            'TEXT_CLIPPING',
            'OUT_OF_VIEWPORT',
          )}
        />
        <MetricTile
          label="Console errors"
          value={r.consoleErrors.length}
          hint="Errors the page logged to the browser console"
        />
        <MetricTile
          label="Failed requests"
          value={r.failedRequests.length}
          hint="Requests that failed or returned 4xx/5xx (blocked requests excluded)"
        />
      </dl>

      <Card>
        <CardHeader>
          <CardTitle>Checks</CardTitle>
          <CardDescription>Choose a check to filter the issue list below</CardDescription>
        </CardHeader>
        <CardContent>
          {r.checks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No UI health problems were detected.</p>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by check">
              <Button
                size="sm"
                variant={checkType ? 'outline' : 'secondary'}
                aria-pressed={!checkType}
                onClick={() => setCheckType(undefined)}
              >
                All ({total})
              </Button>
              {r.checks.map((c) => (
                <Button
                  key={c.checkType}
                  size="sm"
                  variant={checkType === c.checkType ? 'secondary' : 'outline'}
                  aria-pressed={checkType === c.checkType}
                  onClick={() => setCheckType(c.checkType)}
                >
                  {CHECK_LABEL[c.checkType] ?? c.checkType} ({c.count})
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Console errors</CardTitle>
            <CardDescription>As logged by the page (first 200)</CardDescription>
          </CardHeader>
          <CardContent>
            {r.consoleErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No console errors.</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-auto text-sm">
                {r.consoleErrors.map((e, i) => (
                  <li key={i}>
                    <pre className="rounded bg-muted p-2 text-xs whitespace-pre-wrap break-all">
                      {e.text}
                    </pre>
                    <span className="block truncate text-xs text-muted-foreground">
                      {e.pageUrl}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Failed requests</CardTitle>
            <CardDescription>Resources that could not be loaded</CardDescription>
          </CardHeader>
          <CardContent>
            {r.failedRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No failed requests.</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-auto text-sm">
                {r.failedRequests.map((f, i) => (
                  <li key={i} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block break-all">{f.url}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {f.resourceType} on {f.pageUrl}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {f.status ?? f.error ?? 'failed'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pages</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Page</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Issues</TableHead>
                <TableHead className="text-right">Console errors</TableHead>
                <TableHead className="pr-6 text-right">Failed requests</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.pages.map((p) => (
                <TableRow key={p.url}>
                  <TableCell className="max-w-96 truncate pl-6">{p.url}</TableCell>
                  <TableCell>
                    {p.status === 'DONE' ? 'Scanned' : p.status === 'FAILED' ? 'Failed' : p.status}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.issues}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.consoleErrors}</TableCell>
                  <TableCell className="pr-6 text-right tabular-nums">{p.failedRequests}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {r.checks.some((c) => c.highestSeverity === 'CRITICAL') ? (
        <p className="flex items-center gap-2 text-sm">
          <SeverityBadge severity="CRITICAL" /> Some checks found critical problems.
        </p>
      ) : null}
      <ReportIssues
        key={checkType ?? 'all'}
        scanId={scanId}
        category="UI_HEALTH"
        canEdit={canEdit(r.scan.myRole)}
        extraFilters={{ checkType }}
        title={checkType ? `${CHECK_LABEL[checkType] ?? checkType}` : 'All UI health issues'}
      />
    </div>
  );
}
