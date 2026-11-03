/**
 * Phase 9, Milestone 2 (Checkpoint 2) as part of a scan, with a real Chromium on the
 * keyboard and forms fixtures: settings, which controls get Enter/Space, what the form
 * probe touches in each mode, issue tracking, scores and safety. (Detection quality per
 * detector: fixture-acceptance.test.ts.)
 */
import type { PrismaClient } from '@whc/db';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FormsSummary } from '../src/explore/form-probe';
import type { KeyboardSummary } from '../src/explore/keyboard-probe';
import { runScan } from '../src/pipeline/run-scan';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import {
  createPublisher,
  createScanFor,
  createTestDeps,
  createTestPrisma,
  startTestProxy,
  testScannerConfig,
} from './helpers';

let prisma: PrismaClient;
let publisher: Redis;
let fixtures: FixtureServer;
let proxy: Awaited<ReturnType<typeof startTestProxy>>;

beforeAll(async () => {
  prisma = createTestPrisma();
  publisher = createPublisher();
  fixtures = await startFixtureServer();
  proxy = await startTestProxy();
});
afterAll(async () => {
  await fixtures.close();
  await proxy.close();
  await publisher.quit();
  await prisma.$disconnect();
});

type Summary = { keyboard?: KeyboardSummary | null; forms?: FormsSummary | null };

async function scan(
  path: string,
  website: Parameters<typeof createScanFor>[2],
  websiteId?: string,
) {
  fixtures.resetSafetyHits();
  const ids = await createScanFor(prisma, fixtures.url(path), website, websiteId);
  const deps = createTestDeps(testScannerConfig(proxy.url), prisma, publisher);
  await runScan(ids.scanId, deps, { signal: new AbortController().signal });
  const [row, issues, pages] = await Promise.all([
    prisma.scan.findUniqueOrThrow({ where: { id: ids.scanId } }),
    prisma.issue.findMany({ where: { scanId: ids.scanId }, include: { functional: true } }),
    prisma.scanPage.findMany({ where: { scanId: ids.scanId }, orderBy: { createdAt: 'asc' } }),
  ]);
  return {
    ...ids,
    scan: row,
    issues,
    summaries: pages.map((p) => p.exploration as Summary | null),
    safety: fixtures.safetyHits(),
  };
}

const ONE_PAGE = { maxPages: 1, maxDepth: 0, responsivePageLimit: 0 };
const isKeyboard = (ruleId: string) =>
  /functional\/(focus-|keyboard-trap|key-activation|click-not-focusable)/.test(ruleId);
const isForm = (ruleId: string) => ruleId.startsWith('functional/form-');

describe('settings', () => {
  it('defaults: keyboard probe on, forms BLUR (focus and leave, no typing)', async () => {
    const website = await prisma.website.create({
      data: {
        project: { create: { name: 'Defaults' } },
        name: 'Defaults',
        baseUrl: 'https://example.com/',
        hostname: 'example.com',
        authorizationConfirmedAt: new Date(),
      },
    });
    expect(website).toMatchObject({ keyboardProbeEnabled: true, formProbeMode: 'BLUR' });
  });

  it('switched off per website: no keyboard or form findings, and the summaries say so', async () => {
    const result = await scan('/keyboard/', {
      ...ONE_PAGE,
      keyboardProbeEnabled: false,
      formProbeMode: 'OFF',
    });
    expect(result.issues.filter((i) => isKeyboard(i.ruleId) || isForm(i.ruleId))).toEqual([]);
    expect(result.summaries[0]).toMatchObject({ keyboard: null, forms: null });
  }, 180_000);

  it('STATIC only reads fields: no field is focused (the fixture reports any focus) and no blur findings', async () => {
    const result = await scan('/forms/', {
      ...ONE_PAGE,
      keyboardProbeEnabled: false,
      formProbeMode: 'STATIC',
    });
    expect(result.safety).toEqual({ writes: [], traps: [], websockets: [] });
    const rules = new Set(result.issues.map((i) => i.ruleId));
    expect(rules.has('functional/form-required-not-indicated')).toBe(true);
    expect(rules.has('functional/form-error-not-associated')).toBe(false);
    expect(rules.has('functional/form-no-blur-feedback')).toBe(false);
    const forms = result.summaries[0]!.forms!;
    expect(forms.probed).toEqual([]);
    expect(forms.skippedCounts['mode-static']).toBeGreaterThan(0);
  }, 180_000);
});

