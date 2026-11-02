import type { IssueDto } from '@whc/shared';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/form-errors';
import { useUpdateTrackedIssue } from './api';
import { ScreenshotPreview } from './Screenshot';

const TRACKED_LABEL: Record<string, string> = {
  OPEN: 'Open',
  RESOLVED: 'Resolved',
  IGNORED: 'Ignored',
  FALSE_POSITIVE: 'False positive',
};

/**
 * Issues of a scan. Each row expands (native <details>, keyboard accessible) to show
 * where the problem is (selector, HTML, screenshot) and how to fix it.
 * HTML from the scanned site is shown as TEXT only: it is untrusted.
 */
export function IssueList({
  scanId,
  issues,
  canEdit,
  pageWidths,
}: {
  scanId: string;
  issues: IssueDto[];
  canEdit: boolean;
  pageWidths: Map<string, number>;
}) {
  const update = useUpdateTrackedIssue(scanId);
  const setStatus = async (id: string, status: 'OPEN' | 'IGNORED' | 'FALSE_POSITIVE') => {
    try {
      await update.mutateAsync({ id, status });
      toast.success(
        status === 'OPEN'
          ? 'Issue reopened.'
          : `Marked as ${TRACKED_LABEL[status]!.toLowerCase()}.`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <ul className="divide-y rounded-lg border">
      {issues.map((issue) => (
        <li key={issue.id}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-start gap-3 p-3 hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">{issue.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {issue.pageUrl}
                  {issue.viewport && issue.viewport !== '1920x1080' ? ` · ${issue.viewport}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                {issue.accessibility?.detection === 'NEEDS_REVIEW' ? (
                  <Badge variant="secondary">Needs review</Badge>
                ) : null}
                {issue.tracked && issue.tracked.status !== 'OPEN' ? (
                  <Badge variant="secondary">{TRACKED_LABEL[issue.tracked.status]}</Badge>
                ) : null}
                <SeverityBadge severity={issue.severity} />
              </div>
            </summary>

            <div className="grid gap-4 border-t bg-muted/20 p-4 text-sm lg:grid-cols-2">
              <div className="space-y-3">
                <p>{issue.description}</p>
                <dl className="grid gap-1.5">
                  <Row label="Rule">
                    <code className="text-xs">{issue.ruleId}</code>
                  </Row>
                  {issue.accessibility?.wcagCriteria.length ? (
                    <Row label="WCAG">
                      {issue.accessibility.wcagCriteria.join(', ')}
                      {issue.accessibility.wcagLevel
                        ? ` (level ${issue.accessibility.wcagLevel})`
                        : ''}
                    </Row>
                  ) : null}
                  {issue.viewport ? <Row label="Screen size">{issue.viewport}</Row> : null}
                  {issue.uiHealth?.resourceUrl ? (
                    <Row label="Resource">
                      <span className="break-all">{issue.uiHealth.resourceUrl}</span>
                    </Row>
                  ) : null}
                  {issue.tracked ? (
                    <Row label="History">
                      Seen in {issue.tracked.occurrenceCount} scan
                      {issue.tracked.occurrenceCount === 1 ? '' : 's'}
                    </Row>
                  ) : null}
                </dl>
                {issue.selector ? (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">CSS selector</p>
                    <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
                      {issue.selector}
                    </pre>
                  </div>
                ) : null}
                {issue.htmlSnippet ? (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">HTML</p>
                    <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                      {issue.htmlSnippet}
                    </pre>
                  </div>
                ) : null}
                {issue.suggestedFix ? (
                  <div>
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
                    className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                  >
                    Rule guidance (Deque) <ExternalLink className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : null}
                {canEdit && issue.tracked ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {issue.tracked.status === 'OPEN' || issue.tracked.status === 'RESOLVED' ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void setStatus(issue.tracked!.id, 'IGNORED')}
                        >
                          Ignore
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void setStatus(issue.tracked!.id, 'FALSE_POSITIVE')}
                        >
                          False positive
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void setStatus(issue.tracked!.id, 'OPEN')}
                      >
                        Reopen
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
              <div>
                {issue.screenshotId ? (
                  <ScreenshotPreview id={issue.screenshotId} title={issue.title} />
                ) : issue.pageScreenshotId && issue.boundingBox ? (
                  <ScreenshotPreview
                    id={issue.pageScreenshotId}
                    title={issue.title}
                    box={issue.boundingBox}
                    imageWidth={issue.pageId ? pageWidths.get(issue.pageScreenshotId) : undefined}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No screenshot for this kind of issue.
                  </p>
                )}
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
