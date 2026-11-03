/**
 * Form probe (Phase 9, Milestone 2, Checkpoint 2). Runs after the explorer on the same
 * page, in the explorer's context with the safety layer armed. Forms are never submitted
 * and Enter is never pressed in a field.
 *   STATIC     reads every field (no focus, no events): required marks, descriptions
 *              that point nowhere, placeholder-only labels
 *   BLUR       (default) also focuses each allowed, empty, required field and leaves it
 *              again without typing, then looks for feedback and whether it is linked
 *   SYNTHETIC  (opt-in per website) may also type ONE clearly invalid, non-personal value
 *              into email, url, number and pattern fields
 * Secret, payment, personal-data, file, choice and CAPTCHA fields are never focused or
 * typed into; every field left alone is listed with its reason (fieldPolicy).
 */
import {
  fieldPolicy,
  syntheticValue,
  type Feedback,
  type FormFacts,
  type FormField,
  type FormProbeMode,
  type ProbeSkipReason,
  type SideEffectReport,
} from '@whc/dom-checks';
import { functionalDraft, type IssueContext, type IssueDraft } from '../issues';
import {
  freshPage,
  inPage,
  markDisturbed,
  sideEffectBaseline,
  stepMarks,
  type Disturbance,
  type ProbeParams,
} from './probe-common';

const MAX_FIELDS = 50;
const MAX_PROBES = 20;
const TEXT_TYPES = new Set([
  'text',
  'email',
  'url',
  'tel',
  'number',
  'search',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
  'select',
  'textarea',
]);

type ProbeOutcome =
  | 'error-shown-linked'
  | 'error-not-linked'
  | 'feedback-without-text'
  | 'no-feedback'
  | 'value-accepted'
  | 'not-focusable'
  | 'inconclusive';

/** Stored on the page (ScanPage.exploration.forms) and shown in the Interactions report. */
export interface FormsSummary {
  mode: FormProbeMode;
  fields: number;
  probed: { name: string; action: 'blur' | 'synthetic'; outcome: ProbeOutcome }[];
  skipped: { name: string; reason: ProbeSkipReason }[];
  skippedCounts: Partial<Record<ProbeSkipReason, number>>;
}

const nameOf = (f: FormField) => (f.label || f.placeholder || f.name || f.type).slice(0, 80);
const fieldControl = (f: FormField) => ({
  name: nameOf(f),
  role: f.tag === 'input' ? `${f.type} field` : f.tag,
  selector: f.selector,
  html: f.html,
});

