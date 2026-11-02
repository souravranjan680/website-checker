import type { IssueRefDto, ScanDetailsDto } from '@whc/shared';
import { ArrowRightLeft } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { ScanStatusBadge, SeverityBadge } from '@/components/common/StatusBadges';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useScan, useScanComparison } from '@/features/scans/api';
import { formatDateTime } from '@/lib/format';

/**
 * Compares two scans of the same website: /history/compare?base=<older>&target=<newer>.
 * Issues are matched by fingerprint (rule + page + screen size + element), so
 * "resolved" means the same problem is no longer detected, not just that counts changed.
 */
export function ComparePage() {
  const [params] = useSearchParams();
  const base = params.get('base') ?? '';
  const target = params.get('target') ?? '';
  const baseScan = useScan(base);
  const targetScan = useScan(target);
  const comparison = useScanComparison(target, Boolean(base && target), base);

  if (!base || !target) {
    return (
      <EmptyState
        icon={ArrowRightLeft}
        title="Pick two scans"
        description="Select two finished scans of the same website on the history page."
      />
    );
  }
  const failed = baseScan.error ?? targetScan.error ?? comparison.error;
  if (failed) return <ErrorState title="Couldn't compare these scans" error={failed} />;
  if (!baseScan.data || !targetScan.data || !comparison.data) {
    return <Skeleton className="h-96 rounded-xl" aria-label="Loading comparison" />;
  }
  const c = comparison.data;
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        back={{ to: '/history', label: 'Scan history' }}
        title={`Compare scans of ${targetScan.data.website.name}`}
        description="Issues are matched by identity: same rule, page, screen size and element."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <ScanSummaryCard label="Before" scan={baseScan.data} />
        <ScanSummaryCard label="After" scan={targetScan.data} />
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <Delta label="Newly detected" value={c.counts.new} />
        <Delta label="Resolved" value={c.counts.resolved} />
        <Delta label="Still present" value={c.counts.recurring} />
      </dl>
      <div className="grid gap-4 lg:grid-cols-3">
        <IssueColumn title="Newly detected" hint="In the later scan only" items={c.newIssues} />
        <IssueColumn title="Resolved" hint="In the earlier scan only" items={c.resolvedIssues} />
        <IssueColumn title="Still present" hint="In both scans" items={c.recurringIssues} />
      </div>
    </div>
  );
}

function ScanSummaryCard({ label, scan }: { label: string; scan: ScanDetailsDto }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Link to={`/scans/${scan.id}`} className="hover:underline">
            {formatDateTime(scan.queuedAt)}
          </Link>
          <ScanStatusBadge status={scan.status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-4 gap-2 text-sm">
          <Stat label="Issues" value={scan.totalIssues} />
          <Stat label="Pages" value={scan.pagesScanned} />
          <Stat label="A11y" value={scan.accessibilityScore} />
          <Stat label="UI" value={scan.uiHealthScore} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value ?? '–'}</dd>
    </div>
  );
}

function Delta({ label, value }: { label: string; value: number }) {
  return (
    <Card className="gap-1 py-3">
      <CardContent className="px-4">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      </CardContent>
    </Card>
  );
}

function IssueColumn({
  title,
  hint,
  items,
}: {
  title: string;
  hint: string;
  items: IssueRefDto[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} ({items.length})
        </CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="max-h-[28rem] space-y-2 overflow-auto text-sm">
            {items.slice(0, 200).map((item) => (
              <li key={item.fingerprint} className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.pageUrl}
                    {item.viewport ? ` · ${item.viewport}` : ''}
                  </span>
                </span>
                <SeverityBadge severity={item.severity} />
              </li>
            ))}
            {items.length > 200 ? (
              <li className="text-xs text-muted-foreground">
                …and {items.length - 200} more (see the CSV export).
              </li>
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
