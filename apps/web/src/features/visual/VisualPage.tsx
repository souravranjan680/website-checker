import { Images } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useVisualOverview } from './api';
import { BaselineRow } from './BaselinesCard';

/** Every visual baseline the user can see, grouped by website. */
export function VisualPage() {
  const overview = useVisualOverview();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Visual regression"
        description="Pages compared against an approved baseline image on every scan. Small rendering noise is ignored; baselines change only when you replace them."
      />
      {overview.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : overview.data.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No baselines yet"
          description="Open a finished scan → Reports → Visual and choose “Use as baseline” for the pages you want to watch."
          action={
            <Link to="/history" className="text-sm underline-offset-4 hover:underline">
              Go to scan history
            </Link>
          }
        />
      ) : (
        groupByWebsite(overview.data).map(({ website, baselines }) => (
          <Card key={website.id}>
            <CardHeader>
              <CardTitle>
                <Link to={`/websites/${website.id}`} className="hover:underline">
                  {website.name}
                </Link>{' '}
                <span className="text-sm font-normal text-muted-foreground">{website.baseUrl}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {baselines.map((b) => (
                  // Editing happens on the website page, where the user's role is known.
                  <BaselineRow key={b.id} baseline={b} editable={false} />
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function groupByWebsite<T extends { website: { id: string; name: string; baseUrl: string } }>(
  rows: T[],
) {
  const groups = new Map<string, { website: T['website']; baselines: T[] }>();
  for (const row of rows) {
    const group = groups.get(row.website.id) ?? { website: row.website, baselines: [] as T[] };
    group.baselines.push(row);
    groups.set(row.website.id, group);
  }
  return [...groups.values()];
}
