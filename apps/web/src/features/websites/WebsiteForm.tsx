import { zodResolver } from '@hookform/resolvers/zod';
import {
  DEFAULT_WEBSITE_SETTINGS,
  normalizeWebsiteUrl,
  websiteSettingsSchema,
  websiteUrlSchema,
  type ProjectSummaryDto,
  type WebsiteDto,
} from '@whc/shared';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  CheckboxField,
  NumberField,
  SelectField,
  TextareaField,
  TextField,
} from '@/components/common/form-fields';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { applyApiErrors } from '@/lib/form-errors';

const numberError = { error: 'Enter a number.' };

/** Textarea: one pattern per line → ["/blog/*", ...]. */
function toPatterns(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildSchema(needsAuthorization: (baseUrl: string) => boolean) {
  const patternsText = z.string().superRefine((text, ctx) => {
    const patterns = toPatterns(text);
    if (patterns.length > 20) ctx.addIssue({ code: 'custom', message: 'At most 20 patterns.' });
    const bad = patterns.find((p) => !p.startsWith('/'));
    if (bad)
      ctx.addIssue({ code: 'custom', message: `"${bad}" must start with "/", e.g. /blog/*` });
  });

  return z
    .object({
      projectId: z.string().min(1, 'Choose a project.'),
      name: z
        .string()
        .trim()
        .min(2, 'Use at least 2 characters.')
        .max(80, 'Use at most 80 characters.'),
      baseUrl: websiteUrlSchema,
      maxDepth: z.number(numberError).pipe(websiteSettingsSchema.shape.maxDepth),
      maxPages: z.number(numberError).pipe(websiteSettingsSchema.shape.maxPages),
      responsivePageLimit: z
        .number(numberError)
        .pipe(websiteSettingsSchema.shape.responsivePageLimit),
      lighthousePageLimit: z
        .number(numberError)
        .pipe(websiteSettingsSchema.shape.lighthousePageLimit),
      respectRobotsTxt: z.boolean(),
      explorationEnabled: z.boolean(),
      explorationPageLimit: z
        .number(numberError)
        .pipe(websiteSettingsSchema.shape.explorationPageLimit),
      explorationControlLimit: z
        .number(numberError)
        .pipe(websiteSettingsSchema.shape.explorationControlLimit),
      consistencyEnabled: z.boolean(),
      keyboardProbeEnabled: z.boolean(),
      formProbeMode: websiteSettingsSchema.shape.formProbeMode,
      includePatterns: patternsText,
      excludePatterns: patternsText,
      authorizationConfirmed: z.boolean(),
    })
    .superRefine((data, ctx) => {
      if (needsAuthorization(data.baseUrl) && !data.authorizationConfirmed) {
        ctx.addIssue({
          code: 'custom',
          path: ['authorizationConfirmed'],
          message: 'Confirm that you own this website or are authorized to test it.',
        });
      }
    });
}

export type WebsiteFormValues = z.output<ReturnType<typeof buildSchema>>;

export interface WebsiteSubmitValues {
  projectId: string;
  name: string;
  baseUrl: string;
  maxDepth: number;
  maxPages: number;
  responsivePageLimit: number;
  lighthousePageLimit: number;
  respectRobotsTxt: boolean;
  explorationEnabled: boolean;
  explorationPageLimit: number;
  explorationControlLimit: number;
  consistencyEnabled: boolean;
  keyboardProbeEnabled: boolean;
  formProbeMode: 'OFF' | 'STATIC' | 'BLUR' | 'SYNTHETIC';
  includePatterns: string[];
  excludePatterns: string[];
  authorizationConfirmed: boolean;
  urlChanged: boolean;
}

/**
 * Add/edit website form. Checks the URL in the browser with the SAME rules the API
 * uses (packages/shared/url-safety.ts); the API then checks again and also resolves DNS.
 */
export function WebsiteForm({
  projects,
  website,
  defaultProjectId,
  defaultBaseUrl,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  projects: ProjectSummaryDto[];
  website?: WebsiteDto;
  defaultProjectId?: string;
  /** Pre-filled address, e.g. from the Chrome extension's "Open in dashboard". */
  defaultBaseUrl?: string;
  submitLabel: string;
  onSubmit: (values: WebsiteSubmitValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const original = website?.baseUrl;
  const urlChanged = (baseUrl: string) => {
    if (!original) return true;
    const normalized = normalizeWebsiteUrl(baseUrl);
    return !normalized.ok || normalized.url !== original;
  };
  // Rebuilt only when the saved URL changes (urlChanged depends on nothing else).
  const schema = useMemo(() => buildSchema(urlChanged), [original]);

  const settings = website ?? DEFAULT_WEBSITE_SETTINGS;
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      projectId:
        website?.projectId ?? defaultProjectId ?? (projects.length === 1 ? projects[0]!.id : ''),
      name: website?.name ?? '',
      baseUrl: website?.baseUrl ?? defaultBaseUrl ?? '',
      maxDepth: settings.maxDepth,
      maxPages: settings.maxPages,
      responsivePageLimit: settings.responsivePageLimit,
      lighthousePageLimit: settings.lighthousePageLimit,
      respectRobotsTxt: settings.respectRobotsTxt,
      explorationEnabled: settings.explorationEnabled,
      explorationPageLimit: settings.explorationPageLimit,
      explorationControlLimit: settings.explorationControlLimit,
      consistencyEnabled: settings.consistencyEnabled,
      keyboardProbeEnabled: settings.keyboardProbeEnabled,
      formProbeMode: settings.formProbeMode,
      includePatterns: settings.includePatterns.join('\n'),
      excludePatterns: settings.excludePatterns.join('\n'),
      authorizationConfirmed: false,
    },
  });

  const baseUrl = useWatch({ control: form.control, name: 'baseUrl' });
  const preview = baseUrl ? normalizeWebsiteUrl(baseUrl) : null;
  const showAuthorization = urlChanged(baseUrl ?? '');

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit({
        ...values,
        includePatterns: toPatterns(values.includePatterns),
        excludePatterns: toPatterns(values.excludePatterns),
        urlChanged: urlChanged(values.baseUrl),
      });
    } catch (error) {
      setFormError(
        applyApiErrors(error, form.setError, [
          'projectId',
          'name',
          'baseUrl',
          'maxDepth',
          'maxPages',
          'responsivePageLimit',
          'lighthousePageLimit',
          'explorationPageLimit',
          'explorationControlLimit',
          'includePatterns',
          'excludePatterns',
          'authorizationConfirmed',
        ]),
      );
    }
  });

  return (
    <form onSubmit={submit} noValidate>
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
          description="Only projects where you are an owner or editor are listed."
        />
        <TextField
          control={form.control}
          name="name"
          label="Name"
          placeholder="e.g. Company homepage"
        />
        <TextField
          control={form.control}
          name="baseUrl"
          label="Website address"
          placeholder="https://example.com"
          inputMode="url"
          autoComplete="url"
          description={
            preview?.ok && preview.url !== baseUrl
              ? `Will be saved as ${preview.url}`
              : 'Public http(s) addresses only.'
          }
        />

        <FieldSet>
          <FieldLegend variant="label">Crawl settings</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              control={form.control}
              name="maxDepth"
              label="Maximum link depth"
              min={0}
              max={5}
              description="0 = only the start page."
            />
            <NumberField
              control={form.control}
              name="maxPages"
              label="Maximum pages"
              min={1}
              max={100}
            />
            <NumberField
              control={form.control}
              name="responsivePageLimit"
              label="Pages tested at 5 screen sizes"
              min={0}
              max={10}
            />
            <NumberField
              control={form.control}
              name="lighthousePageLimit"
              label="Pages measured by Lighthouse"
              min={0}
              max={5}
            />
          </div>
          <CheckboxField
            control={form.control}
            name="respectRobotsTxt"
            label="Respect robots.txt"
            description="Skip pages the site asks crawlers not to visit."
          />
          <CheckboxField
            control={form.control}
            name="explorationEnabled"
            label="Explore menus, tabs and expandable sections"
            description="Opens them on the first pages to find menus that are cut off, covered or cannot be closed. It never submits forms or uses controls that could change data, and blocks sending data while it works."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              control={form.control}
              name="explorationPageLimit"
              label="Pages explored"
              min={0}
              max={10}
            />
            <NumberField
              control={form.control}
              name="explorationControlLimit"
              label="Controls opened per page"
              min={1}
              max={50}
            />
          </div>
          <CheckboxField
            control={form.control}
            name="consistencyEnabled"
            label="Compare similar buttons and fields"
            description="Points out buttons and fields that look different from others with the same classes, on a page or across pages. Reported as observations unless the difference is clearly set on that element alone; never part of the score."
          />
          <CheckboxField
            control={form.control}
            name="keyboardProbeEnabled"
            label="Check keyboard use on explored pages"
            description="Moves through each explored page with Tab (focus visible, never lost or trapped) and presses Enter or Space only on controls whose click was proven safe. Needs the explorer."
          />
          <SelectField
            control={form.control}
            name="formProbeMode"
            label="Form checks on explored pages"
            description="Forms are never submitted. Personal, secret, payment and CAPTCHA fields are never touched. Typing invalid values is only done if you choose it here."
            options={[
              { value: 'OFF', label: 'Off' },
              { value: 'STATIC', label: 'Read the fields only' },
              {
                value: 'BLUR',
                label: 'Also click into empty required fields and leave them (default)',
              },
              { value: 'SYNTHETIC', label: 'Also type clearly invalid test values (opt-in)' },
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextareaField
              control={form.control}
              name="includePatterns"
              label="Only include paths (optional)"
              rows={3}
              placeholder={'/products/*\n/blog/*'}
              description="One per line."
            />
            <TextareaField
              control={form.control}
              name="excludePatterns"
              label="Exclude paths (optional)"
              rows={3}
              placeholder={'/admin/*\n/cart'}
              description="One per line."
            />
          </div>
        </FieldSet>

        {showAuthorization ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="size-4 text-amber-600" aria-hidden="true" />
              Authorization required
            </div>
            <CheckboxField
              control={form.control}
              name="authorizationConfirmed"
              label="I own this website or have permission to test it"
              description="Scanning sends many automated requests. Only scan sites you are allowed to test. This confirmation is recorded."
            />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : submitLabel}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
