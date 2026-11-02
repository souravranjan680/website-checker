import {
  bugReportToJira,
  bugReportToMarkdown,
  BUG_REPORT_STATUSES,
  PRIORITIES,
  type BugReportDto,
} from '@whc/shared';
import { Copy, Download, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { canEdit } from '@/components/common/RoleBadge';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ScreenshotPreview } from '@/features/scans/Screenshot';
import { ConfirmDialog } from '@/features/visual/components';
import { ApiError } from '@/lib/api-client';
import { downloadFromApi } from '@/lib/download';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';
import { BUG_STATUS_LABEL as STATUS_LABEL } from '@/lib/labels';
import { useBugReport, useDeleteBugReport, useUpdateBugReport, type BugReportUpdate } from './api';

/** /bug-reports/:id : read, copy, export and (for editors) edit one bug report. */
export function BugReportPage() {
  const { reportId = '' } = useParams();
  const report = useBugReport(reportId);
  if (report.isPending)
    return (
      <Skeleton
        className="mx-auto h-96 w-full max-w-5xl rounded-xl"
        aria-label="Loading bug report"
      />
    );
  if (report.isError) {
    const missing = report.error instanceof ApiError && report.error.status === 404;
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title={missing ? 'Bug report not found' : "Couldn't load this bug report"}
          error={
            missing
              ? new Error("It doesn't exist, or you don't have access to its project.")
              : report.error
          }
        />
      </div>
    );
  }
  return <ReportView report={report.data} />;
}

