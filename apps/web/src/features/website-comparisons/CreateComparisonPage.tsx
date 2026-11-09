import { zodResolver } from '@hookform/resolvers/zod';
import {
  createWebsiteComparisonSchema,
  type ProjectSummaryDto,
  type WebsiteComparisonSiteDto,
} from '@whc/shared';
import { AlertCircle, ArrowLeftRight, FolderKanban, Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { SelectField, TextField } from '@/components/common/form-fields';
import { canEdit } from '@/components/common/RoleBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/projects/api';
import { applyApiErrors } from '@/lib/form-errors';
import { useCreateWebsiteComparison } from './api';
import {
  ComparisonSettingsFields,
  DEFAULT_COMPARISON_SETTINGS,
  settingsFormShape,
  settingsFormValues,
  settingsFromForm,
  VIEWPORT_OPTIONS,
} from './ComparisonSettingsFields';
import { WebsitePicker } from './WebsitePicker';

const formSchema = z
  .object({
    projectId: z.string().min(1, 'Choose a project.'),
    name: z
      .string()
      .trim()
      .min(2, 'Use at least 2 characters.')
      .max(80, 'Use at most 80 characters.'),
    referenceWebsiteId: z.string().min(1, 'Choose the reference website.'),
    targetWebsiteId: z.string().min(1, 'Choose the target website.'),
    ...settingsFormShape,
  })
  .superRefine((data, ctx) => {
    if (data.referenceWebsiteId && data.referenceWebsiteId === data.targetWebsiteId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetWebsiteId'],
        message: 'Choose two different websites.',
      });
    }
  });
type FormValues = z.output<typeof formSchema>;

/** Fields the API can name in its errors, all shown on this page. */
const API_FIELDS = [
  'projectId',
  'name',
  'referenceWebsiteId',
  'targetWebsiteId',
  'maxPages',
  'maxDepth',
  'includePatterns',
  'excludePatterns',
  'viewports',
] as const;

/** /website-comparisons/new (Phase 9, Milestone 4, Checkpoint 2.2). */
export function CreateComparisonPage() {
  const projects = useProjects({ pageSize: 100 });
  const editable = projects.data?.data.filter((p) => canEdit(p.myRole)) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        back={{ to: '/website-comparisons', label: 'Website comparison' }}
        title="New website comparison"
        description="Choose two websites of the same project: the reference (for example the live site) and the target (for example its redesign)."
      />
      {projects.isPending ? (
        <Skeleton className="h-96 rounded-xl" aria-label="Loading projects" />
      ) : projects.isError ? (
        <ErrorState
          title="Couldn't load your projects"
          error={projects.error}
          onRetry={() => void projects.refetch()}
        />
      ) : editable.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No project you can edit"
          description="Creating a comparison needs the owner or editor role in a project. Ask a project owner, or create your own project."
          action={
            <Button asChild variant="outline">
              <Link to="/projects">Go to projects</Link>
            </Button>
          }
        />
      ) : (
        <CreateComparisonForm projects={editable} />
      )}
    </div>
  );
}

