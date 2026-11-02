import { useQuery } from '@tanstack/react-query';
import type { DependencyCheck, HealthReport } from '@whc/shared';
import { CheckCircle2, Database, RefreshCw, Server, XCircle, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { fetchHealth } from './api';

/**
 * Phase 2 page: proves browser → API → PostgreSQL/Redis works end to end.
 * TanStack Query handles loading, errors, caching and the 10-second auto-refresh.
 */
export function SystemStatusPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
    retry: false,
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
          <p className="text-sm text-muted-foreground">
            Live connectivity of the API, database and job queue. Refreshes every 10 seconds.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void health.refetch()}
          disabled={health.isFetching}
        >
          <RefreshCw className={cn(health.isFetching && 'animate-spin')} aria-hidden="true" />
          Refresh
        </Button>
      </header>

      {health.isPending ? (
        <LoadingState />
      ) : health.isError ? (
        <ErrorState message={health.error.message} onRetry={() => void health.refetch()} />
      ) : (
        <HealthView report={health.data} />
      )}
    </div>
  );
}

function HealthView({ report }: { report: HealthReport }) {
  const allUp = report.status === 'ok';
  return (
    <>
      <div
        role="status"
        className={cn(
          'flex items-center gap-3 rounded-lg border px-4 py-3 text-sm',
          allUp
            ? 'border-emerald-600/30 bg-emerald-600/5'
            : 'border-destructive/40 bg-destructive/5',
        )}
      >
        {allUp ? (
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
        ) : (
          <XCircle className="size-5 text-destructive" aria-hidden="true" />
        )}
        <span className="font-medium">
          {allUp ? 'All systems operational' : 'Some services are down'}
        </span>
        <span className="ml-auto text-muted-foreground">
          Checked {new Date(report.timestamp).toLocaleTimeString()}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ServiceCard
          title="API"
          description="Express server"
          icon={<Server aria-hidden="true" />}
          check={{ status: 'up', latencyMs: 0 }}
          rows={[
            ['Version', report.version],
            ['Environment', report.environment],
            ['Uptime', formatUptime(report.uptimeSeconds)],
          ]}
        />
        <ServiceCard
          title="PostgreSQL"
          description="Main database"
          icon={<Database aria-hidden="true" />}
          check={report.checks.database}
        />
        <ServiceCard
          title="Redis"
          description="Queue & cache"
          icon={<Zap aria-hidden="true" />}
          check={report.checks.redis}
        />
      </div>
    </>
  );
}

function ServiceCard(props: {
  title: string;
  description: string;
  icon: ReactNode;
  check: DependencyCheck;
  rows?: [string, string][];
}) {
  const { check } = props;
  const rows = props.rows ?? [['Response time', `${check.latencyMs} ms`]];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-muted [&>svg]:size-4">
            {props.icon}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>{props.title}</CardTitle>
            <CardDescription>{props.description}</CardDescription>
          </div>
          <StatusBadge up={check.status === 'up'} />
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
          {check.error ? (
            <div className="mt-1 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
              {check.error}
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

/** Status is shown with an icon AND text, never colour alone (an accessibility rule). */
function StatusBadge({ up }: { up: boolean }) {
  return up ? (
    <Badge
      variant="outline"
      className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
    >
      <CheckCircle2 aria-hidden="true" /> Up
    </Badge>
  ) : (
    <Badge variant="destructive">
      <XCircle aria-hidden="true" /> Down
    </Badge>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-4 md:grid-cols-3" aria-busy="true" aria-label="Loading system status">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-40 rounded-xl" />
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card role="alert" className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <XCircle className="size-5 text-destructive" aria-hidden="true" />
          API unreachable
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          Make sure the API is running (<code className="rounded bg-muted px-1">npm run dev</code>)
          and Docker services are up.
        </span>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

function formatUptime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
