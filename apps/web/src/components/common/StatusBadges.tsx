import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Info,
  Loader2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Severity and status always use an icon AND a word, never colour alone.
const SEVERITY: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  CRITICAL: {
    label: 'Critical',
    icon: AlertOctagon,
    className: 'border-red-600/40 text-red-700 dark:text-red-400',
  },
  HIGH: {
    label: 'High',
    icon: AlertTriangle,
    className: 'border-orange-600/40 text-orange-700 dark:text-orange-400',
  },
  MEDIUM: {
    label: 'Medium',
    icon: AlertTriangle,
    className: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  },
  LOW: { label: 'Low', icon: Info, className: 'border-sky-600/40 text-sky-700 dark:text-sky-400' },
  INFO: { label: 'Info', icon: Info, className: 'text-muted-foreground' },
};

export function SeverityBadge({ severity }: { severity: string }) {
  const info = SEVERITY[severity] ?? SEVERITY.INFO!;
  return (
    <Badge variant="outline" className={cn('font-normal', info.className)}>
      <info.icon aria-hidden="true" />
      {info.label}
    </Badge>
  );
}

const STATUS: Record<
  string,
  { label: string; icon: LucideIcon; spin?: boolean; className: string }
> = {
  QUEUED: { label: 'Queued', icon: CircleDashed, className: 'text-muted-foreground' },
  RUNNING: {
    label: 'Running',
    icon: Loader2,
    spin: true,
    className: 'border-sky-600/40 text-sky-700 dark:text-sky-400',
  },
  CANCELLING: {
    label: 'Cancelling',
    icon: Loader2,
    spin: true,
    className: 'text-muted-foreground',
  },
  CANCELLED: { label: 'Cancelled', icon: Ban, className: 'text-muted-foreground' },
  COMPLETED: {
    label: 'Completed',
    icon: CheckCircle2,
    className: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400',
  },
  PARTIAL: {
    label: 'Partly completed',
    icon: AlertTriangle,
    className: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  },
  FAILED: {
    label: 'Failed',
    icon: XCircle,
    className: 'border-red-600/40 text-red-700 dark:text-red-400',
  },
};

const LEVEL: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  CONFIRMED: {
    label: 'Confirmed',
    icon: XCircle,
    className: 'border-red-600/40 text-red-700 dark:text-red-400',
  },
  WARNING: {
    label: 'Warning',
    icon: AlertTriangle,
    className: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  },
  OBSERVATION: { label: 'Observation', icon: Info, className: 'text-muted-foreground' },
};

/** How sure a security finding is. "Confirmed" = observed configuration, not an exploit. */
export function FindingLevelBadge({ level }: { level: string }) {
  const info = LEVEL[level] ?? LEVEL.OBSERVATION!;
  return (
    <Badge variant="outline" className={cn('font-normal', info.className)}>
      <info.icon aria-hidden="true" />
      {info.label}
    </Badge>
  );
}

export function ScanStatusBadge({ status }: { status: string }) {
  const info = STATUS[status] ?? STATUS.QUEUED!;
  return (
    <Badge variant="outline" className={cn('font-normal', info.className)}>
      <info.icon aria-hidden="true" className={cn(info.spin && 'animate-spin')} />
      {info.label}
    </Badge>
  );
}
