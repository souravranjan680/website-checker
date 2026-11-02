import type { ScanVisualDto } from '@whc/shared';
import { Images } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { canEdit } from '@/components/common/RoleBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCreateBaseline, useReplaceBaseline, useScanVisual } from './api';
import {
  BaselineSettingsDialog,
  ComparisonImages,
  ConfirmDialog,
  describeComparison,
  VisualStatusBadge,
} from './components';

/**
 * Visual snapshots of one scan. Each snapshot is compared with its baseline if the
 * page + screen size has one. Baselines change only when someone clicks the buttons here.
 */
export function VisualReport() {
  const { scanId = '' } = useParams();
  const visual = useScanVisual(scanId);
  if (visual.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (visual.isError)
    return <ErrorState error={visual.error} onRetry={() => void visual.refetch()} />;
  const v = visual.data;
  if (v.snapshots.length === 0) {
    return (
      <EmptyState
        icon={Images}
        title="No visual snapshots in this scan"
        description="Snapshots are taken of the first pages of each scan (desktop and mobile). Scans made before Phase 6, or with snapshots switched off, have none."
      />
    );
  }
  const changed = v.snapshots.filter((s) => s.comparison?.status === 'CHANGED').length;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {v.snapshots.length} snapshot{v.snapshots.length === 1 ? '' : 's'}
        {v.snapshots.some((s) => s.comparison)
          ? `, ${changed} changed compared with the baseline.`
          : '. None has a baseline yet: choose "Use as baseline" to start comparing future scans.'}{' '}
        Small rendering noise (font smoothing, single pixels) is ignored. Baselines never change by
        themselves.
      </p>
      {v.snapshots.map((snapshot) => (
        <SnapshotCard key={snapshot.screenshotId} visual={v} snapshot={snapshot} />
      ))}
    </div>
  );
}

function SnapshotCard({
  visual,
  snapshot,
}: {
  visual: ScanVisualDto;
  snapshot: ScanVisualDto['snapshots'][number];
}) {
  const editable = canEdit(visual.myRole);
  const create = useCreateBaseline(visual.websiteId);
  const replace = useReplaceBaseline();
  const [creating, setCreating] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const title = `${snapshot.pageUrl} at ${snapshot.viewport}`;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className="truncate">{snapshot.pageUrl}</span>
            {snapshot.comparison ? <VisualStatusBadge status={snapshot.comparison.status} /> : null}
          </CardTitle>
          <CardDescription>
            {snapshot.viewport} ·{' '}
            {snapshot.comparison
              ? describeComparison(snapshot.comparison)
              : snapshot.baseline
                ? 'Has a baseline, but this snapshot was not compared.'
                : 'No baseline for this page and screen size.'}
          </CardDescription>
        </div>
        {editable ? (
          snapshot.baseline ? (
            snapshot.comparison && snapshot.comparison.status !== 'UNCHANGED' ? (
              <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
                Accept as new baseline
              </Button>
            ) : null
          ) : (
            <Button size="sm" onClick={() => setCreating(true)}>
              Use as baseline
            </Button>
          )
        ) : null}
      </CardHeader>
      <CardContent>
        <ComparisonImages
          baselineScreenshotId={snapshot.baseline?.screenshotId ?? null}
          comparison={
            snapshot.comparison ?? {
              // Not compared: still show this scan's snapshot in the middle column.
              id: '',
              scanId: visual.scanId,
              status: 'UNCHANGED',
              passed: true,
              diffPercent: 0,
              diffPixels: 0,
              totalPixels: 0,
              currentScreenshotId: snapshot.screenshotId,
              diffScreenshotId: null,
              regions: [],
              sizeChanged: false,
              size: null,
              failPercent: null,
              createdAt: '',
            }
          }
          title={title}
        />
      </CardContent>
      <BaselineSettingsDialog
        open={creating}
        onOpenChange={setCreating}
        title="Use this snapshot as the baseline"
        description={`Future scans of ${title} will be compared with this image. You can change or replace it later.`}
        initial={{ failPercent: 0.5, ignoreSelectors: [] }}
        submitLabel="Save baseline"
        onSubmit={async (settings) => {
          await create.mutateAsync({ screenshotId: snapshot.screenshotId, ...settings });
          toast.success('Baseline saved.');
        }}
      />
      {snapshot.baseline ? (
        <ConfirmDialog
          open={replacing}
          onOpenChange={setReplacing}
          title="Accept this snapshot as the new baseline?"
          description="Use this when the change is intended (e.g. a redesign). Future scans will be compared with this snapshot instead; the old baseline image is removed."
          confirmLabel="Replace baseline"
          onConfirm={async () => {
            await replace.mutateAsync({
              id: snapshot.baseline!.id,
              screenshotId: snapshot.screenshotId,
            });
            toast.success('Baseline replaced.');
          }}
        />
      ) : null}
    </Card>
  );
}
