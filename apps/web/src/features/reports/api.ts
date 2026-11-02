import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccessibilityReportDto,
  ManualCheckState,
  PendingReportDto,
  ResponsiveReportDto,
  UiHealthReportDto,
} from '@whc/shared';
import { apiData } from '@/lib/api-client';

export const reportKeys = {
  report: (scanId: string, kind: string) => ['reports', scanId, kind] as const,
};

export type PendingKind = 'performance' | 'seo' | 'security';

export function useAccessibilityReport(scanId: string) {
  return useQuery({
    queryKey: reportKeys.report(scanId, 'accessibility'),
    queryFn: () => apiData<AccessibilityReportDto>(`/api/reports/${scanId}/accessibility`),
  });
}

export function useUiHealthReport(scanId: string) {
  return useQuery({
    queryKey: reportKeys.report(scanId, 'ui-health'),
    queryFn: () => apiData<UiHealthReportDto>(`/api/reports/${scanId}/ui-health`),
  });
}

export function useResponsiveReport(scanId: string) {
  return useQuery({
    queryKey: reportKeys.report(scanId, 'responsive'),
    queryFn: () => apiData<ResponsiveReportDto>(`/api/reports/${scanId}/responsive`),
  });
}

export function usePendingReport(scanId: string, kind: PendingKind) {
  return useQuery({
    queryKey: reportKeys.report(scanId, kind),
    queryFn: () => apiData<PendingReportDto>(`/api/reports/${scanId}/${kind}`),
  });
}

export function useUpdateChecklist(scanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemId: string; status: ManualCheckState['status']; note?: string }) =>
      apiData<Record<string, ManualCheckState>>(`/api/reports/${scanId}/accessibility/checklist`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: reportKeys.report(scanId, 'accessibility') }),
  });
}
