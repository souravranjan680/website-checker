import type { ProjectSummaryDto } from '@whc/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, page, renderApp, signedIn } from '@/test/utils';

const project = (overrides: Partial<ProjectSummaryDto>): ProjectSummaryDto => ({
  id: 'p1',
  name: 'Marketing sites',
  description: 'Public pages',
  myRole: 'OWNER',
  websiteCount: 3,
  memberCount: 2,
  scanCount: 0,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

describe('ProjectsPage', () => {
  it('lists projects with their real counts and my role', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects': page([
        project({}),
        project({ id: 'p2', name: 'Shop', myRole: 'VIEWER', websiteCount: 1 }),
      ]),
    });
    renderApp('/projects');

    expect(await screen.findByRole('link', { name: 'Marketing sites' })).toHaveAttribute(
      'href',
      '/projects/p1',
    );
    expect(screen.getByText('3 websites')).toBeInTheDocument();
    expect(screen.getByText('1 website')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Viewer')).toBeInTheDocument();
  });

  it('shows an empty state with a call to action', async () => {
    mockApi({ ...signedIn, 'GET /api/projects': page([]) });
    renderApp('/projects');
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New project' }).length).toBeGreaterThan(0);
  });

  it('shows an error state with retry when the API fails', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects': {
        status: 500,
        body: { error: { code: 'INTERNAL_ERROR', message: 'Database unavailable' } },
      },
    });
    renderApp('/projects');
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('creates a project and opens it', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/projects': page([]),
      'POST /api/projects': {
        status: 201,
        body: {
          data: {
            ...project({ id: 'p9', name: 'New shop' }),
            stats: {
              websiteCount: 0,
              memberCount: 1,
              scanCount: 0,
              completedScanCount: 0,
              openIssueCount: 0,
              lastScanAt: null,
            },
          },
        },
      },
    });
    const { router } = renderApp('/projects');
    fireEvent.click((await screen.findAllByRole('button', { name: 'New project' }))[0]!);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'New shop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p9'));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ name: 'New shop' });
  });
});
