import type { DashboardSummaryDto, DashboardTrendPoint } from '@whc/shared';
import { Globe, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { ScopeFilterBar, useScopeFilters } from '@/components/common/ScopeFilters';
import { ScanStatusBadge } from '@/components/common/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { describeActivity } from '@/features/projects/ActivityCard';
import { formatDateTime, formatRelative, formatUtcDay } from '@/lib/format';
import { useDashboardSummary, useDashboardTrends, type DashboardFilters } from './api';
import {
  CategoryChart,
  IssueFlowChart,
  ScanActivityChart,
  ScoreTrendChart,
  SeverityChart,
} from './charts';

/**
 * Overview of everything the user can access. Every number comes from
 * GET /api/dashboard/summary and /trends; nothing is computed from sample data.
 */
export function DashboardPage() {
  const filters = useScopeFilters();
  const query: DashboardFilters = filters.values;
  const summary = useDashboardSummary(query);
  const trends = useDashboardTrends(query);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={
          summary.data
            ? `${formatUtcDay(summary.data.range.from)} – ${formatUtcDay(summary.data.range.to)} · issue counts are current, scans and charts use this date range`
            : 'Health of your websites at a glance'
        }
      />
      <ScopeFilterBar filters={filters} />

      {summary.isError ? (
        <ErrorState
          title="Couldn't load the dashboard"
          error={summary.error}
          onRetry={() => void summary.refetch()}
        />
      ) : summary.isPending ? (
        <DashboardSkeleton />
      ) : summary.data.totals.websites === 0 && !filters.active ? (
        <EmptyState
          icon={Globe}
          title="No websites yet"
          description="Add a website you own or are authorised to test, then run a scan. The dashboard fills in from real scan results."
          action={
            <Button asChild>
              <Link to="/websites/new">Add a website</Link>
            </Button>
          }
        />
      ) : (
        <>
          <KpiTiles summary={summary.data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Open issues by severity" description="Currently open tracked issues">
              {summary.data.totals.openIssues === 0 ? (
                <NoData text="No open issues." />
              ) : (
                <SeverityChart data={summary.data.openBySeverity} />
              )}
            </ChartCard>
            <ChartCard
              title="Open issues by category"
              description="Accessibility, UI health, responsive…"
            >
              {summary.data.openByCategory.length === 0 ? (
                <NoData text="No open issues." />
              ) : (
                <CategoryChart data={summary.data.openByCategory} />
              )}
            </ChartCard>
          </div>
          <TrendCharts query={trends} />
          <div className="grid gap-4 lg:grid-cols-3">
            <RecentScans summary={summary.data} />
            <RecentWebsites summary={summary.data} />
            <RecentActivity summary={summary.data} />
          </div>
        </>
      )}
    </div>
  );
}

function KpiTiles({ summary }: { summary: DashboardSummaryDto }) {
  const { totals, scores } = summary;
  const scoreHint = `Average of each website's latest finished scan (${scores.websitesMeasured} measured)`;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Kpi label="Projects" value={totals.projects} />
      <Kpi label="Websites" value={totals.websites} />
      <Kpi label="Scans" value={totals.scans} hint="Scans started in the selected date range" />
      <Kpi
        label="Open issues"
        value={totals.openIssues}
        hint="Problems currently open, counted once even if seen in many scans"
      />
      <Kpi
        label="Critical"
        value={totals.criticalIssues}
        tone={totals.criticalIssues ? 'critical' : undefined}
      />
      <Kpi label="High" value={totals.highIssues} />
      <Kpi
        label="Resolved"
        value={totals.resolvedIssues}
        hint="Issues that disappeared in a later scan during the selected range"
      />
      <Kpi
        label="Accessibility score"
        value={scores.accessibility}
        suffix="/100"
        hint={scoreHint}
      />
      <Kpi label="UI health score" value={scores.uiHealth} suffix="/100" hint={scoreHint} />
      <Kpi
        label="Performance score"
        value={scores.performance}
        suffix="/100"
        hint="Lighthouse performance checks arrive in Phase 6; until then nothing is shown."
      />
    </dl>
  );
}

