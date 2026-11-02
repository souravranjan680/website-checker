import { CircleSlash } from 'lucide-react';
import { useParams } from 'react-router';
import { ErrorState } from '@/components/common/ErrorState';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePendingReport, type PendingKind } from './api';

const TITLE: Record<PendingKind, string> = {
  performance: 'Performance',
  seo: 'SEO',
  security: 'Security',
};

/**
 * Performance, SEO and security. The scanner does not measure these yet (Phase 6),
 * so the page says so plainly instead of showing estimated or sample numbers.
 * If real rows exist (from a later scanner version) they are listed as-is.
 */
export function PendingReport({ kind }: { kind: PendingKind }) {
  const { scanId = '' } = useParams();
  const report = usePendingReport(scanId, kind);
  if (report.isPending) return <Skeleton className="h-40 rounded-xl" />;
  if (report.isError)
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;

  if (!r.available) {
    return (
      <Alert>
        <CircleSlash aria-hidden="true" />
        <AlertTitle>{TITLE[kind]} data is not available for this scan</AlertTitle>
        <AlertDescription>
          <p>{r.message}</p>
          <p>
            No score is shown because no measurement was made. This is planned for Phase{' '}
            {r.plannedPhase}.
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  const rows = r.results as {
    id: string;
    title?: string;
    severity?: string;
    pageUrl?: string | null;
  }[];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {TITLE[kind]} results ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block">{row.title ?? row.id}</span>
                {row.pageUrl ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.pageUrl}
                  </span>
                ) : null}
              </span>
              {row.severity ? <SeverityBadge severity={row.severity} /> : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
