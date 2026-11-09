import type { WebsiteComparisonSiteDto } from '@whc/shared';
import { Globe, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { ErrorState } from '@/components/common/ErrorState';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { usePickerWebsites } from './api';

/**
 * One side of a comparison: the websites of the chosen project, searched and paged on the
 * server (no first-100 limit). Native radio buttons, so keyboard and screen readers work as
 * usual. The website chosen on the other side cannot be chosen here.
 */
export function WebsitePicker({
  side,
  title,
  hint,
  projectId,
  selected,
  otherId,
  otherLabel,
  error,
  onSelect,
}: {
  side: 'reference' | 'target';
  title: string;
  hint: string;
  projectId: string;
  selected: WebsiteComparisonSiteDto | null;
  otherId: string;
  otherLabel: string;
  error?: string;
  onSelect: (site: WebsiteComparisonSiteDto) => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDeferredValue(search.trim());
  const websites = usePickerWebsites({ projectId, q: q || undefined, page });
  const errorId = `${side}-website-error`;

  return (
    <fieldset
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border p-4',
        error && 'border-destructive',
      )}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <p className="-mt-1 text-sm text-muted-foreground">{hint}</p>

      {selected ? (
        <div className="rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite">
          <span className="text-muted-foreground">Selected: </span>
          <span className="font-medium">{selected.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{selected.baseUrl}</span>
        </div>
      ) : null}

      <div className="relative">
        <Search
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label={`Search ${title.toLowerCase()}`}
          placeholder="Search by name or address…"
          className="pl-8"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {websites.isPending ? (
        <Skeleton className="h-32" aria-label={`Loading websites for ${title.toLowerCase()}`} />
      ) : websites.isError ? (
        <ErrorState
          title="Couldn't load websites"
          error={websites.error}
          onRetry={() => void websites.refetch()}
        />
      ) : websites.data.data.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          {q ? (
            'No website matches this search.'
          ) : (
            <>
              This project has no websites yet.{' '}
              <Link to="/websites/new" className="underline">
                Add a website
              </Link>
            </>
          )}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {websites.data.data.map((site) => {
              const taken = site.id === otherId;
              const id = `${side}-website-${site.id}`;
              return (
                <li key={site.id}>
                  <label
                    htmlFor={id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm',
                      selected?.id === site.id && 'border-primary bg-primary/5',
                      taken && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input
                      type="radio"
                      id={id}
                      name={`${side}-website`}
                      className="mt-1"
                      checked={selected?.id === site.id}
                      disabled={taken}
                      onChange={() =>
                        onSelect({ id: site.id, name: site.name, baseUrl: site.baseUrl })
                      }
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Globe className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{site.name}</span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {site.baseUrl}
                      </span>
                      {taken ? (
                        <span className="block text-xs text-muted-foreground">
                          Already chosen as the {otherLabel}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {websites.data.meta.totalPages > 1 ? (
            <PaginationBar meta={websites.data.meta} onPageChange={setPage} />
          ) : null}
        </>
      )}

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
