import type { IssueHistoryDto } from '@whc/shared';
import {
  Bug,
  CheckCircle2,
  ExternalLink,
  Eye,
  RotateCcw,
  ShieldOff,
  SquareDashed,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { canEdit } from '@/components/common/RoleBadge';
import {
  ClassificationBadge,
  FindingLevelBadge,
  ScanStatusBadge,
  SeverityBadge,
} from '@/components/common/StatusBadges';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useScanPages, useUpdateTrackedIssue } from '@/features/scans/api';
import { ScreenshotPreview } from '@/features/scans/Screenshot';
import { CompatibilityCard } from './CompatibilityCard';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';
import { CATEGORY_LABEL, REVIEW_LABEL, TRACKED_LABEL } from '@/lib/labels';
import { AiExplanationCard } from '@/features/ai/AiExplanationCard';
import { useCreateBugReport } from '@/features/bug-reports/api';
import { useIssue } from './api';
import { ReviewCard } from './ReviewCard';

/** /issues/:issueId : everything about one detected problem, and its life across scans. */
export function IssueDetailPage() {
  const { issueId = '' } = useParams();
  const issue = useIssue(issueId);
  if (issue.isPending)
    return (
      <Skeleton className="mx-auto h-96 w-full max-w-6xl rounded-xl" aria-label="Loading issue" />
    );
  if (issue.isError) {
    const missing = issue.error instanceof ApiError && issue.error.status === 404;
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title={missing ? 'Issue not found' : "Couldn't load this issue"}
          error={
            missing
              ? new Error("It doesn't exist, or you don't have access to its project.")
              : issue.error
          }
          onRetry={missing ? undefined : () => void issue.refetch()}
        />
      </div>
    );
  }
  return <IssueView data={issue.data} />;
}

type Action = 'OPEN' | 'IGNORED' | 'FALSE_POSITIVE';

