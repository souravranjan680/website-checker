import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiInsightDto, AiStatusDto } from '@whc/shared';
import { api, apiData } from '@/lib/api-client';

export const aiKeys = {
  status: ['ai', 'status'] as const,
  insight: (issueId: string) => ['ai', 'insight', issueId] as const,
};

export function useAiStatus() {
  return useQuery({
    queryKey: aiKeys.status,
    queryFn: () => apiData<AiStatusDto>('/api/ai/status'),
    staleTime: 60_000,
  });
}

/** A saved explanation (never triggers an AI call). */
export function useAiInsight(issueId: string) {
  return useQuery({
    queryKey: aiKeys.insight(issueId),
    queryFn: () => apiData<AiInsightDto | null>(`/api/ai/issues/${issueId}`),
  });
}

export function useExplainIssue(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (
        await api<{ data: AiInsightDto; meta: { cached: boolean } }>(
          `/api/ai/issues/${issueId}/explain`,
          { method: 'POST' },
        )
      ).data,
    onSuccess: (insight) => {
      queryClient.setQueryData(aiKeys.insight(issueId), insight);
      void queryClient.invalidateQueries({ queryKey: aiKeys.status });
    },
  });
}
