import type { WebsiteComparisonDto, WebsiteComparisonSiteDto } from '@whc/shared';
import { Archive, ArchiveRestore, Info, Pencil, PlayCircle, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { canEdit, RoleBadge } from '@/components/common/RoleBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';
import {
  useDeleteWebsiteComparison,
  useUpdateWebsiteComparison,
  useWebsiteComparison,
} from './api';
import { VIEWPORT_OPTIONS } from './ComparisonSettingsFields';
import { ComparisonStateBadge } from './ComparisonStateBadge';

const RUN_STATUS: Record<string, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  CANCELLING: 'Cancelling',
  COMPLETED: 'Completed',
  PARTIAL: 'Partly completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

/** /website-comparisons/:comparisonId (Phase 9, Milestone 4, Checkpoint 2.3). */
export function ComparisonDetailsPage() {
  const { comparisonId = '' } = useParams();
  const comparison = useWebsiteComparison(comparisonId);
  const [dialog, setDialog] = useState<'archive' | 'restore' | 'delete' | null>(null);

  if (comparison.isPending) {
    return (
      <div
        className="mx-auto flex w-full max-w-5xl flex-col gap-6"
        aria-busy="true"
        aria-label="Loading comparison"
      >
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  if (comparison.isError) {
    // The API answers 404 both for "does not exist" and for "not in your projects".
    const missing = comparison.error instanceof ApiError && comparison.error.status === 404;
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title={missing ? 'Comparison not found' : "Couldn't load this comparison"}
          error={
            missing
              ? new Error("It doesn't exist, or you don't have access to its project.")
              : comparison.error
          }
          onRetry={missing ? undefined : () => void comparison.refetch()}
        />
        <Button asChild variant="link" className="px-0">
          <Link to="/website-comparisons">Back to website comparisons</Link>
        </Button>
      </div>
    );
  }

  const data = comparison.data;
  const editable = canEdit(data.myRole);
  const archived = data.state === 'ARCHIVED';
  const sizes = VIEWPORT_OPTIONS.filter((o) => data.settings.viewports.includes(o.value));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        back={{ to: '/website-comparisons', label: 'Website comparison' }}
        title={data.name}
        badge={<ComparisonStateBadge state={data.state} />}
        description={
          <>
            Project{' '}
            <Link to={`/projects/${data.projectId}`} className="underline-offset-4 hover:underline">
              {data.projectName}
            </Link>
          </>
        }
        actions={
          editable ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to={`/website-comparisons/${data.id}/edit`}>
                  <Pencil aria-hidden="true" /> Edit
                </Link>
              </Button>
              {archived ? (
                <Button variant="outline" onClick={() => setDialog('restore')}>
                  <ArchiveRestore aria-hidden="true" /> Restore
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setDialog('archive')}>
                  <Archive aria-hidden="true" /> Archive
                </Button>
              )}
              <Button variant="destructive" onClick={() => setDialog('delete')}>
                <Trash2 aria-hidden="true" /> Delete
              </Button>
            </div>
          ) : (
            <RoleBadge role={data.myRole} />
          )
        }
      />

      {archived ? (
        <Alert>
          <Archive aria-hidden="true" />
          <AlertTitle>Archived</AlertTitle>
          <AlertDescription>
            This comparison is hidden from the default list. Nothing was deleted
            {editable ? '; restore it to make it active again.' : '.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <SiteCard
          title="Reference website (A)"
          description="The site compared against, for example the live site."
          site={data.reference}
        />
        <SiteCard
          title="Target website (B)"
          description="The site checked, for example the redesign or staging site."
          site={data.target}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ['Pages per website', String(data.settings.maxPages)],
                ['Link depth', String(data.settings.maxDepth)],
                ['Only include paths', patterns(data.settings.includePatterns, 'All pages')],
                ['Exclude paths', patterns(data.settings.excludePatterns, 'None')],
                ['Screen sizes', sizes.map((s) => s.label).join(', ')],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ['Created by', data.createdBy?.name ?? 'Unknown (account removed)'],
                ['Created', formatDateTime(data.createdAt)],
                ['Last updated', formatDateTime(data.updatedAt)],
                ...(data.archivedAt
                  ? ([['Archived', formatDateTime(data.archivedAt)]] as [string, ReactNode][])
                  : []),
                ['Your role', <RoleBadge key="role" role={data.myRole} />],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <RunsCard comparison={data} />

      {editable ? (
        <>
          <ArchiveDialog
            comparison={data}
            mode={dialog === 'restore' ? 'restore' : 'archive'}
            open={dialog === 'archive' || dialog === 'restore'}
            onOpenChange={(open) => setDialog(open ? dialog : null)}
          />
          <DeleteComparisonDialog
            comparison={data}
            open={dialog === 'delete'}
            onOpenChange={(open) => setDialog(open ? 'delete' : null)}
          />
        </>
      ) : null}
    </div>
  );
}

function SiteCard({
  title,
  description,
  site,
}: {
  title: string;
  description: string;
  site: WebsiteComparisonSiteDto;
}) {
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <Link to={`/websites/${site.id}`} className="font-medium hover:underline">
          {site.name}
        </Link>
        <span className="block break-all text-muted-foreground">{site.baseUrl}</span>
      </CardContent>
    </Card>
  );
}

/** Runs arrive in Checkpoint 3: only what the API reports is shown, never invented. */
function RunsCard({ comparison }: { comparison: WebsiteComparisonDto }) {
  const latest = comparison.latestRun;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Runs</CardTitle>
        <CardDescription>
          {comparison.runCount === 0
            ? 'This comparison has not been run.'
            : `${comparison.runCount} run${comparison.runCount === 1 ? '' : 's'} recorded.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {latest ? (
          <DetailList
            items={[
              ['Latest run', RUN_STATUS[latest.status] ?? latest.status],
              ['Queued', formatDateTime(latest.queuedAt)],
              ['Finished', latest.finishedAt ? formatDateTime(latest.finishedAt) : 'Not finished'],
            ]}
          />
        ) : null}
        <Alert>
          <PlayCircle aria-hidden="true" />
          <AlertDescription>
            Running comparisons is not available yet. When it is, the run history and the
            differences found will appear here.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function patterns(list: string[], none: string): ReactNode {
  return list.length ? (
    <span className="flex flex-wrap justify-end gap-1">
      {list.map((p) => (
        <code key={p} className="rounded bg-muted px-1 text-xs">
          {p}
        </code>
      ))}
    </span>
  ) : (
    none
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

function ArchiveDialog({
  comparison,
  mode,
  open,
  onOpenChange,
}: {
  comparison: WebsiteComparisonDto;
  mode: 'archive' | 'restore';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateWebsiteComparison(comparison.id);
  const busy = useRef(false);
  const run = async () => {
    if (busy.current) return; // never twice
    busy.current = true;
    try {
      await update.mutateAsync({ archived: mode === 'archive' });
      toast.success(
        mode === 'archive' ? `${comparison.name} archived.` : `${comparison.name} restored.`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      busy.current = false;
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {mode === 'archive' ? `Archive ${comparison.name}?` : `Restore ${comparison.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {mode === 'archive'
              ? 'It is hidden from the default list. Its settings and history are kept, nothing is deleted, and you can restore it at any time.'
              : 'It becomes active again and appears in the default list.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={update.isPending}>Cancel</AlertDialogCancel>
          <Button disabled={update.isPending} onClick={() => void run()}>
            {update.isPending
              ? mode === 'archive'
                ? 'Archiving…'
                : 'Restoring…'
              : mode === 'archive'
                ? 'Archive comparison'
                : 'Restore comparison'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteComparisonDialog({
  comparison,
  open,
  onOpenChange,
}: {
  comparison: WebsiteComparisonDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const remove = useDeleteWebsiteComparison(comparison.id);
  const navigate = useNavigate();
  const busy = useRef(false);
  const run = async () => {
    if (busy.current) return; // never twice
    busy.current = true;
    try {
      await remove.mutateAsync();
      toast.success(`${comparison.name} deleted.`);
      onOpenChange(false);
      navigate('/website-comparisons', { replace: true });
    } catch (error) {
      // e.g. 409 while a run is active: the API's own explanation, nothing pretended.
      toast.error(errorMessage(error));
    } finally {
      busy.current = false;
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {comparison.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The comparison, its settings and any run history are permanently deleted. This cannot be
            undone. The two websites themselves are not changed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Alert>
          <Info aria-hidden="true" />
          <AlertDescription>To only hide it from the list, archive it instead.</AlertDescription>
        </Alert>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => void run()}>
            {remove.isPending ? 'Deleting…' : 'Delete comparison'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
