import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto, Paginated } from '@whc/shared';
import { api, apiData, toQueryString } from '@/lib/api-client';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (params: object) => ['notifications', 'list', params] as const,
  unread: ['notifications', 'unread'] as const,
};

/** Polled every 30 s so the bell updates when a scan finishes. */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: () => apiData<{ count: number }>('/api/notifications/unread-count'),
    refetchInterval: 30_000,
  });
}

export function useNotifications(params: { page?: number; pageSize?: number; unread?: boolean }) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () =>
      api<Paginated<NotificationDto>>(
        `/api/notifications${toQueryString({ ...params, unread: params.unread ? 'true' : undefined })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiData<{ updated: number }>('/api/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
