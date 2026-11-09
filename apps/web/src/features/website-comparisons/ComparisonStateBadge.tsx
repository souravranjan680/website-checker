import type { WebsiteComparisonStateName } from '@whc/shared';
import { Archive, CheckCircle2, CircleDashed, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// An icon AND a word, never colour alone (as the other status badges).
const STATE: Record<WebsiteComparisonStateName, { label: string; icon: LucideIcon; hint: string }> =
  {
    DRAFT: { label: 'Draft', icon: CircleDashed, hint: 'Not run yet' },
    IN_USE: { label: 'In use', icon: CheckCircle2, hint: 'Has been run' },
    ARCHIVED: { label: 'Archived', icon: Archive, hint: 'Hidden from the default list' },
  };

/** The comparison's own state (derived by the API). Not the status of a run. */
export function ComparisonStateBadge({ state }: { state: WebsiteComparisonStateName }) {
  const { label, icon: Icon, hint } = STATE[state];
  return (
    <Badge variant={state === 'ARCHIVED' ? 'outline' : 'secondary'} title={hint}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}
