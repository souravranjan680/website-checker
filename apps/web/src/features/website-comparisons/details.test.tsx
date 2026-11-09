/** Phase 9, Milestone 4 (Checkpoint 2.3): comparison details, edit, archive/restore, delete. */
import type { WebsiteComparisonDto } from '@whc/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, page, renderApp, signedIn } from '@/test/utils';

const URL = '/api/website-comparisons/c1';
const ok = (data: unknown) => ({ status: 200, body: { data } });
const fail = (status: number, code: string, message: string, details: unknown[] = []) => ({
  status,
  body: { error: { code, message, details } },
});

function comparison(overrides: Partial<WebsiteComparisonDto> = {}): WebsiteComparisonDto {
  return {
    id: 'c1',
    projectId: 'p1',
    projectName: 'Retail',
    name: 'Redesign vs live',
    state: 'DRAFT',
    reference: { id: 'w1', name: 'Live shop', baseUrl: 'https://shop.example.com/' },
    target: { id: 'w2', name: 'New shop', baseUrl: 'https://new.shop.example.com/' },
    latestRun: null,
    updatedAt: '2026-11-09T10:00:00.000Z',
    settings: {
      maxPages: 25,
      maxDepth: 2,
      includePatterns: ['/shop/*'],
      excludePatterns: [],
      viewports: ['1920x1080', '390x844'],
    },
    runCount: 0,
    archivedAt: null,
    createdBy: { id: 'u1', name: 'Asha' },
    myRole: 'EDITOR',
    createdAt: '2026-11-08T09:00:00.000Z',
    ...overrides,
  };
}

/** A stand-in for the server: GET returns the current state, PUT changes it. */
function server(initial: WebsiteComparisonDto, put?: () => ReturnType<typeof fail> | null) {
  let current = initial;
  const calls = mockApi({
    ...signedIn,
    [`GET ${URL}`]: () => ok(current),
    [`PUT ${URL}`]: (call) => {
      const refused = put?.();
      if (refused) return refused;
      const body = call.body as Record<string, unknown>;
      const { archived, name, ...settings } = body;
      current = {
        ...current,
        ...(name ? { name: name as string } : {}),
        settings: { ...current.settings, ...settings },
        ...(archived === undefined
          ? {}
          : {
              state: archived ? 'ARCHIVED' : current.runCount > 0 ? 'IN_USE' : 'DRAFT',
              archivedAt: archived ? '2026-11-09T12:00:00.000Z' : null,
            }),
      };
      return ok(current);
    },
    'GET /api/website-comparisons': page([current]),
    'GET /api/projects': page([]),
  });
  return { calls, get: () => current };
}

describe('details', () => {
  it('shows the comparison: project, reference, target, state, dates, creator, settings', async () => {
    server(comparison());
    renderApp('/website-comparisons/c1');
    expect(await screen.findByRole('heading', { name: 'Redesign vs live' })).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retail' })).toHaveAttribute('href', '/projects/p1');
    const reference = screen.getByLabelText('Reference website (A)');
    expect(within(reference).getByRole('link', { name: 'Live shop' })).toHaveAttribute(
      'href',
      '/websites/w1',
    );
    expect(reference).toHaveTextContent('https://shop.example.com/');
    expect(screen.getByLabelText('Target website (B)')).toHaveTextContent(
      'New shophttps://new.shop.example.com/',
    );
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('Pages per website25');
    expect(main).toHaveTextContent('Link depth2');
    expect(main).toHaveTextContent('Only include paths/shop/*');
    expect(main).toHaveTextContent('Exclude pathsNone');
    expect(main).toHaveTextContent('Desktop (1920×1080), Mobile (390×844)');
    expect(main).toHaveTextContent('Created byAsha');
    expect(main).toHaveTextContent('Created');
    expect(main).toHaveTextContent('Last updated');
  });

  it('runs: an honest empty state, never invented results', async () => {
    server(comparison());
    renderApp('/website-comparisons/c1');
    expect(await screen.findByText('This comparison has not been run.')).toBeInTheDocument();
    expect(screen.getByText(/Running comparisons is not available yet/)).toBeInTheDocument();
    expect(screen.queryByText('Latest run')).toBeNull();
  });

  it('runs reported by the API are shown as reported', async () => {
    server(
      comparison({
        state: 'IN_USE',
        runCount: 1,
        latestRun: {
          id: 'r1',
          status: 'FAILED',
          queuedAt: '2026-11-09T08:00:00.000Z',
          finishedAt: null,
        },
      }),
    );
    renderApp('/website-comparisons/c1');
    expect(await screen.findByText('1 run recorded.')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Latest runFailed');
    expect(screen.getByRole('main')).toHaveTextContent('FinishedNot finished');
  });

  it('loading, then an error with a working retry', async () => {
    let failing = true;
    mockApi({
      ...signedIn,
      [`GET ${URL}`]: () => (failing ? fail(500, 'INTERNAL', 'Server error') : ok(comparison())),
    });
    renderApp('/website-comparisons/c1');
    expect(await screen.findByLabelText('Loading comparison')).toBeInTheDocument();
    expect(await screen.findByText("Couldn't load this comparison")).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again|Retry/ }));
    expect(await screen.findByRole('heading', { name: 'Redesign vs live' })).toBeInTheDocument();
  });

  it('not found or not yours (404): a safe message, no retry, a way back', async () => {
    mockApi({
      ...signedIn,
      [`GET ${URL}`]: fail(404, 'NOT_FOUND', 'Website comparison not found.'),
    });
    renderApp('/website-comparisons/c1');
    expect(await screen.findByText('Comparison not found')).toBeInTheDocument();
    expect(screen.getByText(/or you don't have access to its project/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again|Retry/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to website comparisons' })).toHaveAttribute(
      'href',
      '/website-comparisons',
    );
  });

  it('a viewer sees everything but no edit, archive or delete', async () => {
    server(comparison({ myRole: 'VIEWER' }));
    renderApp('/website-comparisons/c1');
    await screen.findByRole('heading', { name: 'Redesign vs live' });
    for (const name of [/Edit/, /Archive/, /Restore/, /Delete/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
    expect(screen.getAllByText('Viewer').length).toBeGreaterThan(0);
  });
});

