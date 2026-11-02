import type { WebsiteDto } from '@whc/shared';
import { CircleDashed, Clock, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function VerificationBadge({ status }: { status: WebsiteDto['verificationStatus'] }) {
  if (status === 'VERIFIED') {
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/40 font-normal text-emerald-700 dark:text-emerald-400"
      >
        <ShieldCheck aria-hidden="true" /> Verified
      </Badge>
    );
  }
  if (status === 'PENDING') {
    return (
      <Badge variant="outline" className="font-normal">
        <Clock aria-hidden="true" /> Pending
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      <CircleDashed aria-hidden="true" /> Unverified
    </Badge>
  );
}
