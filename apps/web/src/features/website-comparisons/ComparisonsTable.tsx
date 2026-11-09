import type { WebsiteComparisonListItemDto, WebsiteComparisonSiteDto } from '@whc/shared';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatRelative } from '@/lib/format';
import { ComparisonStateBadge } from './ComparisonStateBadge';

function Site({ site, role }: { site: WebsiteComparisonSiteDto; role: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs text-muted-foreground">{role}</span>
      <Link to={`/websites/${site.id}`} className="block truncate font-medium hover:underline">
        {site.name}
      </Link>
      <span className="block truncate text-xs text-muted-foreground">{site.baseUrl}</span>
    </div>
  );
}

export function ComparisonsTable({ comparisons }: { comparisons: WebsiteComparisonListItemDto[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Comparison</TableHead>
          <TableHead>Websites</TableHead>
          <TableHead className="hidden md:table-cell">Project</TableHead>
          <TableHead>State</TableHead>
          <TableHead className="hidden md:table-cell">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {comparisons.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="max-w-56 align-top">
              <Link
                to={`/website-comparisons/${c.id}`}
                className="block truncate font-medium hover:underline"
              >
                {c.name}
              </Link>
              {/* Small screens: the project is shown here instead of in its own column. */}
              <span className="block truncate text-xs text-muted-foreground md:hidden">
                {c.projectName}
              </span>
            </TableCell>
            <TableCell className="align-top">
              <div className="flex max-w-md flex-col gap-2 sm:flex-row sm:items-center">
                <Site site={c.reference} role="Reference" />
                <ArrowRight
                  className="hidden size-4 shrink-0 text-muted-foreground sm:block"
                  aria-label="compared with"
                />
                <Site site={c.target} role="Target" />
              </div>
            </TableCell>
            <TableCell className="hidden align-top md:table-cell">
              <Link to={`/projects/${c.projectId}`} className="text-sm hover:underline">
                {c.projectName}
              </Link>
            </TableCell>
            <TableCell className="align-top">
              <ComparisonStateBadge state={c.state} />
            </TableCell>
            <TableCell
              className="hidden align-top text-sm text-muted-foreground md:table-cell"
              title={formatDate(c.updatedAt)}
            >
              {formatRelative(c.updatedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
