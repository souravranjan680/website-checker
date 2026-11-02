/**
 * Test helpers: render the real app (real routes, real providers) at a URL, with
 * the network replaced by a table of fake API responses.
 */
import { QueryClient } from '@tanstack/react-query';
import type { UserDto } from '@whc/shared';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { routes } from '@/app/router';

export interface MockResponse {
  status: number;
  body?: unknown;
}

export interface RecordedCall {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

type Handler = MockResponse | ((call: RecordedCall) => MockResponse);

/** Replaces fetch. Keys look like "POST /api/auth/login". Returns the list of calls made. */
export function mockApi(handlers: Record<string, Handler>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const call: RecordedCall = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        search: url.search,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const handler = handlers[`${call.method} ${call.path}`];
      const response: MockResponse =
        typeof handler === 'function'
          ? handler(call)
          : (handler ?? {
              status: 404,
              body: {
                error: { code: 'NOT_FOUND', message: `No mock for ${call.method} ${call.path}` },
              },
            });
      return new Response(response.status === 204 ? null : JSON.stringify(response.body ?? {}), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router };
}

export const TEST_USER: UserDto = {
  id: 'u1',
  email: 'asha@example.com',
  name: 'Asha',
  role: 'USER',
  createdAt: '2026-11-01T10:00:00.000Z',
};

export const signedIn = {
  'GET /api/auth/me': { status: 200, body: { data: { user: TEST_USER } } },
};

export const signedOut = {
  'GET /api/auth/me': {
    status: 401,
    body: { error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } },
  },
  'POST /api/auth/refresh': {
    status: 401,
    body: { error: { code: 'SESSION_ENDED', message: 'Session ended.' } },
  },
};

export function page<T>(data: T[]) {
  return {
    status: 200,
    body: { data, meta: { page: 1, pageSize: 20, total: data.length, totalPages: 1 } },
  };
}
