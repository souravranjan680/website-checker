import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityDto,
  AddMemberInput,
  CreateProjectInput,
  Paginated,
  ProjectDetailsDto,
  ProjectMemberDto,
  ProjectRole,
  ProjectSummaryDto,
  UpdateProjectInput,
} from '@whc/shared';
import { api, apiData, toQueryString } from '@/lib/api-client';

/**
 * TanStack Query keys. Data is cached under these keys; after a change we
 * "invalidate" a key so the affected lists/pages refetch fresh data.
 */
export const projectKeys = {
  all: ['projects'] as const,
  list: (params: object) => ['projects', 'list', params] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
  members: (id: string) => ['projects', 'members', id] as const,
  activity: (id: string) => ['projects', 'activity', id] as const,
};

export function useProjects(params: { page?: number; pageSize?: number; q?: string } = {}) {
  return useQuery({
    queryKey: projectKeys.list(params),
    queryFn: () => api<Paginated<ProjectSummaryDto>>(`/api/projects${toQueryString(params)}`),
    placeholderData: keepPreviousData, // keep showing the old page while the next one loads
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => apiData<ProjectDetailsDto>(`/api/projects/${id}`),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      apiData<ProjectDetailsDto>('/api/projects', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      apiData<ProjectDetailsDto>(`/api/projects/${id}`, { method: 'PUT', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useDeleteProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (confirmName: string) =>
      api(`/api/projects/${id}`, { method: 'DELETE', body: { confirmName } }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: projectKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['websites'] });
    },
  });
}

export function useProjectMembers(id: string) {
  return useQuery({
    queryKey: projectKeys.members(id),
    queryFn: () => apiData<ProjectMemberDto[]>(`/api/projects/${id}/members`),
  });
}

function useMemberMutation<TVariables, TData>(
  projectId: string,
  request: (variables: TVariables) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.activity(projectId) });
    },
  });
}

export function useAddMember(projectId: string) {
  return useMemberMutation(projectId, (input: AddMemberInput) =>
    apiData<ProjectMemberDto>(`/api/projects/${projectId}/members`, {
      method: 'POST',
      body: input,
    }),
  );
}

export function useUpdateMemberRole(projectId: string) {
  return useMemberMutation(projectId, ({ userId, role }: { userId: string; role: ProjectRole }) =>
    api(`/api/projects/${projectId}/members/${userId}`, { method: 'PATCH', body: { role } }),
  );
}

export function useRemoveMember(projectId: string) {
  return useMemberMutation(projectId, (userId: string) =>
    api(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
  );
}

export function useProjectActivity(projectId: string) {
  return useQuery({
    queryKey: projectKeys.activity(projectId),
    queryFn: () =>
      api<Paginated<ActivityDto>>(`/api/activity${toQueryString({ projectId, pageSize: 10 })}`),
  });
}
