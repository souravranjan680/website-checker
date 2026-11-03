import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccessibilityReportDto,
  ManualCheckState,
  PerformanceReportDto,
  ResponsiveReportDto,
  SecurityReportDto,
  FunctionalReportDto,
  SeoReportDto,
  UiHealthReportDto,
} from '@whc/shared';
import { apiData } from '@/lib/api-client';

export const reportKeys = {
  report: (scanId: string, kind: string) => ['reports', scanId, kind] as const,
};

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

export function useSeoReport(scanId: string) {
  return useQuery({
    queryKey: reportKeys.report(scanId, 'seo'),
    queryFn: () => apiData<SeoReportDto>(`/api/reports/${scanId}/seo`),
  });
}

export function useFunctionalReport(scanId: string) {
  return useQuery({
    queryKey: reportKeys.report(scanId, 'functional'),
    queryFn: () => apiData<FunctionalReportDto>(`/api/reports/${scanId}/functional`),
  });
}

export function useSecurityReport(scanId: string) {
  return useQuery({
    queryKey: reportKeys.report(scanId, 'security'),
    queryFn: () => apiData<SecurityReportDto>(`/api/reports/${scanId}/security`),
  });
}

export function usePerformanceReport(scanId: string) {
  return useQuery({
    queryKey: reportKeys.report(scanId, 'performance'),
    queryFn: () => apiData<PerformanceReportDto>(`/api/reports/${scanId}/performance`),
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
