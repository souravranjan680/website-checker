import { VIEWPORTS, type ScanDetailsDto, type ScanPageDto } from '@whc/shared';
import { ArrowRightLeft, Ban, FileSearch, RotateCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { canEdit } from '@/components/common/RoleBadge';
import { ScanStatusBadge, SeverityBadge } from '@/components/common/StatusBadges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';
import {
  isActive,
  useCancelScan,
  useRescan,
  useScan,
  useScanComparison,
  useScanIssues,
  useScanPages,
} from './api';
import { IssueList } from './IssueList';
import { ScreenshotPreview } from './Screenshot';
import { useScanEvents } from './use-scan-events';

export function ScanPage() {
  const { scanId = '' } = useParams();
  const scan = useScan(scanId);

  if (scan.isPending) {
    return (
      <div
        className="mx-auto flex w-full max-w-6xl flex-col gap-6"
        aria-busy="true"
        aria-label="Loading scan"
      >
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (scan.isError) {
    const missing = scan.error instanceof ApiError && scan.error.status === 404;
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title={missing ? 'Scan not found' : "Couldn't load this scan"}
          error={
            missing
              ? new Error("It doesn't exist, or you don't have access to its project.")
              : scan.error
          }
          onRetry={missing ? undefined : () => void scan.refetch()}
        />
      </div>
    );
  }
  return <ScanView scan={scan.data} />;
}

function ScanView({ scan }: { scan: ScanDetailsDto }) {
  const active = isActive(scan.status);
  const live = useScanEvents(scan.id, active);
  const editable = canEdit(scan.myRole);
  const navigate = useNavigate();
  const cancel = useCancelScan(scan.id);
  const rescan = useRescan();

  const onCancel = async () => {
    try {
      await cancel.mutateAsync();
      toast.success('Cancelling the scan…');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const onRescan = async () => {
    try {
      const next = await rescan.mutateAsync(scan.id);
      toast.success('New scan queued.');
      navigate(`/scans/${next.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        back={{ to: `/websites/${scan.website.id}`, label: scan.website.name }}
        title={`Scan of ${scan.website.name}`}
        badge={<ScanStatusBadge status={live?.status && active ? live.status : scan.status} />}
        description={
          <>
            {scan.website.baseUrl} · started {formatDateTime(scan.queuedAt)}
            {scan.triggeredBy ? ` by ${scan.triggeredBy.name}` : ''}
            {scan.durationMs ? ` · took ${Math.round(scan.durationMs / 1000)} s` : ''}
          </>
        }
        actions={
          editable ? (
            active ? (
              <Button
                variant="outline"
                onClick={() => void onCancel()}
                disabled={cancel.isPending || scan.status === 'CANCELLING'}
              >
                <Ban aria-hidden="true" />{' '}
                {scan.status === 'CANCELLING' ? 'Cancelling…' : 'Cancel scan'}
              </Button>
            ) : (
              <Button onClick={() => void onRescan()} disabled={rescan.isPending}>
                <RotateCw aria-hidden="true" /> Rescan
              </Button>
            )
          ) : null
        }
      />

      {active ? <LiveProgress scan={scan} live={live} /> : <FinishedSummary scan={scan} />}
      {!active || scan.totalIssues > 0 || (live?.issuesFound ?? 0) > 0 ? (
        <Results scan={scan} />
      ) : null}
    </div>
  );
}

function LiveProgress({
  scan,
  live,
}: {
  scan: ScanDetailsDto;
  live: ReturnType<typeof useScanEvents>;
}) {
  const progress = live?.progress ?? scan.progress;
  const step = live?.step ?? scan.currentStep ?? 'Waiting in the queue';
  return (
    <Card aria-live="polite">
      <CardHeader>
        <CardTitle>
          {scan.status === 'QUEUED' && !live ? 'Waiting for a scanner…' : 'Scanning in progress'}
        </CardTitle>
        <CardDescription>{step}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={progress} aria-label="Scan progress" />
        <p className="text-sm text-muted-foreground">{progress}% complete</p>
        {live?.currentUrl ? (
          <p className="truncate text-sm">
            <span className="text-muted-foreground">Current page: </span>
            <span className="font-medium">{live.currentUrl}</span>
          </p>
        ) : null}
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Pages found" value={live?.pagesDiscovered ?? scan.pagesDiscovered} />
          <Stat label="Pages scanned" value={live?.pagesScanned ?? scan.pagesScanned} />
          <Stat label="Pages failed" value={live?.pagesFailed ?? scan.pagesFailed} />
          <Stat label="Issues found" value={live?.issuesFound ?? scan.totalIssues} />
        </dl>
      </CardContent>
    </Card>
  );
}

function FinishedSummary({ scan }: { scan: ScanDetailsDto }) {
  return (
    <div className="flex flex-col gap-4">
      {scan.errorMessage ? (
        <Alert variant={scan.status === 'FAILED' ? 'destructive' : 'default'}>
          <AlertTitle>
            {scan.status === 'FAILED'
              ? 'The scan failed'
              : scan.status === 'CANCELLED'
                ? 'Cancelled'
                : 'Partly completed'}
          </AlertTitle>
          <AlertDescription>{scan.errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ScoreCard label="Accessibility score" value={scan.accessibilityScore} />
        <ScoreCard label="UI health score" value={scan.uiHealthScore} />
        <Card className="gap-1 py-4">
          <CardContent className="px-4">
            <dt className="text-sm text-muted-foreground">Pages scanned</dt>
            <dd className="text-2xl font-semibold tabular-nums">{scan.pagesScanned}</dd>
            {scan.pagesFailed ? (
              <dd className="text-xs text-muted-foreground">
                {scan.pagesFailed} could not be loaded
              </dd>
            ) : null}
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="px-4">
            <dt className="text-sm text-muted-foreground">Issues found</dt>
            <dd className="text-2xl font-semibold tabular-nums">{scan.totalIssues}</dd>
            <dd className="mt-1 flex flex-wrap gap-1">
              {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((s) =>
                scan.severityCounts[s] ? (
                  <span key={s} className="inline-flex items-center gap-1 text-xs">
                    <SeverityBadge severity={s} /> {scan.severityCounts[s]}
                  </span>
                ) : null,
              )}
            </dd>
          </CardContent>
        </Card>
      </dl>
      <p className="text-xs text-muted-foreground">
        Scores are this tool&apos;s own heuristic (fewer and less severe problems → higher score).
        Automated checks find only part of all accessibility problems; manual testing is still
        needed.
      </p>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number | null }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="text-2xl font-semibold tabular-nums">{value ?? '-'}</dd>
        <dd className="text-xs text-muted-foreground">
          {value === null ? 'Not measured' : 'out of 100'}
        </dd>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Results({ scan }: { scan: ScanDetailsDto }) {
  const finished = !isActive(scan.status);
  const pages = useScanPages(scan.id);
  const pageWidths = useMemo(() => {
    const map = new Map<string, number>();
    for (const page of pages.data ?? [])
      for (const shot of page.screenshots) map.set(shot.id, shot.width);
    return map;
  }, [pages.data]);
  const counts = scan.categoryCounts;

  return (
    <Tabs defaultValue="ACCESSIBILITY">
      <TabsList className="flex-wrap">
        <TabsTrigger value="ACCESSIBILITY">Accessibility ({counts.ACCESSIBILITY ?? 0})</TabsTrigger>
        <TabsTrigger value="UI_HEALTH">UI health ({counts.UI_HEALTH ?? 0})</TabsTrigger>
        <TabsTrigger value="RESPONSIVE">Screen sizes ({counts.RESPONSIVE ?? 0})</TabsTrigger>
        <TabsTrigger value="pages">Pages ({pages.data?.length ?? 0})</TabsTrigger>
        {finished ? <TabsTrigger value="compare">Compare</TabsTrigger> : null}
      </TabsList>
      {(['ACCESSIBILITY', 'UI_HEALTH'] as const).map((category) => (
        <TabsContent key={category} value={category} className="pt-4">
          <CategoryIssues scan={scan} category={category} pageWidths={pageWidths} />
        </TabsContent>
      ))}
      <TabsContent value="RESPONSIVE" className="space-y-4 pt-4">
        <ResponsiveGallery pages={pages.data ?? []} />
        <CategoryIssues scan={scan} category="RESPONSIVE" pageWidths={pageWidths} />
      </TabsContent>
      <TabsContent value="pages" className="pt-4">
        <PagesTable pages={pages.data ?? []} />
      </TabsContent>
      {finished ? (
        <TabsContent value="compare" className="pt-4">
          <Comparison scan={scan} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

function CategoryIssues({
  scan,
  category,
  pageWidths,
}: {
  scan: ScanDetailsDto;
  category: string;
  pageWidths: Map<string, number>;
}) {
  const [severity, setSeverity] = useState<string | undefined>();
  const issues = useScanIssues(scan.id, { category, severity });
  if (issues.isPending) return <Skeleton className="h-40" />;
  if (issues.isError)
    return <ErrorState error={issues.error} onRetry={() => void issues.refetch()} />;
  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter by severity"
      >
        {[undefined, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].map((value) => (
          <Button
            key={value ?? 'all'}
            size="sm"
            variant={severity === value ? 'secondary' : 'ghost'}
            aria-pressed={severity === value}
            onClick={() => setSeverity(value)}
          >
            {value ? value.charAt(0) + value.slice(1).toLowerCase() : 'All'}
          </Button>
        ))}
        <span className="ml-auto text-sm text-muted-foreground">
          {issues.data.meta.total} issues
        </span>
      </div>
      {category === 'ACCESSIBILITY' ? (
        <p className="text-xs text-muted-foreground">
          Automated checks (axe-core, WCAG 2.0–2.2 A/AA) catch roughly a third of accessibility
          problems. &quot;Needs review&quot; items must be checked by a person.
        </p>
      ) : null}
      {issues.data.data.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No issues here"
          description="Nothing was detected in this category."
        />
      ) : (
        <IssueList
          scanId={scan.id}
          issues={issues.data.data}
          canEdit={canEdit(scan.myRole)}
          pageWidths={pageWidths}
        />
      )}
    </div>
  );
}

function ResponsiveGallery({ pages }: { pages: ScanPageDto[] }) {
  const page = pages.find((p) => p.screenshots.some((s) => s.kind === 'VIEWPORT'));
  if (!page) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Screen sizes</CardTitle>
        <CardDescription className="truncate">{page.url}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {VIEWPORTS.map((v) => {
            const label = `${v.width}x${v.height}`;
            const shot = page.screenshots.find((s) => s.viewport === label);
            return (
              <li key={label} className="space-y-1">
                <p className="text-sm font-medium">
                  {v.name}{' '}
                  <span className="font-normal text-muted-foreground">
                    {v.width}×{v.height}
                  </span>
                </p>
                {shot ? (
                  <ScreenshotPreview id={shot.id} title={`${v.name} (${label})`} />
                ) : (
                  <p className="text-xs text-muted-foreground">No screenshot</p>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function PagesTable({ pages }: { pages: ScanPageDto[] }) {
  if (pages.length === 0) return <p className="text-sm text-muted-foreground">No pages yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Page</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Load time</TableHead>
          <TableHead className="text-right">Issues</TableHead>
          <TableHead className="text-right">Console / network errors</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pages.map((page) => (
          <TableRow key={page.id}>
            <TableCell className="max-w-96">
              <span className="block truncate font-medium">{page.title || page.url}</span>
              <span className="block truncate text-xs text-muted-foreground">{page.url}</span>
              {page.errorMessage ? (
                <span className="block text-xs text-muted-foreground">{page.errorMessage}</span>
              ) : null}
            </TableCell>
            <TableCell>
              {page.status === 'DONE'
                ? 'Scanned'
                : page.status === 'SKIPPED'
                  ? 'Skipped'
                  : 'Failed'}
              {page.httpStatus ? (
                <span className="text-xs text-muted-foreground"> · HTTP {page.httpStatus}</span>
              ) : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {page.loadTimeMs ? `${page.loadTimeMs} ms` : '-'}
            </TableCell>
            <TableCell className="text-right tabular-nums">{page.issueCount}</TableCell>
            <TableCell className="text-right tabular-nums">
              {page.consoleErrorCount} / {page.failedRequestCount}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Comparison({ scan }: { scan: ScanDetailsDto }) {
  const comparison = useScanComparison(scan.id);
  if (comparison.isPending) return <Skeleton className="h-32" />;
  if (comparison.isError) return <ErrorState error={comparison.error} />;
  const data = comparison.data;
  if (!data.comparedWithScanId) {
    return (
      <EmptyState
        icon={ArrowRightLeft}
        title="Nothing to compare yet"
        description="This is the first finished scan of this website. Rescan after making changes to see what was fixed."
      />
    );
  }
  const sections = [
    { title: 'New', items: data.newIssues, hint: 'Found now, not in the previous scan' },
    { title: 'Resolved', items: data.resolvedIssues, hint: 'In the previous scan, gone now' },
    { title: 'Still present', items: data.recurringIssues, hint: 'In both scans' },
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Compared with the{' '}
        <Link className="underline" to={`/scans/${data.comparedWithScanId}`}>
          previous scan
        </Link>
        . Issues are matched by identity (rule, page, screen size and element).
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>
                {section.title} ({section.items.length})
              </CardTitle>
              <CardDescription>{section.hint}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="max-h-80 space-y-2 overflow-auto text-sm">
                {section.items.slice(0, 100).map((item) => (
                  <li key={item.fingerprint} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.pageUrl}
                      </span>
                    </span>
                    <SeverityBadge severity={item.severity} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
