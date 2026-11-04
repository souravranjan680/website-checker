/**
 * Bug reports built from real issues: nothing invented, permission-checked,
 * editable, exportable as Markdown / Jira / JSON.
 */
import { bugReportToJira, bugReportToMarkdown, type BugReportDto } from '@whc/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CSRF,
  createTestContext,
  createTestPrisma,
  resetDatabase,
  signUp,
  type Agent,
} from '../../../test/helpers';
import { buildBugReport, type BugReportIssue } from './builder';

const prisma = createTestPrisma();
let ctx = createTestContext(prisma);

beforeEach(async () => {
  await resetDatabase(prisma);
  ctx = createTestContext(prisma);
});
afterAll(() => prisma.$disconnect());

// ------------------------------------------------------------------ builder

function issue(overrides: Partial<BugReportIssue>): BugReportIssue {
  return {
    id: 'i1',
    scanId: 's1',
    scanPageId: 'p1',
    trackedIssueId: null,
    category: 'ACCESSIBILITY',
    severity: 'CRITICAL',
    ruleId: 'image-alt',
    title: 'Images must have alternative text',
    description: 'Ensures <img> elements have alternative text',
    pageUrl: 'https://shop.example.com/products',
    viewport: '390x844',
    selector: 'img.hero',
    htmlSnippet: '<img class="hero" src="/hero.png">',
    boundingBox: null,
    suggestedFix:
      'Add an alt attribute.\nGuidance: https://dequeuniversity.com/rules/axe/4.14/image-alt',
    details: null,
    fingerprint: 'f1',
    screenshotId: 'crop1',
    createdAt: new Date('2026-11-02T10:00:00Z'),
    accessibility: {
      issueId: 'i1',
      axeRuleId: 'image-alt',
      impact: 'critical',
      wcagCriteria: ['1.1.1'],
      wcagLevel: 'A',
      tags: [],
      helpUrl: null,
      detection: 'AUTOMATED',
      failureSummary: 'Element does not have an alt attribute',
    },
    uiHealth: null,
    seo: null,
    security: null,
    scanPage: { screenshots: [{ id: 'page1', kind: 'VIEWPORT', viewport: '390x844' }] },
    scan: {
      id: 's1',
      createdAt: new Date('2026-11-02T10:00:00Z'),
      browserVersion: 'Chromium 140.0.7339.16',
      website: { id: 'w1', name: 'Shop', baseUrl: 'https://shop.example.com/', projectId: 'pr1' },
    },
    ...overrides,
  } as BugReportIssue;
}

