import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ProjectRole,
  ScanVisualDto,
  VisualBaselineDto,
  VisualBaselineWithWebsiteDto,
  VisualComparisonDto,
} from '@whc/shared';
import { api, apiData } from '@/lib/api-client';

export const visualKeys = {
  all: ['visual'] as const,
  overview: ['visual', 'overview'] as const,
  website: (id: string) => ['visual', 'website', id] as const,
  scan: (id: string) => ['visual', 'scan', id] as const,
  history: (id: string) => ['visual', 'history', id] as const,
};

export function useVisualOverview() {
  return useQuery({
    queryKey: visualKeys.overview,
    queryFn: () => apiData<VisualBaselineWithWebsiteDto[]>('/api/visual/baselines'),
  });
}

export function useWebsiteBaselines(websiteId: string) {
  return useQuery({
    queryKey: visualKeys.website(websiteId),
    queryFn: () =>
      apiData<{ baselines: VisualBaselineDto[]; myRole: ProjectRole }>(
        `/api/visual/websites/${websiteId}/baselines`,
      ),
  });
}

export function useScanVisual(scanId: string) {
  return useQuery({
    queryKey: visualKeys.scan(scanId),
    queryFn: () => apiData<ScanVisualDto>(`/api/visual/scans/${scanId}`),
  });
}

export function useBaselineHistory(baselineId: string, enabled: boolean) {
  return useQuery({
    queryKey: visualKeys.history(baselineId),
    queryFn: () =>
      apiData<VisualComparisonDto[]>(`/api/visual/baselines/${baselineId}/comparisons`),
    enabled,
  });
}

function useInvalidateVisual() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: visualKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['websites', 'activity'] });
  };
}

export interface BaselineSettings {
  failPercent: number;
  ignoreSelectors: string[];
}

export function useCreateBaseline(websiteId: string) {
  const invalidate = useInvalidateVisual();
  return useMutation({
    mutationFn: (input: BaselineSettings & { screenshotId: string }) =>
      apiData<VisualBaselineDto>(`/api/visual/websites/${websiteId}/baselines`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateBaseline() {
  const invalidate = useInvalidateVisual();
  return useMutation({
    mutationFn: ({ id, ...input }: BaselineSettings & { id: string }) =>
      apiData<VisualBaselineDto>(`/api/visual/baselines/${id}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useReplaceBaseline() {
  const invalidate = useInvalidateVisual();
  return useMutation({
    mutationFn: ({ id, screenshotId }: { id: string; screenshotId: string }) =>
      apiData<VisualBaselineDto>(`/api/visual/baselines/${id}/replace`, {
        method: 'POST',
        body: { screenshotId },
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteBaseline() {
  const invalidate = useInvalidateVisual();
  return useMutation({
    mutationFn: (id: string) => api(`/api/visual/baselines/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
