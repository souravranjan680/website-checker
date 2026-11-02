import { X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useProjects } from '@/features/projects/api';
import { useWebsites } from '@/features/websites/api';

export const SCAN_STATUS_OPTIONS = [
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'PARTIAL', label: 'Partly completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'QUEUED', label: 'Queued' },
];

export const FILTER_KEYS = ['projectId', 'websiteId', 'from', 'to', 'status'] as const;
export type ScopeFilterValues = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

/**
 * Filters live in the URL (?projectId=...&from=...) so a filtered view can be
 * bookmarked or shared, and the back button works.
 */
export function useScopeFilters(extraKeys: string[] = []) {
  const [params, setParams] = useSearchParams();
  const values: Record<string, string | undefined> = {};
  for (const key of [...FILTER_KEYS, ...extraKeys]) values[key] = params.get(key) ?? undefined;

  const set = (patch: Record<string, string | undefined>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        // Changing a filter starts again at page 1.
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  const active = Object.values(values).some(Boolean);
  return { values, set, clear, active };
}

/** Project / website / date range / status selectors in one row. */
export function ScopeFilterBar({
  filters,
  showStatus = true,
  children,
}: {
  filters: ReturnType<typeof useScopeFilters>;
  showStatus?: boolean;
  children?: React.ReactNode;
}) {
  const { values, set, clear, active } = filters;
  const projects = useProjects({ pageSize: 100 });
  const websites = useWebsites({ pageSize: 100, projectId: values.projectId });

  return (
    <div className="flex flex-wrap items-end gap-3" role="search" aria-label="Filters">
      {children}
      <Field label="Project" id="filter-project">
        <NativeSelect
          id="filter-project"
          value={values.projectId ?? ''}
          onChange={(e) => set({ projectId: e.target.value || undefined, websiteId: undefined })}
        >
          <NativeSelectOption value="">All projects</NativeSelectOption>
          {projects.data?.data.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Website" id="filter-website">
        <NativeSelect
          id="filter-website"
          value={values.websiteId ?? ''}
          onChange={(e) => set({ websiteId: e.target.value || undefined })}
        >
          <NativeSelectOption value="">All websites</NativeSelectOption>
          {websites.data?.data.map((w) => (
            <NativeSelectOption key={w.id} value={w.id}>
              {w.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field label="From" id="filter-from">
        <Input
          id="filter-from"
          type="date"
          className="h-8 w-38"
          value={values.from ?? ''}
          max={values.to}
          onChange={(e) => set({ from: e.target.value || undefined })}
        />
      </Field>
      <Field label="To" id="filter-to">
        <Input
          id="filter-to"
          type="date"
          className="h-8 w-38"
          value={values.to ?? ''}
          min={values.from}
          onChange={(e) => set({ to: e.target.value || undefined })}
        />
      </Field>
      {showStatus ? (
        <Field label="Scan status" id="filter-status">
          <NativeSelect
            id="filter-status"
            value={values.status ?? ''}
            onChange={(e) => set({ status: e.target.value || undefined })}
          >
            <NativeSelectOption value="">Any status</NativeSelectOption>
            {SCAN_STATUS_OPTIONS.map((s) => (
              <NativeSelectOption key={s.value} value={s.value}>
                {s.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      {active ? (
        <Button variant="ghost" size="sm" onClick={clear}>
          <X aria-hidden="true" /> Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
