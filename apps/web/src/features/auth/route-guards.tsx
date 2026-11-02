import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { ErrorState } from '@/components/common/ErrorState';
import { useAuth } from './auth-context';

/** Only allow same-site paths like "/projects/1" (never "//evil.com" or "https://..."). */
export function safeNextPath(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

function FullPageLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Loading">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

/**
 * Wraps every page that needs a signed-in user. Not signed in → /login?next=<this page>.
 * This is for user experience only; the API enforces access on every request.
 */
export function RequireAuth() {
  const { status, error, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <ErrorState title="Can't reach the server" error={error} onRetry={retry} />
      </div>
    );
  }
  if (status === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

/** Login/registration pages: already signed in → go straight to the app. */
export function GuestOnly() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to={safeNextPath(params.get('next'))} replace />;
  return <Outlet />;
}
