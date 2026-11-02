/**
 * "Open in dashboard": the address of the dashboard's "Add website" form with the
 * checked page pre-filled. Only the page's origin and path are passed: query strings
 * and fragments can contain session IDs or personal data, so they are dropped.
 * The dashboard still validates the address and asks you to confirm authorization.
 */
export function dashboardHandoffUrl(dashboardUrl: string, pageUrl: string): string {
  const page = new URL(pageUrl);
  const target = new URL(`${dashboardUrl.replace(/\/+$/, '')}/websites/new`);
  target.searchParams.set('baseUrl', `${page.origin}${page.pathname}`);
  return target.toString();
}
