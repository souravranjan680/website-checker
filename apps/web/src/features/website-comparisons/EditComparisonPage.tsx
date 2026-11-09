import { zodResolver } from '@hookform/resolvers/zod';
import { updateWebsiteComparisonSchema, type WebsiteComparisonDto } from '@whc/shared';
import { AlertCircle, Lock } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { TextField } from '@/components/common/form-fields';
import { canEdit } from '@/components/common/RoleBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { applyApiErrors } from '@/lib/form-errors';
import { useUpdateWebsiteComparison, useWebsiteComparison } from './api';
import {
  ComparisonSettingsFields,
  settingsFormShape,
  settingsFormValues,
  settingsFromForm,
} from './ComparisonSettingsFields';

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Use at least 2 characters.')
    .max(80, 'Use at most 80 characters.'),
  ...settingsFormShape,
});
type FormValues = z.output<typeof formSchema>;

const API_FIELDS = [
  'name',
  'maxPages',
  'maxDepth',
  'includePatterns',
  'excludePatterns',
  'viewports',
] as const;

/** /website-comparisons/:comparisonId/edit (Phase 9, Milestone 4, Checkpoint 2.3). */
export function EditComparisonPage() {
  const { comparisonId = '' } = useParams();
  const comparison = useWebsiteComparison(comparisonId);

  if (comparison.isPending) {
    return (
      <Skeleton
        className="mx-auto h-96 w-full max-w-3xl rounded-xl"
        aria-label="Loading comparison"
      />
    );
  }
  if (comparison.isError) {
    const missing = comparison.error instanceof ApiError && comparison.error.status === 404;
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title={missing ? 'Comparison not found' : "Couldn't load this comparison"}
          error={
            missing
              ? new Error("It doesn't exist, or you don't have access to its project.")
              : comparison.error
          }
          onRetry={missing ? undefined : () => void comparison.refetch()}
        />
        <Button asChild variant="link" className="px-0">
          <Link to="/website-comparisons">Back to website comparisons</Link>
        </Button>
      </div>
    );
  }
  if (!canEdit(comparison.data.myRole)) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-2">
        <ErrorState
          title="Read-only access"
          error={new Error('Only owners and editors of the project can change this comparison.')}
        />
        <Button asChild variant="link" className="px-0">
          <Link to={`/website-comparisons/${comparisonId}`}>Back to the comparison</Link>
        </Button>
      </div>
    );
  }
  return <EditForm comparison={comparison.data} />;
}

function EditForm({ comparison }: { comparison: WebsiteComparisonDto }) {
  const navigate = useNavigate();
  const update = useUpdateWebsiteComparison(comparison.id);
  const [formError, setFormError] = useState<string | null>(null);
  const submitting = useRef(false);
  const detailsUrl = `/website-comparisons/${comparison.id}`;
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { name: comparison.name, ...settingsFormValues(comparison.settings) },
  });

  const submit = form.handleSubmit(async (values: FormValues) => {
    if (submitting.current) return; // never twice
    submitting.current = true;
    setFormError(null);
    try {
      // Name and settings only: the project and the two websites cannot be changed.
      const input = updateWebsiteComparisonSchema.parse({
        name: values.name.trim(),
        ...settingsFromForm(values),
      });
      await update.mutateAsync(input);
      toast.success('Comparison saved.');
      navigate(detailsUrl);
    } catch (error) {
      // Everything entered stays in the form; the API's messages go on the fields.
      setFormError(applyApiErrors(error, form.setError, API_FIELDS));
    } finally {
      submitting.current = false;
    }
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader back={{ to: detailsUrl, label: comparison.name }} title="Edit comparison" />
      <Card>
        <CardContent>
          <form onSubmit={submit} noValidate>
            <FieldGroup>
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              <section
                aria-label="Fixed for this comparison"
                className="rounded-lg border bg-muted/40 p-4 text-sm"
              >
                <p className="mb-3 flex items-center gap-1.5 font-medium">
                  <Lock className="size-4" aria-hidden="true" /> Cannot be changed
                </p>
                <dl className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                  <dt className="text-muted-foreground">Project</dt>
                  <dd>{comparison.projectName}</dd>
                  <dt className="text-muted-foreground">Reference (A)</dt>
                  <dd>
                    {comparison.reference.name}
                    <span className="block break-all text-xs text-muted-foreground">
                      {comparison.reference.baseUrl}
                    </span>
                  </dd>
                  <dt className="text-muted-foreground">Target (B)</dt>
                  <dd>
                    {comparison.target.name}
                    <span className="block break-all text-xs text-muted-foreground">
                      {comparison.target.baseUrl}
                    </span>
                  </dd>
                </dl>
                <p className="mt-3 text-muted-foreground">
                  To compare other websites, create a new comparison.
                </p>
              </section>

              <TextField control={form.control} name="name" label="Comparison name" />

              <FieldSet>
                <FieldLegend variant="label">What to compare</FieldLegend>
                <ComparisonSettingsFields control={form.control} />
              </FieldSet>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? 'Saving…' : 'Save changes'}
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate(detailsUrl)}>
                  Cancel
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
