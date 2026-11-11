/**
 * Phase 9, Milestone 4 (Checkpoint 2.4): Website comparison entry points on project and
 * website pages, and refused website deletes/moves (409 WEBSITE_IN_COMPARISON) that name
 * the comparisons using the website.
 */
import type { WebsiteComparisonListItemDto, WebsiteDto } from '@whc/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from '@/lib/api-client';
import { mockApi, page, renderApp, signedIn } from '@/test/utils';
import { websiteInComparisonInfo } from './WebsiteInComparisonNotice';

const ok = (data: unknown) => ({ status: 200, body: { data } });

const website = (overrides: Partial<WebsiteDto> = {}): WebsiteDto => ({
  id: 'w1',
  projectId: 'p1',
  projectName: 'Retail',
  name: 'Live shop',
  baseUrl: 'https://shop.example.com/',
  hostname: 'shop.example.com',
  maxDepth: 2,
  maxPages: 20,
  includePatterns: [],
  excludePatterns: [],
  respectRobotsTxt: true,
  responsivePageLimit: 3,
  lighthousePageLimit: 1,
  explorationEnabled: true,
  explorationPageLimit: 5,
  explorationControlLimit: 30,
  consistencyEnabled: true,
  keyboardProbeEnabled: true,
  formProbeMode: 'BLUR',
  crossBrowserEnabled: false,
  crossBrowserTargets: ['FIREFOX', 'WEBKIT'],
  crossBrowserPageLimit: 3,
  crossBrowserMobile: false,
  verificationStatus: 'UNVERIFIED',
  authorizationConfirmedAt: '2026-11-01T10:00:00.000Z',
  myRole: 'EDITOR',
  scanCount: 0,
  lastScan: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

const comparison = (
  id: string,
  name: string,
  reference: string,
  target: string,
  state: WebsiteComparisonListItemDto['state'] = 'DRAFT',
): WebsiteComparisonListItemDto => ({
  id,
  projectId: 'p1',
  projectName: 'Retail',
  name,
  state,
  reference: {
    id: reference,
    name: reference === 'w1' ? 'Live shop' : 'Other site',
    baseUrl: 'https://a.example.com/',
  },
  target: {
    id: target,
    name: target === 'w1' ? 'Live shop' : 'New shop',
    baseUrl: 'https://b.example.com/',
  },
  latestRun: null,
  updatedAt: '2026-11-09T10:00:00.000Z',
});

const IN_USE = {
  status: 409,
  body: {
    error: {
      code: 'WEBSITE_IN_COMPARISON',
      message: 'This website is used by 2 website comparisons. Delete those comparisons first.',
      details: {
        count: 2,
        comparisons: [
          { id: 'c1', name: 'Redesign vs live' },
          { id: 'c2', name: 'Staging check' },
        ],
      },
    },
  },
};

describe('API errors with structured details (the client)', () => {
  it('a field list stays in details; anything else goes to info, never to the forms', async () => {
    const fields = await toApiError(
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'x',
            details: [{ path: 'name', message: 'm' }],
          },
        }),
        { status: 400 },
      ),
    );
    expect(fields.details).toEqual([{ path: 'name', message: 'm' }]);
    expect(fields.info).toBeNull();

    const inUse = await toApiError(new Response(JSON.stringify(IN_USE.body), { status: 409 }));
    expect(inUse.details).toEqual([]); // the forms iterate details: an object here broke them
    expect(websiteInComparisonInfo(inUse)).toEqual({
      count: 2,
      comparisons: [
        { id: 'c1', name: 'Redesign vs live' },
        { id: 'c2', name: 'Staging check' },
      ],
    });
  });

  it('reads the details defensively', () => {
    const odd = new ApiError(409, 'WEBSITE_IN_COMPARISON', 'm', [], {
      count: 'many',
      comparisons: [{ id: 'c1', name: 'Ok' }, { id: 3 }, 'x', null],
    });
    expect(websiteInComparisonInfo(odd)).toEqual({
      count: 1,
      comparisons: [{ id: 'c1', name: 'Ok' }],
    });
    expect(websiteInComparisonInfo(new ApiError(409, 'OTHER', 'm'))).toBeNull();
    expect(websiteInComparisonInfo(new Error('x'))).toBeNull();
  });
});

