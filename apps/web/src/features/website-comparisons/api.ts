import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Paginated, WebsiteComparisonListItemDto } from '@whc/shared';
import { api, toQueryString } from '@/lib/api-client';

/**
 * Website comparisons (Phase 9, Milestone 4: Mode 2). Only the parameters the API accepts
 * are sent: it rejects unknown ones (toQueryString also drops empty values).
 */
export const websiteComparisonKeys = {
  all: ['website-comparisons'] as const,
  list: (params: object) => ['website-comparisons', 'list', params] as const,
};

export interface WebsiteComparisonListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  projectId?: string;
  /** Default on the server: 'false' (not archived). */
  archived?: 'true' | 'false' | 'all';
}

export function useWebsiteComparisons(params: WebsiteComparisonListParams = {}) {
  const query = {
    page: params.page,
    pageSize: params.pageSize,
    q: params.q,
    projectId: params.projectId,
    archived: params.archived,
  };
  return useQuery({
    queryKey: websiteComparisonKeys.list(query),
    queryFn: () =>
      api<Paginated<WebsiteComparisonListItemDto>>(
        `/api/website-comparisons${toQueryString(query)}`,
      ),
    placeholderData: keepPreviousData,
  });
}