describe('edit', () => {
  it('prefilled; project and websites read-only; sends name and settings only; back to details', async () => {
    const { calls } = server(comparison());
    const { router } = renderApp('/website-comparisons/c1/edit');
    const name = await screen.findByLabelText('Comparison name');
    expect(name).toHaveValue('Redesign vs live');
    expect(screen.getByLabelText('Pages per website')).toHaveValue(25);
    expect(screen.getByLabelText('Only include paths (optional)')).toHaveValue('/shop/*');
    expect(screen.getByRole('checkbox', { name: /Mobile \(390/ })).toBeChecked();
    const fixed = screen.getByRole('region', { name: 'Fixed for this comparison' });
    expect(fixed).toHaveTextContent('Retail');
    expect(fixed).toHaveTextContent('Live shop');
    expect(fixed).toHaveTextContent('New shop');
    expect(within(fixed).queryByRole('textbox')).toBeNull();
    expect(within(fixed).queryByRole('combobox')).toBeNull();

    fireEvent.change(name, { target: { value: 'Redesign vs live (v2)' } });
    fireEvent.change(screen.getByLabelText('Pages per website'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Exclude paths (optional)'), {
      target: { value: '/admin/*' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/website-comparisons/c1'));
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({
      name: 'Redesign vs live (v2)',
      maxPages: 30,
      maxDepth: 2,
      includePatterns: ['/shop/*'],
      excludePatterns: ['/admin/*'],
      viewports: ['1920x1080', '390x844'],
    });
    expect(await screen.findByText('Comparison saved.')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Redesign vs live (v2)' }),
    ).toBeInTheDocument();
  });

  it('validates the name and settings; nothing is sent', async () => {
    const { calls } = server(comparison());
    renderApp('/website-comparisons/c1/edit');
    fireEvent.change(await screen.findByLabelText('Comparison name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Link depth'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Desktop/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Mobile \(390/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use at least 2 characters.')).toBeInTheDocument();
    expect(screen.getByText('Maximum is 3.')).toBeInTheDocument();
    expect(screen.getByText('Choose at least one screen size.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('API errors: on the fields, or as a message (e.g. a run in progress); input kept', async () => {
    let answer: ReturnType<typeof fail> | null = fail(400, 'VALIDATION_ERROR', 'Invalid.', [
      { path: 'maxPages', message: 'Maximum is 50.' },
    ]);
    server(comparison(), () => answer);
    renderApp('/website-comparisons/c1/edit');
    fireEvent.change(await screen.findByLabelText('Comparison name'), {
      target: { value: 'Kept name' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Maximum is 50.')).toBeInTheDocument();
    expect(screen.getByLabelText('Comparison name')).toHaveValue('Kept name');

    answer = fail(
      409,
      'WEBSITE_COMPARISON_RUN_ACTIVE',
      'This comparison is running. Wait for it to finish or cancel it first.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/This comparison is running/)).toBeInTheDocument();
    expect(screen.getByLabelText('Comparison name')).toHaveValue('Kept name');
  });

  it('a viewer opening the edit address gets read-only access, no form', async () => {
    server(comparison({ myRole: 'VIEWER' }));
    renderApp('/website-comparisons/c1/edit');
    expect(await screen.findByText('Read-only access')).toBeInTheDocument();
    expect(screen.queryByLabelText('Comparison name')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to the comparison' })).toHaveAttribute(
      'href',
      '/website-comparisons/c1',
    );
  });
});

describe('archive and restore', () => {
  it('archive asks first, explains nothing is deleted, then shows the real result; restore too', async () => {
    const { calls } = server(comparison());
    renderApp('/website-comparisons/c1');
    fireEvent.click(await screen.findByRole('button', { name: /Archive/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/nothing is deleted/);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false); // not before confirming
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive comparison' }));
    expect(await screen.findByText('Redesign vs live archived.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Restore/ })).toBeInTheDocument();
    expect(screen.getAllByText('Archived').length).toBeGreaterThan(0); // badge and banner
    expect(screen.getByRole('button', { name: /Restore/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archive$/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    const restore = await screen.findByRole('alertdialog');
    expect(restore).toHaveTextContent(/active again/);
    fireEvent.click(within(restore).getByRole('button', { name: 'Restore comparison' }));
    expect(await screen.findByText('Redesign vs live restored.')).toBeInTheDocument();
    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
      { archived: true },
      { archived: false },
    ]);
  });

  it('a refused archive (e.g. permission) shows the reason and changes nothing', async () => {
    server(comparison({ name: 'Locked check' }), () =>
      fail(
        403,
        'FORBIDDEN',
        'You need the editor role in this project to edit website comparisons.',
      ),
    );
    renderApp('/website-comparisons/c1');
    fireEvent.click(await screen.findByRole('button', { name: /Archive/ }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Archive comparison',
      }),
    );
    expect(await screen.findByText(/You need the editor role/)).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.queryByText('Locked check archived.')).toBeNull();
  });
});

describe('delete', () => {
  it('asks first, says it is permanent and not an archive, deletes once, returns to the list', async () => {
    const calls = mockApi({
      ...signedIn,
      [`GET ${URL}`]: ok(comparison()),
      [`DELETE ${URL}`]: { status: 204 },
      'GET /api/website-comparisons': page([]),
      'GET /api/projects': page([]),
    });
    const { router } = renderApp('/website-comparisons/c1');
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/permanently deleted/);
    expect(dialog).toHaveTextContent(/archive it instead/);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const confirm = within(dialog).getByRole('button', { name: 'Delete comparison' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(router.state.location.pathname).toBe('/website-comparisons'));
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(await screen.findByText('Redesign vs live deleted.')).toBeInTheDocument();
  });

  it('refused (a run in progress, or no permission): the reason, no false success', async () => {
    let answer = fail(
      409,
      'WEBSITE_COMPARISON_RUN_ACTIVE',
      'This comparison is running. Wait for it to finish or cancel it first.',
    );
    mockApi({
      ...signedIn,
      [`GET ${URL}`]: ok(comparison({ name: 'Busy check' })),
      [`DELETE ${URL}`]: () => answer,
    });
    const { router } = renderApp('/website-comparisons/c1');
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete comparison',
      }),
    );
    expect(await screen.findByText(/This comparison is running/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/website-comparisons/c1');
    expect(screen.queryByText('Busy check deleted.')).toBeNull();

    answer = fail(
      403,
      'FORBIDDEN',
      'You need the editor role in this project to delete website comparisons.',
    );
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete comparison' }),
    );
    expect(await screen.findByText(/You need the editor role/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/website-comparisons/c1');
  });
});

describe('integration', () => {
  it('comparison names in the list open their details', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects': page([]),
      'GET /api/website-comparisons': page([comparison()]),
      [`GET ${URL}`]: ok(comparison()),
    });
    const { router } = renderApp('/website-comparisons');
    fireEvent.click(await screen.findByRole('link', { name: 'Redesign vs live' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/website-comparisons/c1'));
    expect(await screen.findByLabelText('Reference website (A)')).toBeInTheDocument();
  });
});
