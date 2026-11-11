import type { WebsiteComparisonListItemDto } from '@whc/shared';
import { GitCompareArrows, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useWebsiteComparisons } from './api';
import { ComparisonStateBadge } from './ComparisonStateBadge';

/**
 * Entry points to Website comparison (Mode 2) from Mode 1 pages (Milestone 4, Checkpoint
 * 2.4). Read-only: they only list and link; comparisons are created and managed on their
 * own pages.
 */

function NewComparisonLink({ projectId }: { projectId: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link to={`/website-comparisons/new?projectId=${projectId}`}>
        <Plus aria-hidden="true" /> New comparison
      </Link>
    </Button>
  );
}

function ComparisonRows({
  comparisons,
  websiteId,
}: {
  comparisons: WebsiteComparisonListItemDto[];
  websiteId?: string;
}) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {comparisons.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0">
            <Link
              to={`/website-comparisons/${c.id}`}
              className="block truncate font-medium hover:underline"
            >
              {c.name}
            </Link>
            <span className="block truncate text-xs text-muted-foreground">
              {websiteId
                ? c.reference.id === websiteId
                  ? `This website is the reference; target: ${c.target.name}`
                  : `This website is the target; reference: ${c.reference.name}`
                : `${c.reference.name} → ${c.target.name}`}
            </span>
          </span>
          <ComparisonStateBadge state={c.state} />
        </li>
      ))}
    </ul>
  );
}

/** On a project's page: its active comparisons, and where to start a new one. */
export function ProjectComparisonsCard({
  projectId,
  editable,
}: {
  projectId: string;
  editable: boolean;
}) {
  const comparisons = useWebsiteComparisons({ projectId, archived: 'false', pageSize: 5 });
  return (
    <Card aria-label="Website comparisons">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Website comparisons</CardTitle>
          <CardDescription>Two websites of this project compared with each other.</CardDescription>
        </div>
        {editable ? <NewComparisonLink projectId={projectId} /> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {comparisons.isPending ? (
          <Skeleton className="h-16" aria-label="Loading comparisons" />
        ) : comparisons.isError ? (
          <ErrorState
            title="Couldn't load comparisons"
            error={comparisons.error}
            onRetry={() => void comparisons.refetch()}
          />
        ) : comparisons.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active comparisons in this project.
            {editable ? '' : ' An editor can create one.'}
          </p>
        ) : (
          <>
            <ComparisonRows comparisons={comparisons.data.data} />
            <Link
              to={`/website-comparisons?projectId=${projectId}`}
              className="text-sm underline-offset-4 hover:underline"
            >
              View all {comparisons.data.meta.total} comparison
              {comparisons.data.meta.total === 1 ? '' : 's'}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * On a website's page: the comparisons that use it (they keep it from being deleted or
 * moved). The API filters comparisons by project, not by website, so this checks the
 * project's comparisons (up to 100) and says so if there are more.
 */
export function WebsiteComparisonsCard({
  websiteId,
  projectId,
  editable,
}: {
  websiteId: string;
  projectId: string;
  editable: boolean;
}) {
  const comparisons = useWebsiteComparisons({ projectId, archived: 'all', pageSize: 100 });
  const using =
    comparisons.data?.data.filter(
      (c) => c.reference.id === websiteId || c.target.id === websiteId,
    ) ?? [];
  const partial = (comparisons.data?.meta.total ?? 0) > (comparisons.data?.data.length ?? 0);
  return (
    <Card aria-label="Website comparisons using this website">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="size-4" aria-hidden="true" /> Website comparisons
          </CardTitle>
          <CardDescription>
            Comparisons that use this website. While any exist, it cannot be deleted or moved to
            another project.
          </CardDescription>
        </div>
        {editable ? <NewComparisonLink projectId={projectId} /> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {comparisons.isPending ? (
          <Skeleton className="h-16" aria-label="Loading comparisons" />
        ) : comparisons.isError ? (
          <ErrorState
            title="Couldn't load comparisons"
            error={comparisons.error}
            onRetry={() => void comparisons.refetch()}
          />
        ) : using.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {partial
              ? 'None among the first 100 comparisons of this project.'
              : 'No comparison uses this website.'}
          </p>
        ) : (
          <ComparisonRows comparisons={using} websiteId={websiteId} />
        )}
        {partial && using.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Only the first 100 comparisons of this project were checked.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
