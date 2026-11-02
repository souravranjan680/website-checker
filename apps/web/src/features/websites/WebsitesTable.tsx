import type { WebsiteDto } from '@whc/shared';
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
import { VerificationBadge } from './VerificationBadge';

export function WebsitesTable({
  websites,
  showProject = true,
}: {
  websites: WebsiteDto[];
  showProject?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Website</TableHead>
          {showProject ? <TableHead>Project</TableHead> : null}
          <TableHead>Verification</TableHead>
          <TableHead>Last scan</TableHead>
          <TableHead className="hidden md:table-cell">Added</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {websites.map((website) => (
          <TableRow key={website.id}>
            <TableCell className="max-w-72">
              <Link
                to={`/websites/${website.id}`}
                className="block truncate font-medium hover:underline"
              >
                {website.name}
              </Link>
              <span className="block truncate text-xs text-muted-foreground">
                {website.baseUrl}
              </span>
            </TableCell>
            {showProject ? (
              <TableCell>
                <Link to={`/projects/${website.projectId}`} className="text-sm hover:underline">
                  {website.projectName}
                </Link>
              </TableCell>
            ) : null}
            <TableCell>
              <VerificationBadge status={website.verificationStatus} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {website.lastScan ? formatRelative(website.lastScan.createdAt) : 'Never scanned'}
            </TableCell>
            <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
              {formatDate(website.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
