import {
  createBrowserRouter,
  isRouteErrorResponse,
  Link,
  Navigate,
  useRouteError,
  type RouteObject,
} from 'react-router';
import { Button } from '@/components/ui/button';
import { ProfilePage } from '@/features/account/ProfilePage';
import { SettingsPage } from '@/features/account/SettingsPage';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { GuestOnly, RequireAuth } from '@/features/auth/route-guards';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ComparePage } from '@/features/history/ComparePage';
import { HistoryPage } from '@/features/history/HistoryPage';
import { IssueDetailPage } from '@/features/issues/IssueDetailPage';
import { ProjectDetailsPage } from '@/features/projects/ProjectDetailsPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { AccessibilityReport } from '@/features/reports/AccessibilityReport';
import { PendingReport } from '@/features/reports/PendingReport';
import { ReportsLayout } from '@/features/reports/ReportsLayout';
import { ResponsiveReport } from '@/features/reports/ResponsiveReport';
import { UiHealthReport } from '@/features/reports/UiHealthReport';
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
              { index: true, element: <Navigate to="/dashboard" replace /> },
              { path: 'dashboard', element: <DashboardPage /> },
              { path: 'projects', element: <ProjectsPage /> },
              { path: 'projects/:projectId', element: <ProjectDetailsPage /> },
              { path: 'websites', element: <WebsitesPage /> },
              { path: 'websites/new', element: <AddWebsitePage /> },
              { path: 'websites/:websiteId', element: <WebsiteDetailsPage /> },
              { path: 'websites/:websiteId/edit', element: <EditWebsitePage /> },
              { path: 'scans', element: <ScanCenterPage /> },
              { path: 'scans/:scanId', element: <ScanPage /> },
              {
                path: 'scans/:scanId/reports',
                element: <ReportsLayout />,
                children: [
                  { index: true, element: <Navigate to="accessibility" replace /> },
                  { path: 'accessibility', element: <AccessibilityReport /> },
                  { path: 'ui-health', element: <UiHealthReport /> },
                  { path: 'responsive', element: <ResponsiveReport /> },
                  { path: 'performance', element: <PendingReport kind="performance" /> },
                  { path: 'seo', element: <PendingReport kind="seo" /> },
                  { path: 'security', element: <PendingReport kind="security" /> },
                ],
              },
              { path: 'history', element: <HistoryPage /> },
              { path: 'history/compare', element: <ComparePage /> },
              { path: 'issues/:issueId', element: <IssueDetailPage /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: 'settings', element: <SettingsPage /> },
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
        <Link to="/dashboard">Go to the dashboard</Link>
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
