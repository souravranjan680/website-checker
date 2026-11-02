import { NavLink, Outlet, useLocation, useParams } from 'react-router';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { ScanStatusBadge } from '@/components/common/StatusBadges';
import { Skeleton } from '@/components/ui/skeleton';
import { isActive, useScan } from '@/features/scans/api';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ExportMenu } from './ExportMenu';

export const REPORT_TABS = [
  { path: 'accessibility', label: 'Accessibility', category: 'ACCESSIBILITY' },
  { path: 'ui-health', label: 'UI health', category: 'UI_HEALTH' },
  { path: 'responsive', label: 'Responsive', category: 'RESPONSIVE' },
  { path: 'performance', label: 'Performance', category: 'PERFORMANCE' },
  { path: 'seo', label: 'SEO', category: 'SEO' },
  { path: 'security', label: 'Security', category: 'SECURITY' },
  { path: 'visual', label: 'Visual' },
] as const;

/** /scans/:scanId/reports/* : header, report tabs and export; the report itself is the <Outlet>. */
export function ReportsLayout() {
  const { scanId = '' } = useParams();
  const scan = useScan(scanId);
  const { pathname } = useLocation();
  const current = REPORT_TABS.find((tab) => pathname.endsWith(`/${tab.path}`));

  if (scan.isPending) return <Skeleton className="h-96 rounded-xl" aria-label="Loading report" />;
  if (scan.isError) {
    const missing = scan.error instanceof ApiError && scan.error.status === 404;
    return (
      <ErrorState
        title={missing ? 'Scan not found' : "Couldn't load this report"}
        error={
          missing
            ? new Error("It doesn't exist, or you don't have access to its project.")
            : scan.error
        }
      />
    );
  }
  const data = scan.data;
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        back={{ to: `/scans/${data.id}`, label: 'Scan overview' }}
        title={`${current?.label ?? 'Scan'} report`}
        badge={<ScanStatusBadge status={data.status} />}
        description={
          <>
            {data.website.name} · {data.website.baseUrl} · {formatDateTime(data.queuedAt)}
          </>
        }
        actions={
          isActive(data.status) ? null : (
            <ExportMenu
              scanId={data.id}
              category={current && 'category' in current ? current.category : undefined}
            />
          )
        }
      />
      <nav aria-label="Reports" className="-mb-2 flex gap-1 overflow-x-auto border-b">
        {REPORT_TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive: on }) =>
              cn(
                '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap',
                on
                  ? 'border-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      {isActive(data.status) ? (
        <p className="text-sm text-muted-foreground">
          This scan is still running. Reports are complete once it finishes.
        </p>
      ) : null}
      <Outlet />
    </div>
  );
}