describe('deleting a website that comparisons use', () => {
  it('the dialog names the comparisons with links; nothing is deleted or claimed', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/websites/w1': ok(website()),
      'DELETE /api/websites/w1': IN_USE,
      'GET /api/website-comparisons': page([]),
    });
    const { router } = renderApp('/websites/w1');
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete website' }));

    const notice = await within(dialog).findByRole('alert');
    expect(notice).toHaveTextContent('Used by 2 website comparisons');
    expect(notice).toHaveTextContent(/cannot be deleted while comparisons use it/);
    expect(within(notice).getByRole('link', { name: 'Redesign vs live' })).toHaveAttribute(
      'href',
      '/website-comparisons/c1',
    );
    expect(within(notice).getByRole('link', { name: 'Staging check' })).toHaveAttribute(
      'href',
      '/website-comparisons/c2',
    );
    // No second attempt from the same dialog, and no success.
    expect(within(dialog).getByRole('button', { name: 'Delete website' })).toBeDisabled();
    expect(screen.queryByText('Live shop deleted.')).toBeNull();
    expect(router.state.location.pathname).toBe('/websites/w1');
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);

    // Closing and reopening starts fresh.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    const again = await screen.findByRole('alertdialog');
    expect(within(again).queryByRole('alert')).toBeNull();
    expect(within(again).getByRole('button', { name: 'Delete website' })).toBeEnabled();
  });

  it('without a count or list from the API, the notice claims no number', async () => {
    mockApi({
      ...signedIn,
      'GET /api/websites/w1': ok(website()),
      // The API's fallback when the database refuses but no comparison is found to list.
      'DELETE /api/websites/w1': {
        status: 409,
        body: {
          error: {
            code: 'WEBSITE_IN_COMPARISON',
            message: 'This website is used by a website comparison.',
          },
        },
      },
      'GET /api/website-comparisons': page([]),
    });
    renderApp('/websites/w1');
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete website' }));

    const notice = await within(dialog).findByRole('alert');
    expect(notice).toHaveTextContent('Used by website comparisons');
    expect(notice).not.toHaveTextContent(/\d/);
    expect(within(notice).queryByRole('link')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Delete website' })).toBeDisabled();
  });

  it('other delete errors are unchanged (a message, no comparison list)', async () => {
    mockApi({
      ...signedIn,
      'GET /api/websites/w1': ok(website({ name: 'Plain site' })),
      'DELETE /api/websites/w1': {
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'Something broke on the server.' } },
      },
      'GET /api/website-comparisons': page([]),
    });
    renderApp('/websites/w1');
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete website' }));
    expect(await screen.findByText('Something broke on the server.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/website comparison/)).toBeNull();
  });
});

describe('moving a website that comparisons use', () => {
  it('the edit page names the comparisons; the form keeps its input and message', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/websites/w1': ok(website()),
      'GET /api/projects': page([
        {
          id: 'p1',
          name: 'Retail',
          description: null,
          myRole: 'EDITOR',
          websiteCount: 1,
          memberCount: 1,
          scanCount: 0,
          createdAt: '2026-11-01T10:00:00.000Z',
          updatedAt: '2026-11-01T10:00:00.000Z',
        },
        {
          id: 'p2',
          name: 'Marketing',
          description: null,
          myRole: 'OWNER',
          websiteCount: 0,
          memberCount: 1,
          scanCount: 0,
          createdAt: '2026-11-01T10:00:00.000Z',
          updatedAt: '2026-11-01T10:00:00.000Z',
        },
      ]),
      'PUT /api/websites/w1': IN_USE,
    });
    renderApp('/websites/w1/edit');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'p2' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kept name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const notice = await screen.findByText('Used by 2 website comparisons');
    expect(notice.closest('[role="alert"]')).toHaveTextContent(
      /cannot be moved to another project while comparisons use it/,
    );
    expect(screen.getByRole('link', { name: 'Redesign vs live' })).toHaveAttribute(
      'href',
      '/website-comparisons/c1',
    );
    // The form shows the API's message (it used to fail on the object details) and keeps input.
    expect(screen.getByText(/Delete those comparisons first\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Kept name');
    expect(screen.getByLabelText('Project')).toHaveValue('p2');
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });
});

