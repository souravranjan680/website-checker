import { CircleSlash, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { ErrorState } from '@/components/common/ErrorState';
import { canEdit } from '@/components/common/RoleBadge';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FUNCTIONAL_CHECK_LABEL } from '@/lib/labels';
import { useFunctionalReport } from './api';
import { ReportIssues } from './ReportIssues';
import { MetricTile } from './report-parts';

const SKIP_REASON: Record<string, string> = {
  'destructive-or-state-changing': 'could change data (delete, send, save…)',
  'form-submit': 'submits a form',
  'navigation-link': 'navigates (links are followed by the crawler)',
  'opens-dialog': 'opens a dialog (not explored yet)',
  'native-form-control': 'form field',
  'unknown-action': 'unknown action',
  disabled: 'disabled',
  'not-visible': 'not visible',
  'already-open': 'already open',
  limit: 'over the limit',
};

const RESULT: Record<string, string> = {
  opened: 'Opened',
  'no-visible-effect': 'Nothing happened',
  'changed-without-new-content': 'Changed, nothing new shown',
  'not-clickable': 'Could not be clicked',
  disappeared: 'Disappeared',
};

const BLOCKED: Record<string, string> = {
  request: 'Request',
  navigation: 'Navigation',
  websocket: 'WebSocket',
  download: 'Download',
  popup: 'Pop-up',
  dialog: 'Dialog',
  'form-submit': 'Form submission',
};

const ruleIdOf = (checkType: string) => `functional/${checkType.toLowerCase().replace(/_/g, '-')}`;

/**
 * The safe explorer (Phase 9): menus, tabs and expandable sections opened on the
 * first pages, what that revealed, and everything it skipped or blocked for safety.
 */
export function FunctionalReport() {
  const { scanId = '' } = useParams();
  const report = useFunctionalReport(scanId);
  const [checkType, setCheckType] = useState<string | undefined>();
  if (report.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (report.isError)
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;

  if (r.pages.length === 0 && r.checks.length === 0) {
    return (
      <Alert>
        <CircleSlash aria-hidden="true" />
        <AlertTitle>No pages were explored in this scan</AlertTitle>
        <AlertDescription>
          The explorer opens menus, tabs and expandable sections. It is switched off for this
          website, or this scan ran before it existed. Turn it on in the website’s settings and
          rescan.
        </AlertDescription>
      </Alert>
    );
  }
  const total = r.checks.reduce((n, c) => n + c.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <MetricTile label="Pages explored" value={r.totals.pagesExplored} />
        <MetricTile label="Controls opened" value={r.totals.controlsExplored} />
        <MetricTile label="Findings" value={total} />
        <MetricTile
          label="Accessibility in opened states"
          value={r.openStateAccessibilityIssues}
          hint="Accessibility problems found only after opening a menu or panel (listed in the Accessibility report; they do not change its score)"
        />
        <MetricTile
          label="Actions blocked"
          value={r.totals.actionsBlocked}
          hint="Requests, navigations, downloads and pop-ups the page tried while it was explored"
        />
      </dl>

      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>How the explorer stays safe</AlertTitle>
        <AlertDescription>
          It only opens menus, tabs and expandable sections. It never submits forms or uses controls
          that could change data (delete, send, save, buy…). While it works, the page cannot send
          data, navigate, open pop-ups, download files or use WebSockets. Findings from an
          interaction during which something was blocked are marked inconclusive.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Checks</CardTitle>
          <CardDescription>Choose a check to filter the issue list below</CardDescription>
        </CardHeader>
        <CardContent>
          {r.checks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No interaction or navigation problems were found.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by check">
              <Button
                size="sm"
                variant={checkType ? 'outline' : 'secondary'}
                aria-pressed={!checkType}
                onClick={() => setCheckType(undefined)}
              >
                All ({total})
              </Button>
              {r.checks.map((c) => (
                <Button
                  key={c.checkType}
                  size="sm"
                  variant={checkType === c.checkType ? 'secondary' : 'outline'}
                  aria-pressed={checkType === c.checkType}
                  onClick={() => setCheckType(c.checkType)}
                >
                  <SeverityBadge severity={c.highestSeverity} />
                  {FUNCTIONAL_CHECK_LABEL[c.checkType] ?? c.checkType} ({c.count})
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {r.pages.map((page) => (
          <Card key={page.url}>
            <CardHeader>
              <CardTitle className="break-all text-base">{page.url}</CardTitle>
              <CardDescription>
                {page.error ??
                  `${page.explored} of ${page.eligible} eligible controls explored${page.stoppedEarly ? ` · stopped early: ${page.stoppedEarly}` : ''}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {page.controls.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Explored</p>
                  <ul className="flex flex-wrap gap-1.5" aria-label="Explored controls">
                    {page.controls.map((c, i) => (
                      <li key={i}>
                        <Badge
                          variant={c.result === 'opened' ? 'secondary' : 'outline'}
                          title={RESULT[c.result] ?? c.result}
                        >
                          {c.name || '(unnamed)'}
                          {c.result !== 'opened' ? ` · ${RESULT[c.result] ?? c.result}` : ''}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {page.skipped.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Not used, for safety or because they are not menus
                  </p>
                  <ul className="space-y-0.5" aria-label="Skipped controls">
                    {page.skipped.map((s, i) => (
                      <li key={i}>
                        <span className="font-medium">{s.name || '(unnamed)'}</span>{' '}
                        <span className="text-muted-foreground">
                          · {SKIP_REASON[s.reason] ?? s.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {page.blocked.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Blocked while exploring
                  </p>
                  {/* Every kind is always shown with its count; then a few examples. */}
                  <ul className="mb-1 flex flex-wrap gap-1.5" aria-label="Blocked action kinds">
                    {Object.entries(
                      page.blocked.reduce<Record<string, number>>((counts, b) => {
                        counts[b.kind] = (counts[b.kind] ?? 0) + 1;
                        return counts;
                      }, {}),
                    ).map(([kind, count]) => (
                      <li key={kind}>
                        <Badge variant="outline">
                          {BLOCKED[kind] ?? kind} × {count}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-0.5" aria-label="Blocked actions">
                    {page.blocked.slice(0, 8).map((b, i) => (
                      <li key={i} className="break-all">
                        <span className="font-medium">{BLOCKED[b.kind] ?? b.kind}</span>{' '}
                        <span className="text-muted-foreground">
                          {[b.method, b.url ?? b.detail].filter(Boolean).join(' ')}
                        </span>
                      </li>
                    ))}
                    {page.blocked.length > 8 ? (
                      <li className="text-muted-foreground">and {page.blocked.length - 8} more</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <ReportIssues
        key={checkType ?? 'all'}
        scanId={scanId}
        category="FUNCTIONAL"
        canEdit={canEdit(r.scan.myRole)}
        extraFilters={{ ruleId: checkType ? ruleIdOf(checkType) : undefined }}
        title={
          checkType ? (FUNCTIONAL_CHECK_LABEL[checkType] ?? checkType) : 'All interaction issues'
        }
      />
    </div>
  );
}