function CreateComparisonForm({ projects }: { projects: ProjectSummaryDto[] }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateWebsiteComparison();
  const [reviewing, setReviewing] = useState(false);
  // Set synchronously: a double click cannot send the request twice.
  const submitting = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sites, setSites] = useState<{
    reference: WebsiteComparisonSiteDto | null;
    target: WebsiteComparisonSiteDto | null;
  }>({ reference: null, target: null });

  const preselected = params.get('projectId');
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectId:
        projects.find((p) => p.id === preselected)?.id ??
        (projects.length === 1 ? projects[0]!.id : ''),
      name: '',
      referenceWebsiteId: '',
      targetWebsiteId: '',
      ...settingsFormValues(DEFAULT_COMPARISON_SETTINGS),
    },
  });
  const projectId = useWatch({ control: form.control, name: 'projectId' });
  const errors = form.formState.errors;

  const choose = (side: 'reference' | 'target', site: WebsiteComparisonSiteDto | null) => {
    setSites((current) => ({ ...current, [side]: site }));
    form.setValue(side === 'reference' ? 'referenceWebsiteId' : 'targetWebsiteId', site?.id ?? '', {
      shouldValidate: form.formState.isSubmitted,
    });
  };
  const swap = () => {
    const { reference, target } = sites;
    choose('reference', target);
    choose('target', reference);
  };

  // Websites belong to one project: choosing another project starts the choice again.
  useEffect(() => {
    const subscription = form.watch((_values, { name }) => {
      if (name !== 'projectId') return;
      setSites({ reference: null, target: null });
      form.setValue('referenceWebsiteId', '');
      form.setValue('targetWebsiteId', '');
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const review = form.handleSubmit(() => {
    setFormError(null);
    setReviewing(true);
  });

  const submit = async () => {
    if (submitting.current) return; // never twice
    submitting.current = true;
    setFormError(null);
    try {
      const values = form.getValues() as FormValues;
      // The same shared schema the API uses: exactly its fields, nothing else.
      const input = createWebsiteComparisonSchema.parse({
        projectId: values.projectId,
        name: values.name.trim(),
        referenceWebsiteId: values.referenceWebsiteId,
        targetWebsiteId: values.targetWebsiteId,
        ...settingsFromForm(values),
      });
      const created = await create.mutateAsync(input);
      toast.success(`Comparison "${created.name}" created. It has not been run.`);
      navigate(`/website-comparisons/${created.id}`);
    } catch (error) {
      // Back to the form with everything the user entered; the API's messages on the fields.
      setReviewing(false);
      setFormError(applyApiErrors(error, form.setError, API_FIELDS));
    } finally {
      submitting.current = false;
    }
  };

  const project = projects.find((p) => p.id === projectId);
  const values = form.getValues();

  if (reviewing) {
    const settings = settingsFromForm(values);
    const sizes = VIEWPORT_OPTIONS.filter((o) => settings.viewports.includes(o.value));
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check and create</CardTitle>
          <CardDescription>Nothing is scanned or compared when you create it.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <dl aria-label="Summary" className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Project</dt>
            <dd>{project?.name}</dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{values.name.trim()}</dd>
            <dt className="text-muted-foreground">Reference (A)</dt>
            <dd>
              <span className="font-medium">{sites.reference?.name}</span>
              <span className="block text-xs text-muted-foreground">
                {sites.reference?.baseUrl}
              </span>
            </dd>
            <dt className="text-muted-foreground">Target (B)</dt>
            <dd>
              <span className="font-medium">{sites.target?.name}</span>
              <span className="block text-xs text-muted-foreground">{sites.target?.baseUrl}</span>
            </dd>
            <dt className="text-muted-foreground">Pages per website</dt>
            <dd>{settings.maxPages}</dd>
            <dt className="text-muted-foreground">Link depth</dt>
            <dd>{settings.maxDepth}</dd>
            <dt className="text-muted-foreground">Only include paths</dt>
            <dd>{settings.includePatterns.join(', ') || 'All pages'}</dd>
            <dt className="text-muted-foreground">Exclude paths</dt>
            <dd>{settings.excludePatterns.join(', ') || 'None'}</dd>
            <dt className="text-muted-foreground">Screen sizes</dt>
            <dd>{sizes.map((s) => s.label).join(', ')}</dd>
          </dl>
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>
              Creating this comparison only saves it. It does not start a scan or a comparison run;
              running comparisons is not available yet.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={create.isPending} onClick={() => void submit()}>
              {create.isPending ? 'Creating…' : 'Create comparison'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={create.isPending}
              onClick={() => setReviewing(false)}
            >
              Back to edit
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={review} noValidate>
      <FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <SelectField
          control={form.control}
          name="projectId"
          label="Project"
          placeholder="Choose a project…"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          description="Only projects where you are an owner or editor are listed. Both websites must belong to it."
        />

        {projectId ? (
          <FieldSet>
            <FieldLegend variant="label">Websites</FieldLegend>
            <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
              <WebsitePicker
                key={`reference-${projectId}`}
                side="reference"
                title="Reference website (A)"
                hint="The site you compare against, for example the live site."
                projectId={projectId}
                selected={sites.reference}
                otherId={sites.target?.id ?? ''}
                otherLabel="target website"
                error={errors.referenceWebsiteId?.message}
                onSelect={(site) => choose('reference', site)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-center"
                disabled={!sites.reference && !sites.target}
                onClick={swap}
              >
                <ArrowLeftRight aria-hidden="true" /> Swap
              </Button>
              <WebsitePicker
                key={`target-${projectId}`}
                side="target"
                title="Target website (B)"
                hint="The site you check, for example the redesign or staging site."
                projectId={projectId}
                selected={sites.target}
                otherId={sites.reference?.id ?? ''}
                otherLabel="reference website"
                error={errors.targetWebsiteId?.message}
                onSelect={(site) => choose('target', site)}
              />
            </div>
          </FieldSet>
        ) : null}

        <TextField
          control={form.control}
          name="name"
          label="Comparison name"
          placeholder="e.g. Redesign vs live site"
        />

        <FieldSet>
          <FieldLegend variant="label">What to compare</FieldLegend>
          <ComparisonSettingsFields control={form.control} />
        </FieldSet>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">Review</Button>
          <Button type="button" variant="outline" onClick={() => navigate('/website-comparisons')}>
            Cancel
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
