import type { IssueHistoryDto, ReviewStatusName } from '@whc/shared';
import { CheckCircle2, Paintbrush, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ClassificationBadge } from '@/components/common/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUpdateTrackedIssue } from '@/features/scans/api';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';
import { CLASSIFICATION_HELP, REVIEW_LABEL, TRACKED_LABEL } from '@/lib/labels';
import { useIssueReviews } from './api';

/**
 * The tool's evidence (classification) next to the team's decision (review status),
 * with the append-only decision history. Only people set the review.
 */
export function ReviewCard({
  scanId,
  classification,
  tracking,
  editable,
}: {
  scanId: string;
  classification: string;
  tracking: IssueHistoryDto['tracking'];
  editable: boolean;
}) {
  const update = useUpdateTrackedIssue(scanId);
  const reviews = useIssueReviews(tracking?.id);
  const [note, setNote] = useState('');
  const noteId = useId();

  const review = async (reviewStatus: ReviewStatusName) => {
    if (!tracking) return;
    try {
      await update.mutateAsync({ id: tracking.id, reviewStatus, note: note.trim() || undefined });
      setNote('');
      toast.success(
        reviewStatus === 'UNREVIEWED'
          ? 'Review cleared.'
          : `Marked as ${REVIEW_LABEL[reviewStatus]!.toLowerCase()}.`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const current = tracking?.reviewStatus ?? 'UNREVIEWED';
  const falsePositive = tracking?.status === 'FALSE_POSITIVE';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review</CardTitle>
        <CardDescription>
          The tool reports evidence. Whether it is a defect is your team’s decision.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Automated evidence</p>
          <ClassificationBadge classification={classification} />
          <p className="text-muted-foreground">{CLASSIFICATION_HELP[classification]}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Team decision</p>
          <p className="font-medium" data-testid="review-status">
            {REVIEW_LABEL[current]}
          </p>
        </div>

        {editable && tracking ? (
          falsePositive ? (
            <p className="text-muted-foreground">
              Marked as a false positive. Reopen it to review it as a defect or as intentional.
            </p>
          ) : (
            <div className="space-y-2">
              <label htmlFor={noteId} className="text-xs font-medium text-muted-foreground">
                Note (optional, kept in the history)
              </label>
              <textarea
                id={noteId}
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                placeholder="e.g. Reproduced in Chrome on a phone"
              />
              <div className="flex flex-wrap gap-2">
                {current !== 'CONFIRMED' ? (
                  <Button
                    size="sm"
                    onClick={() => void review('CONFIRMED')}
                    disabled={update.isPending}
                  >
                    <CheckCircle2 aria-hidden="true" /> Confirm defect
                  </Button>
                ) : null}
                {current !== 'INTENTIONAL' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void review('INTENTIONAL')}
                    disabled={update.isPending}
                  >
                    <Paintbrush aria-hidden="true" /> Intentional
                  </Button>
                ) : null}
                {current !== 'UNREVIEWED' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void review('UNREVIEWED')}
                    disabled={update.isPending}
                  >
                    <RotateCcw aria-hidden="true" /> Clear review
                  </Button>
                ) : null}
              </div>
            </div>
          )
        ) : null}

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Decision history</p>
          {!tracking ? (
            <p className="text-muted-foreground">Not tracked (this scan did not finish).</p>
          ) : reviews.data && reviews.data.length > 0 ? (
            <ol className="space-y-2" aria-label="Decision history">
              {reviews.data.map((entry) => (
                <li key={entry.id} className="rounded-md border p-2">
                  <p>
                    <span className="font-medium">{entry.user?.name ?? 'A former user'}</span>{' '}
                    {entry.toReview
                      ? `set the review to “${REVIEW_LABEL[entry.toReview]}”`
                      : `changed the status to “${TRACKED_LABEL[entry.toStatus ?? '']}”`}
                    {entry.toReview && entry.toStatus
                      ? ` and the status to “${TRACKED_LABEL[entry.toStatus]}”`
                      : ''}
                  </p>
                  {entry.note ? <p className="text-muted-foreground">“{entry.note}”</p> : null}
                  <time dateTime={entry.createdAt} className="text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground">No decisions yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
