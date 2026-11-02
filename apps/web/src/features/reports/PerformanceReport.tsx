import type { PerformanceMetricsDto, PerformanceReportDto } from '@whc/shared';
import { CircleSlash, Download } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/ErrorState';
import { canEdit } from '@/components/common/RoleBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { downloadFromApi } from '@/lib/download';
import { errorMessage } from '@/lib/form-errors';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { usePerformanceReport } from './api';
import { ReportIssues } from './ReportIssues';
import { MetricTile } from './report-parts';

/** Same thresholds the scanner uses for issues (web.dev Core Web Vitals; Lighthouse TBT). */
const METRICS: {
  key: keyof PerformanceMetricsDto;
  label: string;
  good: number;
  poor: number;
  format: (v: number) => string;
  hint: string;
}[] = [
  {
    key: 'lcpMs',
    label: 'Largest Contentful Paint',
    good: 2500,
    poor: 4000,
    format: (v) => `${(v / 1000).toFixed(1)} s`,
    hint: 'When the main content appeared.',
  },
  {
    key: 'cls',
    label: 'Cumulative Layout Shift',
    good: 0.1,
    poor: 0.25,
    format: (v) => v.toFixed(3),
    hint: 'How much the page jumped around while loading.',
  },
  {
    key: 'tbtMs',
    label: 'Total Blocking Time',
    good: 200,
    poor: 600,
    format: (v) => `${Math.round(v)} ms`,
    hint: 'How long JavaScript blocked clicks and typing. Lab stand-in for INP.',
  },
  {
    key: 'fcpMs',
    label: 'First Contentful Paint',
    good: 1800,
    poor: 3000,
    format: (v) => `${(v / 1000).toFixed(1)} s`,
    hint: 'When the first text or image appeared.',
  },
  {
    key: 'speedIndexMs',
    label: 'Speed Index',
    good: 3400,
    poor: 5800,
    format: (v) => `${(v / 1000).toFixed(1)} s`,
    hint: 'How quickly the visible area filled in.',
  },
];

function rating(value: number, good: number, poor: number) {
  if (value <= good) return { text: 'Good', className: 'text-emerald-700 dark:text-emerald-400' };
  if (value <= poor)
    return { text: 'Needs improvement', className: 'text-amber-700 dark:text-amber-400' };
  return { text: 'Poor', className: 'text-red-700 dark:text-red-400' };
}

const bytes = (n: number | null) =>
  n === null
    ? '–'
    : n > 1_000_000
      ? `${(n / 1_000_000).toFixed(1)} MB`
      : `${Math.round(n / 1000)} KB`;

/**
 * Google Lighthouse lab results (mobile, simulated slow 4G and CPU slowdown, like
 * PageSpeed Insights). Lab values vary by a few points between runs.
 */
