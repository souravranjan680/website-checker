import { z } from 'zod';
import { normalizeWebsiteUrl } from '../url-safety';
import { idSchema, listQuerySchema } from './common';

/** A website address that passes the URL-safety rules (see url-safety.ts). */
export const websiteUrlSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const result = normalizeWebsiteUrl(value);
    if (!result.ok) ctx.addIssue({ code: 'custom', message: result.reason });
  });

/** "/blog/*" style path patterns for include/exclude rules. */
export const pathPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^\//, 'Patterns must start with "/", e.g. /blog/*');

/** How far the form probe goes; forms are never submitted. */
export const FORM_PROBE_MODES = ['OFF', 'STATIC', 'BLUR', 'SYNTHETIC'] as const;
export type FormProbeModeName = (typeof FORM_PROBE_MODES)[number];

/** Other browsers a website can be checked in (Chromium is always the scan's own). */
export const CROSS_BROWSER_TARGETS = ['FIREFOX', 'WEBKIT'] as const;

export const websiteSettingsSchema = z.object({
  maxDepth: z.number().int().min(0, 'Minimum is 0.').max(5, 'Maximum is 5.'),
  maxPages: z.number().int().min(1, 'Minimum is 1.').max(100, 'Maximum is 100.'),
  includePatterns: z.array(pathPatternSchema).max(20, 'At most 20 patterns.'),
  excludePatterns: z.array(pathPatternSchema).max(20, 'At most 20 patterns.'),
  respectRobotsTxt: z.boolean(),
  responsivePageLimit: z.number().int().min(0).max(10, 'Maximum is 10.'),
  lighthousePageLimit: z.number().int().min(0).max(5, 'Maximum is 5.'),
  /** Safe explorer (Phase 9): opens menus, tabs and expandable sections. */
  explorationEnabled: z.boolean(),
  explorationPageLimit: z.number().int().min(0).max(10, 'Maximum is 10.'),
  explorationControlLimit: z.number().int().min(1, 'Minimum is 1.').max(50, 'Maximum is 50.'),
  /** Component consistency (Phase 9, Milestone 2): compares comparable buttons and fields. */
  consistencyEnabled: z.boolean(),
  /** Keyboard and form probes (Phase 9, Milestone 2, Checkpoint 2). SYNTHETIC is opt-in only. */
  keyboardProbeEnabled: z.boolean(),
  formProbeMode: z.enum(FORM_PROBE_MODES),
  /** Cross-browser checks (Phase 9, Milestone 3): off by default; passive checks only. */
  crossBrowserEnabled: z.boolean(),
  crossBrowserTargets: z
    .array(z.enum(CROSS_BROWSER_TARGETS))
    .max(2)
    .refine((list) => new Set(list).size === list.length, 'Choose each browser once.'),
  crossBrowserPageLimit: z.number().int().min(1, 'Minimum is 1.').max(10, 'Maximum is 10.'),
  crossBrowserMobile: z.boolean(),
});

export const DEFAULT_WEBSITE_SETTINGS: z.infer<typeof websiteSettingsSchema> = {
  maxDepth: 2,
  maxPages: 20,
  includePatterns: [],
  excludePatterns: [],
  respectRobotsTxt: true,
  responsivePageLimit: 3,
  lighthousePageLimit: 1,
  explorationEnabled: true,
  explorationPageLimit: 5,
  explorationControlLimit: 30,
  consistencyEnabled: true,
  keyboardProbeEnabled: true,
  formProbeMode: 'BLUR',
  crossBrowserEnabled: false,
  crossBrowserTargets: ['FIREFOX', 'WEBKIT'],
  crossBrowserPageLimit: 3,
  crossBrowserMobile: false,
};

const authorizationSchema = z.literal(true, {
  error: 'Confirm that you own this website or are authorized to test it.',
});

export const createWebsiteSchema = websiteSettingsSchema.partial().extend({
  projectId: idSchema,
  name: z
    .string()
    .trim()
    .min(2, 'Use at least 2 characters.')
    .max(80, 'Use at most 80 characters.'),
  baseUrl: websiteUrlSchema,
  authorizationConfirmed: authorizationSchema,
});
export type CreateWebsiteInput = z.infer<typeof createWebsiteSchema>;

export const updateWebsiteSchema = websiteSettingsSchema.partial().extend({
  projectId: idSchema.optional(),
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(80).optional(),
  baseUrl: websiteUrlSchema.optional(),
  // Required again when the URL changes (checked by the API).
  authorizationConfirmed: z.boolean().optional(),
});
export type UpdateWebsiteInput = z.infer<typeof updateWebsiteSchema>;

export const websiteListQuerySchema = listQuerySchema.extend({
  projectId: idSchema.optional(),
});
