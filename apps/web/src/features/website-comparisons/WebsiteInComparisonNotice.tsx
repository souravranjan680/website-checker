import { GitCompareArrows } from 'lucide-react';
import { Link } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/lib/api-client';

export interface WebsiteInComparisonInfo {
  count: number;
  comparisons: { id: string; name: string }[];
}

/**
 * The comparisons named by a refused website delete or move (409 WEBSITE_IN_COMPARISON,
 * Milestone 4), read defensively from the server's details; null for any other error.
 */
export function websiteInComparisonInfo(error: unknown): WebsiteInComparisonInfo | null {
  if (!(error instanceof ApiError) || error.code !== 'WEBSITE_IN_COMPARISON') return null;
  const info = (error.info ?? {}) as { count?: unknown; comparisons?: unknown };
  const comparisons = Array.isArray(info.comparisons)
    ? info.comparisons.filter(
        (c): c is { id: string; name: string } =>
          typeof c === 'object' &&
          c !== null &&
          typeof (c as { id?: unknown }).id === 'string' &&
          typeof (c as { name?: unknown }).name === 'string',
      )
    : [];
  const count =
    typeof info.count === 'number' && info.count >= comparisons.length
      ? info.count
      : comparisons.length;
  return { count, comparisons };
}

/** Why the website cannot be deleted or moved, with links to the comparisons that use it. */
export function WebsiteInComparisonNotice({
  info,
  action,
}: {
  info: WebsiteInComparisonInfo;
  action: 'deleted' | 'moved to another project';
}) {
  const more = info.count - info.comparisons.length;
  return (
    <Alert role="alert">
      <GitCompareArrows aria-hidden="true" />
      <AlertTitle>
        {/* No count when the API sent none (a refusal by the database without a list). */}
        {info.count > 0
          ? `Used by ${info.count} website comparison${info.count === 1 ? '' : 's'}`
          : 'Used by website comparisons'}
      </AlertTitle>
      <AlertDescription>
        <p>
          This website cannot be {action} while comparisons use it, so their history is kept. Delete
          those comparisons first; archiving is not enough.
        </p>
        {info.comparisons.length > 0 ? (
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {info.comparisons.map((c) => (
              <li key={c.id}>
                <Link to={`/website-comparisons/${c.id}`} className="underline underline-offset-4">
                  {c.name}
                </Link>
              </li>
            ))}
            {more > 0 ? <li>and {more} more</li> : null}
          </ul>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