describe('buildBugReport', () => {
  it('builds an accessibility report only from recorded facts', () => {
    const r = buildBugReport(issue({}));
    expect(r).toMatchObject({
      title: 'Images must have alternative text (shop.example.com/products)',
      severity: 'CRITICAL',
      priority: 'P1',
      affectedUrl: 'https://shop.example.com/products',
      browser: 'Chromium 140.0.7339.16',
      viewport: '390×844',
      expectedBehavior: 'Images must have alternative text.',
      actualBehavior: 'Element does not have an alt attribute',
      selector: 'img.hero',
      suggestedFix: 'Add an alt attribute.', // the guidance link line is dropped
      screenshotId: 'crop1',
    });
    expect(r.stepsToReproduce).toEqual([
      'Open https://shop.example.com/products in Chromium 140.0.7339.16 with a 390×844 browser window.',
      'Find the element matching the CSS selector: img.hero',
      'Check the page with the axe-core rule "image-alt" (for example with the axe DevTools browser extension).',
    ]);
  });

  it('does not invent an expected behavior when axe could not decide', () => {
    const r = buildBugReport(
      issue({
        accessibility: {
          ...issue({}).accessibility!,
          detection: 'NEEDS_REVIEW',
          failureSummary: null,
        },
        screenshotId: null,
      }),
    );
    expect(r.expectedBehavior).toBe('');
    expect(r.stepsToReproduce[2]).toBe(
      'Check it by hand: axe-core could not decide automatically (WCAG 1.1.1).',
    );
    expect(r.screenshotId).toBe('page1'); // falls back to the page screenshot
  });

  it('uses the SEO check values and the security observed / recommended values', () => {
    const seo = buildBugReport(
      issue({
        category: 'SEO',
        severity: 'MEDIUM',
        ruleId: 'seo/missing-meta-description',
        title: 'Page has no meta description',
        description: 'The page has no meta description, or it is empty.',
        selector: null,
        accessibility: null,
        seo: {
          issueId: 'i1',
          checkType: 'MISSING_META_DESCRIPTION',
          expected: 'A one or two sentence summary',
          actual: '(none)',
        },
      }),
    );
    expect(seo.priority).toBe('P3');
    expect(seo.expectedBehavior).toBe('A one or two sentence summary');
    expect(seo.actualBehavior).toContain('Found: (none).');
    expect(seo.stepsToReproduce[1]).toBe(
      'View the page source (Ctrl+U) and check the <meta name="description"> tag in <head>.',
    );

    const security = buildBugReport(
      issue({
        category: 'SECURITY',
        severity: 'MEDIUM',
        ruleId: 'security/missing-csp',
        title: 'No Content-Security-Policy header',
        description: 'No Content-Security-Policy header is sent.',
        selector: null,
        accessibility: null,
        security: {
          issueId: 'i1',
          checkType: 'MISSING_CSP',
          findingLevel: 'WARNING',
          headerName: 'Content-Security-Policy',
          observedValue: null,
          recommendedValue: "default-src 'self'",
        },
      }),
    );
    expect(security.expectedBehavior).toBe("Recommended: default-src 'self'");
    expect(security.stepsToReproduce[1]).toContain(
      'read its response header "Content-Security-Policy"',
    );
  });

  it('describes performance issues with the Lighthouse threshold and mobile emulation', () => {
    const r = buildBugReport(
      issue({
        category: 'PERFORMANCE',
        severity: 'HIGH',
        ruleId: 'perf/lcp',
        title: 'Poor Largest Contentful Paint',
        description: 'Largest Contentful Paint is 5.1 s (mobile lab test).',
        viewport: 'mobile (Lighthouse)',
        selector: null,
        accessibility: null,
        details: { metric: 'lcpMs', value: 5100, good: 2500, poor: 4000 },
      }),
    );
    expect(r.browser).toBe('Chromium 140.0.7339.16 (Lighthouse, simulated mobile device)');
    expect(r.viewport).toBe('Mobile (Lighthouse emulation)');
    expect(r.expectedBehavior).toBe('At most 2.5 s');
    expect(r.stepsToReproduce[0]).toBe(
      'Open https://shop.example.com/products in Chromium 140.0.7339.16 (Lighthouse, simulated mobile device).',
    );
  });

  it('cross-browser issues: reproduced in the other browser, compared with the recorded Chromium', () => {
    const r = buildBugReport(
      issue({
        category: 'COMPATIBILITY',
        severity: 'MEDIUM',
        ruleId: 'compat/browser-only-layout',
        title: 'Layout problem in one browser only: Firefox',
        description: '“TEXT_OVERLAP” was found in this browser but not in Chromium.',
        viewport: '1920x1080',
        selector: '#badge',
        accessibility: null,
        compatibility: {
          issueId: 'i1',
          browser: 'FIREFOX',
          browserVersion: 'Firefox 157.0',
          baselineVersion: 'Chromium 156.0.8078.80',
          checkType: 'BROWSER_ONLY_LAYOUT',
          matchMethod: 'path',
          evidence: {},
        },
      }),
    );
    expect(r.browser).toBe('Firefox 157.0');
    expect(r.stepsToReproduce[0]).toContain('in Firefox 157.0 with a 1920×1080 browser window');
    expect(r.stepsToReproduce).toContain(
      'Open the same page in Chromium 156.0.8078.80 at the same window size and compare: the scanner did not see this there.',
    );
    expect(r.expectedBehavior).toBe('The same result as in Chromium 156.0.8078.80.');
  });

  it('says when the browser version was not recorded (older scans)', () => {
    const r = buildBugReport(issue({ scan: { ...issue({}).scan, browserVersion: null } }));
    expect(r.browser).toBe('Chromium (exact version not recorded for this scan)');
  });
});

describe('formatters', () => {
  const report = {
    ...buildBugReport(issue({})),
    id: 'b1',
    status: 'OPEN',
    expectedBehavior: '',
  } as unknown as BugReportDto;

  it('writes Markdown with numbered steps and marks unknown expected behavior', () => {
    const md = bugReportToMarkdown(report, 'https://app.example/api/screenshots/crop1');
    expect(md).toContain('# Images must have alternative text');
    expect(md).toContain('1. Open https://shop.example.com/products');
    expect(md).toContain('_Not determined by the scanner. Please describe._');
    expect(md).toContain('```html\n<img class="hero" src="/hero.png">\n```');
    expect(md).toContain('![Screenshot](https://app.example/api/screenshots/crop1)');
  });

  it('writes Jira wiki markup with escaped braces', () => {
    const jira = bugReportToJira({ ...report, description: 'Uses {curly} and [square] brackets' });
    expect(jira).toContain('h2. Images must have alternative text');
    expect(jira).toContain('# Open https://shop.example.com/products');
    expect(jira).toContain('Uses \\{curly\\} and \\[square\\] brackets');
    expect(jira).toContain('{code:html}');
  });
});

// ---------------------------------------------------------------------- API

