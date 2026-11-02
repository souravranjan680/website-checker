import type { ActivityDto } from '@whc/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useProjectActivity } from './api';

/** Turns an audit-log row into a short sentence. */
export function describeActivity(activity: Pick<ActivityDto, 'action' | 'metadata'>): string {
  const meta = activity.metadata ?? {};
  const text = (key: string) => (typeof meta[key] === 'string' ? (meta[key] as string) : '');
  switch (activity.action) {
    case 'project.created':
      return 'created the project';
    case 'project.updated':
      return 'updated the project details';
    case 'website.created':
      return `added the website ${text('name')}`;
    case 'website.updated':
      return 'updated a website';
    case 'website.deleted':
      return `deleted the website ${text('name')}`;
    case 'member.added':
      return `added ${text('email')} as ${text('role').toLowerCase()}`;
    case 'member.role_changed':
      return `changed a member's role to ${text('to').toLowerCase()}`;
    case 'member.removed':
      return 'removed a member';
    case 'member.left':
      return 'left the project';
    case 'scan.started':
      return `started a scan of ${text('website') || 'a website'}`;
    case 'scan.rescanned':
      return `rescanned ${text('website') || 'a website'}`;
    case 'scan.cancelled':
      return 'cancelled a scan';
    case 'issue.status_changed':
      return `marked "${text('title')}" as ${text('to').toLowerCase().replace('_', ' ')}`;
    default:
      return activity.action;
  }
}

export function ActivityCard({ projectId }: { projectId: string }) {
  const activity = useProjectActivity(projectId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Audit trail of changes in this project.</CardDescription>
      </CardHeader>
      <CardContent>
        {activity.isPending ? (
          <Skeleton className="h-24" />
        ) : activity.isError ? (
          <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
        ) : activity.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="space-y-3">
            {activity.data.data.map((item) => (
              <li key={item.id} className="text-sm">
                <span className="font-medium">{item.user?.name ?? 'Deleted user'}</span>{' '}
                {describeActivity(item)}
                <time
                  dateTime={item.createdAt}
                  title={formatDateTime(item.createdAt)}
                  className="block text-xs text-muted-foreground"
                >
                  {formatRelative(item.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
