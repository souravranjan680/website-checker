import { Globe, Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/projects/api';
import { useWebsites } from './api';
import { WebsitesTable } from './WebsitesTable';

export function WebsitesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const q = useDeferredValue(search.trim());
  const websites = useWebsites({
    page,
    pageSize: 20,
    q: q || undefined,
    projectId: projectId || undefined,
  });
  const projects = useProjects({ pageSize: 100 });
  const filtering = Boolean(q || projectId);

  const addButton = (
    <Button asChild>
      <Link to="/websites/new">
        <Plus aria-hidden="true" /> Add website
      </Link>
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Websites"
        description="Every website you can access, across all your projects."
        actions={addButton}
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative w-full max-w-sm">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search websites"
            placeholder="Search by name or URL…"
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
      </div>

      {websites.isPending ? (
        <Skeleton className="h-64 rounded-xl" aria-label="Loading websites" />
      ) : websites.isError ? (
        <ErrorState
          title="Couldn't load websites"
          error={websites.error}
          onRetry={() => void websites.refetch()}
        />
      ) : websites.data.data.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={Search}
            title="No matching websites"
            description="Try a different search or project."
          />
        ) : (
          <EmptyState
            icon={Globe}
            title="No websites yet"
            description="Add a website you own or are authorized to test. Scans become available in Phase 4."
            action={addButton}
          />
        )
      ) : (
        <>
          <Card className="py-0">
            <CardContent className="px-0">
              <WebsitesTable websites={websites.data.data} />
            </CardContent>
          </Card>
          <PaginationBar meta={websites.data.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
