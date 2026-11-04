import type { WebsiteDto } from '@whc/shared';
import { FileSearch, FileText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PaginationBar } from '@/components/common/PaginationBar';
import { ScanStatusBadge, SeverityBadge } from '@/components/common/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { describeActivity } from '@/features/projects/ActivityCard';
import { MetricTile } from '@/features/reports/report-parts';
import { formatDateTime, formatRelative } from '@/lib/format';
import { TRACKED_LABEL } from '@/lib/labels';
import { useWebsiteActivity, useWebsiteIssues, useWebsiteStats } from './api';

/** Numbers at the top of the website page (GET /api/websites/:id/stats). */
export function WebsiteStatsRow({ website }: { website: WebsiteDto }) {
  const stats = useWebsiteStats(website.id);
  if (stats.isPending) return <Skeleton className="h-24 rounded-xl" />;
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;
  const s = stats.data;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <MetricTile label="Total scans" value={s.totalScans} />
        <MetricTile
          label="Accessibility"
          value={s.latestScan?.accessibilityScore ?? null}
          suffix="/100"
          hint="From the latest finished scan"
        />
        <MetricTile
          label="UI health"
          value={s.latestScan?.uiHealthScore ?? null}
          suffix="/100"
          hint="From the latest finished scan"
        />
        <MetricTile label="Open issues" value={s.issues.open} />
        <MetricTile
          label="Resolved"
          value={s.issues.resolved}
          hint="No longer detected by a later scan"
        />
        <MetricTile
          label="Ignored / false pos."
          value={s.issues.ignored + s.issues.falsePositive}
        />
      </dl>
      {s.latestScan ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Latest scan: <ScanStatusBadge status={s.latestScan.status} />
          <Link to={`/scans/${s.latestScan.id}`} className="hover:underline">
            {formatDateTime(s.latestScan.createdAt)}
          </Link>
          {s.latestFinishedScanId ? (
            <Button asChild size="sm" variant="outline" className="ml-auto">
              <Link to={`/scans/${s.latestFinishedScanId}/reports/accessibility`}>
                <FileText aria-hidden="true" /> View reports
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const STATUS_OPTIONS = ['OPEN', 'RESOLVED', 'IGNORED', 'FALSE_POSITIVE'];
const CATEGORY_OPTIONS = [
  { value: 'ACCESSIBILITY', label: 'Accessibility' },
  { value: 'UI_HEALTH', label: 'UI health' },
  { value: 'RESPONSIVE', label: 'Responsive' },
  { value: 'COMPATIBILITY', label: 'Browsers' },
];

/** Every problem ever detected on this website, with its current tracking status. */
export function TrackedIssuesCard({ website }: { website: WebsiteDto }) {
  const [status, setStatus] = useState('OPEN');
  const [category, setCategory] = useState('');
  const [browser, setBrowser] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const issues = useWebsiteIssues(website.id, {
    status: status || undefined,
    category: category || undefined,
    // Only cross-browser issues have a browser.
    browser: category === 'COMPATIBILITY' && browser ? browser : undefined,
    q: q.trim() || undefined,
    page,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Tracked issues</CardTitle>
          <CardDescription>Each problem once, however many scans found it.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            type="search"
            aria-label="Search tracked issues"
            placeholder="Search title or rule"
            className="h-8 w-48"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <NativeSelect
            aria-label="Tracking status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <NativeSelectOption value="">Any status</NativeSelectOption>
            {STATUS_OPTIONS.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {TRACKED_LABEL[s]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <NativeSelectOption value="">All categories</NativeSelectOption>
            {CATEGORY_OPTIONS.map((c) => (
              <NativeSelectOption key={c.value} value={c.value}>
                {c.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {category === 'COMPATIBILITY' ? (
            <NativeSelect
              aria-label="Browser"
              value={browser}
              onChange={(e) => {
                setBrowser(e.target.value);
                setPage(1);
              }}
            >
              <NativeSelectOption value="">Firefox and WebKit</NativeSelectOption>
              <NativeSelectOption value="FIREFOX">Firefox</NativeSelectOption>
              <NativeSelectOption value="WEBKIT">WebKit</NativeSelectOption>
            </NativeSelect>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {issues.isPending ? (
          <Skeleton className="h-32" />
        ) : issues.isError ? (
          <ErrorState error={issues.error} onRetry={() => void issues.refetch()} />
        ) : issues.data.data.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="No issues"
            description="Nothing matches these filters."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Issue</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Scans</TableHead>
                  <TableHead className="text-right">Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.data.data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-96">
                      {t.latest ? (
                        <Link
                          to={`/issues/${t.latest.issueId}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {t.title}
                        </Link>
                      ) : (
                        <span className="block truncate font-medium">{t.title}</span>
                      )}
                      <span className="block truncate text-xs text-muted-foreground">
                        {t.latest?.pageUrl ?? t.ruleId}
                        {t.latest?.viewport ? ` · ${t.latest.viewport}` : ''}
                      </span>
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={t.severity} />
                    </TableCell>
                    <TableCell>{TRACKED_LABEL[t.status]}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.occurrenceCount}</TableCell>
                    <TableCell
                      className="text-right whitespace-nowrap"
                      title={formatDateTime(t.lastSeenAt)}
                    >
                      {formatRelative(t.lastSeenAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar meta={issues.data.meta} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function WebsiteActivityCard({ website }: { website: WebsiteDto }) {
  const activity = useWebsiteActivity(website.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Changes and scans of this website</CardDescription>
      </CardHeader>
      <CardContent>
        {activity.isPending ? (
          <Skeleton className="h-24" />
        ) : activity.isError ? (
          <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
        ) : activity.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="space-y-3">
            {activity.data.data.map((item) => (
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
