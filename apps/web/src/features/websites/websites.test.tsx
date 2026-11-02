import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, page, renderApp, signedIn } from '@/test/utils';

const editableProject = {
  id: 'p1',
  name: 'Marketing sites',
  description: null,
  myRole: 'EDITOR',
  websiteCount: 0,
  memberCount: 2,
  scanCount: 0,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
};

async function fillWebsite(url: string) {
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Homepage' } });
  fireEvent.change(screen.getByLabelText('Website address'), { target: { value: url } });
}

describe('AddWebsitePage', () => {
  it('pre-fills the address from the Chrome extension hand-off and still asks for authorization', async () => {
    const calls = mockApi({ ...signedIn, 'GET /api/projects': page([editableProject]) });
    renderApp('/websites/new?baseUrl=https%3A%2F%2Fshop.example.com%2Fcart');
    expect(await screen.findByLabelText('Website address')).toHaveValue(
      'https://shop.example.com/cart',
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Shop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));
    expect(await screen.findByText(/Confirm that you own this website/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('rejects unsafe URLs and a missing authorization confirmation in the browser', async () => {
    const calls = mockApi({ ...signedIn, 'GET /api/projects': page([editableProject]) });
    renderApp('/websites/new');
    await fillWebsite('http://localhost');
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));

    expect(
      await screen.findByText('Local and internal addresses cannot be scanned.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Confirm that you own this website/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows the server-side DNS check result under the URL field', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/projects': page([editableProject]),
      'POST /api/websites': {
        status: 400,
        body: {
          error: {
            code: 'UNSAFE_URL',
            message: '"sneaky.example.com" points to a private or internal network address.',
            details: [
              { path: 'baseUrl', message: 'This address points to a private or internal network.' },
            ],
          },
        },
      },
    });
    renderApp('/websites/new');
    await fillWebsite('sneaky.example.com');
    fireEvent.click(screen.getByRole('checkbox', { name: /I own this website/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));

    expect(
      await screen.findByText('This address points to a private or internal network.'),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      projectId: 'p1',
      baseUrl: 'sneaky.example.com',
      authorizationConfirmed: true,
      maxDepth: 2,
      maxPages: 20,
    });
  });

  it('adds a website and opens its page', async () => {
    mockApi({
      ...signedIn,
      'GET /api/projects': page([editableProject]),
      'POST /api/websites': { status: 201, body: { data: { id: 'w1', name: 'Homepage' } } },
    });
    const { router } = renderApp('/websites/new');
    await fillWebsite('example.com');
    expect(screen.getByText('Will be saved as https://example.com/')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /I own this website/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/websites/w1'));
  });

  it('asks viewers to get a project first instead of showing the form', async () => {
    mockApi({ ...signedIn, 'GET /api/projects': page([{ ...editableProject, myRole: 'VIEWER' }]) });
    renderApp('/websites/new');
    expect(await screen.findByText('You need a project first')).toBeInTheDocument();
  });
});
