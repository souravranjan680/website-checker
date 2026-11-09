import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateWebsiteComparisonInput,
  Paginated,
  WebsiteComparisonDto,
  WebsiteComparisonListItemDto,
  WebsiteDto,
} from '@whc/shared';
import { api, apiData, toQueryString } from '@/lib/api-client';

/**
 * Website comparisons (Phase 9, Milestone 4: Mode 2). Only the parameters the API accepts
 * are sent: it rejects unknown ones (toQueryString also drops empty values).
 */
export const websiteComparisonKeys = {
  all: ['website-comparisons'] as const,
  list: (params: object) => ['website-comparisons', 'list', params] as const,
  pickerWebsites: (params: object) => ['website-comparisons', 'picker-websites', params] as const,
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

/**
 * Websites of one project for the website picker, searched and paged by the existing
 * GET /api/websites (projectId, q on name and address, page, pageSize): never limited to
 * a first batch. Nothing is loaded until a project is chosen.
 */
export function usePickerWebsites(params: { projectId: string; q?: string; page: number }) {
  const query = { projectId: params.projectId, q: params.q, page: params.page, pageSize: 10 };
  return useQuery({
    queryKey: websiteComparisonKeys.pickerWebsites(query),
    queryFn: () => api<Paginated<WebsiteDto>>(`/api/websites${toQueryString(query)}`),
    enabled: Boolean(params.projectId),
    placeholderData: keepPreviousData,
  });
}

export function useCreateWebsiteComparison() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebsiteComparisonInput) =>
      apiData<WebsiteComparisonDto>('/api/website-comparisons', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: websiteComparisonKeys.all });
    },
  });
}
