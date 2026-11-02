import type { SeoReportDto, SiteFileFacts } from '@whc/shared';
import { CheckCircle2, CircleSlash, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { ErrorState } from '@/components/common/ErrorState';
import { canEdit } from '@/components/common/RoleBadge';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSeoReport } from './api';
import { ReportIssues } from './ReportIssues';
import { MetricTile } from './report-parts';

/**
 * On-page technical SEO: titles, descriptions, headings, canonical, robots
 * directives, Open Graph, image alt, robots.txt and sitemap. Not ranking advice.
 */
export function SeoReport() {
  const { scanId = '' } = useParams();
  const report = useSeoReport(scanId);
  const [ruleId, setRuleId] = useState<string | undefined>();
  if (report.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (report.isError)
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;

  if (!r.site && r.checks.length === 0) {
    return (
      <Alert>
        <CircleSlash aria-hidden="true" />
        <AlertTitle>No SEO data for this scan</AlertTitle>
        <AlertDescription>
          This scan ran before the SEO audit was added (Phase 6). Rescan the website to get SEO
          results. Nothing is estimated.
        </AlertDescription>
      </Alert>
    );
  }
  const total = r.checks.reduce((n, c) => n + c.count, 0);
  const indexable = r.pages.filter((p) => p.indexable).length;
  const current = r.checks.find((c) => c.ruleId === ruleId);

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <MetricTile
          label="SEO score"
          value={r.scan.seoScore}
          suffix="/100"
          hint="Our heuristic: 100 minus a penalty per problem, averaged over pages. Not a search ranking."
        />
        <MetricTile label="Issues" value={total} />
        <MetricTile label="Checks failed" value={r.checks.length} />
        <MetricTile
          label="Indexable pages"
          value={`${indexable} / ${r.pages.length}`}
          hint="Pages without a noindex directive (meta robots or X-Robots-Tag)"
        />
        <MetricTile
          label="Open Graph complete"
          value={`${r.pages.filter((p) => p.hasOpenGraph).length} / ${r.pages.length}`}
        />
      </dl>

      {r.site ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SiteFileCard
            title="robots.txt"
            file={r.site.robotsTxt}
            detail={
              r.site.robotsTxt.found
                ? r.site.robotsTxt.blocksAll
                  ? 'Blocks the whole site for all crawlers (Disallow: /).'
                  : `Crawling allowed. ${r.site.robotsTxt.sitemaps.length} sitemap line(s).`
                : null
            }
            ok={r.site.robotsTxt.found && !r.site.robotsTxt.blocksAll}
          />
          <SiteFileCard
            title="XML sitemap"
            file={r.site.sitemap}
            detail={
              r.site.sitemap.found
                ? r.site.sitemap.validXml
                  ? `Valid XML sitemap (found via ${r.site.sitemap.source === 'robots.txt' ? 'robots.txt' : 'the default /sitemap.xml'}).`
                  : 'The file exists but is not an XML sitemap.'
                : null
            }
            ok={r.site.sitemap.found && r.site.sitemap.validXml}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Checks</CardTitle>
          <CardDescription>Choose a check to filter the issue list below</CardDescription>
        </CardHeader>
        <CardContent>
          {r.checks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No SEO problems were found.</p>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by check">
              <Button
                size="sm"
                variant={ruleId ? 'outline' : 'secondary'}
                aria-pressed={!ruleId}
                onClick={() => setRuleId(undefined)}
              >
                All ({total})
              </Button>
              {r.checks.map((c) => (
                <Button
                  key={c.ruleId}
                  size="sm"
                  variant={ruleId === c.ruleId ? 'secondary' : 'outline'}
                  aria-pressed={ruleId === c.ruleId}
                  onClick={() => setRuleId(c.ruleId)}
                >
                  <SeverityBadge severity={c.highestSeverity} /> {c.title} ({c.count})
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <PagesCard pages={r.pages} />

      <ReportIssues
        key={ruleId ?? 'all'}
        scanId={scanId}
        category="SEO"
        canEdit={canEdit(r.scan.myRole)}
        extraFilters={{ ruleId }}
        title={current ? current.title : 'All SEO issues'}
      />
      <p className="text-xs text-muted-foreground">
        Technical, on-page SEO only. Rankings, backlinks and content quality are not measured.
      </p>
    </div>
  );
}

function SiteFileCard({
  title,
  file,
  detail,
  ok,
}: {
  title: string;
  file: SiteFileFacts;
  detail: string | null;
  ok: boolean;
}) {
  const unchecked = file.status === null;
  const Icon = unchecked ? CircleSlash : ok ? CheckCircle2 : XCircle;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon
            className={`size-4 ${unchecked ? 'text-muted-foreground' : ok ? 'text-emerald-600' : 'text-red-600'}`}
            aria-hidden="true"
          />
          {title}
        </CardTitle>
        <CardDescription className="break-all">{file.url}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {unchecked ? (
          <p>Could not be checked ({file.error ?? 'request failed'}). Not counted as missing.</p>
        ) : file.found ? (
          <p>
            HTTP {file.status}. {detail}
          </p>
        ) : (
          <p>Not found (HTTP {file.status}).</p>
        )}
      </CardContent>
    </Card>
  );
}

function PagesCard({ pages }: { pages: SeoReportDto['pages'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Page metadata</CardTitle>
        <CardDescription>What search engines see on each scanned page</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Page and title</TableHead>
              <TableHead className="text-right">Description</TableHead>
              <TableHead className="text-right">h1</TableHead>
              <TableHead>Canonical</TableHead>
              <TableHead>Indexing</TableHead>
              <TableHead className="pr-6 text-right">Issues</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.map((p) => (
              <TableRow key={p.url}>
                <TableCell className="max-w-80 pl-6">
                  <span className="block truncate font-medium">
                    {p.title || <span className="text-muted-foreground">(no title)</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{p.url}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.metaDescriptionLength === null ? '–' : `${p.metaDescriptionLength} chars`}
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.h1Count ?? '–'}</TableCell>
                <TableCell className="max-w-48 truncate text-xs">{p.canonical ?? '–'}</TableCell>
                <TableCell className="text-xs">
                  {p.indexable ? 'Indexable' : <span title={p.metaRobots ?? ''}>noindex</span>}
                </TableCell>
                <TableCell className="pr-6 text-right tabular-nums">{p.issues}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
