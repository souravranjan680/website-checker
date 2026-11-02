import { MANUAL_CHECKLIST, type AccessibilityReportDto, type ManualCheckState } from '@whc/shared';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/ErrorState';
import { canEdit } from '@/components/common/RoleBadge';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SeverityChart } from '@/features/dashboard/charts';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';
import { useAccessibilityReport, useUpdateChecklist } from './api';
import { ReportIssues } from './ReportIssues';
import { MetricTile } from './report-parts';

/** WCAG report: what axe-core found, grouped by criterion, rule and page, plus the manual checklist. */
export function AccessibilityReport() {
  const { scanId = '' } = useParams();
  const report = useAccessibilityReport(scanId);
  if (report.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (report.isError)
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;
  const editable = canEdit(r.scan.myRole);

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <MetricTile label="Score" value={r.scan.accessibilityScore} suffix="/100" />
        <MetricTile label="Violations" value={r.totals.violations} hint="Automated failures" />
        <MetricTile
          label="Needs review"
          value={r.totals.needsReview}
          hint="axe could not decide: check by hand"
        />
        <MetricTile label="Rules failed" value={r.totals.rules} />
        <MetricTile
          label="Pages affected"
          value={`${r.totals.pagesAffected} / ${r.totals.pagesScanned}`}
        />
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Severity distribution</CardTitle>
            <CardDescription>Automated violations in this scan</CardDescription>
          </CardHeader>
          <CardContent>
            {r.totals.violations === 0 ? (
              <p className="text-sm text-muted-foreground">No automated violations.</p>
            ) : (
              <SeverityChart data={r.severity} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most affected pages</CardTitle>
            <CardDescription>Pages with the most accessibility issues</CardDescription>
          </CardHeader>
          <CardContent>
            <PagesTable pages={r.pages} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>WCAG success criteria</CardTitle>
          <CardDescription>Criteria with at least one failure, in WCAG order</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {r.criteria.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">
              No criteria failed automated checks.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Criterion</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead className="text-right">Issues</TableHead>
                  <TableHead className="pr-6 text-right">Pages</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.criteria.map((c) => (
                  <TableRow key={c.criterion}>
                    <TableCell className="pl-6">
                      <span className="font-medium tabular-nums">{c.criterion}</span> {c.name ?? ''}
                    </TableCell>
                    <TableCell>{c.level ?? '–'}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.issues}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">{c.pages}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RulesCard rules={r.rules} />
      <ManualChecklist scanId={scanId} report={r} editable={editable} />
      <ReportIssues
        scanId={scanId}
        category="ACCESSIBILITY"
        canEdit={editable}
        title="All accessibility issues"
      />
    </div>
  );
}

function PagesTable({ pages }: { pages: AccessibilityReportDto['pages'] }) {
  if (pages.length === 0)
    return <p className="text-sm text-muted-foreground">No affected pages.</p>;
  return (
    <ul className="max-h-56 space-y-2 overflow-auto text-sm">
      {pages.slice(0, 20).map((p) => (
        <li key={p.url} className="flex items-center justify-between gap-2">
          <span className="truncate">{p.url}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {p.issues} issues{p.critical ? ` · ${p.critical} critical` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RulesCard({ rules }: { rules: AccessibilityReportDto['rules'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Failed rules</CardTitle>
        <CardDescription>
          Each axe-core rule, how often it failed and on how many pages
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {rules.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">No rules failed.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Rule</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>WCAG</TableHead>
                <TableHead className="text-right">Issues</TableHead>
                <TableHead className="pr-6 text-right">Pages</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.ruleId}>
                  <TableCell className="max-w-96 pl-6">
                    <span className="block truncate font-medium">{rule.title}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <code>{rule.ruleId}</code>
                      {rule.helpUrl ? (
                        <a
                          href={rule.helpUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center hover:text-foreground"
                        >
                          <ExternalLink className="size-3" aria-hidden="true" />
                          <span className="sr-only">
                            Guidance for {rule.ruleId} (opens in a new tab)
                          </span>
                        </a>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={rule.severity} />
                  </TableCell>
                  <TableCell className="text-xs">{rule.wcag.join(', ') || '–'}</TableCell>
                  <TableCell className="text-right tabular-nums">{rule.issues}</TableCell>
                  <TableCell className="pr-6 text-right tabular-nums">{rule.pages}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

const CHECK_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Not checked' },
  { value: 'PASS', label: 'Pass' },
  { value: 'FAIL', label: 'Fail' },
  { value: 'NOT_APPLICABLE', label: 'Not applicable' },
];

/** Things only a person can judge. Results are saved on the scan, with who and when. */
function ManualChecklist({
  scanId,
  report,
  editable,
}: {
  scanId: string;
  report: AccessibilityReportDto;
  editable: boolean;
}) {
  const done = MANUAL_CHECKLIST.filter((item) => report.checklist[item.id]?.status).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual review checklist</CardTitle>
        <CardDescription>
          Automated tools find only part of all accessibility problems. A person should check these
          ({done} of {MANUAL_CHECKLIST.length} done).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {MANUAL_CHECKLIST.map((item) => (
            <ChecklistRow
              key={item.id}
              scanId={scanId}
              item={item}
              state={report.checklist[item.id]}
              editable={editable}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ChecklistRow({
  scanId,
  item,
  state,
  editable,
}: {
  scanId: string;
  item: (typeof MANUAL_CHECKLIST)[number];
  state: ManualCheckState | undefined;
  editable: boolean;
}) {
  const update = useUpdateChecklist(scanId);
  const [note, setNote] = useState(state?.note ?? '');

  const save = async (status: ManualCheckState['status'], nextNote = note) => {
    try {
      await update.mutateAsync({ itemId: item.id, status, note: nextNote || undefined });
      toast.success('Checklist saved.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const status = state?.status ?? null;

  return (
    <li className="grid gap-2 py-3 md:grid-cols-[1fr_auto]">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {item.title} <span className="font-normal text-muted-foreground">· WCAG {item.wcag}</span>
        </p>
        <p className="text-xs text-muted-foreground">{item.how}</p>
        {state?.by && state.at ? (
          <p className="text-xs text-muted-foreground">
            Last updated by {state.by}, {formatDateTime(state.at)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <NativeSelect
          aria-label={`Result: ${item.title}`}
          value={status ?? ''}
          disabled={!editable || update.isPending}
          onChange={(e) => void save((e.target.value || null) as ManualCheckState['status'])}
        >
          {CHECK_OPTIONS.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          aria-label={`Note: ${item.title}`}
          placeholder="Note (optional)"
          className="h-8 w-56"
          maxLength={500}
          value={note}
          disabled={!editable}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== (state?.note ?? '')) void save(status, note);
          }}
        />
      </div>
    </li>
  );
}
