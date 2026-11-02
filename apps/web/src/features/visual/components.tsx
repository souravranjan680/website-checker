import type { VisualComparisonDto } from '@whc/shared';
import { CheckCircle2, Diff, Equal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScreenshotPreview } from '@/features/scans/Screenshot';
import { errorMessage } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import type { BaselineSettings } from './api';

const STATUS = {
  UNCHANGED: {
    label: 'Unchanged',
    icon: Equal,
    className: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400',
  },
  MINOR: {
    label: 'Minor differences',
    icon: CheckCircle2,
    className: 'border-sky-600/40 text-sky-700 dark:text-sky-400',
  },
  CHANGED: {
    label: 'Changed',
    icon: Diff,
    className: 'border-red-600/40 text-red-700 dark:text-red-400',
  },
} as const;

/** Comparison result in words + icon (never colour alone). */
export function VisualStatusBadge({ status }: { status: VisualComparisonDto['status'] }) {
  const info = STATUS[status];
  return (
    <Badge variant="outline" className={cn('font-normal', info.className)}>
      <info.icon aria-hidden="true" />
      {info.label}
    </Badge>
  );
}

/** One sentence that explains the numbers. */
export function describeComparison(c: VisualComparisonDto): string {
  const parts = [`${c.diffPercent.toFixed(2)} % of the page differs`];
  if (c.failPercent !== null) parts.push(`threshold ${c.failPercent} %`);
  if (c.regions.length)
    parts.push(`${c.regions.length} changed area${c.regions.length === 1 ? '' : 's'}`);
  if (c.sizeChanged && c.size) {
    parts.push(
      `page size changed from ${c.size.baseline.width}×${c.size.baseline.height} to ${c.size.current.width}×${c.size.current.height}`,
    );
  }
  return `${parts.join(' · ')}.`;
}

/** Baseline, current snapshot and the diff image side by side. */
export function ComparisonImages({
  baselineScreenshotId,
  comparison,
  title,
}: {
  baselineScreenshotId: string | null;
  comparison: VisualComparisonDto | null;
  title: string;
}) {
  const column = (label: string, id: string | null, hint: string): ReactNode => (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
      {id ? (
        <ScreenshotPreview id={id} title={`${label}: ${title}`} />
      ) : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </figure>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {column('Baseline', baselineScreenshotId, 'No baseline yet.')}
      {column('This scan', comparison?.currentScreenshotId ?? null, 'Not captured.')}
      {column(
        'Differences (red)',
        comparison?.diffScreenshotId ?? null,
        baselineScreenshotId ? 'Not compared.' : 'Set a baseline to compare.',
      )}
    </div>
  );
}

/** Threshold + CSS selectors to ignore (rectangles are API-only for now). */
export function BaselineSettingsDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initial: BaselineSettings;
  submitLabel: string;
  onSubmit: (settings: BaselineSettings) => Promise<void>;
}) {
  const [failPercent, setFailPercent] = useState(String(initial.failPercent));
  const [selectors, setSelectors] = useState(initial.ignoreSelectors.join('\n'));
  const [busy, setBusy] = useState(false);
  const percent = Number(failPercent);
  const invalid = !Number.isFinite(percent) || percent < 0 || percent > 100;

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit({
        failPercent: percent,
        ignoreSelectors: selectors
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="baseline-threshold">Change threshold (% of the page)</Label>
            <Input
              id="baseline-threshold"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={failPercent}
              aria-invalid={invalid}
              onChange={(e) => setFailPercent(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Differences above this are reported as &quot;Changed&quot;; below it as
              &quot;Minor&quot;. 0.5 % is a sensible default.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="baseline-ignore">
              Ignore these elements (one CSS selector per line)
            </Label>
            <Textarea
              id="baseline-ignore"
              rows={3}
              placeholder={'.carousel\n#current-date'}
              value={selectors}
              onChange={(e) => setSelectors(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              For areas that change on every visit (dates, rotating banners, ads).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || invalid}>
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A confirmation step for actions that change or remove the baseline image. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
