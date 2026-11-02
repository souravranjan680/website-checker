import {
  createBrowserRouter,
  isRouteErrorResponse,
  Link,
  Navigate,
  useRouteError,
  type RouteObject,
} from 'react-router';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { GuestOnly, RequireAuth } from '@/features/auth/route-guards';
import { ProjectDetailsPage } from '@/features/projects/ProjectDetailsPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { ScanCenterPage } from '@/features/scans/ScanCenterPage';
import { ScanPage } from '@/features/scans/ScanPage';
import { SystemStatusPage } from '@/features/system/SystemStatusPage';
import { AddWebsitePage } from '@/features/websites/AddWebsitePage';
import { EditWebsitePage } from '@/features/websites/EditWebsitePage';
import { WebsiteDetailsPage } from '@/features/websites/WebsiteDetailsPage';
import { WebsitesPage } from '@/features/websites/WebsitesPage';
import { AppLayout } from './layouts/AppLayout';

/**
 * All routes. Public pages use AuthLayout; everything inside RequireAuth needs a
 * signed-in user. (The API checks permissions again on every request.)
 */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          {
            element: <GuestOnly />,
            children: [
              { path: '/login', element: <LoginPage /> },
              { path: '/register', element: <RegisterPage /> },
              { path: '/forgot-password', element: <ForgotPasswordPage /> },
            ],
          },
          { path: '/reset-password', element: <ResetPasswordPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            path: '/',
            element: <AppLayout />,
            children: [
              { index: true, element: <Navigate to="/projects" replace /> },
              { path: 'projects', element: <ProjectsPage /> },
              { path: 'projects/:projectId', element: <ProjectDetailsPage /> },
              { path: 'websites', element: <WebsitesPage /> },
              { path: 'websites/new', element: <AddWebsitePage /> },
              { path: 'websites/:websiteId', element: <WebsiteDetailsPage /> },
              { path: 'websites/:websiteId/edit', element: <EditWebsitePage /> },
              { path: 'scans', element: <ScanCenterPage /> },
              { path: 'scans/:scanId', element: <ScanPage /> },
              { path: 'status', element: <SystemStatusPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);

function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        This page doesn&apos;t exist yet, or the link is wrong.
      </p>
      <Button asChild>
        <Link to="/projects">Go to projects</Link>
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
