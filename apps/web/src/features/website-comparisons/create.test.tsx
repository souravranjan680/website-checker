/** Phase 9, Milestone 4 (Checkpoint 2.2): creating a website comparison. */
import type { ProjectSummaryDto } from '@whc/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, page, renderApp, signedIn } from '@/test/utils';

const project = (id: string, name: string, myRole: ProjectSummaryDto['myRole']) => ({
  id,
  name,
  description: null,
  myRole,
  websiteCount: 0,
  memberCount: 1,
  scanCount: 0,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
});

/** 12 websites in Retail (two pages of 10), 1 in Blog, none in Empty. */
const SITES: Record<string, { id: string; name: string; baseUrl: string }[]> = {
  p1: Array.from({ length: 12 }, (_, i) => ({
    id: `w${i + 1}`,
    name: i === 0 ? 'Live shop' : i === 1 ? 'New shop' : `Site ${i + 1}`,
    baseUrl: i === 0 ? 'https://shop.example.com/' : `https://s${i + 1}.example.com/`,
  })),
  p3: [{ id: 'b1', name: 'Blog', baseUrl: 'https://blog.example.com/' }],
  p4: [],
};

const websitesHandler = (call: { search: string }) => {
  const params = new URLSearchParams(call.search);
  const q = (params.get('q') ?? '').toLowerCase();
  const pageNo = Number(params.get('page') ?? '1');
  const size = Number(params.get('pageSize') ?? '20');
  const all = (SITES[params.get('projectId') ?? ''] ?? []).filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.baseUrl.includes(q),
  );
  return {
    status: 200,
    body: {
      data: all.slice((pageNo - 1) * size, pageNo * size),
      meta: {
        page: pageNo,
        pageSize: size,
        total: all.length,
        totalPages: Math.ceil(all.length / size),
      },
    },
  };
};

const PROJECTS = page([
  project('p1', 'Retail', 'EDITOR'),
  project('p2', 'Marketing', 'VIEWER'),
  project('p3', 'Content', 'OWNER'),
  project('p4', 'Empty', 'EDITOR'),
]);

function setup(post?: Parameters<typeof mockApi>[0][string]) {
  return mockApi({
    ...signedIn,
    'GET /api/projects': PROJECTS,
    'GET /api/websites': websitesHandler,
    'GET /api/website-comparisons': page([]),
    ...(post ? { 'POST /api/website-comparisons': post } : {}),
  });
}

const reference = () => screen.getByRole('group', { name: 'Reference website (A)' });
const target = () => screen.getByRole('group', { name: 'Target website (B)' });

async function choose(group: HTMLElement, name: RegExp) {
  fireEvent.click(await within(group).findByRole('radio', { name }));
}

/** Project Retail, Live shop → New shop, a name. */
async function fillIn() {
  fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'p1' } });
  await choose(reference(), /Live shop/);
  await choose(target(), /New shop/);
  fireEvent.change(screen.getByLabelText('Comparison name'), {
    target: { value: 'Redesign vs live' },
  });
}

describe('choosing the project', () => {
  it('only projects the user can edit; websites load once one is chosen', async () => {
    const calls = setup();
    renderApp('/website-comparisons/new');
    const select = await screen.findByLabelText('Project');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Choose a project…', 'Retail', 'Content', 'Empty']); // no Marketing (viewer)
    expect(screen.queryByRole('group', { name: 'Reference website (A)' })).toBeNull();
    expect(calls.some((c) => c.path === '/api/websites')).toBe(false); // nothing before a project
    fireEvent.change(select, { target: { value: 'p1' } });
    expect(
      await within(reference()).findByRole('radio', { name: /Live shop/ }),
    ).toBeInTheDocument();
    expect(within(reference()).getByText('https://shop.example.com/')).toBeInTheDocument();
    const websiteCalls = calls.filter((c) => c.path === '/api/websites');
    expect(Object.fromEntries(new URLSearchParams(websiteCalls[0]!.search))).toEqual({
      projectId: 'p1',
      page: '1',
      pageSize: '10',
    });
  });

  it('a project given in the address is preselected', async () => {
    setup();
    renderApp('/website-comparisons/new?projectId=p3');
    expect(await screen.findByLabelText('Project')).toHaveValue('p3');
    expect(await within(reference()).findByRole('radio', { name: /Blog/ })).toBeInTheDocument();
  });

  it('without an editable project: explains it, no form', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects': page([project('p2', 'Marketing', 'VIEWER')]),
    });
    renderApp('/website-comparisons/new');
    expect(await screen.findByText('No project you can edit')).toBeInTheDocument();
    expect(screen.queryByLabelText('Project')).toBeNull();
  });

  it('projects that fail to load: error with retry', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects': { status: 500, body: { error: { code: 'X', message: 'Down' } } },
    });
    renderApp('/website-comparisons/new');
    expect(await screen.findByText("Couldn't load your projects")).toBeInTheDocument();
  });
});

