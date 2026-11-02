import { BUG_REPORT_STATUSES } from '@whc/shared';
import { Bug, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { formatRelative } from '@/lib/format';
import { useBugReports } from './api';
import { BUG_STATUS_LABEL as STATUS_LABEL } from '@/lib/labels';

/** All bug reports in the user's projects. Reports are created from an issue's page. */
export function BugReportsPage() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const reports = useBugReports({ page, q: q || undefined, status: status || undefined });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Bug reports"
        description="Structured reports made from detected issues, ready to copy into your tracker. Create one from any issue's page."
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="bug-search" className="text-xs text-muted-foreground">
            Search
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="bug-search"
              type="search"
              placeholder="Title or URL"
              className="h-8 w-60 pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="bug-status" className="text-xs text-muted-foreground">
            Status
          </Label>
          <NativeSelect
            id="bug-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <NativeSelectOption value="">Any status</NativeSelectOption>
            {BUG_REPORT_STATUSES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {STATUS_LABEL[s]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {reports.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : reports.isError ? (
        <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />
      ) : reports.data.data.length === 0 ? (
        <EmptyState
          icon={Bug}
          title={q || status ? 'No bug reports match' : 'No bug reports yet'}
          description="Open an issue (from a scan report) and choose “Create bug report”."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Report</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.data.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-md pl-6">
                      <Link
                        to={`/bug-reports/${r.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {r.title}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.website?.name ?? 'Website deleted'} · {r.affectedUrl}
                      </span>
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={r.severity} />
                    </TableCell>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{STATUS_LABEL[r.status]}</Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-right whitespace-nowrap">
                      {formatRelative(r.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {reports.data ? <PaginationBar meta={reports.data.meta} onPageChange={setPage} /> : null}
    </div>
  );
}
