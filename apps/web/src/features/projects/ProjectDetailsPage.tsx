import type { ProjectStatsDto } from '@whc/shared';
import {
  AlertTriangle,
  Globe,
  Pencil,
  Plus,
  ScanSearch,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { canEdit, RoleBadge } from '@/components/common/RoleBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { WebsitesTable } from '@/features/websites/WebsitesTable';
import { useWebsites } from '@/features/websites/api';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { ProjectComparisonsCard } from '@/features/website-comparisons/ComparisonEntryCards';
import { ActivityCard } from './ActivityCard';
import { useProject } from './api';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { MembersCard } from './MembersCard';
import { ProjectFormDialog } from './ProjectFormDialog';

export function ProjectDetailsPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (project.isPending) {
    return (
      <div
        className="mx-auto flex w-full max-w-6xl flex-col gap-6"
        aria-busy="true"
        aria-label="Loading project"
      >
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (project.isError) {
    const missing = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title={missing ? 'Project not found' : "Couldn't load this project"}
          error={
            missing ? new Error("It doesn't exist, or you're not a member of it.") : project.error
          }
          onRetry={missing ? undefined : () => void project.refetch()}
        />
        <Button asChild variant="link" className="px-0">
          <Link to="/projects">Back to projects</Link>
        </Button>
      </div>
    );
  }

  const data = project.data;
  const editable = canEdit(data.myRole);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        back={{ to: '/projects', label: 'Projects' }}
        title={data.name}
        badge={<RoleBadge role={data.myRole} />}
        description={data.description ?? undefined}
        actions={
          <>
            {editable ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden="true" /> Edit
              </Button>
            ) : null}
            {data.myRole === 'OWNER' ? (
              <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                <Trash2 aria-hidden="true" /> Delete
              </Button>
            ) : null}
          </>
        }
      />

      <StatsRow stats={data.stats} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <ProjectWebsites projectId={data.id} editable={editable} />
          <ProjectComparisonsCard projectId={data.id} editable={editable} />
        </div>
        <div className="flex flex-col gap-6">
          <MembersCard projectId={data.id} myRole={data.myRole} />
          <ActivityCard projectId={data.id} />
        </div>
      </div>

      <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} project={data} />
      <DeleteProjectDialog open={deleteOpen} onOpenChange={setDeleteOpen} project={data} />
    </div>
  );
}

/** Every number comes from the database. Scans stay at 0 until the scanner exists (Phase 4). */
function StatsRow({ stats }: { stats: ProjectStatsDto }) {
  const items: { label: string; value: number; icon: LucideIcon; hint?: string }[] = [
    { label: 'Websites', value: stats.websiteCount, icon: Globe },
    { label: 'Members', value: stats.memberCount, icon: Users },
    {
      label: 'Scans',
      value: stats.scanCount,
      icon: ScanSearch,
      hint: stats.lastScanAt ? `Last: ${formatDateTime(stats.lastScanAt)}` : 'No scans yet',
    },
    {
      label: 'Open issues',
      value: stats.openIssueCount,
      icon: AlertTriangle,
      hint: 'From completed scans',
    },
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(({ label, value, icon: Icon, hint }) => (
        <Card key={label} className="gap-2 py-4">
          <CardContent className="flex items-start justify-between gap-2 px-4">
            <div>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
              {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
            </div>
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}

function ProjectWebsites({ projectId, editable }: { projectId: string; editable: boolean }) {
  const websites = useWebsites({ projectId, pageSize: 50 });
  const addButton = editable ? (
    <Button asChild size="sm">
      <Link to={`/websites/new?projectId=${projectId}`}>
        <Plus aria-hidden="true" /> Add website
      </Link>
    </Button>
  ) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Websites</CardTitle>
          <CardDescription>Websites in this project.</CardDescription>
        </div>
        {addButton}
      </CardHeader>
      <CardContent>
        {websites.isPending ? (
          <Skeleton className="h-32" />
        ) : websites.isError ? (
          <ErrorState error={websites.error} onRetry={() => void websites.refetch()} />
        ) : websites.data.data.length === 0 ? (
          <EmptyState
            icon={Globe}
            title="No websites yet"
            description={
              editable
                ? 'Add the first website you want to check.'
                : 'An editor can add websites here.'
            }
            action={addButton}
          />
        ) : (
          <WebsitesTable websites={websites.data.data} showProject={false} />
        )}
      </CardContent>
    </Card>
  );
}