function IssueView({ data }: { data: IssueHistoryDto }) {
  const { issue, tracking } = data;
  const update = useUpdateTrackedIssue(data.scan.id);
  const pages = useScanPages(data.scan.id, Boolean(issue.pageScreenshotId));
  const [confirm, setConfirm] = useState<Action | null>(null);
  const editable = canEdit(data.myRole);
  const pageWidth = issue.pageScreenshotId
    ? pages.data?.flatMap((p) => p.screenshots).find((s) => s.id === issue.pageScreenshotId)?.width
    : undefined;

  const apply = async (status: Action) => {
    if (!tracking) return;
    try {
      await update.mutateAsync({ id: tracking.id, status });
      toast.success(
        status === 'OPEN'
          ? 'Issue reopened.'
          : `Marked as ${TRACKED_LABEL[status]!.toLowerCase()}.`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setConfirm(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        back={{ to: `/scans/${data.scan.id}`, label: `Scan of ${data.website.name}` }}
        title={issue.title}
        badge={
          <>
            <SeverityBadge severity={issue.severity} />
            <ClassificationBadge classification={issue.classification} />
            {tracking ? <Badge variant="secondary">{TRACKED_LABEL[tracking.status]}</Badge> : null}
            {tracking && tracking.reviewStatus !== 'UNREVIEWED' ? (
              <Badge variant="secondary">{REVIEW_LABEL[tracking.reviewStatus]}</Badge>
            ) : null}
          </>
        }
        description={
          <>
            {CATEGORY_LABEL[issue.category] ?? issue.category} · {data.project.name} /{' '}
            <Link to={`/websites/${data.website.id}`} className="hover:underline">
              {data.website.name}
            </Link>
          </>
        }
        actions={
          <>
            {editable ? <CreateBugReportButton issueId={issue.id} /> : null}
            {editable && tracking ? (
              tracking.status === 'OPEN' || tracking.status === 'RESOLVED' ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setConfirm('IGNORED')}
                    disabled={update.isPending}
                  >
                    <Eye aria-hidden="true" /> Ignore
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setConfirm('FALSE_POSITIVE')}
                    disabled={update.isPending}
                  >
                    <ShieldOff aria-hidden="true" /> False positive
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => void apply('OPEN')}
                  disabled={update.isPending}
                >
                  <RotateCcw aria-hidden="true" /> Reopen
                </Button>
              )
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>What is wrong</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>{issue.description}</p>
              {issue.suggestedFix ? (
                <div className="rounded-md bg-muted/60 p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">How to fix</p>
                  <p className="whitespace-pre-wrap">
                    {issue.suggestedFix.replace(/\n*Guidance: \S+$/, '')}
                  </p>
                </div>
              ) : null}
              {issue.accessibility?.helpUrl ? (
                <a
                  href={issue.accessibility.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                >
                  Rule guidance (Deque) <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : null}
            </CardContent>
          </Card>

          <AiExplanationCard issueId={issue.id} />

          <Card>
            <CardHeader>
              <CardTitle>Where</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="grid gap-2">
                <Row label="Page">
                  {issue.pageUrl ? (
                    <a
                      href={issue.pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all hover:underline"
                    >
                      {issue.pageUrl}
                    </a>
                  ) : (
                    'Whole site'
                  )}
                </Row>
                {issue.viewport ? <Row label="Screen size">{issue.viewport}</Row> : null}
                {issue.seo?.expected ? <Row label="Expected">{issue.seo.expected}</Row> : null}
                {issue.seo?.actual ? <Row label="Found">{issue.seo.actual}</Row> : null}
                {issue.security ? (
                  <Row label="Level">
                    <FindingLevelBadge level={issue.security.findingLevel} />
                  </Row>
                ) : null}
                {issue.security?.observedValue ? (
                  <Row label="Observed">
                    <span className="break-all">{issue.security.observedValue}</span>
                  </Row>
                ) : null}
                {issue.security?.recommendedValue ? (
                  <Row label="Recommended">
                    <span className="break-all">{issue.security.recommendedValue}</span>
                  </Row>
                ) : null}
                {issue.functional?.controlName ? (
                  <Row label="Control">
                    “{issue.functional.controlName}”
                    {issue.functional.controlRole ? ` (${issue.functional.controlRole})` : ''}
                  </Row>
                ) : null}
                {Array.isArray(issue.functional?.interaction?.steps) ? (
                  <Row label="What we did">
                    <ol className="list-decimal pl-4">
                      {(issue.functional.interaction.steps as unknown[])
                        .filter((step): step is string => typeof step === 'string')
                        .map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                    </ol>
                  </Row>
                ) : null}
                <Row label="Rule">
                  <code className="text-xs">{issue.ruleId}</code>
                </Row>
                {issue.accessibility?.wcagCriteria.length ? (
                  <Row label="WCAG">
                    {issue.accessibility.wcagCriteria.join(', ')}
                    {issue.accessibility.wcagLevel
                      ? ` (level ${issue.accessibility.wcagLevel})`
                      : ''}
                    {issue.accessibility.detection === 'NEEDS_REVIEW'
                      ? ' · needs manual review'
                      : ''}
                  </Row>
                ) : null}
                {issue.uiHealth?.resourceUrl ? (
                  <Row label="Resource">
                    <span className="break-all">{issue.uiHealth.resourceUrl}</span>
                    {issue.uiHealth.statusCode ? ` (HTTP ${issue.uiHealth.statusCode})` : ''}
                  </Row>
                ) : null}
                {issue.boundingBox ? (
                  <Row label="Position">
                    <span className="tabular-nums">
                      x {Math.round(issue.boundingBox.x)}, y {Math.round(issue.boundingBox.y)} ·{' '}
                      {Math.round(issue.boundingBox.width)}×{Math.round(issue.boundingBox.height)}{' '}
                      px
                    </span>
                  </Row>
                ) : null}
              </dl>
              {issue.selector ? <CodeBlock label="CSS selector">{issue.selector}</CodeBlock> : null}
              {/* Untrusted HTML from the scanned site: shown as text, never rendered. */}
              {issue.htmlSnippet ? <CodeBlock label="HTML">{issue.htmlSnippet}</CodeBlock> : null}
            </CardContent>
          </Card>

          {issue.compatibility ? <CompatibilityCard compatibility={issue.compatibility} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>Screenshot</CardTitle>
              <CardDescription>The affected element is highlighted.</CardDescription>
            </CardHeader>
            <CardContent>
              {issue.screenshotId ? (
                <ScreenshotPreview id={issue.screenshotId} title={issue.title} />
              ) : issue.pageScreenshotId && issue.boundingBox ? (
                <ScreenshotPreview
                  id={issue.pageScreenshotId}
                  title={issue.title}
                  box={issue.boundingBox}
                  imageWidth={pageWidth}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No screenshot for this kind of issue.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <ReviewCard
            scanId={data.scan.id}
            classification={issue.classification}
            tracking={tracking}
            editable={editable}
          />
          <Card>
            <CardHeader>
              <CardTitle>Tracking</CardTitle>
              <CardDescription>
                The same problem is recognised across scans by its fingerprint.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tracking ? (
                <dl className="grid gap-2 text-sm">
                  <Row label="Status">{TRACKED_LABEL[tracking.status]}</Row>
                  <Row label="First seen">{formatDateTime(tracking.firstSeenAt)}</Row>
                  <Row label="Last seen">{formatDateTime(tracking.lastSeenAt)}</Row>
                  <Row label="Seen in">{tracking.occurrenceCount} scans</Row>
                  {tracking.resolvedAt ? (
                    <Row label="Resolved">{formatDateTime(tracking.resolvedAt)}</Row>
                  ) : null}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not tracked (this scan did not finish).
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline items={data.timeline} currentIssueId={issue.id} />
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'IGNORED' ? 'Ignore this issue?' : 'Mark as false positive?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'IGNORED'
                ? 'It stays ignored in future scans and stops counting as open. You can reopen it any time.'
                : 'Use this when the tool is wrong. It stays marked in future scans and stops counting as open. You can reopen it any time.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={() => confirm && void apply(confirm)} disabled={update.isPending}>
              {confirm === 'IGNORED' ? 'Ignore issue' : 'Mark as false positive'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Timeline({
  items,
  currentIssueId,
}: {
  items: IssueHistoryDto['timeline'];
  currentIssueId: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No history.</p>;
  return (
    <ol className="relative space-y-4 border-l pl-4 text-sm">
      {items.map((item, i) => (
        <li key={i} className="relative">
          <span
            className="absolute top-1 -left-[1.4rem] flex size-3 items-center justify-center rounded-full border bg-background"
            aria-hidden="true"
          >
            {item.type === 'RESOLVED' ? (
              <CheckCircle2 className="size-3 text-emerald-600" />
            ) : (
              <SquareDashed className="size-2 text-muted-foreground" />
            )}
          </span>
          {item.type === 'DETECTED' ? (
            <p>
              Detected in{' '}
              {item.issueId && item.issueId !== currentIssueId ? (
                <Link to={`/issues/${item.issueId}`} className="underline-offset-4 hover:underline">
                  a scan
                </Link>
              ) : (
                'this scan'
              )}{' '}
              {item.scanStatus ? <ScanStatusBadge status={item.scanStatus} /> : null}
            </p>
          ) : item.type === 'REVIEWED' ? (
            <p>
              {item.user?.name ?? 'Someone'} set the review to{' '}
              <span className="font-medium">{REVIEW_LABEL[item.to ?? ''] ?? item.to}</span>
            </p>
          ) : item.type === 'STATUS_CHANGED' ? (
            <p>
              {item.user?.name ?? 'Someone'} changed status from{' '}
              {TRACKED_LABEL[item.from ?? ''] ?? item.from} to{' '}
              <span className="font-medium">{TRACKED_LABEL[item.to ?? ''] ?? item.to}</span>
            </p>
          ) : (
            <p>
              No longer detected:{' '}
              {item.scanId ? (
                <Link to={`/scans/${item.scanId}`} className="underline-offset-4 hover:underline">
                  resolved
                </Link>
              ) : (
                'resolved'
              )}
            </p>
          )}
          <time dateTime={item.at} className="text-xs text-muted-foreground">
            {formatDateTime(item.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap break-all">
        {children}
      </pre>
    </div>
  );
}

/** Builds a bug report from this issue (or opens the existing open one). */
function CreateBugReportButton({ issueId }: { issueId: string }) {
  const create = useCreateBugReport();
  const navigate = useNavigate();
  const onClick = async () => {
    try {
      const { report, created } = await create.mutateAsync(issueId);
      toast.success(created ? 'Bug report created.' : 'This issue already has an open bug report.');
      navigate(`/bug-reports/${report.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  return (
    <Button onClick={() => void onClick()} disabled={create.isPending}>
      <Bug aria-hidden="true" /> {create.isPending ? 'Creating…' : 'Create bug report'}
    </Button>
  );
}
