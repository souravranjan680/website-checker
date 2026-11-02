import type { WebsiteDto } from '@whc/shared';
import { ExternalLink, History, Pencil, ScanSearch, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { canEdit, RoleBadge } from '@/components/common/RoleBadge';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';
import { useDeleteWebsite, useWebsite, useWebsiteScans } from './api';
import { VerificationBadge } from './VerificationBadge';

export function WebsiteDetailsPage() {
  const { websiteId = '' } = useParams();
  const website = useWebsite(websiteId);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (website.isPending) {
    return (
      <div
        className="mx-auto flex w-full max-w-5xl flex-col gap-6"
        aria-busy="true"
        aria-label="Loading website"
      >
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  if (website.isError) {
    const missing = website.error instanceof ApiError && website.error.status === 404;
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title={missing ? 'Website not found' : "Couldn't load this website"}
          error={
            missing
              ? new Error("It doesn't exist, or you don't have access to its project.")
              : website.error
          }
          onRetry={missing ? undefined : () => void website.refetch()}
        />
        <Button asChild variant="link" className="px-0">
          <Link to="/websites">Back to websites</Link>
        </Button>
      </div>
    );
  }

  const data = website.data;
  const editable = canEdit(data.myRole);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        back={{ to: `/projects/${data.projectId}`, label: data.projectName }}
        title={data.name}
        badge={<VerificationBadge status={data.verificationStatus} />}
        description={
          <a
            href={data.baseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            {data.baseUrl}
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        }
        actions={
          editable ? (
            <>
              <Button asChild variant="outline">
                <Link to={`/websites/${data.id}/edit`}>
                  <Pencil aria-hidden="true" /> Edit
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                <Trash2 aria-hidden="true" /> Delete
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                [
                  'Project',
                  <Link key="p" to={`/projects/${data.projectId}`} className="hover:underline">
                    {data.projectName}
                  </Link>,
                ],
                ['Your role', <RoleBadge key="r" role={data.myRole} />],
                ['Host name', data.hostname],
                ['Authorization confirmed', formatDateTime(data.authorizationConfirmedAt)],
                ['Domain verification', 'Optional; checking arrives with the scanner (Phase 4)'],
                ['Added', formatDateTime(data.createdAt)],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Crawl settings</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ['Maximum link depth', String(data.maxDepth)],
                ['Maximum pages', String(data.maxPages)],
                ['Responsive test pages', String(data.responsivePageLimit)],
                ['Lighthouse pages', String(data.lighthousePageLimit)],
                ['Respect robots.txt', data.respectRobotsTxt ? 'Yes' : 'No'],
                ['Include paths', patterns(data.includePatterns)],
                ['Exclude paths', patterns(data.excludePatterns)],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <ScanHistory website={data} />
      <DeleteWebsiteDialog website={data} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  );
}

function patterns(list: string[]): ReactNode {
  return list.length ? (
    <span className="flex flex-wrap justify-end gap-1">
      {list.map((p) => (
        <code key={p} className="rounded bg-muted px-1 text-xs">
          {p}
        </code>
      ))}
    </span>
  ) : (
    'All'
  );
}

function DetailList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-2.5 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="shrink-0 text-muted-foreground">{label}</dt>
          <dd className="text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Real data from GET /api/websites/:id/scans. Until Phase 4 it is always empty. */
function ScanHistory({ website }: { website: WebsiteDto }) {
  const scans = useWebsiteScans(website.id);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Scan history</CardTitle>
          <CardDescription>Every scan of this website, newest first.</CardDescription>
        </div>
        <Button disabled title="The scanning engine is built in Phase 4">
          <ScanSearch aria-hidden="true" /> Start scan
        </Button>
      </CardHeader>
      <CardContent>
        {scans.isPending ? (
          <Skeleton className="h-24" />
        ) : scans.isError ? (
          <ErrorState error={scans.error} onRetry={() => void scans.refetch()} />
        ) : scans.data.data.length === 0 ? (
          <EmptyState
            icon={History}
            title="No scans yet"
            description={
              <>
                The scanning engine (Playwright, axe-core, Lighthouse) is built in{' '}
                <strong>Phase 4</strong>. Real scan results will appear here. Nothing is simulated.
              </>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Issues</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scans.data.data.map((scan) => (
                <TableRow key={scan.id}>
                  <TableCell>{formatDateTime(scan.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{scan.status.toLowerCase()}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{scan.totalIssues}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function DeleteWebsiteDialog({
  website,
  open,
  onOpenChange,
}: {
  website: WebsiteDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const remove = useDeleteWebsite(website.id);
  const navigate = useNavigate();
  const onDelete = async () => {
    try {
      await remove.mutateAsync();
      toast.success(`${website.name} deleted.`);
      onOpenChange(false);
      navigate(`/projects/${website.projectId}`, { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {website.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The website, its settings and all of its scans will be permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => void onDelete()}>
            {remove.isPending ? 'Deleting…' : 'Delete website'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
