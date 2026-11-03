import { useState } from 'react';
import { useParams } from 'react-router';
import type { ConsoleKindName, ResourceVerdictName } from '@whc/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { canEdit } from '@/components/common/RoleBadge';
import { SeverityBadge } from '@/components/common/StatusBadges';
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
  TEXT_OVERFLOW_VISIBLE: 'Text spilling out',
  TEXT_OVERLAP: 'Overlapping text',
  FIXED_OUT_OF_VIEWPORT: 'Fixed element off screen',
  CONTROL_LABEL_CLIPPED: 'Labels that do not fit',
  FONT_LOAD_FAILED: 'Failed web fonts',
  FONT_FALLBACK_RENDERED: 'Fallback fonts',
  ICON_BROKEN: 'Broken icons',
  ICON_MISSING: 'Empty icon buttons',
  COMPONENT_INCONSISTENT: 'Inconsistent components',
};

const CLASSIFICATION: Record<string, string> = {
  DETECTED: 'Detected',
  POTENTIAL_DEFECT: 'Potential defect',
  OBSERVATION: 'Observation',
  INCONCLUSIVE: 'Inconclusive',
};

const CONSOLE_KIND: Record<ConsoleKindName, string> = {
  APPLICATION: 'Site code',
  INTEGRATION_CONFIG: 'Integration config',
  THIRD_PARTY: 'Third-party script',
  NETWORK: 'Network',
  HARMLESS: 'Harmless',
};

const VERDICT: Record<ResourceVerdictName, string> = {
  CONFIRMED: 'Confirmed',
  INCONCLUSIVE: 'Inconclusive',
  BLOCKED_BY_POLICY: 'Blocked (policy)',
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
          value={
            r.consoleErrors.filter((e) => e.kind !== 'HARMLESS' && e.level !== 'warning').length
          }
          hint="Distinct errors and uncaught exceptions (harmless warnings excluded)"
        />
        <MetricTile
          label="Confirmed failed requests"
          value={r.failedRequests.filter((f) => f.verdict === 'CONFIRMED').length}
          hint={`Failures confirmed by a re-check; ${
            r.failedRequests.filter((f) => f.verdict !== 'CONFIRMED').length
          } more could not be verified or were blocked by the security policy`}
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

      <Card>
        <CardHeader>
          <CardTitle>Layout, fonts, icons and consistency</CardTitle>
          <CardDescription>
            Newer checks, listed with the others above. They are not part of the score, so scores
            stay comparable with earlier scans. Observations may be intended.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile
              label="Layout"
              value={r.extraChecks.layout}
              hint="Text spilling out or overlapping, fixed elements off screen, labels that do not fit (all screen sizes)"
            />
            <MetricTile
              label="Fonts and icons"
              value={r.extraChecks.fontsAndIcons}
              hint="Web fonts that failed, text in fallback fonts, broken or empty icons"
            />
            <MetricTile
              label="Inconsistent components"
              value={r.extraChecks.consistency}
              hint="Buttons and fields that look different from others with the same classes"
            />
            <MetricTile
              label="Pages compared"
              value={r.extraChecks.consistencyPages}
              hint="Pages whose buttons and fields were compared (0 when switched off for this website)"
            />
          </dl>
          {Object.keys(r.extraChecks.byClassification).length > 0 ? (
            <ul
              className="flex flex-wrap gap-1.5"
              aria-label="Newer checks by strength of evidence"
            >
              {Object.entries(r.extraChecks.byClassification).map(([classification, n]) => (
                <li key={classification}>
                  <Badge variant="outline">
                    {CLASSIFICATION[classification] ?? classification} × {n}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Console messages</CardTitle>
            <CardDescription>
              Errors, warnings and uncaught exceptions with their source. The same message from the
              same script is listed once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {r.consoleErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No console errors or warnings.</p>
            ) : (
              <ul className="max-h-96 space-y-3 overflow-auto text-sm">
                {r.consoleErrors.map((e, i) => (
                  <li key={i} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={e.kind === 'HARMLESS' ? 'outline' : 'secondary'}>
                        {e.kind ? CONSOLE_KIND[e.kind] : 'Not classified'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {e.level === 'exception' ? 'Uncaught exception' : e.level}
                        {e.occurrences > 1 ? ` · ${e.occurrences} times` : ''}
                      </span>
                    </div>
                    <pre className="rounded bg-muted p-2 text-xs whitespace-pre-wrap break-all">
                      {e.text}
                    </pre>
                    {e.source ? (
                      <span className="block break-all text-xs text-muted-foreground">
                        Source: {e.source}
                        {e.line ? `:${e.line}${e.column ? `:${e.column}` : ''}` : ''}
                      </span>
                    ) : null}
                    {e.related.length > 0 ? (
                      <span className="block break-all text-xs text-muted-foreground">
                        Related requests:{' '}
                        {e.related
                          .map(
                            (rel) =>
                              `${rel.url} (${rel.status ? `HTTP ${rel.status}` : 'failed'}${rel.relation === 'same-service' ? ', possibly related' : ''})`,
                          )
                          .join('; ')}
                      </span>
                    ) : null}
                    <span className="block truncate text-xs text-muted-foreground">
                      {e.pageUrl}
                      {e.otherPages.length > 0 ? ` and ${e.otherPages.length} more page(s)` : ''}
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
            <CardDescription>
              Each failure is re-checked. Only confirmed failures are reported as issues.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {r.failedRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No failed requests.</p>
            ) : (
              <ul className="max-h-96 space-y-3 overflow-auto text-sm">
                {r.failedRequests.map((f, i) => (
                  <li key={i} className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-all">{f.url}</span>
                      <Badge
                        variant={f.verdict === 'CONFIRMED' ? 'destructive' : 'outline'}
                        className="shrink-0"
                      >
                        {f.verdict ? VERDICT[f.verdict] : 'Not re-checked'}
                      </Badge>
                    </div>
                    <span className="block text-xs text-muted-foreground">
                      {f.status ? `HTTP ${f.status}` : (f.error ?? 'failed')}
                      {f.verdictReason ? ` · ${f.verdictReason}` : ''}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.resourceType} on {f.pageUrl}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {r.links && (r.links.inconclusive.length > 0 || r.links.blockedByPolicy.length > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle>Links that could not be verified</CardTitle>
            <CardDescription>
              {r.links.checked} links checked, {r.links.confirmedBroken} confirmed broken (listed as
              issues). These were not reported as broken: check them manually.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="max-h-72 space-y-2 overflow-auto text-sm">
              {r.links.inconclusive.map((l) => (
                <li key={l.href}>
                  <span className="block break-all">{l.href}</span>
                  <span className="block text-xs text-muted-foreground">
                    Inconclusive · {l.reason}
                  </span>
                </li>
              ))}
              {r.links.blockedByPolicy.map((l) => (
                <li key={l.href}>
                  <span className="block break-all">{l.href}</span>
                  <span className="block text-xs text-muted-foreground">
                    Not checked · {l.reason}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

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
