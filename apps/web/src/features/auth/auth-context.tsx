import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginInput, RegisterInput, UserDto } from '@whc/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError, apiData, setSessionExpiredHandler } from '@/lib/api-client';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthContextValue {
  user: UserDto | null;
  status: AuthStatus;
  error: Error | null;
  retry: () => void;
  login: (input: LoginInput) => Promise<UserDto>;
  register: (input: RegisterInput) => Promise<UserDto>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * Knows who is signed in. The browser can't read the HttpOnly cookies, so we ask
 * the API (GET /api/auth/me) and cache the answer with TanStack Query.
 *   401 → nobody is signed in ("anonymous"), not an error.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        return (await apiData<{ user: UserDto }>('/api/auth/me')).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const setUser = useCallback(
    (user: UserDto | null) => queryClient.setQueryData(ME_QUERY_KEY, user),
    [queryClient],
  );

  // When a refresh fails mid-session, forget the user; RequireAuth then shows the login page.
  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    return () => setSessionExpiredHandler(null);
  }, [setUser]);

  const value = useMemo<AuthContextValue>(() => {
    const status: AuthStatus = me.isPending
      ? 'loading'
      : me.isError
        ? 'error'
        : me.data
          ? 'authenticated'
          : 'anonymous';
    return {
      user: me.data ?? null,
      status,
      error: me.error,
      retry: () => void me.refetch(),
      async login(input) {
        const { user } = await apiData<{ user: UserDto }>('/api/auth/login', {
          method: 'POST',
          body: input,
        });
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
        setUser(user);
        return user;
      },
      async register(input) {
        const { user } = await apiData<{ user: UserDto }>('/api/auth/register', {
          method: 'POST',
          body: input,
        });
        setUser(user);
        return user;
      },
      async logout() {
        try {
          await api('/api/auth/logout', { method: 'POST' });
        } finally {
          // Drop every cached response so the next user never sees this user's data.
          queryClient.clear();
          setUser(null);
        }
      },
    };
  }, [me, queryClient, setUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
