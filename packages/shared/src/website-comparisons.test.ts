import { describe, expect, it } from 'vitest';
import {
  createWebsiteComparisonSchema,
  updateWebsiteComparisonSchema,
  WEBSITE_COMPARISON_VIEWPORTS,
  websiteComparisonListQuerySchema,
} from './website-comparisons';

const valid = {
  projectId: 'p1',
  name: 'Redesign vs live',
  referenceWebsiteId: 'w1',
  targetWebsiteId: 'w2',
};
const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.success ? [] : result.error!.issues.map((i) => i.path.join('.'));

describe('createWebsiteComparisonSchema', () => {
  it('accepts the minimum (settings optional) and full settings', () => {
    expect(createWebsiteComparisonSchema.safeParse(valid).success).toBe(true);
    expect(
      createWebsiteComparisonSchema.safeParse({
        ...valid,
        maxPages: 50,
        maxDepth: 3,
        includePatterns: ['/shop/*'],
        excludePatterns: ['/admin/*'],
        viewports: ['1920x1080', '390x844'],
      }).success,
    ).toBe(true);
  });

  it.each([
    [{ maxPages: 0 }, 'maxPages'],
    [{ maxPages: 51 }, 'maxPages'],
    [{ maxPages: 2.5 }, 'maxPages'],
    [{ maxDepth: -1 }, 'maxDepth'],
    [{ maxDepth: 4 }, 'maxDepth'],
    [{ includePatterns: Array.from({ length: 21 }, (_, i) => `/p${i}`) }, 'includePatterns'],
    [{ excludePatterns: Array.from({ length: 21 }, (_, i) => `/p${i}`) }, 'excludePatterns'],
    [{ includePatterns: ['no-slash'] }, 'includePatterns.0'],
    [{ viewports: ['1024x768'] }, 'viewports.0'],
    [{ viewports: [] }, 'viewports'],
    [{ viewports: ['1920x1080', '1920x1080'] }, 'viewports'],
    [{ name: 'x' }, 'name'],
  ])('rejects %j', (override, path) => {
    expect(issues(createWebsiteComparisonSchema.safeParse({ ...valid, ...override }))).toContain(
      path,
    );
  });

  it('only the scan screen sizes are allowed', () => {
    expect(WEBSITE_COMPARISON_VIEWPORTS).toEqual([
      '1920x1080',
      '1366x768',
      '768x1024',
      '390x844',
      '320x568',
    ]);
  });

  it('rejects unknown fields and identical websites', () => {
    expect(createWebsiteComparisonSchema.safeParse({ ...valid, status: 'RUNNING' }).success).toBe(
      false,
    );
    expect(
      issues(createWebsiteComparisonSchema.safeParse({ ...valid, targetWebsiteId: 'w1' })),
    ).toEqual(['targetWebsiteId']);
  });
});

describe('updateWebsiteComparisonSchema', () => {
  it('is partial; the websites and unknown fields cannot be changed', () => {
    expect(updateWebsiteComparisonSchema.safeParse({}).success).toBe(true);
    expect(updateWebsiteComparisonSchema.safeParse({ archived: true }).success).toBe(true);
    expect(updateWebsiteComparisonSchema.safeParse({ targetWebsiteId: 'w3' }).success).toBe(false);
    expect(updateWebsiteComparisonSchema.safeParse({ projectId: 'p2' }).success).toBe(false);
    expect(updateWebsiteComparisonSchema.safeParse({ maxPages: 0 }).success).toBe(false);
  });
});

describe('websiteComparisonListQuerySchema', () => {
  it('defaults to non-archived; rejects unknown parameters', () => {
    expect(websiteComparisonListQuerySchema.parse({})).toMatchObject({
      archived: 'false',
      page: 1,
      pageSize: 20,
    });
    expect(websiteComparisonListQuerySchema.safeParse({ archived: 'maybe' }).success).toBe(false);
    expect(websiteComparisonListQuerySchema.safeParse({ sort: 'x' }).success).toBe(false);
  });
});
