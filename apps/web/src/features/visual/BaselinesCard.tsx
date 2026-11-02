import type { VisualBaselineDto } from '@whc/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { canEdit } from '@/components/common/RoleBadge';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScreenshotPreview } from '@/features/scans/Screenshot';
import { formatDateTime, formatRelative } from '@/lib/format';
import {
  useBaselineHistory,
  useDeleteBaseline,
  useUpdateBaseline,
  useWebsiteBaselines,
} from './api';
import { BaselineSettingsDialog, ConfirmDialog, VisualStatusBadge } from './components';

/** Visual baselines of one website, with their latest result and history. */
export function BaselinesCard({ websiteId }: { websiteId: string }) {
  const baselines = useWebsiteBaselines(websiteId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Visual regression</CardTitle>
        <CardDescription>
          Each scan&apos;s snapshot of these pages is compared with the baseline image. Choose a
          baseline from a scan&apos;s Visual report.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {baselines.isPending ? (
          <Skeleton className="h-24" />
        ) : baselines.isError ? (
          <ErrorState error={baselines.error} onRetry={() => void baselines.refetch()} />
        ) : baselines.data.baselines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No baselines yet. Open a finished scan → Reports → Visual → &quot;Use as baseline&quot;.
          </p>
        ) : (
          <ul className="divide-y">
            {baselines.data.baselines.map((b) => (
              <BaselineRow key={b.id} baseline={b} editable={canEdit(baselines.data.myRole)} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function BaselineRow({
  baseline,
  editable,
}: {
  baseline: VisualBaselineDto;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const update = useUpdateBaseline();
  const remove = useDeleteBaseline();
  const history = useBaselineHistory(baseline.id, showHistory);

  return (
    <li className="grid gap-3 py-3 md:grid-cols-[10rem_1fr_auto]">
      <ScreenshotPreview
        id={baseline.screenshotId}
        title={`Baseline: ${baseline.pageUrl} at ${baseline.viewport}`}
      />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="truncate font-medium">{baseline.pageUrl}</p>
        <p className="text-xs text-muted-foreground">
          {baseline.viewport} · threshold {baseline.failPercent} %
          {baseline.ignoreSelectors.length
            ? ` · ignores ${baseline.ignoreSelectors.join(', ')}`
            : ''}
          {' · '}set {formatDateTime(baseline.updatedAt)}
          {baseline.createdBy ? ` by ${baseline.createdBy.name}` : ''}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-xs">
          {baseline.latest ? (
            <>
              <VisualStatusBadge status={baseline.latest.status} />
              {baseline.latest.diffPercent.toFixed(2)} % different ·{' '}
              {baseline.latest.scanId ? (
                <Link
                  to={`/scans/${baseline.latest.scanId}/reports/visual`}
                  className="underline-offset-4 hover:underline"
                >
                  {formatRelative(baseline.latest.createdAt)}
                </Link>
              ) : (
                formatRelative(baseline.latest.createdAt)
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Not compared yet: run a scan.</span>
          )}
        </p>
        {baseline.comparisons > 0 ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() => setShowHistory((s) => !s)}
            aria-expanded={showHistory}
          >
            {showHistory ? 'Hide' : 'Show'} history ({baseline.comparisons})
          </Button>
        ) : null}
        {showHistory && history.data ? (
          <ol className="space-y-1 text-xs">
            {history.data.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <VisualStatusBadge status={c.status} /> {c.diffPercent.toFixed(2)} % ·{' '}
                {c.scanId ? (
                  <Link
                    to={`/scans/${c.scanId}/reports/visual`}
                    className="underline-offset-4 hover:underline"
                  >
                    {formatDateTime(c.createdAt)}
                  </Link>
                ) : (
                  formatDateTime(c.createdAt)
                )}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      {editable ? (
        <div className="flex gap-2 md:flex-col">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Settings
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        </div>
      ) : null}
      <BaselineSettingsDialog
        open={editing}
        onOpenChange={setEditing}
        title="Baseline settings"
        description="Changing these does not change the baseline image."
        initial={{ failPercent: baseline.failPercent, ignoreSelectors: baseline.ignoreSelectors }}
        submitLabel="Save settings"
        onSubmit={async (settings) => {
          await update.mutateAsync({ id: baseline.id, ...settings });
          toast.success('Baseline settings saved.');
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this baseline?"
        description="Its comparison history is deleted too. Future scans of this page and screen size will not be compared until you set a new baseline."
        confirmLabel="Delete baseline"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(baseline.id);
          toast.success('Baseline deleted.');
        }}
      />
    </li>
  );
}