export async function formProbe(
  params: ProbeParams & {
    ctx: IssueContext;
    mode: FormProbeMode;
    /** "rule|selector" of accessibility violations already reported on this page. */
    knownViolations: Set<string>;
  },
): Promise<{ summary: FormsSummary | null; drafts: IssueDraft[] }> {
  const { page, ctx, mode } = params;
  const drafts: IssueDraft[] = [];
  if (!(await freshPage(params))) return { summary: null, drafts };
  const facts = await inPage<{ fields: FormField[]; forms: FormFacts[] }>(
    page,
    'probes.formFacts',
    MAX_FIELDS,
  );
  const summary: FormsSummary = {
    mode,
    fields: facts.fields.length,
    probed: [],
    skipped: [],
    skippedCounts: {},
  };
  if (facts.fields.length === 0) return { summary, drafts };
  const formOf = (f: FormField) => facts.forms.find((form) => form.formId === f.formId) ?? null;
  const known = (rule: string, f: FormField) => params.knownViolations.has(`${rule}|${f.selector}`);

  // ---------------------------------------------------------- reading the fields
  for (const f of facts.fields) {
    if (!f.visible) continue;
    const form = formOf(f);
    const missing = [
      ...f.describedByMissing,
      ...(f.errorMessageMissing ? [f.errorMessageMissing] : []),
    ];
    if (missing.length > 0 && !known('aria-valid-attr-value', f)) {
      drafts.push(
        functionalDraft('FORM_DESCRIBEDBY_MISSING', ctx, {
          severity: 'LOW',
          classification: 'DETECTED',
          description: `The field “${nameOf(f)}” points to ${missing.map((id) => `#${id}`).join(', ')} for its description or error message, but the page has no element with ${missing.length === 1 ? 'that id' : 'those ids'}.`,
          control: fieldControl(f),
          box: f.box,
          interaction: {
            missingIds: missing,
            steps: ['Read the field (nothing was typed or focused)'],
          },
          target: `${f.selector}|describedby`,
        }),
      );
    }
    if (!TEXT_TYPES.has(f.type)) continue;
    if (f.required && !f.markShown && f.label && !form?.allRequired && !form?.optionalConvention) {
      drafts.push(
        functionalDraft('FORM_REQUIRED_NOT_INDICATED', ctx, {
          severity: 'MEDIUM',
          classification: 'POTENTIAL_DEFECT',
          description: `The field “${nameOf(f)}” is required (${f.required ? 'required attribute' : 'aria-required'}), but neither its label nor its description shows it, and the form does not say that all fields are required or mark optional ones instead.`,
          control: fieldControl(f),
          box: f.box,
          interaction: { label: f.label, steps: ['Read the field (nothing was typed or focused)'] },
          target: `${f.selector}|required-mark`,
        }),
      );
    }
    if (!f.required && f.markShown && f.label) {
      // A visible mark alone is not proof: the site may validate in its own code. Only a
      // form note that says what the asterisk means makes it a potential defect.
      const explained = Boolean(form?.asteriskLegend) && f.label.includes('*');
      drafts.push(
        functionalDraft('FORM_INDICATOR_WITHOUT_REQUIRED', ctx, {
          severity: 'LOW',
          classification: explained ? 'POTENTIAL_DEFECT' : 'OBSERVATION',
          description: `The label “${f.label.slice(0, 80)}” marks the field as required, but the field has neither the required attribute nor aria-required, so browsers and screen readers do not know.${explained ? ' The form explains that the asterisk means required.' : ' It may be validated by the site’s own code.'}`,
          control: fieldControl(f),
          box: f.box,
          interaction: {
            label: f.label,
            formExplainsAsterisk: explained,
            steps: ['Read the field (nothing was typed or focused)'],
          },
          target: `${f.selector}|required-attr`,
        }),
      );
    }
    if (f.placeholderOnly && !f.inSearch && !known('label', f)) {
      drafts.push(
        functionalDraft('FORM_PLACEHOLDER_ONLY_LABEL', ctx, {
          severity: 'MEDIUM',
          classification: 'POTENTIAL_DEFECT',
          description: `The field shows no label; only its placeholder “${f.placeholder.slice(0, 80)}” says what it is for, and that disappears as soon as someone types.`,
          control: fieldControl(f),
          box: f.box,
          interaction: {
            placeholder: f.placeholder,
            steps: ['Read the field (nothing was typed or focused)'],
          },
          target: `${f.selector}|placeholder-label`,
        }),
      );
    }
  }

  // ------------------------------------------------- focus and leave (no submit)
  const probes: { field: FormField; action: 'blur' | 'synthetic' }[] = [];
  for (const f of facts.fields) {
    const policy = fieldPolicy(f, mode);
    let skip = policy.skip;
    if (policy.action && probes.length >= MAX_PROBES) skip = 'limit';
    if (policy.action && !skip) probes.push({ field: f, action: policy.action });
    else if (skip) {
      summary.skipped.push({ name: nameOf(f), reason: skip });
      summary.skippedCounts[skip] = (summary.skippedCounts[skip] ?? 0) + 1;
    }
  }
  if (probes.length === 0) return { summary, drafts };

  await sideEffectBaseline(page);
  // Fields that gave no feedback, per form; a disturbed one is reported on its own.
  const silent = new Map<string, { fields: FormField[]; disturbance: Disturbance | null }>();
  for (const { field, action } of probes) {
    params.checkpoint();
    const done = stepMarks(params);
    await page.evaluate(
      `(() => { const d = window.__whcDomChecks; const f = d.explore.element(${field.fieldId}); const form = ${field.formId ?? 0} ? d.explore.element(${field.formId ?? 0}) : null; d.sideEffects.start(f, form ? [form] : []); })()`,
    );
    await inPage(page, 'probes.feedbackBefore', field.fieldId);
    const focused = await inPage<boolean>(page, 'probes.focusField', field.fieldId);
    const value = action === 'synthetic' ? syntheticValue(field) : null;
    if (focused && value !== null) await page.keyboard.type(value); // never Enter
    await inPage(page, 'probes.blurField', field.fieldId);
    await page.waitForTimeout(300);
    const feedback = await inPage<Feedback | null>(page, 'probes.feedbackAfter', field.fieldId);
    const effects = (await page.evaluate(
      'window.__whcDomChecks.sideEffects.stop()',
    )) as SideEffectReport;
    const disturbance = await done(effects);

    const steps = [
      `Focused the field “${nameOf(field)}”`,
      ...(value !== null ? [`Typed “${value}” (a deliberately invalid value)`] : []),
      'Moved focus away without submitting the form',
    ];
    let outcome: ProbeOutcome;
    if (!focused || !feedback) outcome = 'not-focusable';
    else if (feedback.newTexts.length > 0) {
      const linked = feedback.ariaInvalid || feedback.newTexts.some((t) => t.linked || t.announced);
      outcome = linked ? 'error-shown-linked' : 'error-not-linked';
      if (!linked) {
        const text = feedback.newTexts[0]!;
        drafts.push(
          markDisturbed(
            functionalDraft('FORM_ERROR_NOT_ASSOCIATED', ctx, {
              severity: 'MEDIUM',
              classification: 'POTENTIAL_DEFECT',
              description: `After leaving the field “${nameOf(field)}”${value !== null ? ' with an invalid value' : ' empty'}, the message “${text.text}” appeared, but the field does not point to it (no aria-describedby or aria-errormessage) and is not marked aria-invalid, so screen-reader users are not told.`,
              control: fieldControl(field),
              box: field.box,
              interaction: { steps, message: text, action },
              target: `${field.selector}|error-link`,
            }),
            disturbance,
          ),
        );
      }
    } else if (feedback.ariaInvalid || feedback.lookChanged) outcome = 'feedback-without-text';
    else if (value !== null && feedback.valid === true) outcome = 'value-accepted';
    else {
      outcome = 'no-feedback';
      const key = disturbance ? `field:${field.fieldId}` : `form:${field.formId}`;
      const group = silent.get(key) ?? { fields: [], disturbance };
      group.fields.push(field);
      silent.set(key, group);
    }
    if (disturbance && outcome !== 'no-feedback' && outcome !== 'error-not-linked')
      outcome = 'inconclusive';
    summary.probed.push({ name: nameOf(field), action, outcome });
  }

  // No feedback on leaving a field is common (validation on submit): an observation.
  for (const { fields, disturbance } of silent.values()) {
    const first = fields[0]!;
    const names = fields.map((f) => `“${nameOf(f)}”`).join(', ');
    drafts.push(
      markDisturbed(
        functionalDraft('FORM_NO_BLUR_FEEDBACK', ctx, {
          severity: 'INFO',
          classification: 'OBSERVATION',
          description: `Leaving ${fields.length === 1 ? 'the required field' : `${fields.length} required fields`} ${names} ${fields.some((f) => fieldPolicy(f, mode).action === 'synthetic') ? 'with an invalid value' : 'empty'} shows no message and no change. Many sites validate only when the form is submitted (which this scan never does), so this may be intended.`,
          control: fieldControl(first),
          box: first.box,
          interaction: {
            fields: fields.map(nameOf),
            steps: ['Focused each field and moved focus away without typing or submitting'],
          },
          target: `${first.selector}|no-blur-feedback`,
        }),
        disturbance,
      ),
    );
  }
  return { summary, drafts };
}
