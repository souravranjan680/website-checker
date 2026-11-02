import { FolderKanban, Globe, Plus, ScanSearch, Search, Users } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { RoleBadge } from '@/components/common/RoleBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelative, pluralize } from '@/lib/format';
import { useProjects } from './api';
import { ProjectFormDialog } from './ProjectFormDialog';

export function ProjectsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [createOpen, setCreateOpen] = useState(false);
  const projects = useProjects({ page, pageSize: 12, q: q || undefined });

  const newButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus aria-hidden="true" /> New project
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Group websites by team, product or client. Only members can see a project."
        actions={newButton}
      />

      <div className="relative max-w-sm">
        <Search
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search projects"
          placeholder="Search projects…"
          className="pl-8"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {projects.isPending ? (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label="Loading projects"
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : projects.isError ? (
        <ErrorState
          title="Couldn't load projects"
          error={projects.error}
          onRetry={() => void projects.refetch()}
        />
      ) : projects.data.data.length === 0 ? (
        q ? (
          <EmptyState
            icon={Search}
            title="No matching projects"
            description={`Nothing matches "${q}".`}
          />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create a project, then add the websites you want to check."
            action={newButton}
          />
        )
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.data.data.map((project) => (
              <li key={project.id}>
                <Card className="relative h-full transition-colors hover:border-foreground/20">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="min-w-0">
                        <Link
                          to={`/projects/${project.id}`}
                          className="truncate after:absolute after:inset-0 hover:underline"
                        >
                          {project.name}
                        </Link>
                      </CardTitle>
                      <RoleBadge role={project.myRole} />
                    </div>
                    <CardDescription className="line-clamp-2 min-h-10">
                      {project.description || 'No description'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Globe className="size-3.5" aria-hidden="true" />
                      {pluralize(project.websiteCount, 'website')}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden="true" />
                      {pluralize(project.memberCount, 'member')}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ScanSearch className="size-3.5" aria-hidden="true" />
                      {pluralize(project.scanCount, 'scan')}
                    </span>
                    <span className="w-full text-xs">
                      Updated {formatRelative(project.updatedAt)}
                    </span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <PaginationBar meta={projects.data.meta} onPageChange={setPage} />
        </>
      )}

      <ProjectFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
