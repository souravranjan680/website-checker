/** Phase 9, Milestone 4 (Checkpoint 2.1): the Website comparison navigation and list. */
import type { ProjectSummaryDto, WebsiteComparisonListItemDto } from '@whc/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, page, renderApp, signedIn } from '@/test/utils';

const project = (id: string, name: string, myRole: ProjectSummaryDto['myRole']) => ({
  id,
  name,
  description: null,
  myRole,
  websiteCount: 2,
  memberCount: 1,
  scanCount: 0,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
});

const comparison = (
  overrides: Partial<WebsiteComparisonListItemDto> = {},
): WebsiteComparisonListItemDto => ({
  id: 'c1',
  projectId: 'p1',
  projectName: 'Retail',
  name: 'Redesign vs live',
  state: 'DRAFT',
  reference: { id: 'w1', name: 'Live shop', baseUrl: 'https://shop.example.com/' },
  target: { id: 'w2', name: 'New shop', baseUrl: 'https://new.shop.example.com/' },
  latestRun: null,
  updatedAt: '2026-11-08T10:00:00.000Z',
  ...overrides,
});

const LIST = '/api/website-comparisons';
const listCalls = (calls: { path: string; search: string }[]) =>
  calls.filter((c) => c.path === LIST).map((c) => new URLSearchParams(c.search));

describe('Website comparison list', () => {
  it('shows real records: name, project, reference → target, state, updated', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/projects': page([project('p1', 'Retail', 'EDITOR')]),
      [`GET ${LIST}`]: page([
        comparison(),
        comparison({ id: 'c2', name: 'Staging check', state: 'IN_USE' }),
      ]),
    });
    renderApp('/website-comparisons');

    expect(await screen.findByText('Redesign vs live')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2
    const first = within(rows[1]!);
    expect(first.getByText('Reference')).toBeInTheDocument();
    expect(first.getByRole('link', { name: 'Live shop' })).toHaveAttribute('href', '/websites/w1');
    expect(first.getByText('Target')).toBeInTheDocument();
    expect(first.getByRole('link', { name: 'New shop' })).toHaveAttribute('href', '/websites/w2');
    expect(first.getByRole('link', { name: 'Retail' })).toHaveAttribute('href', '/projects/p1');
    expect(first.getByText('Draft')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('In use')).toBeInTheDocument();
    // The default request: first page, not archived; nothing the API does not accept.
    const [firstCall] = listCalls(calls);
    expect(Object.fromEntries(firstCall!)).toEqual({
      page: '1',
      pageSize: '20',
      archived: 'false',
    });
  });

  it('searches, filters by project and archived state, and paginates with the API parameters', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/projects': page([
        project('p1', 'Retail', 'EDITOR'),
        project('p2', 'Marketing', 'VIEWER'),
      ]),
      [`GET ${LIST}`]: {
        status: 200,
        body: {
          data: [comparison()],
          meta: { page: 1, pageSize: 20, total: 45, totalPages: 3 },
        },
      },
    });
    renderApp('/website-comparisons');
    await screen.findByText('Redesign vs live');

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(listCalls(calls).some((p) => p.get('page') === '2')).toBe(true));

    fireEvent.change(screen.getByLabelText('Search comparisons'), {
      target: { value: '  shop  ' },
    });
    await waitFor(() =>
      expect(listCalls(calls).some((p) => p.get('q') === 'shop' && p.get('page') === '1')).toBe(
        true,
      ),
    );
    fireEvent.change(screen.getByLabelText('Filter by project'), { target: { value: 'p2' } });
    await waitFor(() =>
      expect(listCalls(calls).some((p) => p.get('projectId') === 'p2')).toBe(true),
    );
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'true' } });
    await waitFor(() => expect(listCalls(calls).at(-1)?.get('archived')).toBe('true'));
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } });
    await waitFor(() => expect(listCalls(calls).at(-1)?.get('archived')).toBe('all'));

    // Only parameters the API accepts are ever sent.
    const allowed = new Set(['page', 'pageSize', 'q', 'projectId', 'archived']);
    for (const params of listCalls(calls)) {
      for (const key of params.keys()) expect(allowed).toContain(key);
    }
  });

  it('loading, then the error state with a working retry', async () => {
    let fail = true;
    const calls = mockApi({
      ...signedIn,
      'GET /api/projects': page([]),
      [`GET ${LIST}`]: () =>
        fail
          ? { status: 500, body: { error: { code: 'INTERNAL', message: 'Server error' } } }
          : page([comparison()]),
    });
    renderApp('/website-comparisons');
    expect(await screen.findByLabelText('Loading comparisons')).toBeInTheDocument();
    expect(await screen.findByText("Couldn't load comparisons")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again|Retry/ }));
    expect(await screen.findByText('Redesign vs live')).toBeInTheDocument();
    expect(listCalls(calls).length).toBeGreaterThanOrEqual(2);
  });

  it('empty states: none yet (editor and viewer wording), no matches, no archived', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects': page([project('p1', 'Retail', 'VIEWER')]),
      [`GET ${LIST}`]: page([]),
    });
    renderApp('/website-comparisons');
    expect(await screen.findByText('No website comparisons yet')).toBeInTheDocument();
    expect(screen.getByText(/An owner or editor of a project can create one/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'true' } });
    expect(await screen.findByText('No archived comparisons')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search comparisons'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No matching comparisons')).toBeInTheDocument();
  });

  it('New comparison only for project editors; no per-row actions', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects': page([project('p1', 'Retail', 'VIEWER')]),
      [`GET ${LIST}`]: page([comparison()]),
    });
    renderApp('/website-comparisons');
    await screen.findByText('Redesign vs live');
    expect(screen.queryByRole('link', { name: /New comparison/ })).toBeNull();
    // No per-row actions: the list does not say what the user may do with each one.
    expect(screen.queryByRole('button', { name: /Edit|Archive|Delete/ })).toBeNull();
  });

  it('an editor sees New comparison, linking to the create page (also in the empty state)', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects': page([
        project('p1', 'Retail', 'VIEWER'),
        project('p2', 'Marketing', 'OWNER'),
      ]),
      [`GET ${LIST}`]: page([]),
    });
    renderApp('/website-comparisons');
    await screen.findByText('No website comparisons yet');
    const links = screen.getAllByRole('link', { name: /New comparison/ });
    expect(links).toHaveLength(2); // header and empty state
    for (const link of links) expect(link).toHaveAttribute('href', '/website-comparisons/new');
  });
});

describe('navigation', () => {
  const api = {
    ...signedIn,
    'GET /api/projects': page([]),
    [`GET ${LIST}`]: page([]),
  };

  it('the sidebar links to Website comparison', async () => {
    mockApi(api);
    const { router } = renderApp('/website-comparisons');
    const link = await screen.findByRole('link', { name: 'Website comparison' });
    expect(link).toHaveAttribute('href', '/website-comparisons');
    expect(await screen.findByRole('heading', { name: 'Website comparison' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/website-comparisons');
  });

  it('the mobile menu has it too', async () => {
    mockApi(api);
    const { router } = renderApp('/projects');
    fireEvent.pointerDown(await screen.findByRole('button', { name: /Menu/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Website comparison/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/website-comparisons'));
  });
});
