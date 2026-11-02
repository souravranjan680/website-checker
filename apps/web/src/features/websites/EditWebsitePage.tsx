import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { canEdit } from '@/components/common/RoleBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/projects/api';
import { useUpdateWebsite, useWebsite } from './api';
import { WebsiteForm } from './WebsiteForm';

export function EditWebsitePage() {
  const { websiteId = '' } = useParams();
  const navigate = useNavigate();
  const website = useWebsite(websiteId);
  const projects = useProjects({ pageSize: 100 });
  const update = useUpdateWebsite(websiteId);

  if (website.isPending || projects.isPending)
    return <Skeleton className="mx-auto h-96 w-full max-w-3xl rounded-xl" />;
  if (website.isError || projects.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState error={website.error ?? projects.error} />
      </div>
    );
  }
  if (!canEdit(website.data.myRole)) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-2">
        <ErrorState
          title="Read-only access"
          error={new Error('Only owners and editors can change websites.')}
        />
        <Button asChild variant="link" className="px-0">
          <Link to={`/websites/${websiteId}`}>Back to website</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        back={{ to: `/websites/${websiteId}`, label: website.data.name }}
        title="Edit website"
      />
      <Card>
        <CardContent>
          <WebsiteForm
            projects={projects.data.data.filter((p) => canEdit(p.myRole))}
            website={website.data}
            submitLabel="Save changes"
            onCancel={() => navigate(`/websites/${websiteId}`)}
            onSubmit={async ({ urlChanged, authorizationConfirmed, ...values }) => {
              await update.mutateAsync({
                ...values,
                ...(urlChanged ? { authorizationConfirmed } : {}),
              });
              toast.success('Website updated.');
              navigate(`/websites/${websiteId}`);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
