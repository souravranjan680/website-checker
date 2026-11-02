import { FolderKanban } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { canEdit } from '@/components/common/RoleBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/projects/api';
import { useCreateWebsite } from './api';
import { WebsiteForm } from './WebsiteForm';

export function AddWebsitePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projects = useProjects({ pageSize: 100 });
  const create = useCreateWebsite();

  const body = projects.isPending ? (
    <Skeleton className="h-96 rounded-xl" />
  ) : projects.isError ? (
    <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
  ) : (
    (() => {
      const editable = projects.data.data.filter((p) => canEdit(p.myRole));
      if (editable.length === 0) {
        return (
          <EmptyState
            icon={FolderKanban}
            title="You need a project first"
            description="Websites belong to a project. Create one (or ask an owner to make you an editor)."
            action={
              <Button asChild>
                <Link to="/projects">Go to projects</Link>
              </Button>
            }
          />
        );
      }
      return (
        <Card>
          <CardContent>
            <WebsiteForm
              projects={editable}
              defaultProjectId={params.get('projectId') ?? undefined}
              submitLabel="Add website"
              onCancel={() => navigate(-1)}
              onSubmit={async ({ urlChanged: _ignored, ...values }) => {
                const website = await create.mutateAsync({
                  ...values,
                  authorizationConfirmed: true,
                });
                toast.success(`${website.name} added.`);
                navigate(`/websites/${website.id}`, { replace: true });
              }}
            />
          </CardContent>
        </Card>
      );
    })()
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        back={{ to: '/websites', label: 'Websites' }}
        title="Add website"
        description="Register a website to scan. Nothing is scanned yet; scanning arrives in Phase 4."
      />
      {body}
    </div>
  );
}
