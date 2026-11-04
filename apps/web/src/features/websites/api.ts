import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityDto,
  CreateWebsiteInput,
  Paginated,
  ScanSummaryDto,
  TrackedIssueDto,
  UpdateWebsiteInput,
  WebsiteDto,
  WebsiteStatsDto,
} from '@whc/shared';
import { api, apiData, toQueryString } from '@/lib/api-client';

export const websiteKeys = {
  all: ['websites'] as const,
  list: (params: object) => ['websites', 'list', params] as const,
  detail: (id: string) => ['websites', 'detail', id] as const,
  scans: (id: string, page: number) => ['websites', 'scans', id, page] as const,
  stats: (id: string) => ['websites', 'stats', id] as const,
  issues: (id: string, params: object) => ['websites', 'issues', id, params] as const,
  activity: (id: string) => ['websites', 'activity', id] as const,
};

export function useWebsites(
  params: { page?: number; pageSize?: number; q?: string; projectId?: string } = {},
) {
  return useQuery({
    queryKey: websiteKeys.list(params),
    queryFn: () => api<Paginated<WebsiteDto>>(`/api/websites${toQueryString(params)}`),
    placeholderData: keepPreviousData,
  });
}

export function useWebsite(id: string) {
  return useQuery({
    queryKey: websiteKeys.detail(id),
    queryFn: () => apiData<WebsiteDto>(`/api/websites/${id}`),
  });
}

/** Scan count, latest scores and tracked-issue counts for the website page. */
export function useWebsiteStats(id: string) {
  return useQuery({
    queryKey: websiteKeys.stats(id),
    queryFn: () => apiData<WebsiteStatsDto>(`/api/websites/${id}/stats`),
  });
}

/** Problems tracked across all scans of the website (one row per problem). */
export function useWebsiteIssues(
  id: string,
  params: {
    status?: string;
    category?: string;
    severity?: string;
    browser?: string;
    q?: string;
    page?: number;
  },
) {
  return useQuery({
    queryKey: websiteKeys.issues(id, params),
    queryFn: () =>
      api<Paginated<TrackedIssueDto>>(`/api/websites/${id}/issues${toQueryString(params)}`),
    placeholderData: keepPreviousData,
  });
}

export function useWebsiteActivity(id: string) {
  return useQuery({
    queryKey: websiteKeys.activity(id),
    queryFn: () =>
      api<Paginated<ActivityDto>>(`/api/activity${toQueryString({ websiteId: id, pageSize: 10 })}`),
  });
}

/** Real scan history, newest first. */
export function useWebsiteScans(id: string, page = 1) {
  return useQuery({
    queryKey: websiteKeys.scans(id, page),
    queryFn: () =>
      api<Paginated<ScanSummaryDto>>(`/api/websites/${id}/scans${toQueryString({ page })}`),
  });
}

function useInvalidateAfterWebsiteChange() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: websiteKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['projects'] }); // counts + activity change too
  };
}

export function useCreateWebsite() {
  const invalidate = useInvalidateAfterWebsiteChange();
  return useMutation({
    mutationFn: (input: CreateWebsiteInput) =>
      apiData<WebsiteDto>('/api/websites', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateWebsite(id: string) {
  const invalidate = useInvalidateAfterWebsiteChange();
  return useMutation({
    mutationFn: (input: UpdateWebsiteInput) =>
      apiData<WebsiteDto>(`/api/websites/${id}`, { method: 'PUT', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteWebsite(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAfterWebsiteChange();
  return useMutation({
    mutationFn: () => api(`/api/websites/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: websiteKeys.detail(id) });
      invalidate();
    },
  });
}
