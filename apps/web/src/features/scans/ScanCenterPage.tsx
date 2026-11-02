import { ScanSearch } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { ScanStatusBadge } from '@/components/common/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { useScans } from './api';

const STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'];

/** All scans across the user's projects (live-refreshing while any is active). */
export function ScanCenterPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const scans = useScans({ page, pageSize: 20, status: status || undefined });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Scan Center"
        description="Every scan of the websites you can access. Start a scan from a website's page."
        actions={
          <Button asChild variant="outline">
            <Link to="/websites">Choose a website</Link>
          </Button>
        }
      />
      <NativeSelect
        aria-label="Filter by status"
        value={status}
        onChange={(event) => {
          setStatus(event.target.value);
          setPage(1);
        }}
        className="w-48"
      >
        <NativeSelectOption value="">All statuses</NativeSelectOption>
        {STATUSES.map((s) => (
          <NativeSelectOption key={s} value={s}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </NativeSelectOption>
        ))}
      </NativeSelect>

      {scans.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : scans.isError ? (
        <ErrorState error={scans.error} onRetry={() => void scans.refetch()} />
      ) : scans.data.data.length === 0 ? (
        <EmptyState
          icon={ScanSearch}
          title="No scans yet"
          description="Open a website and click Start scan. Results appear here."
          action={
            <Button asChild>
              <Link to="/websites">Go to websites</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Card className="py-0">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Website</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Issues</TableHead>
                    <TableHead className="text-right">Accessibility</TableHead>
                    <TableHead className="text-right">Pages</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scans.data.data.map((scan) => (
                    <TableRow key={scan.id}>
                      <TableCell>
                        <Link to={`/scans/${scan.id}`} className="font-medium hover:underline">
                          {scan.website.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {scan.website.baseUrl}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ScanStatusBadge status={scan.status} />
                        {scan.status === 'RUNNING' ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {scan.progress}%
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{scan.totalIssues}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {scan.accessibilityScore ?? '-'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{scan.pagesScanned}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelative(scan.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <PaginationBar meta={scans.data.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
