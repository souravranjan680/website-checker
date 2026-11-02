import { useQuery } from '@tanstack/react-query';
import type { IssueHistoryDto } from '@whc/shared';
import { apiData } from '@/lib/api-client';

export const issueKeys = {
  detail: (id: string) => ['issues', 'detail', id] as const,
};

/** One issue with its tracking state and history (GET /api/issues/:id). */
export function useIssue(id: string) {
  return useQuery({
    queryKey: issueKeys.detail(id),
    queryFn: () => apiData<IssueHistoryDto>(`/api/issues/${id}`),
  });
}
