import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Shown when a list has nothing in it yet, with the next step to take. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="font-medium">{title}</h2>
        <div className="max-w-md text-sm text-muted-foreground">{description}</div>
      </div>
      {action}
    </div>
  );
}
