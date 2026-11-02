import { z } from 'zod';
import { idSchema } from './schemas/common';

/** Visual regression API shapes. Baselines only change through these explicit calls. */

export type VisualComparisonStatusName = 'UNCHANGED' | 'MINOR' | 'CHANGED';

export interface VisualRegionDto {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualComparisonDto {
  id: string;
  scanId: string | null;
  status: VisualComparisonStatusName;
  passed: boolean;
  diffPercent: number;
  diffPixels: number;
  totalPixels: number;
  currentScreenshotId: string;
  diffScreenshotId: string | null;
  regions: VisualRegionDto[];
  sizeChanged: boolean;
  size: {
    baseline: { width: number; height: number };
    current: { width: number; height: number };
  } | null;
  failPercent: number | null;
  createdAt: string;
}

export interface VisualBaselineDto {
  id: string;
  websiteId: string;
  pageUrl: string;
  viewport: string;
  screenshotId: string;
  failPercent: number;
  ignoreSelectors: string[];
  ignoreRects: VisualRegionDto[];
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  latest: VisualComparisonDto | null;
  comparisons: number;
}

/** Visual snapshots taken by one scan, each with its baseline and comparison (if any). */
export interface ScanVisualDto {
  scanId: string;
  websiteId: string;
  myRole: 'OWNER' | 'EDITOR' | 'VIEWER';
  snapshots: {
    screenshotId: string;
    pageUrl: string;
    viewport: string;
    width: number;
    height: number;
    baseline: { id: string; screenshotId: string; failPercent: number } | null;
    comparison: VisualComparisonDto | null;
  }[];
}

const selectorList = z
  .array(z.string().trim().min(1).max(200))
  .max(20, 'At most 20 ignore selectors.');
const rectList = z
  .array(
    z.object({
      x: z.number().min(0).max(20_000),
      y: z.number().min(0).max(20_000),
      width: z.number().min(1).max(20_000),
      height: z.number().min(1).max(20_000),
    }),
  )
  .max(20, 'At most 20 ignore regions.');
const failPercent = z.number().min(0).max(100);

export const createVisualBaselineSchema = z.object({
  /** A VISUAL_CURRENT snapshot from a scan of this website. */
  screenshotId: idSchema,
  failPercent: failPercent.default(0.5),
  ignoreSelectors: selectorList.default([]),
  ignoreRects: rectList.default([]),
});
export type CreateVisualBaselineInput = z.infer<typeof createVisualBaselineSchema>;

export const updateVisualBaselineSchema = z
  .object({
    failPercent: failPercent.optional(),
    ignoreSelectors: selectorList.optional(),
    ignoreRects: rectList.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Nothing to update.',
  });

/** "Accept this snapshot as the new baseline": always an explicit user action. */
export const replaceVisualBaselineSchema = z.object({ screenshotId: idSchema });

export type VisualBaselineWithWebsiteDto = VisualBaselineDto & {
  website: { id: string; name: string; baseUrl: string };
};
