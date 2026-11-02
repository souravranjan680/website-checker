import type { ResponsiveViewportDto } from '@whc/shared';
import { Monitor } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { canEdit } from '@/components/common/RoleBadge';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScreenshotPreview } from '@/features/scans/Screenshot';
import { formatDateTime } from '@/lib/format';
import { useResponsiveReport } from './api';
import { ReportIssues } from './ReportIssues';

const DESKTOP = '1920x1080';

/**
 * Results per screen size (desktop, laptop, tablet, mobile), with the screenshots
 * of this scan next to the same page in the previous scan ("before / after").
 */
export function ResponsiveReport() {
  const { scanId = '' } = useParams();
  const report = useResponsiveReport(scanId);
  const [selected, setSelected] = useState<string | null>(null);
  if (report.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (report.isError)
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;
  const tested = r.viewports.some((v) => v.pages.length > 0);
  if (!tested) {
    return (
      <EmptyState
        icon={Monitor}
        title="No responsive results"
        description="This scan did not test pages at several screen sizes (for example it failed early or was cancelled)."
      />
    );
  }
  const current = r.viewports.find((v) => v.label === selected) ?? r.viewports[0]!;

  return (
    <div className="flex flex-col gap-6">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {r.viewports.map((v) => (
          <li key={v.label}>
            <button
              type="button"
              onClick={() => setSelected(v.label)}
              aria-pressed={v.label === current.label}
              className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/50 ${v.label === current.label ? 'border-primary bg-muted/40' : ''}`}
            >
              <span className="block text-sm font-medium">{v.name}</span>
              <span className="block text-xs text-muted-foreground">
                {v.width}×{v.height}
              </span>
              <span className="mt-1 block text-2xl font-semibold tabular-nums">{v.issues}</span>
              <span className="block text-xs text-muted-foreground">
                layout issues
                {v.comparison
                  ? ` · +${v.comparison.newIssues} / −${v.comparison.resolvedIssues}`
                  : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {r.previousScan ? (
          <>
            “+ / −” and the “Before” screenshots compare with the{' '}
            <Link to={`/scans/${r.previousScan.id}`} className="underline">
              previous scan
            </Link>{' '}
            ({formatDateTime(r.previousScan.createdAt)}).
          </>
        ) : (
          'This is the first finished scan of this website, so there is nothing to compare with yet.'
        )}
      </p>

      <ViewportDetails viewport={current} hasPrevious={Boolean(r.previousScan)} />

      <ReportIssues
        key={current.label}
        scanId={scanId}
        category={current.label === DESKTOP ? 'UI_HEALTH' : 'RESPONSIVE'}
        extraFilters={{ viewport: current.label }}
        canEdit={canEdit(r.scan.myRole)}
        title={
          current.label === DESKTOP
            ? `Desktop issues (layout checks run as part of UI health)`
            : `Issues at ${current.name} (${current.width}×${current.height})`
        }
      />
    </div>
  );
}

function ViewportDetails({
  viewport,
  hasPrevious,
}: {
  viewport: ResponsiveViewportDto;
  hasPrevious: boolean;
}) {
  const [compare, setCompare] = useState(hasPrevious);
  const severities = Object.entries(viewport.bySeverity);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>
            {viewport.name} · {viewport.width}×{viewport.height}
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            {severities.length === 0
              ? 'No layout issues at this size.'
              : severities.map(([severity, n]) => (
                  <span key={severity} className="inline-flex items-center gap-1">
                    <SeverityBadge severity={severity} /> {n}
                  </span>
                ))}
          </CardDescription>
        </div>
        {hasPrevious ? (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={compare}
            onClick={() => setCompare((v) => !v)}
          >
            {compare ? 'Hide before / after' : 'Show before / after'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <ul className="grid gap-6 md:grid-cols-2">
          {viewport.pages.map((page) => (
            <li key={page.pageId} className="space-y-2">
              <p className="truncate text-sm font-medium" title={page.url}>
                {page.url}
                <span className="font-normal text-muted-foreground"> · {page.issues} issues</span>
              </p>
              <div className={compare ? 'grid grid-cols-2 gap-2' : ''}>
                {compare ? (
                  <figure className="space-y-1">
                    <figcaption className="text-xs text-muted-foreground">Before</figcaption>
                    {page.previousScreenshotId ? (
                      <ScreenshotPreview
                        id={page.previousScreenshotId}
                        title={`Before: ${page.url} at ${viewport.name}`}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">Not in the previous scan.</p>
                    )}
                  </figure>
                ) : null}
                <figure className="space-y-1">
                  {compare ? (
                    <figcaption className="text-xs text-muted-foreground">After</figcaption>
                  ) : null}
                  {page.screenshotId ? (
                    <ScreenshotPreview
                      id={page.screenshotId}
                      title={`${page.url} at ${viewport.name}`}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">No screenshot at this size.</p>
                  )}
                </figure>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