describe('choosing the websites', () => {
  it('searches and pages through all websites of the project (beyond the first page)', async () => {
    const calls = setup();
    renderApp('/website-comparisons/new');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'p1' } });
    await within(reference()).findByRole('radio', { name: /Live shop/ });
    expect(within(reference()).queryByRole('radio', { name: /Site 12/ })).toBeNull();

    fireEvent.click(within(reference()).getByRole('button', { name: /Next/ }));
    await choose(reference(), /Site 12/);
    expect(within(reference()).getByText(/Selected:/).parentElement).toHaveTextContent('Site 12');

    fireEvent.change(within(target()).getByLabelText('Search target website (b)'), {
      target: { value: 'site 1' },
    });
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.path === '/api/websites' && new URLSearchParams(c.search).get('q') === 'site 1',
        ),
      ).toBe(true),
    );
    // Search results; the one chosen as reference cannot be chosen again.
    const taken = await within(target()).findByRole('radio', { name: /Site 12/ });
    expect(taken).toBeDisabled();
    expect(
      within(target()).getByText('Already chosen as the reference website'),
    ).toBeInTheDocument();
    expect(within(target()).getByRole('radio', { name: /Site 10/ })).toBeEnabled();

    fireEvent.change(within(target()).getByLabelText('Search target website (b)'), {
      target: { value: 'nothing' },
    });
    expect(
      await within(target()).findByText('No website matches this search.'),
    ).toBeInTheDocument();
  });

  it('swap exchanges reference and target; a new project clears both', async () => {
    setup();
    renderApp('/website-comparisons/new');
    await fillIn();
    fireEvent.click(screen.getByRole('button', { name: /Swap/ }));
    expect(within(reference()).getByText(/Selected:/).parentElement).toHaveTextContent('New shop');
    expect(within(target()).getByText(/Selected:/).parentElement).toHaveTextContent('Live shop');

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p3' } });
    await within(reference()).findByRole('radio', { name: /Blog/ });
    expect(within(reference()).queryByText(/Selected:/)).toBeNull();
    expect(within(target()).queryByText(/Selected:/)).toBeNull();
  });

  it('a project without websites says so, with a link to add one', async () => {
    setup();
    renderApp('/website-comparisons/new');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'p4' } });
    expect(
      await within(reference()).findByText(/This project has no websites yet/),
    ).toBeInTheDocument();
    expect(within(reference()).getByRole('link', { name: 'Add a website' })).toHaveAttribute(
      'href',
      '/websites/new',
    );
  });

  it('websites that fail to load: error with retry', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects': PROJECTS,
      'GET /api/websites': { status: 500, body: { error: { code: 'X', message: 'Down' } } },
    });
    renderApp('/website-comparisons/new');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'p1' } });
    expect(await within(reference()).findByText("Couldn't load websites")).toBeInTheDocument();
  });
});

