import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, page, renderApp, signedIn, signedOut, TEST_USER } from '@/test/utils';

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('protected routes', () => {
  it('sends signed-out visitors to the login page and remembers where they wanted to go', async () => {
    mockApi(signedOut);
    const { router } = renderApp('/projects');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fprojects');
  });

  it('lets signed-in users in', async () => {
    mockApi({ ...signedIn, 'GET /api/projects': page([]) });
    renderApp('/projects');
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
  });

  it('keeps signed-in users away from the login page', async () => {
    mockApi({ ...signedIn, 'GET /api/projects': page([]) });
    const { router } = renderApp('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });
});

describe('login', () => {
  it('validates fields in the browser before calling the API', async () => {
    const calls = mockApi(signedOut);
    renderApp('/login');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.path === '/api/auth/login')).toBe(false);
  });

  it('shows the error from a failed login', async () => {
    mockApi({
      ...signedOut,
      'POST /api/auth/login': {
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } },
      },
    });
    renderApp('/login');
    type(await screen.findByLabelText('Email').then(() => 'Email'), 'asha@example.com');
    type('Password', 'wrong password');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });

  it('signs in and continues to the page the user asked for', async () => {
    const calls = mockApi({
      ...signedOut,
      'POST /api/auth/login': { status: 200, body: { data: { user: TEST_USER } } },
      'GET /api/websites': page([]),
      'GET /api/projects': page([]),
    });
    const { router } = renderApp('/login?next=%2Fwebsites');
    type(await screen.findByLabelText('Email').then(() => 'Email'), 'Asha@Example.com');
    type('Password', 'correct horse battery');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/websites'));
    const login = calls.find((c) => c.path === '/api/auth/login');
    expect(login?.body).toEqual({ email: 'asha@example.com', password: 'correct horse battery' });
  });
});

describe('registration', () => {
  async function fillForm(confirm = 'correct horse battery') {
    type(await screen.findByLabelText('Name').then(() => 'Name'), 'Asha');
    type('Email', 'asha@example.com');
    type('Password', 'correct horse battery');
    type('Confirm password', confirm);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  }

  it('checks that both passwords match', async () => {
    mockApi(signedOut);
    renderApp('/register');
    await fillForm('something else entirely');
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
  });

  it('rejects weak passwords with the shared rules', async () => {
    mockApi(signedOut);
    renderApp('/register');
    type(await screen.findByLabelText('Name').then(() => 'Name'), 'Asha');
    type('Email', 'asha@example.com');
    type('Password', 'password123');
    type('Confirm password', 'password123');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/too common/)).toBeInTheDocument();
  });

  it('shows "email already exists" under the email field (duplicate registration)', async () => {
    mockApi({
      ...signedOut,
      'POST /api/auth/register': {
        status: 409,
        body: {
          error: {
            code: 'EMAIL_TAKEN',
            message: 'An account with this email already exists.',
            details: [{ path: 'email', message: 'An account with this email already exists.' }],
          },
        },
      },
    });
    renderApp('/register');
    await fillForm();

    expect(
      await screen.findByText('An account with this email already exists.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });
});
