import {
  pathPatternSchema,
  VIEWPORTS,
  WEBSITE_COMPARISON_LIMITS,
  type WebsiteComparisonSettingsDto,
} from '@whc/shared';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { NumberField, TextareaField } from '@/components/common/form-fields';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldError, FieldLegend, FieldSet } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { z } from 'zod';

/** The screen sizes a comparison can use (the scan's own sizes), with readable names. */
export const VIEWPORT_OPTIONS = VIEWPORTS.map((v) => ({
  value: `${v.width}x${v.height}`,
  label: `${v.name} (${v.width}×${v.height})`,
}));

/** API defaults for a new comparison (the CP1 schema): shown before the user changes them. */
export const DEFAULT_COMPARISON_SETTINGS: WebsiteComparisonSettingsDto = {
  maxPages: 10,
  maxDepth: 1,
  includePatterns: [],
  excludePatterns: [],
  viewports: ['1920x1080'],
};

/** Textarea: one pattern per line → ["/blog/*", ...] (as in the website form). */
export function toPatterns(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const numberError = { error: 'Enter a number.' };
const patternsText = z.string().superRefine((text, ctx) => {
  const patterns = toPatterns(text);
  if (patterns.length > WEBSITE_COMPARISON_LIMITS.patterns) {
    ctx.addIssue({
      code: 'custom',
      message: `At most ${WEBSITE_COMPARISON_LIMITS.patterns} patterns.`,
    });
  }
  const bad = patterns.find((p) => !pathPatternSchema.safeParse(p).success);
  if (bad) ctx.addIssue({ code: 'custom', message: `"${bad}" must start with "/", e.g. /blog/*` });
});

/** Form fields of the settings (same limits as the API's shared schema). */
export const settingsFormShape = {
  maxPages: z
    .number(numberError)
    .int('Use a whole number.')
    .min(1, 'Minimum is 1.')
    .max(WEBSITE_COMPARISON_LIMITS.maxPages, `Maximum is ${WEBSITE_COMPARISON_LIMITS.maxPages}.`),
  maxDepth: z
    .number(numberError)
    .int('Use a whole number.')
    .min(0, 'Minimum is 0.')
    .max(WEBSITE_COMPARISON_LIMITS.maxDepth, `Maximum is ${WEBSITE_COMPARISON_LIMITS.maxDepth}.`),
  includePatterns: patternsText,
  excludePatterns: patternsText,
  viewports: z.array(z.string()).min(1, 'Choose at least one screen size.'),
};

export interface ComparisonSettingsValues {
  maxPages: number;
  maxDepth: number;
  includePatterns: string;
  excludePatterns: string;
  viewports: string[];
}

export function settingsFormValues(s: WebsiteComparisonSettingsDto): ComparisonSettingsValues {
  return {
    ...s,
    includePatterns: s.includePatterns.join('\n'),
    excludePatterns: s.excludePatterns.join('\n'),
  };
}

export function settingsFromForm(v: ComparisonSettingsValues): WebsiteComparisonSettingsDto {
  return {
    maxPages: v.maxPages,
    maxDepth: v.maxDepth,
    includePatterns: toPatterns(v.includePatterns),
    excludePatterns: toPatterns(v.excludePatterns),
    // In the order of the scan sizes, whatever order they were ticked in.
    viewports: VIEWPORT_OPTIONS.map((o) => o.value).filter((v2) => v.viewports.includes(v2)),
  };
}

/** The settings section, shared by the create and (Checkpoint 2.3) edit pages. */
export function ComparisonSettingsFields<T extends FieldValues & ComparisonSettingsValues>({
  control,
}: {
  control: Control<T>;
}) {
  const name = (field: keyof ComparisonSettingsValues) => field as FieldPath<T>;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          control={control}
          name={name('maxPages')}
          label="Pages per website"
          min={1}
          max={WEBSITE_COMPARISON_LIMITS.maxPages}
          description={`How many pages of each website to compare (1–${WEBSITE_COMPARISON_LIMITS.maxPages}).`}
        />
        <NumberField
          control={control}
          name={name('maxDepth')}
          label="Link depth"
          min={0}
          max={WEBSITE_COMPARISON_LIMITS.maxDepth}
          description="How many clicks away from the start page to look. 0 = only the start page."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextareaField
          control={control}
          name={name('includePatterns')}
          label="Only include paths (optional)"
          rows={3}
          placeholder={'/products/*\n/blog/*'}
          description="One per line. Leave empty to include every page."
        />
        <TextareaField
          control={control}
          name={name('excludePatterns')}
          label="Exclude paths (optional)"
          rows={3}
          placeholder={'/admin/*\n/cart'}
          description="One per line."
        />
      </div>
      <Controller
        control={control}
        name={name('viewports')}
        render={({ field, fieldState }) => {
          const value = (field.value as string[] | undefined) ?? [];
          return (
            <FieldSet data-invalid={fieldState.invalid || undefined}>
              <FieldLegend variant="label">Screen sizes</FieldLegend>
              <p className="-mt-1 text-sm text-muted-foreground">
                Each page is compared at every size you choose.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {VIEWPORT_OPTIONS.map((option) => {
                  const id = `viewport-${option.value}`;
                  return (
                    <div key={option.value} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={value.includes(option.value)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked === true
                              ? [...value, option.value]
                              : value.filter((v) => v !== option.value),
                          )
                        }
                        onBlur={field.onBlur}
                        aria-invalid={fieldState.invalid}
                      />
                      <Label htmlFor={id} className="font-normal">
                        {option.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
              <FieldError errors={[fieldState.error]} />
            </FieldSet>
          );
        }}
      />
    </>
  );
}
