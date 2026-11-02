import { FileSearch, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useScanIssues, useScanPages } from '@/features/scans/api';
import { IssueList } from '@/features/scans/IssueList';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const TRACKED = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IGNORED', label: 'Ignored' },
  { value: 'FALSE_POSITIVE', label: 'False positive' },
];

/**
 * The issue list under each report, filtered on the server
 * (GET /api/scans/:id/issues?category=&severity=&q=&...) and paginated,
 * so even scans with thousands of issues stay fast.
 */
export function ReportIssues({
  scanId,
  category,
  canEdit,
  extraFilters,
  title = 'Issues',
}: {
  scanId: string;
  category: string;
  canEdit: boolean;
  extraFilters?: Record<string, string | undefined>;
  title?: string;
}) {
  const [severity, setSeverity] = useState('');
  const [trackedStatus, setTrackedStatus] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const issues = useScanIssues(scanId, {
    category,
    severity: severity || undefined,
    trackedStatus: trackedStatus || undefined,
    q: q || undefined,
    page,
    ...extraFilters,
  });
  const pages = useScanPages(scanId);
  const pageWidths = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of pages.data ?? [])
      for (const shot of p.screenshots) map.set(shot.id, shot.width);
    return map;
  }, [pages.data]);

  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto text-lg font-semibold">{title}</h2>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${category}-search`} className="text-xs text-muted-foreground">
            Search
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id={`${category}-search`}
              type="search"
              placeholder="Title, rule, page or selector"
              className="h-8 w-60 pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${category}-severity`} className="text-xs text-muted-foreground">
            Severity
          </Label>
          <NativeSelect
            id={`${category}-severity`}
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
          >
            <NativeSelectOption value="">All severities</NativeSelectOption>
            {SEVERITIES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${category}-tracked`} className="text-xs text-muted-foreground">
            Tracking status
          </Label>
          <NativeSelect
            id={`${category}-tracked`}
            value={trackedStatus}
            onChange={(e) => {
              setTrackedStatus(e.target.value);
              setPage(1);
            }}
          >
            <NativeSelectOption value="">Any</NativeSelectOption>
            {TRACKED.map((s) => (
              <NativeSelectOption key={s.value} value={s.value}>
                {s.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {issues.isPending ? (
        <Skeleton className="h-40" />
      ) : issues.isError ? (
        <ErrorState error={issues.error} onRetry={() => void issues.refetch()} />
      ) : issues.data.data.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No issues"
          description="Nothing matches these filters in this scan."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{issues.data.meta.total} issues</p>
          <IssueList
            scanId={scanId}
            issues={issues.data.data}
            canEdit={canEdit}
            pageWidths={pageWidths}
          />
          <PaginationBar meta={issues.data.meta} onPageChange={setPage} />
        </>
      )}
    </section>
  );
}