describe('entry points', () => {
  const project = (myRole: 'OWNER' | 'EDITOR' | 'VIEWER') => ({
    id: 'p1',
    name: 'Retail',
    description: null,
    myRole,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    stats: {
      websiteCount: 2,
      memberCount: 1,
      scanCount: 0,
      completedScanCount: 0,
      openIssueCount: 0,
      lastScanAt: null,
    },
  });

  it('project page: active comparisons, New comparison for editors, View all filtered to the project', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/projects/p1': ok(project('EDITOR')),
      'GET /api/websites': page([]),
      'GET /api/website-comparisons': (call) =>
        new URLSearchParams(call.search).get('projectId') === 'p1'
          ? {
              status: 200,
              body: {
                data: [comparison('c1', 'Redesign vs live', 'w9', 'w1')],
                meta: { page: 1, pageSize: 5, total: 7, totalPages: 2 },
              },
            }
          : page([]),
      'GET /api/projects': page([]),
    });
    const { router } = renderApp('/projects/p1');
    const card = await screen.findByLabelText('Website comparisons');
    expect(await within(card).findByRole('link', { name: 'Redesign vs live' })).toHaveAttribute(
      'href',
      '/website-comparisons/c1',
    );
    expect(within(card).getByRole('link', { name: /New comparison/ })).toHaveAttribute(
      'href',
      '/website-comparisons/new?projectId=p1',
    );
    const first = calls.find((c) => c.path === '/api/website-comparisons')!;
    expect(Object.fromEntries(new URLSearchParams(first.search))).toEqual({
      projectId: 'p1',
      archived: 'false',
      pageSize: '5',
    });

    // "View all" opens the list already filtered to this project.
    fireEvent.click(within(card).getByRole('link', { name: 'View all 7 comparisons' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/website-comparisons'));
    expect(router.state.location.search).toBe('?projectId=p1');
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === '/api/website-comparisons' &&
            new URLSearchParams(c.search).get('page') === '1' &&
            new URLSearchParams(c.search).get('projectId') === 'p1',
        ),
      ).toBe(true),
    );
  });

  it('project page for a viewer: the list, but no New comparison', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects/p1': ok(project('VIEWER')),
      'GET /api/websites': page([]),
      'GET /api/website-comparisons': page([]),
    });
    renderApp('/projects/p1');
    const card = await screen.findByLabelText('Website comparisons');
    expect(
      await within(card).findByText(
        /No active comparisons in this project\. An editor can create one\./,
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: /New comparison/ })).toBeNull();
  });

  it('website page: only the comparisons that use it, with its side; others left out', async () => {
    mockApi({
      ...signedIn,
      'GET /api/websites/w1': ok(website()),
      'GET /api/website-comparisons': page([
        comparison('c1', 'Redesign vs live', 'w1', 'w2'),
        comparison('c2', 'Staging check', 'w2', 'w1', 'ARCHIVED'),
        comparison('c3', 'Unrelated', 'w2', 'w3'),
      ]),
    });
    renderApp('/websites/w1');
    const card = await screen.findByLabelText('Website comparisons using this website');
    expect(await within(card).findByRole('link', { name: 'Redesign vs live' })).toBeInTheDocument();
    expect(card).toHaveTextContent('This website is the reference; target: New shop');
    expect(within(card).getByRole('link', { name: 'Staging check' })).toBeInTheDocument();
    expect(card).toHaveTextContent('This website is the target; reference: Other site');
    expect(within(card).getByText('Archived')).toBeInTheDocument(); // archived ones still block deletion
    expect(within(card).queryByText('Unrelated')).toBeNull();
    expect(within(card).getByRole('link', { name: /New comparison/ })).toHaveAttribute(
      'href',
      '/website-comparisons/new?projectId=p1',
    );
  });

  it('website page: none, and an honest note when the project has more than 100', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/websites/w1': ok(website({ myRole: 'VIEWER' })),
      'GET /api/website-comparisons': {
        status: 200,
        body: {
          data: [comparison('c3', 'Unrelated', 'w2', 'w3')],
          meta: { page: 1, pageSize: 100, total: 140, totalPages: 2 },
        },
      },
    });
    renderApp('/websites/w1');
    const card = await screen.findByLabelText('Website comparisons using this website');
    expect(
      await within(card).findByText('None among the first 100 comparisons of this project.'),
    ).toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: /New comparison/ })).toBeNull(); // viewer
    const first = calls.find((c) => c.path === '/api/website-comparisons')!;
    expect(Object.fromEntries(new URLSearchParams(first.search))).toEqual({
      projectId: 'p1',
      archived: 'all',
      pageSize: '100',
    });
  });
});
