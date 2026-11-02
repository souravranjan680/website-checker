import { describe, expect, it } from 'vitest';
import { dashboardHandoffUrl } from '../src/lib/handoff';
import { issueMarkdown, reportMarkdown } from '../src/lib/markdown';
import { describeInjectionError, pageSupport } from '../src/lib/page-access';
import { normalizeDashboardUrl } from '../src/lib/settings';
import { toIssues } from '../src/types';
import { sampleResult } from './sample';

describe('which pages can be checked', () => {
  it.each([
    ['https://example.com/', true],
    ['http://localhost:3000/', true],
    ['chrome://settings', false],
    ['chrome-extension://abc/popup.html', false],
    ['https://chromewebstore.google.com/detail/x', false],
    ['about:blank', false],
    ['file:///C:/x.html', false],
    [undefined, false],
  ])('%s → %s', (url, supported) => {
    expect(pageSupport(url).supported).toBe(supported);
  });

  it('explains Chrome errors in plain words', () => {
    expect(describeInjectionError(new Error('Cannot access a chrome:// URL'))).toMatch(
      /browser page/,
    );
    expect(
      describeInjectionError(
        new Error(
          'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
        ),
      ),
    ).toMatch(/click the extension icon/);
  });
});

describe('dashboard hand-off', () => {
  it('passes only the page origin and path (no query string or fragment)', () => {
    const url = new URL(dashboardHandoffUrl('http://localhost:8081', sampleResult.url));
    expect(url.origin + url.pathname).toBe('http://localhost:8081/websites/new');
    expect(url.searchParams.get('baseUrl')).toBe('https://shop.example.com/cart');
    expect(url.toString()).not.toContain('session');
  });

  it('accepts only plain http(s) dashboard addresses', () => {
    expect(normalizeDashboardUrl('https://checker.example.com/app/')).toBe(
      'https://checker.example.com/app',
    );
    expect(normalizeDashboardUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeDashboardUrl('https://user:pass@checker.example.com')).toBeNull();
    expect(normalizeDashboardUrl('https://checker.example.com/?token=x')).toBeNull();
    expect(normalizeDashboardUrl('not a url')).toBeNull();
  });
});

describe('Markdown copy', () => {
  const issues = toIssues(sampleResult);

  it('uses the shared titles, WCAG references and fixes, and says it is a local check', () => {
    const text = issueMarkdown(issues[0]!, sampleResult);
    expect(text).toContain('### Images must have alternative text');
    expect(text).toContain('**WCAG:** 1.1.1 (level A)');
    expect(text).toContain('`image-alt`');
    expect(text).toContain('Add an alt attribute.');
    expect(text).toMatch(/local check .*not a saved scan/);
  });

  it('cannot be broken by backticks inside the HTML snippet', () => {
    const text = issueMarkdown(issues[0]!, sampleResult);
    expect(text).toContain('````html\n<img class="logo" src="```x.png">\n````');
  });

  it('lists all issues, most severe first', () => {
    const text = reportMarkdown(issues, sampleResult);
    expect(text.indexOf('Images must have')).toBeLessThan(text.indexOf('Button without'));
    expect(text).toContain('**Issues:** 2');
  });
});
