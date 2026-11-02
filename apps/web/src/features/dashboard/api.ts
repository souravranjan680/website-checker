import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DashboardSummaryDto, DashboardTrendsDto } from '@whc/shared';
import { apiData, toQueryString } from '@/lib/api-client';

/** The dashboard filter bar. Dates are "YYYY-MM-DD" strings (UTC days). */
export interface DashboardFilters {
  projectId?: string;
  websiteId?: string;
  from?: string;
  to?: string;
  status?: string;
}

export const dashboardKeys = {
  summary: (filters: DashboardFilters) => ['dashboard', 'summary', filters] as const,
  trends: (filters: DashboardFilters) => ['dashboard', 'trends', filters] as const,
};

// Numbers on the dashboard change only when scans finish; 30 s of caching is plenty.
const STALE_MS = 30_000;

export function useDashboardSummary(filters: DashboardFilters) {
  return useQuery({
    queryKey: dashboardKeys.summary(filters),
    queryFn: () =>
      apiData<DashboardSummaryDto>(`/api/dashboard/summary${toQueryString({ ...filters })}`),
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });
}

export function useDashboardTrends(filters: DashboardFilters) {
  return useQuery({
    queryKey: dashboardKeys.trends(filters),
    queryFn: () =>
      apiData<DashboardTrendsDto>(`/api/dashboard/trends${toQueryString({ ...filters })}`),
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });
}