function ReportView({ report }: { report: BugReportDto }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useDeleteBugReport(report.id);
  const navigate = useNavigate();
  const editable = canEdit(report.myRole);
  const screenshotUrl = report.screenshotId
    ? `${window.location.origin}/api/screenshots/${report.screenshotId}`
    : null;

  const copy = async (format: 'markdown' | 'jira') => {
    const text =
      format === 'markdown'
        ? bugReportToMarkdown(report, screenshotUrl)
        : bugReportToJira(report, screenshotUrl);
    try {
      await navigator.clipboard.writeText(text);
      toast.success(format === 'markdown' ? 'Markdown copied.' : 'Jira text copied.');
    } catch {
      toast.error('The browser blocked clipboard access. Use Download instead.');
    }
  };
  const download = async (format: 'markdown' | 'jira' | 'json') => {
    try {
      await downloadFromApi(
        `/api/bug-reports/${report.id}/export?format=${format}`,
        `bug-report.${format === 'json' ? 'json' : format === 'jira' ? 'jira.txt' : 'md'}`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        back={{ to: '/bug-reports', label: 'Bug reports' }}
        title={report.title}
        badge={
          <>
            <SeverityBadge severity={report.severity} />
            <Badge variant="secondary">{report.priority}</Badge>
            <Badge variant="outline">{STATUS_LABEL[report.status]}</Badge>
          </>
        }
        description={
          <>
            {report.website ? (
              <Link to={`/websites/${report.website.id}`} className="hover:underline">
                {report.website.name}
              </Link>
            ) : (
              'Website deleted'
            )}
            {' · '}created {formatDateTime(report.createdAt)}
            {report.createdBy ? ` by ${report.createdBy.name}` : ''}
            {report.issueId ? (
              <>
                {' · '}
                <Link to={`/issues/${report.issueId}`} className="hover:underline">
                  source issue
                </Link>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => void copy('markdown')}>
              <Copy aria-hidden="true" /> Copy Markdown
            </Button>
            <Button variant="outline" onClick={() => void copy('jira')}>
              <Copy aria-hidden="true" /> Copy for Jira
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download aria-hidden="true" /> Download
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void download('markdown')}>
                  Markdown (.md)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void download('jira')}>
                  Jira text (.txt)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void download('json')}>JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {editable ? (
              <>
                <Button variant="outline" onClick={() => setEditing((e) => !e)}>
                  <Pencil aria-hidden="true" /> {editing ? 'Stop editing' : 'Edit'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDeleting(true)}
                  aria-label="Delete bug report"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {editing ? (
        <EditForm report={report} onDone={() => setEditing(false)} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardContent className="space-y-5 text-sm">
              <Section title="Description">
                <p className="whitespace-pre-wrap">{report.description}</p>
              </Section>
              <Section title="Steps to reproduce">
                <ol className="list-decimal space-y-1 pl-5">
                  {report.stepsToReproduce.map((step, i) => (
                    <li key={i} className="break-words">
                      {step}
                    </li>
                  ))}
                </ol>
              </Section>
              <div className="grid gap-4 md:grid-cols-2">
                <Section title="Expected behavior">
                  {report.expectedBehavior ? (
                    <p className="whitespace-pre-wrap">{report.expectedBehavior}</p>
                  ) : (
                    <p className="text-muted-foreground italic">
                      Not determined by the scanner.{editable ? ' Use Edit to describe it.' : ''}
                    </p>
                  )}
                </Section>
                <Section title="Actual behavior">
                  <p className="whitespace-pre-wrap">{report.actualBehavior}</p>
                </Section>
              </div>
              {report.selector ? (
                <Section title="Element">
                  <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
                    {report.selector}
                  </pre>
                  {/* Untrusted HTML from the scanned site: shown as text only. */}
                  {report.htmlSnippet ? (
                    <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                      {report.htmlSnippet}
                    </pre>
                  ) : null}
                </Section>
              ) : null}
              {report.suggestedFix ? (
                <Section title="Suggested fix">
                  <p className="whitespace-pre-wrap">{report.suggestedFix}</p>
                </Section>
              ) : null}
            </CardContent>
          </Card>
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Environment</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm">
                  <Row label="URL">
                    <span className="break-all">{report.affectedUrl}</span>
                  </Row>
                  <Row label="Browser">{report.browser}</Row>
                  <Row label="Viewport">{report.viewport}</Row>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Screenshot</CardTitle>
              </CardHeader>
              <CardContent>
                {report.screenshotId ? (
                  <ScreenshotPreview id={report.screenshotId} title={report.title} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No screenshot for this kind of issue.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this bug report?"
        description="The report is removed. The issue it was made from is not affected."
        confirmLabel="Delete report"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync();
          toast.success('Bug report deleted.');
          navigate('/bug-reports', { replace: true });
        }}
      />
    </div>
  );
}

function EditForm({ report, onDone }: { report: BugReportDto; onDone: () => void }) {
  const update = useUpdateBugReport(report.id);
  const [form, setForm] = useState({
    title: report.title,
    priority: report.priority,
    status: report.status,
    description: report.description,
    steps: report.stepsToReproduce.join('\n'),
    expectedBehavior: report.expectedBehavior,
    actualBehavior: report.actualBehavior,
    suggestedFix: report.suggestedFix ?? '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    const input: BugReportUpdate = {
      title: form.title,
      priority: form.priority,
      status: form.status,
      description: form.description,
      stepsToReproduce: form.steps
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      expectedBehavior: form.expectedBehavior,
      actualBehavior: form.actualBehavior,
      suggestedFix: form.suggestedFix.trim() || null,
    };
    try {
      await update.mutateAsync(input);
      toast.success('Bug report saved.');
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-4">
        <Field id="br-title" label="Title">
          <Input id="br-title" value={form.title} onChange={set('title')} maxLength={200} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="br-priority" label="Priority">
            <NativeSelect id="br-priority" value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {p}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field id="br-status" label="Status">
            <NativeSelect id="br-status" value={form.status} onChange={set('status')}>
              {BUG_REPORT_STATUSES.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {STATUS_LABEL[s]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field id="br-description" label="Description">
          <Textarea
            id="br-description"
            rows={4}
            value={form.description}
            onChange={set('description')}
          />
        </Field>
        <Field id="br-steps" label="Steps to reproduce (one per line)">
          <Textarea id="br-steps" rows={5} value={form.steps} onChange={set('steps')} />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="br-expected" label="Expected behavior">
            <Textarea
              id="br-expected"
              rows={3}
              value={form.expectedBehavior}
              onChange={set('expectedBehavior')}
            />
          </Field>
          <Field id="br-actual" label="Actual behavior">
            <Textarea
              id="br-actual"
              rows={3}
              value={form.actualBehavior}
              onChange={set('actualBehavior')}
            />
          </Field>
        </div>
        <Field id="br-fix" label="Suggested fix">
          <Textarea id="br-fix" rows={3} value={form.suggestedFix} onChange={set('suggestedFix')} />
        </Field>
        <div className="flex gap-2">
          <Button
            onClick={() => void save()}
            disabled={update.isPending || form.title.trim().length < 3}
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
