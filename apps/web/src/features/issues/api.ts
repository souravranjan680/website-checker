import { useQuery } from '@tanstack/react-query';
import type { IssueHistoryDto, IssueReviewDto } from '@whc/shared';
import { apiData } from '@/lib/api-client';

export const issueKeys = {
  detail: (id: string) => ['issues', 'detail', id] as const,
  reviews: (trackedId: string) => ['issues', 'reviews', trackedId] as const,
};

/** Review decisions on a tracked problem, oldest first (append-only). */
export function useIssueReviews(trackedId: string | undefined) {
  return useQuery({
    queryKey: issueKeys.reviews(trackedId ?? ''),
    queryFn: () => apiData<IssueReviewDto[]>(`/api/tracked-issues/${trackedId}/reviews`),
    enabled: Boolean(trackedId),
  });
}

/** One issue with its tracking state and history (GET /api/issues/:id). */
export function useIssue(id: string) {
  return useQuery({
    queryKey: issueKeys.detail(id),
    queryFn: () => apiData<IssueHistoryDto>(`/api/issues/${id}`),
  });
}
