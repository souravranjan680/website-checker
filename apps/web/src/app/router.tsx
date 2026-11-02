import { createBrowserRouter, isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';
import { SystemStatusPage } from '@/features/system/SystemStatusPage';
import { AppLayout } from './layouts/AppLayout';

/**
 * All routes live here. Phase 5 adds the 21 product pages
 * (dashboard, websites, reports, ...) as children of AppLayout.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <SystemStatusPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        This page doesn&apos;t exist yet, or the link is wrong.
      </p>
      <Button asChild>
        <Link to="/">Go to system status</Link>
      </Button>
    </div>
  );
}

/** Shown when a page crashes while rendering, instead of a blank screen. */
function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center"
    >
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}
