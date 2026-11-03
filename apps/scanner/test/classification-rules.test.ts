/**
 * Finding classification (Phase 9, Milestone 0): the scanner's rules, and proof that
 * the migration's backfill SQL gives older rows exactly the same result.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@whc/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyDraft, uiDraft, type IssueDraft, type UiCheckType } from '../src/issues';
import { saveIssues } from '../src/persistence';
import { createScanFor, createTestPrisma } from './helpers';

const ctx = { websiteId: 'w', pageUrl: 'https://site.test/', viewport: '1920x1080' };

function ui(
  check: UiCheckType,
  measurements?: Record<string, unknown>,
  category: 'UI_HEALTH' | 'RESPONSIVE' = 'UI_HEALTH',
) {
  return uiDraft(check, ctx, category, {
    severity: 'MEDIUM',
    description: `${check} ${JSON.stringify(measurements ?? {})}`,
    measurements,
    target: `${check}-${JSON.stringify(measurements ?? {})}-${category}`,
  });
}

function base(overrides: Partial<IssueDraft>): IssueDraft {
  return {
    ...ui('OVERLAPPING_ELEMENTS'),
    uiHealth: undefined,
    ...overrides,
    fingerprint: `${overrides.ruleId}-${Math.random()}`,
    id: crypto.randomUUID(),
  };
}

const axe = (detection: 'AUTOMATED' | 'NEEDS_REVIEW') =>
  base({
    category: 'ACCESSIBILITY',
    ruleId: `image-alt-${detection}`,
    accessibility: {
      axeRuleId: 'image-alt',
      impact: 'critical',
      wcagCriteria: ['1.1.1'],
      wcagLevel: 'A',
      tags: [],
      helpUrl: 'https://example.test',
      detection,
      failureSummary: null,
    },
  });
const security = (findingLevel: 'OBSERVATION' | 'WARNING' | 'CONFIRMED') =>
  base({
    category: 'SECURITY',
    ruleId: `sec/missing-csp-${findingLevel}`,
    security: {
      checkType: 'MISSING_CSP',
      findingLevel,
      headerName: null,
      observedValue: null,
      recommendedValue: null,
    },
  });

/** Every branch of the rules, with the expected answer. */
const CASES: [string, IssueDraft, string][] = [
  ['axe violation', axe('AUTOMATED'), 'DETECTED'],
  ['axe needs review', axe('NEEDS_REVIEW'), 'INCONCLUSIVE'],
  ['security confirmed', security('CONFIRMED'), 'DETECTED'],
  ['security warning', security('WARNING'), 'POTENTIAL_DEFECT'],
  ['security observation', security('OBSERVATION'), 'OBSERVATION'],
  [
    'SEO rule',
    base({
      category: 'SEO',
      ruleId: 'seo/missing-title',
      seo: { checkType: 'MISSING_TITLE', expected: null, actual: null },
    }),
    'DETECTED',
  ],
  ['performance', base({ category: 'PERFORMANCE', ruleId: 'perf/lcp' }), 'POTENTIAL_DEFECT'],
  ['horizontal scroll', ui('HORIZONTAL_SCROLL'), 'DETECTED'],
  ['unnamed button', ui('EMPTY_BUTTON'), 'DETECTED'],
  ['unnamed link', ui('EMPTY_LINK'), 'DETECTED'],
  ['confirmed broken image', ui('BROKEN_IMAGE', { verdict: 'CONFIRMED' }), 'DETECTED'],
  ['older unverified broken image', ui('BROKEN_IMAGE'), 'POTENTIAL_DEFECT'],
  ['confirmed broken link', ui('BROKEN_LINK', { verdict: 'CONFIRMED' }), 'DETECTED'],
  ['confirmed failed script', ui('FAILED_SCRIPT', { verdict: 'CONFIRMED' }), 'DETECTED'],
  ['older failed stylesheet', ui('FAILED_STYLESHEET'), 'POTENTIAL_DEFECT'],
  ['confirmed failed request', ui('FAILED_REQUEST', { verdict: 'CONFIRMED' }), 'DETECTED'],
  ['site-code console error', ui('CONSOLE_ERROR', { kind: 'APPLICATION' }), 'POTENTIAL_DEFECT'],
  [
    'integration config error',
    ui('CONSOLE_ERROR', { kind: 'INTEGRATION_CONFIG' }),
    'POTENTIAL_DEFECT',
  ],
  ['third-party console error', ui('CONSOLE_ERROR', { kind: 'THIRD_PARTY' }), 'OBSERVATION'],
  ['network console echo', ui('CONSOLE_ERROR', { kind: 'NETWORK' }), 'OBSERVATION'],
  ['older console error', ui('CONSOLE_ERROR'), 'POTENTIAL_DEFECT'],
  ['uncaught exception', ui('JS_ERROR', { kind: 'APPLICATION' }), 'POTENTIAL_DEFECT'],
  ['covered control', ui('OVERLAPPING_ELEMENTS'), 'POTENTIAL_DEFECT'],
  ['clipped text', ui('TEXT_CLIPPING'), 'POTENTIAL_DEFECT'],
  ['responsive overflow', ui('CONTENT_OVERFLOW', undefined, 'RESPONSIVE'), 'POTENTIAL_DEFECT'],
  ['responsive horizontal scroll', ui('HORIZONTAL_SCROLL', undefined, 'RESPONSIVE'), 'DETECTED'],
];

describe('classifyDraft', () => {
  it.each(CASES)('%s → %s', (_label, draft, expected) => {
    expect(classifyDraft(draft)).toBe(expected);
  });
});

describe('migration backfill gives older rows the same classification', () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = createTestPrisma();
  });
  afterAll(async () => prisma.$disconnect());

  it('matches classifyDraft for every rule branch', async () => {
    const { scanId } = await createScanFor(prisma, 'https://classification.example.com/');
    const drafts = CASES.map(([, draft]) => draft);
    await saveIssues(prisma, scanId, null, drafts);

    // Pretend these are rows from before Phase 9, then run the migration's backfill.
    await prisma.issue.updateMany({ where: { scanId }, data: { classification: 'INCONCLUSIVE' } });
    const dir = path.resolve(import.meta.dirname, '../../../packages/db/prisma/migrations');
    const migration = readdirSync(dir).find((name) =>
      name.endsWith('phase9_m0_classification_review'),
    )!;
    const sql = readFileSync(path.join(dir, migration, 'migration.sql'), 'utf8');
    const backfill = sql.slice(
      sql.indexOf('-- Backfill'),
      sql.indexOf('-- Review history is append-only'),
    );
    for (const statement of backfill
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => /\bUPDATE\b/.test(s))) {
      await prisma.$executeRawUnsafe(statement);
    }

    const rows = await prisma.issue.findMany({
      where: { scanId },
      select: { id: true, classification: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r.classification]));
    for (const [label, draft, expected] of CASES) {
      expect(byId.get(draft.id), label).toBe(expected);
    }
  });

  it('stores the scanner classification for new issues', async () => {
    const { scanId } = await createScanFor(prisma, 'https://classification-new.example.com/');
    const draft = ui('BROKEN_LINK', { verdict: 'CONFIRMED' });
    await saveIssues(prisma, scanId, null, [draft]);
    const row = await prisma.issue.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.classification).toBe('DETECTED');
  });
});
