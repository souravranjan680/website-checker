import { Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** A single number with a label (and optional explanation on hover/focus). */
export function MetricTile({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: number | string | null;
  suffix?: string;
  hint?: string;
}) {
  return (
    <Card className="gap-1 py-3">
      <CardContent className="px-4">
        <dt className="flex items-center gap-1 text-xs text-muted-foreground">
          {label}
          {hint ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="rounded-sm" aria-label={`About ${label}`}>
                  <Info className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-60">{hint}</TooltipContent>
            </Tooltip>
          ) : null}
        </dt>
        <dd className="text-2xl font-semibold tabular-nums">
          {value === null ? (
            <span className="text-base font-normal text-muted-foreground">Not measured</span>
          ) : (
            <>
              {value}
              {suffix ? (
                <span className="text-sm font-normal text-muted-foreground">{suffix}</span>
              ) : null}
            </>
          )}
        </dd>
      </CardContent>
    </Card>
  );
}