describe('validation and review', () => {
  it('requires both websites and a name; checks the limits; nothing is sent', async () => {
    const calls = setup();
    renderApp('/website-comparisons/new');
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'p1' } });
    await within(reference()).findByRole('radio', { name: /Live shop/ });
    fireEvent.change(screen.getByLabelText('Pages per website'), { target: { value: '51' } });
    fireEvent.change(screen.getByLabelText('Link depth'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Only include paths (optional)'), {
      target: { value: 'products' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Desktop/ })); // no size left
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(await screen.findByText('Choose the reference website.')).toBeInTheDocument();
    expect(screen.getByText('Choose the target website.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 2 characters.')).toBeInTheDocument();
    expect(screen.getByText('Maximum is 50.')).toBeInTheDocument();
    expect(screen.getByText('Maximum is 3.')).toBeInTheDocument();
    expect(screen.getByText('"products" must start with "/", e.g. /blog/*')).toBeInTheDocument();
    expect(screen.getByText('Choose at least one screen size.')).toBeInTheDocument();
    expect(screen.queryByText('Check and create')).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows a summary that says nothing runs; Back keeps everything', async () => {
    setup();
    renderApp('/website-comparisons/new');
    await fillIn();
    fireEvent.change(screen.getByLabelText('Pages per website'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Exclude paths (optional)'), {
      target: { value: '/admin/*\n/cart' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Mobile \(390/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(await screen.findByText('Check and create')).toBeInTheDocument();
    const summary = screen.getByLabelText('Summary');
    expect(summary).toHaveTextContent('Retail');
    expect(summary).toHaveTextContent('Redesign vs live');
    expect(summary).toHaveTextContent('Reference (A)Live shophttps://shop.example.com/');
    expect(summary).toHaveTextContent('Target (B)New shop');
    expect(summary).toHaveTextContent('Pages per website25');
    expect(summary).toHaveTextContent('Exclude paths/admin/*, /cart');
    expect(summary).toHaveTextContent('Desktop (1920×1080), Mobile (390×844)');
    expect(screen.getByText(/does not start a scan or a comparison run/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to edit' }));
    expect(await screen.findByLabelText('Comparison name')).toHaveValue('Redesign vs live');
    expect(screen.getByLabelText('Pages per website')).toHaveValue(25);
    expect(within(reference()).getByText(/Selected:/).parentElement).toHaveTextContent('Live shop');
  });
});

describe('creating through the API', () => {
  it('sends exactly the API fields once, then returns to the list with a message', async () => {
    const calls = setup({
      status: 201,
      body: { data: { id: 'c9', name: 'Redesign vs live' } },
    });
    const { router } = renderApp('/website-comparisons/new');
    await fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const create = await screen.findByRole('button', { name: 'Create comparison' });
    fireEvent.click(create);
    fireEvent.click(create); // a double click sends one request
    await waitFor(() => expect(router.state.location.pathname).toBe('/website-comparisons'));
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      projectId: 'p1',
      name: 'Redesign vs live',
      referenceWebsiteId: 'w1',
      targetWebsiteId: 'w2',
      maxPages: 10,
      maxDepth: 1,
      includePatterns: [],
      excludePatterns: [],
      viewports: ['1920x1080'],
    });
    expect(await screen.findByText(/Comparison "Redesign vs live" created/)).toBeInTheDocument();
  });

  it('API field errors appear on the fields; everything entered is kept', async () => {
    setup({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid.',
          details: [{ path: 'maxPages', message: 'Maximum is 50.' }],
        },
      },
    });
    renderApp('/website-comparisons/new');
    await fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create comparison' }));
    expect(await screen.findByText('Maximum is 50.')).toBeInTheDocument();
    expect(screen.getByLabelText('Comparison name')).toHaveValue('Redesign vs live');
    expect(within(target()).getByText(/Selected:/).parentElement).toHaveTextContent('New shop');
  });

  it('a website no longer in the project (404) is shown on that website', async () => {
    setup({
      status: 404,
      body: {
        error: {
          code: 'NOT_FOUND',
          message: 'Website not found in this project.',
          details: [{ path: 'targetWebsiteId', message: 'Choose a website of this project.' }],
        },
      },
    });
    renderApp('/website-comparisons/new');
    await fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create comparison' }));
    const picker = await screen.findByRole('group', { name: 'Target website (B)' });
    expect(within(picker).getByText('Choose a website of this project.')).toBeInTheDocument();
  });

  it('permission (403) and other failures: a clear message, input kept, can retry', async () => {
    let status = 403;
    const calls = setup(() =>
      status === 403
        ? {
            status: 403,
            body: {
              error: {
                code: 'FORBIDDEN',
                message: 'You need the editor role in this project to create website comparisons.',
              },
            },
          }
        : { status: 201, body: { data: { id: 'c9', name: 'Redesign vs live' } } },
    );
    const { router } = renderApp('/website-comparisons/new');
    await fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create comparison' }));
    expect(await screen.findByText(/You need the editor role/)).toBeInTheDocument();
    expect(screen.getByLabelText('Comparison name')).toHaveValue('Redesign vs live');

    status = 201; // e.g. the role was granted meanwhile
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create comparison' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/website-comparisons'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });
});