function Kpi({
  label,
  value,
  hint,
  suffix,
  tone,
}: {
  label: string;
  value: number | null;
  hint?: string;
  suffix?: string;
  tone?: 'critical';
}) {
  return (
    <Card className="gap-1 py-3">
      <CardContent className="px-4">
        <dt className="flex items-center gap-1 text-xs text-muted-foreground">
          {label}
          {hint ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="rounded-sm" aria-label={`About ${label}`}>
                  <Info className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-60">{hint}</TooltipContent>
            </Tooltip>
          ) : null}
        </dt>
        <dd
          className={`text-2xl font-semibold tabular-nums ${tone === 'critical' ? 'text-red-700 dark:text-red-400' : ''}`}
        >
          {value === null ? (
            <span className="text-base font-normal text-muted-foreground">Not measured</span>
          ) : (
            <>
              {value}
              {suffix ? (
                <span className="text-sm font-normal text-muted-foreground">{suffix}</span>
              ) : null}
            </>
          )}
        </dd>
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function NoData({ text }: { text: string }) {
  return (
    <div className="flex h-56 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function TrendCharts({ query }: { query: ReturnType<typeof useDashboardTrends> }) {
  if (query.isError)
    return (
      <ErrorState
        title="Couldn't load the trends"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  if (query.isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }
  const points = query.data.points;
  const sum = (pick: (p: DashboardTrendPoint) => number) => points.reduce((n, p) => n + pick(p), 0);
  const scans = sum((p) => p.completed + p.partial + p.failed + p.cancelled + p.other);
  const scored = points.some((p) => p.accessibilityScore !== null || p.uiHealthScore !== null);
  const flow = sum((p) => p.newIssues + p.resolvedIssues);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Scan activity" description="Scans per day by outcome">
        {scans === 0 ? (
          <NoData text="No scans in this date range." />
        ) : (
          <ScanActivityChart points={points} />
        )}
      </ChartCard>
      <ChartCard title="Score trends" description="Average score of scans finished each day">
        {scored ? (
          <ScoreTrendChart points={points} />
        ) : (
          <NoData text="No finished scans in this date range." />
        )}
      </ChartCard>
      <ChartCard
        title="Newly detected vs resolved"
        description="Issue identities first seen / fixed each day"
      >
        {flow === 0 ? (
          <NoData text="No issues appeared or were resolved in this range." />
        ) : (
          <IssueFlowChart points={points} />
        )}
      </ChartCard>
      <ChartCard
        title="Daily health summary"
        description="The chart data as a table: scans, average scores and issue flow per day"
      >
        <TrendTable points={points} />
      </ChartCard>
    </div>
  );
}

/** Table view of the trend series: the accessible alternative to the charts. */
function TrendTable({ points }: { points: DashboardTrendPoint[] }) {
  const rows = points.filter(
    (p) =>
      p.completed + p.partial + p.failed + p.cancelled + p.other + p.newIssues + p.resolvedIssues >
      0,
  );
  if (rows.length === 0) return <NoData text="Nothing happened in this date range." />;
  return (
    <div className="max-h-56 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-medium">Day</th>
            <th className="py-1 text-right font-medium">Scans</th>
            <th className="py-1 text-right font-medium">A11y</th>
            <th className="py-1 text-right font-medium">UI</th>
            <th className="py-1 text-right font-medium">New</th>
            <th className="py-1 text-right font-medium">Resolved</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {[...rows].reverse().map((p) => (
            <tr key={p.date} className="border-t">
              <td className="py-1">{formatUtcDay(p.date)}</td>
              <td className="py-1 text-right">
                {p.completed + p.partial + p.failed + p.cancelled + p.other}
              </td>
              <td className="py-1 text-right">{p.accessibilityScore ?? '–'}</td>
              <td className="py-1 text-right">{p.uiHealthScore ?? '–'}</td>
              <td className="py-1 text-right">{p.newIssues}</td>
              <td className="py-1 text-right">{p.resolvedIssues}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentScans({ summary }: { summary: DashboardSummaryDto }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Latest scans</CardTitle>
        <Button asChild variant="link" size="sm" className="px-0">
          <Link to="/history">History</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {summary.recentScans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scans in this date range.</p>
        ) : (
          <ul className="space-y-3">
            {summary.recentScans.map((scan) => (
              <li key={scan.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <Link
                    to={`/scans/${scan.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {scan.website.name}
                  </Link>
                  <span
                    className="text-xs text-muted-foreground"
                    title={formatDateTime(scan.createdAt)}
                  >
                    {formatRelative(scan.createdAt)} · {scan.totalIssues} issues
                  </span>
                </span>
                <ScanStatusBadge status={scan.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentWebsites({ summary }: { summary: DashboardSummaryDto }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent websites</CardTitle>
        <Button asChild variant="link" size="sm" className="px-0">
          <Link to="/websites">All websites</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {summary.recentWebsites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No websites match these filters.</p>
        ) : (
          <ul className="space-y-3">
            {summary.recentWebsites.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <Link
                    to={`/websites/${w.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {w.name}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {w.projectName}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {w.openIssues} open
                  <br />
                  {w.lastScan ? `A11y ${w.lastScan.accessibilityScore ?? '–'}` : 'Never scanned'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivity({ summary }: { summary: DashboardSummaryDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {summary.recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity in this date range.</p>
        ) : (
          <ol className="space-y-3">
            {summary.recentActivity.map((item) => (
              <li key={item.id} className="text-sm">
                <span className="font-medium">{item.user?.name ?? 'Deleted user'}</span>{' '}
                {describeActivity(item)}
                <time
                  dateTime={item.createdAt}
                  title={formatDateTime(item.createdAt)}
                  className="block text-xs text-muted-foreground"
                >
                  {formatRelative(item.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}