describe('what the probes touch', () => {
  it('Enter and Space only on controls whose click was proven safe in this scan', async () => {
    const result = await scan('/keyboard/', { maxPages: 2, maxDepth: 1, responsivePageLimit: 0 });
    expect(result.safety).toEqual({ writes: [], traps: [], websockets: [] });
    const [main, modal] = result.summaries as [Summary, Summary];
    expect(main.keyboard!.activation.map((a) => a.name).sort()).toEqual([
      'Billing questions',
      'More tips',
      'Shipping questions',
    ]);
    // The cookie notice's "Accept" and "Reject" change data: never clicked, never pressed.
    expect(modal.keyboard!.activation).toEqual([]);
    expect(modal.keyboard!.stoppedBy).toBe('end'); // a modal keeping focus is not a trap
  }, 240_000);

  it('form fields left alone are listed with their reasons; personal and secret fields are never touched', async () => {
    const result = await scan('/forms/', {
      ...ONE_PAGE,
      keyboardProbeEnabled: false,
      formProbeMode: 'SYNTHETIC',
    });
    expect(result.safety).toEqual({ writes: [], traps: [], websockets: [] });
    const forms = result.summaries[0]!.forms!;
    expect(forms.skipped).toEqual(
      expect.arrayContaining([
        { name: 'E-mail', reason: 'personal-data-field' },
        { name: 'Full name', reason: 'personal-data-field' },
        { name: 'Password', reason: 'sensitive-field' },
        { name: 'Verification code', reason: 'sensitive-field' },
        { name: 'Card number', reason: 'sensitive-field' },
        { name: 'Type the letters', reason: 'captcha' },
      ]),
    );
    expect(forms.probed.map((p) => p.name)).not.toContain('E-mail');
  }, 180_000);
});

describe('issue tracking', () => {
  it('keyboard findings are not resolved by a scan with the keyboard probe off', async () => {
    const first = await scan('/keyboard/', ONE_PAGE);
    await prisma.website.update({
      where: { id: first.websiteId },
      data: { keyboardProbeEnabled: false },
    });
    await scan('/keyboard/', {}, first.websiteId);
    const tracked = await prisma.trackedIssue.findMany({ where: { websiteId: first.websiteId } });
    const keyboard = tracked.filter((t) => isKeyboard(t.ruleId));
    expect(keyboard.length).toBeGreaterThanOrEqual(6);
    expect(keyboard.every((t) => t.status === 'OPEN')).toBe(true);
  }, 360_000);

  it('blur and synthetic findings are not resolved by scans that no longer probe that way', async () => {
    const first = await scan('/forms/', {
      ...ONE_PAGE,
      keyboardProbeEnabled: false,
      formProbeMode: 'SYNTHETIC',
    });
    await prisma.website.update({
      where: { id: first.websiteId },
      data: { formProbeMode: 'BLUR' },
    });
    await scan('/forms/', {}, first.websiteId);
    await prisma.website.update({
      where: { id: first.websiteId },
      data: { formProbeMode: 'STATIC' },
    });
    await scan('/forms/', {}, first.websiteId);
    const tracked = await prisma.trackedIssue.findMany({
      where: { websiteId: first.websiteId, ruleId: { startsWith: 'functional/form-' } },
    });
    const open = (rule: string) =>
      tracked.filter((t) => t.ruleId === rule).every((t) => t.status === 'OPEN');
    expect(tracked.filter((t) => t.ruleId === 'functional/form-error-not-associated')).toHaveLength(
      2,
    );
    expect(open('functional/form-error-not-associated')).toBe(true); // incl. the synthetic one
    expect(open('functional/form-no-blur-feedback')).toBe(true);
  }, 480_000);
});

describe('scores', () => {
  it('keyboard and form findings (FUNCTIONAL) never change the accessibility or UI score', async () => {
    const on = await scan('/keyboard/', ONE_PAGE);
    const off = await scan('/keyboard/', {
      ...ONE_PAGE,
      keyboardProbeEnabled: false,
      formProbeMode: 'OFF',
    });
    expect(on.issues.filter((i) => isKeyboard(i.ruleId)).length).toBeGreaterThan(0);
    expect(on.scan.accessibilityScore).toBe(off.scan.accessibilityScore);
    expect(on.scan.uiHealthScore).toBe(off.scan.uiHealthScore);
  }, 360_000);
});
