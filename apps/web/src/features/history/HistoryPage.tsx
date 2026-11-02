import type { ScanListItemDto } from '@whc/shared';
import { ArrowRightLeft, FileText, History, RotateCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { ScopeFilterBar, useScopeFilters } from '@/components/common/ScopeFilters';
import { ScanStatusBadge } from '@/components/common/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isActive, useRescan, useScans } from '@/features/scans/api';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format';

/** "2026-10-14" (a whole UTC day) → ISO start / end of that day, as the API expects. */
const dayStart = (day?: string) => (day ? `${day}T00:00:00.000Z` : undefined);
const dayEnd = (day?: string) => (day ? `${day}T23:59:59.999Z` : undefined);

/**
 * All scans of all websites the user can see, newest first, 20 per page.
 * Filtering and paging happen in the database (GET /api/scans?...), never in the browser.
 */
export function HistoryPage() {
  const filters = useScopeFilters(['q', 'page']);
  const { values } = filters;
  const page = Number(values.page ?? 1) || 1;
  const [search, setSearch] = useState(values.q ?? '');
  const [selected, setSelected] = useState<ScanListItemDto[]>([]);
  const navigate = useNavigate();
  const rescan = useRescan();

  // Search as you type, but only send a request once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((values.q ?? '') !== search.trim()) filters.set({ q: search.trim() || undefined });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const scans = useScans({
    page,
    pageSize: 20,
    q: values.q,
    projectId: values.projectId,
    websiteId: values.websiteId,
    status: values.status,
    from: dayStart(values.from),
    to: dayEnd(values.to),
  });

  const toggle = (scan: ScanListItemDto) =>
    setSelected((current) =>
      current.some((s) => s.id === scan.id)
        ? current.filter((s) => s.id !== scan.id)
        : [...current, scan].slice(-2),
    );
  const sameWebsite = selected.length === 2 && selected[0]!.website.id === selected[1]!.website.id;

  const onCompare = () => {
    const [a, b] = [...selected].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    navigate(`/history/compare?base=${a!.id}&target=${b!.id}`);
  };
  const onRescan = async (scan: ScanListItemDto) => {
    try {
      const next = await rescan.mutateAsync(scan.id);
      toast.success(`New scan of ${scan.website.name} queued.`);
      navigate(`/scans/${next.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        title="Scan history"
        description="Every scan of the websites you can access. Select two scans of the same website to compare them."
        actions={
          <Button onClick={onCompare} disabled={!sameWebsite}>
            <ArrowRightLeft aria-hidden="true" /> Compare {selected.length}/2
          </Button>
        }
      />
      <ScopeFilterBar filters={filters}>
        <div className="flex flex-col gap-1">
          <Label htmlFor="history-search" className="text-xs text-muted-foreground">
            Search
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="history-search"
              type="search"
              placeholder="Website name or URL"
              className="h-8 w-56 pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </ScopeFilterBar>
      {selected.length === 2 && !sameWebsite ? (
        <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
          Only scans of the same website can be compared.
        </p>
      ) : null}

      {scans.isPending ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : scans.isError ? (
        <ErrorState error={scans.error} onRetry={() => void scans.refetch()} />
      ) : scans.data.data.length === 0 ? (
        <EmptyState
          icon={History}
          title={filters.active ? 'No scans match these filters' : 'No scans yet'}
          description={
            filters.active
              ? 'Try a wider date range or clear the filters.'
              : 'Start a scan from a website page.'
          }
          action={
            filters.active ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('');
                  filters.clear();
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button asChild>
                <Link to="/websites">Go to websites</Link>
              </Button>
            )
          }
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">Select to compare</span>
                  </TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead className="text-right">Issues</TableHead>
                  <TableHead className="text-right">A11y / UI</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.data.data.map((scan) => {
                  const checked = selected.some((s) => s.id === scan.id);
                  const finished = scan.status === 'COMPLETED' || scan.status === 'PARTIAL';
                  return (
                    <TableRow key={scan.id} data-state={checked ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={checked}
                          disabled={!finished}
                          onCheckedChange={() => toggle(scan)}
                          aria-label={`Select scan of ${scan.website.name} from ${formatDateTime(scan.createdAt)}`}
                        />
                      </TableCell>
                      <TableCell className="max-w-64">
                        <Link
                          to={`/websites/${scan.website.id}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {scan.website.name}
                        </Link>
                        <span className="block truncate text-xs text-muted-foreground">
                          {scan.website.baseUrl}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ScanStatusBadge status={scan.status} />
                        {scan.mode === 'SINGLE_PAGE' ? (
                          <span className="ml-1 text-xs text-muted-foreground">one page</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span title={formatDateTime(scan.createdAt)}>
                          {formatRelative(scan.createdAt)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatDuration(scan.durationMs)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{scan.pagesScanned}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {scan.totalIssues}
                        {scan.criticalCount ? (
                          <span className="block text-xs text-red-700 dark:text-red-400">
                            {scan.criticalCount} critical
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {scan.accessibilityScore ?? '–'} / {scan.uiHealthScore ?? '–'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button asChild variant="ghost" size="icon-sm">
                                <Link
                                  to={
                                    finished
                                      ? `/scans/${scan.id}/reports/accessibility`
                                      : `/scans/${scan.id}`
                                  }
                                  aria-label={`Open report for ${scan.website.name}`}
                                >
                                  <FileText aria-hidden="true" />
                                </Link>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {finished ? 'Open report' : 'Open scan'}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={isActive(scan.status) || rescan.isPending}
                                onClick={() => void onRescan(scan)}
                                aria-label={`Rescan ${scan.website.name}`}
                              >
                                <RotateCw aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Rescan with the same settings</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {scans.data ? (
        <PaginationBar
          meta={scans.data.meta}
          onPageChange={(p) => filters.set({ page: String(p) })}
        />
      ) : null}
    </div>
  );
}