export function PerformanceReport() {
  const { scanId = '' } = useParams();
  const report = usePerformanceReport(scanId);
  if (report.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (report.isError)
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;

  if (r.pages.length === 0) {
    return (
      <Alert>
        <CircleSlash aria-hidden="true" />
        <AlertTitle>Performance was not measured for this scan</AlertTitle>
        <AlertDescription>
          <p>{r.notMeasuredReason}</p>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Google Lighthouse lab test on a simulated mid-range phone with a slow 4G connection, the
        same setup as PageSpeed Insights. Scores vary by a few points between runs. INP (interaction
        delay) needs real visitors and cannot be measured in a lab test; Total Blocking Time is
        shown as the lab stand-in.
      </p>
      {r.pages.map((page) => (
        <PageResult key={page.resultId} scanId={scanId} page={page} />
      ))}
      <HistoryCharts history={r.history} currentScanId={scanId} />
      <ReportIssues
        scanId={scanId}
        category="PERFORMANCE"
        canEdit={canEdit(r.scan.myRole)}
        title="Performance issues"
      />
    </div>
  );
}

function PageResult({
  scanId,
  page,
}: {
  scanId: string;
  page: PerformanceReportDto['pages'][number];
}) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      await downloadFromApi(
        `/api/reports/${scanId}/lighthouse/${page.resultId}`,
        'lighthouse-report.json',
      );
      toast.success('Lighthouse report downloaded.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="truncate">{page.url}</CardTitle>
          <CardDescription>
            {page.formFactor === 'MOBILE' ? 'Mobile' : 'Desktop'} · Lighthouse{' '}
            {page.lighthouseVersion ?? ''}
          </CardDescription>
        </div>
        {page.rawReportAvailable ? (
          <Button variant="outline" size="sm" onClick={() => void download()} disabled={busy}>
            <Download aria-hidden="true" /> Full Lighthouse JSON
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        {page.error ? (
          <Alert variant="destructive">
            <AlertTitle>Lighthouse could not measure this page</AlertTitle>
            <AlertDescription>{page.error}</AlertDescription>
          </Alert>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricTile label="Performance" value={page.scores.performance} suffix="/100" />
              <MetricTile
                label="Accessibility (Lighthouse)"
                value={page.scores.accessibility}
                suffix="/100"
                hint="Lighthouse's own accessibility score, separate from ours."
              />
              <MetricTile label="Best practices" value={page.scores.bestPractices} suffix="/100" />
              <MetricTile label="SEO (Lighthouse)" value={page.scores.seo} suffix="/100" />
            </dl>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {METRICS.map((m) => {
                const value = page.metrics[m.key];
                const rate = value === null ? null : rating(value, m.good, m.poor);
                return (
                  <div key={m.key} className="rounded-lg border p-3">
                    <dt className="text-xs text-muted-foreground" title={m.hint}>
                      {m.label}
                    </dt>
                    <dd className="text-xl font-semibold tabular-nums">
                      {value === null ? '–' : m.format(value)}
                    </dd>
                    <dd className={cn('text-xs', rate?.className ?? 'text-muted-foreground')}>
                      {rate?.text ?? 'Not measured'}
                    </dd>
                  </div>
                );
              })}
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Interaction to Next Paint</dt>
                <dd className="text-xl font-semibold">–</dd>
                <dd className="text-xs text-muted-foreground">Needs real visitors (see TBT)</dd>
              </div>
            </dl>
            <Opportunities items={page.opportunities} />
            <SlowRequests items={page.slowestRequests} total={page.totalByteWeight} />
            {page.warnings.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {page.warnings.map((w) => (
                  <li key={w}>Lighthouse warning: {w}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Opportunities({
  items,
}: {
  items: PerformanceReportDto['pages'][number]['opportunities'];
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Opportunities (estimated savings)</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Lighthouse found no significant savings.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Opportunity</TableHead>
              <TableHead className="text-right">Estimated savings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  {o.title} <code className="ml-1 text-xs text-muted-foreground">{o.id}</code>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {o.displayValue ??
                    (o.savingsMs ? `${Math.round(o.savingsMs)} ms` : bytes(o.savingsBytes))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function SlowRequests({
  items,
  total,
}: {
  items: PerformanceReportDto['pages'][number]['slowestRequests'];
  total: number | null;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">
        Slowest requests{' '}
        <span className="font-normal text-muted-foreground">
          · total page weight {bytes(total)}
        </span>
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Resource</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="text-right">Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((r, i) => (
            <TableRow key={`${r.url}-${i}`}>
              <TableCell className="max-w-96 truncate">{r.url}</TableCell>
              <TableCell className="text-xs">{r.resourceType ?? '–'}</TableCell>
              <TableCell className="text-right tabular-nums">{bytes(r.transferSize)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.durationMs === null ? '–' : `${r.durationMs} ms`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

const SCORE_CONFIG = {
  performanceScore: { label: 'Performance score', color: 'var(--chart-1)' },
} satisfies ChartConfig;
const LCP_CONFIG = {
  lcpSeconds: { label: 'LCP (s)', color: 'var(--chart-2)' },
} satisfies ChartConfig;
const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, fontSize: 12 } as const;

/** Two single-series charts (never one chart with two y-axes). */
function HistoryCharts({
  history,
  currentScanId,
}: {
  history: PerformanceReportDto['history'];
  currentScanId: string;
}) {
  const data = history.map((h) => ({
    ...h,
    day: formatDate(h.createdAt),
    lcpSeconds: h.lcpMs === null ? null : Number((h.lcpMs / 1000).toFixed(2)),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance over time</CardTitle>
        <CardDescription>
          This website&apos;s finished scans with Lighthouse data (last {history.length})
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            A trend appears after two or more scans with performance data.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartContainer config={SCORE_CONFIG} className="aspect-auto h-56 w-full">
              <LineChart data={data} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="day" minTickGap={24} {...AXIS} />
                <YAxis domain={[0, 100]} width={32} {...AXIS} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  dataKey="performanceScore"
                  stroke="var(--color-performanceScore)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: 'var(--background)', strokeWidth: 2 }}
                  connectNulls
                />
              </LineChart>
            </ChartContainer>
            <ChartContainer config={LCP_CONFIG} className="aspect-auto h-56 w-full">
              <LineChart data={data} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="day" minTickGap={24} {...AXIS} />
                <YAxis width={32} {...AXIS} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  dataKey="lcpSeconds"
                  stroke="var(--color-lcpSeconds)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: 'var(--background)', strokeWidth: 2 }}
                  connectNulls
                />
              </LineChart>
            </ChartContainer>
          </div>
        )}
        <ul className="mt-4 flex flex-wrap gap-2 text-xs">
          {history.map((h) => (
            <li key={h.scanId}>
              {h.scanId === currentScanId ? (
                <span className="font-medium">
                  {formatDate(h.createdAt)}: {h.performanceScore ?? '–'} (this scan)
                </span>
              ) : (
                <Link
                  to={`/scans/${h.scanId}/reports/performance`}
                  className="underline-offset-4 hover:underline"
                >
                  {formatDate(h.createdAt)}: {h.performanceScore ?? '–'}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
