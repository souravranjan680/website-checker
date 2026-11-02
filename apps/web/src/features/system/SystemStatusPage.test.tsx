import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HealthReport } from '@whc/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatusPage } from './SystemStatusPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemStatusPage />
    </QueryClientProvider>,
  );
}

function report(redisUp: boolean): HealthReport {
  return {
    status: redisUp ? 'ok' : 'error',
    service: 'whc-api',
    version: '0.1.0',
    environment: 'test',
    uptimeSeconds: 125,
    timestamp: new Date().toISOString(),
    checks: {
      database: { status: 'up', latencyMs: 4 },
      redis: redisUp
        ? { status: 'up', latencyMs: 2 }
        : { status: 'down', latencyMs: 1, error: 'connection refused' },
    },
  };
}

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SystemStatusPage', () => {
  it('shows a loading state first, then all services as operational', async () => {
    mockFetch(200, report(true));
    renderPage();

    expect(screen.getByLabelText('Loading system status')).toBeInTheDocument();
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    expect(screen.getByText('4 ms')).toBeInTheDocument();
    expect(screen.getByText('2m 5s')).toBeInTheDocument();
  });

  it('shows which dependency is down when the API answers 503', async () => {
    mockFetch(503, report(false));
    renderPage();

    expect(await screen.findByText('Some services are down')).toBeInTheDocument();
    expect(screen.getByText('connection refused')).toBeInTheDocument();
    expect(screen.getAllByText('Down')).toHaveLength(1);
  });

  it('shows an error state with a retry button when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('API unreachable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('rejects a response that does not match the shared schema', async () => {
    mockFetch(200, { hello: 'world' });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
  });
});
