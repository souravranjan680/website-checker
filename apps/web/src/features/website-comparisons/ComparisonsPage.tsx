import { GitCompareArrows, Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { canEdit } from '@/components/common/RoleBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/projects/api';
import { useWebsiteComparisons, type WebsiteComparisonListParams } from './api';
import { ComparisonsTable } from './ComparisonsTable';

type Archived = NonNullable<WebsiteComparisonListParams['archived']>;

/**
 * /website-comparisons (Phase 9, Milestone 4: Mode 2). Saved comparisons of two websites
 * of the same project. Comparisons cannot run yet (Checkpoint 3): nothing here pretends
 * they can.
 */
export function ComparisonsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [archived, setArchived] = useState<Archived>('false');
  const q = useDeferredValue(search.trim());
  const comparisons = useWebsiteComparisons({
    page,
    pageSize: 20,
    q: q || undefined,
    projectId: projectId || undefined,
    archived,
  });
  const projects = useProjects({ pageSize: 100 });
  // The list has no per-row role: creating needs editor rights in some project.
  const canCreate = projects.data?.data.some((p) => canEdit(p.myRole)) ?? false;
  const filtering = Boolean(q || projectId);

  const newButton = canCreate ? (
    <Button asChild>
      <Link to="/website-comparisons/new">
        <Plus aria-hidden="true" /> New comparison
      </Link>
    </Button>
  ) : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Website comparison"
        description="Compare two websites of the same project, for example a live site and its redesign. Differences will be reported for review, never as confirmed defects. Running comparisons is not available yet."
        actions={newButton}
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search comparisons"
            placeholder="Search by comparison or website name…"
            className="pl-8"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <NativeSelect
          aria-label="Filter by project"
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            setPage(1);
          }}
        >
          <NativeSelectOption value="">All projects</NativeSelectOption>
          {projects.data?.data.map((project) => (
            <NativeSelectOption key={project.id} value={project.id}>
              {project.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Show"
          value={archived}
          onChange={(event) => {
            setArchived(event.target.value as Archived);
            setPage(1);
          }}
        >
          <NativeSelectOption value="false">Active</NativeSelectOption>
          <NativeSelectOption value="true">Archived</NativeSelectOption>
          <NativeSelectOption value="all">Active and archived</NativeSelectOption>
        </NativeSelect>
      </div>

      {comparisons.isPending ? (
        <Skeleton className="h-64 rounded-xl" aria-label="Loading comparisons" />
      ) : comparisons.isError ? (
        <ErrorState
          title="Couldn't load comparisons"
          error={comparisons.error}
          onRetry={() => void comparisons.refetch()}
        />
      ) : comparisons.data.data.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={Search}
            title="No matching comparisons"
            description="Try a different search or project."
          />
        ) : archived === 'true' ? (
          <EmptyState
            icon={GitCompareArrows}
            title="No archived comparisons"
            description="Archived comparisons are listed here."
          />
        ) : (
          <EmptyState
            icon={GitCompareArrows}
            title="No website comparisons yet"
            action={newButton}
            description={
              canCreate
                ? 'A comparison pairs a reference website with a target website of the same project.'
                : 'A comparison pairs a reference website with a target website of the same project. An owner or editor of a project can create one.'
            }
          />
        )
      ) : (
        <>
          <Card className="py-0">
            <CardContent className="px-0">
              <ComparisonsTable comparisons={comparisons.data.data} />
            </CardContent>
          </Card>
          <PaginationBar meta={comparisons.data.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