async function siteWithIssue(agent: Agent) {
  const project = (await agent.post('/api/projects').set(CSRF).send({ name: 'Sites' })).body.data;
  const website = (
    await agent.post('/api/websites').set(CSRF).send({
      projectId: project.id,
      name: 'Home',
      baseUrl: 'https://example.com',
      authorizationConfirmed: true,
    })
  ).body.data;
  const scan = await prisma.scan.create({
    data: {
      websiteId: website.id,
      config: {},
      status: 'COMPLETED',
      browserVersion: 'Chromium 140.0.7339.16',
    },
  });
  const issueRow = await prisma.issue.create({
    data: {
      scanId: scan.id,
      category: 'ACCESSIBILITY',
      severity: 'HIGH',
      ruleId: 'label',
      title: 'Form elements must have labels',
      description: 'Ensures every form element has a label',
      pageUrl: 'https://example.com/contact',
      viewport: '1920x1080',
      selector: '#email',
      fingerprint: 'f-label',
      accessibility: {
        create: { axeRuleId: 'label', wcagCriteria: ['4.1.2'], detection: 'AUTOMATED' },
      },
    },
  });
  return { projectId: project.id as string, websiteId: website.id as string, issueId: issueRow.id };
}

describe('bug report API', () => {
  it('creates one report per issue, then edits, lists and exports it', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId, issueId } = await siteWithIssue(agent);

    const created = await agent.post('/api/bug-reports').set(CSRF).send({ issueId });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      issueId,
      website: { id: websiteId },
      priority: 'P2',
      browser: 'Chromium 140.0.7339.16',
      viewport: '1920×1080',
      status: 'OPEN',
      myRole: 'OWNER',
    });
    // Asking again returns the same open report instead of a duplicate.
    const again = await agent.post('/api/bug-reports').set(CSRF).send({ issueId });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(created.body.data.id);

    const id = created.body.data.id;
    const edited = await agent
      .patch(`/api/bug-reports/${id}`)
      .set(CSRF)
      .send({ status: 'IN_PROGRESS', expectedBehavior: 'The email field has a visible label.' });
    expect(edited.body.data).toMatchObject({
      status: 'IN_PROGRESS',
      expectedBehavior: 'The email field has a visible label.',
    });
    expect((await agent.patch(`/api/bug-reports/${id}`).set(CSRF).send({})).status).toBe(400);

    const list = await agent.get(`/api/bug-reports?status=IN_PROGRESS`);
    expect(list.body.meta.total).toBe(1);
    expect((await agent.get('/api/bug-reports?q=labels')).body.meta.total).toBe(1);

    const md = await agent.get(`/api/bug-reports/${id}/export?format=markdown`).buffer(true);
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(md.headers['content-disposition']).toContain(`bug-report-${id}.md`);
    expect(md.text).toContain('# Form elements must have labels');
    const jira = await agent.get(`/api/bug-reports/${id}/export?format=jira`).buffer(true);
    expect(jira.text).toContain('h2. Form elements must have labels');
    const json = await agent.get(`/api/bug-reports/${id}/export?format=json`);
    expect(json.body).toMatchObject({ id, issueId });

    const activity = (
      await prisma.activityLog.findMany({ where: { entityType: 'BugReport' } })
    ).map((a) => a.action);
    expect(activity.sort()).toEqual(['bug_report.created', 'bug_report.updated']);
  });

  it('enforces roles: viewers read and export, only editors create, edit and delete', async () => {
    const owner = await signUp(ctx.app);
    const viewer = await signUp(ctx.app, { email: 'viewer@example.com' });
    const outsider = await signUp(ctx.app);
    const { projectId, issueId } = await siteWithIssue(owner.agent);
    await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set(CSRF)
      .send({ email: 'viewer@example.com', role: 'VIEWER' });

    expect((await viewer.agent.post('/api/bug-reports').set(CSRF).send({ issueId })).status).toBe(
      403,
    );
    const id = (await owner.agent.post('/api/bug-reports').set(CSRF).send({ issueId })).body.data
      .id;
    expect((await viewer.agent.get(`/api/bug-reports/${id}`)).status).toBe(200);
    expect((await viewer.agent.get(`/api/bug-reports/${id}/export?format=markdown`)).status).toBe(
      200,
    );
    expect(
      (await viewer.agent.patch(`/api/bug-reports/${id}`).set(CSRF).send({ status: 'CLOSED' }))
        .status,
    ).toBe(403);
    expect((await viewer.agent.delete(`/api/bug-reports/${id}`).set(CSRF)).status).toBe(403);
    expect((await outsider.agent.get(`/api/bug-reports/${id}`)).status).toBe(404);
    expect((await outsider.agent.post('/api/bug-reports').set(CSRF).send({ issueId })).status).toBe(
      404,
    );
    expect((await outsider.agent.get('/api/bug-reports')).body.meta.total).toBe(0);
    expect((await owner.agent.delete(`/api/bug-reports/${id}`).set(CSRF)).status).toBe(204);
  });
});
