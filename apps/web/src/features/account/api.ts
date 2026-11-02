import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationPreferences, SessionDto, UserDto } from '@whc/shared';
import { api, apiData } from '@/lib/api-client';
import { ME_QUERY_KEY } from '@/features/auth/auth-context';

export const accountKeys = {
  sessions: ['account', 'sessions'] as const,
  preferences: ['account', 'preferences'] as const,
};

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      apiData<{ user: UserDto }>('/api/auth/me', { method: 'PATCH', body: input }),
    // The header shows the name too: update the cached "who am I" right away.
    onSuccess: ({ user }) => queryClient.setQueryData(ME_QUERY_KEY, user),
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api('/api/auth/change-password', { method: 'POST', body: input }),
    // Changing the password signs out every other device.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: accountKeys.sessions,
    queryFn: () => apiData<SessionDto[]>('/api/auth/sessions'),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiData<{ revoked: number }>('/api/auth/sessions/others', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
}

export function usePreferences() {
  return useQuery({
    queryKey: accountKeys.preferences,
    queryFn: () => apiData<NotificationPreferences>('/api/auth/preferences'),
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationPreferences) =>
      apiData<NotificationPreferences>('/api/auth/preferences', { method: 'PUT', body: input }),
    onSuccess: (data) => queryClient.setQueryData(accountKeys.preferences, data),
  });
}
