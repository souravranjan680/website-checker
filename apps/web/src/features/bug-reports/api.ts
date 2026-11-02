import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BugReportDto, Paginated } from '@whc/shared';
import { api, apiData, toQueryString } from '@/lib/api-client';

export const bugReportKeys = {
  all: ['bug-reports'] as const,
  list: (params: object) => ['bug-reports', 'list', params] as const,
  detail: (id: string) => ['bug-reports', 'detail', id] as const,
};

export function useBugReports(params: {
  page?: number;
  q?: string;
  status?: string;
  projectId?: string;
}) {
  return useQuery({
    queryKey: bugReportKeys.list(params),
    queryFn: () => api<Paginated<BugReportDto>>(`/api/bug-reports${toQueryString(params)}`),
    placeholderData: keepPreviousData,
  });
}

export function useBugReport(id: string) {
  return useQuery({
    queryKey: bugReportKeys.detail(id),
    queryFn: () => apiData<BugReportDto>(`/api/bug-reports/${id}`),
  });
}

/** Creates a report from an issue (or returns the existing open one). */
export function useCreateBugReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (issueId: string) => {
      const res = await api<{ data: BugReportDto; meta: { created: boolean } }>(
        '/api/bug-reports',
        {
          method: 'POST',
          body: { issueId },
        },
      );
      return { report: res.data, created: res.meta.created };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bugReportKeys.all }),
  });
}

export type BugReportUpdate = Partial<
  Pick<
    BugReportDto,
    | 'title'
    | 'description'
    | 'priority'
    | 'status'
    | 'stepsToReproduce'
    | 'expectedBehavior'
    | 'actualBehavior'
    | 'suggestedFix'
  >
>;

export function useUpdateBugReport(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BugReportUpdate) =>
      apiData<BugReportDto>(`/api/bug-reports/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (data) => {
      queryClient.setQueryData(bugReportKeys.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: ['bug-reports', 'list'] });
    },
  });
}

export function useDeleteBugReport(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/bug-reports/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: bugReportKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: bugReportKeys.all });
    },
  });
}
