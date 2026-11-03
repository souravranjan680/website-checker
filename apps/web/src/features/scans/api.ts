import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVE_SCAN_STATUSES,
  type IssueDto,
  type Paginated,
  type ReviewStatusName,
  type ScanComparisonDto,
  type ScanDetailsDto,
  type ScanListItemDto,
  type ScanPageDto,
  type StartScanInput,
} from '@whc/shared';
import { api, apiData, toQueryString } from '@/lib/api-client';

export const scanKeys = {
  all: ['scans'] as const,
  list: (params: object) => ['scans', 'list', params] as const,
  detail: (id: string) => ['scans', 'detail', id] as const,
  pages: (id: string) => ['scans', 'pages', id] as const,
  issues: (id: string, params: object) => ['scans', 'issues', id, params] as const,
  compare: (id: string) => ['scans', 'compare', id] as const,
};

export const isActive = (status: string) =>
  (ACTIVE_SCAN_STATUSES as readonly string[]).includes(status);

export function useScan(id: string) {
  return useQuery({
    queryKey: scanKeys.detail(id),
    queryFn: () => apiData<ScanDetailsDto>(`/api/scans/${id}`),
    // Backup for the live stream: re-check every 5 s while the scan is active.
    refetchInterval: (query) =>
      query.state.data && isActive(query.state.data.status) ? 5_000 : false,
  });
}

export function useScans(params: {
  page?: number;
  pageSize?: number;
  status?: string;
  websiteId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  q?: string;
}) {
  return useQuery({
    queryKey: scanKeys.list(params),
    queryFn: () => api<Paginated<ScanListItemDto>>(`/api/scans${toQueryString(params)}`),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.data.some((s) => isActive(s.status)) ? 5_000 : false,
  });
}

export function useScanPages(id: string, enabled = true) {
  return useQuery({
    queryKey: scanKeys.pages(id),
    queryFn: () => apiData<ScanPageDto[]>(`/api/scans/${id}/pages`),
    enabled,
  });
}

export function useScanIssues(
  id: string,
  params: {
    category?: string;
    severity?: string;
    viewport?: string;
    page?: number;
    q?: string;
    trackedStatus?: string;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: scanKeys.issues(id, params),
    queryFn: () =>
      api<Paginated<IssueDto>>(
        `/api/scans/${id}/issues${toQueryString({ ...params, pageSize: 100 })}`,
      ),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Compares a scan with its previous one, or with `withId` (same website only). */
export function useScanComparison(id: string, enabled = true, withId?: string) {
  return useQuery({
    queryKey: [...scanKeys.compare(id), withId ?? null],
    queryFn: () =>
      apiData<ScanComparisonDto>(`/api/scans/${id}/compare${toQueryString({ with: withId })}`),
    enabled,
  });
}

function useInvalidateScans() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: scanKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['websites'] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };
}

export function useStartScan() {
  const invalidate = useInvalidateScans();
  return useMutation({
    mutationFn: (input: StartScanInput) =>
      apiData<ScanDetailsDto>('/api/scans', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useRescan() {
  const invalidate = useInvalidateScans();
  return useMutation({
    mutationFn: (scanId: string) =>
      apiData<ScanDetailsDto>(`/api/scans/${scanId}/rescan`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useCancelScan(scanId: string) {
  const invalidate = useInvalidateScans();
  return useMutation({
    mutationFn: () => apiData<ScanDetailsDto>(`/api/scans/${scanId}/cancel`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useUpdateTrackedIssue(scanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      status?: 'OPEN' | 'IGNORED' | 'FALSE_POSITIVE';
      reviewStatus?: ReviewStatusName;
      note?: string;
    }) => apiData(`/api/tracked-issues/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scans', 'issues', scanId] });
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      void queryClient.invalidateQueries({ queryKey: ['websites'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export const screenshotUrl = (id: string, download = false) =>
  `/api/screenshots/${id}${download ? '?download=1' : ''}`;
