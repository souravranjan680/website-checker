import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DomCheckOptions,
  DomCheckResult,
  ExtraCheckOptions,
  ExtraResult,
} from '@whc/dom-checks';
import type { Page } from 'playwright';

/**
 * Loads the browser bundle of @whc/dom-checks (one self-contained script).
 * Production build: copied next to dist/main.js. Development: from the package.
 */
export function loadDomChecksBundle(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const besideBuild = path.join(here, 'dom-checks.js');
  if (existsSync(besideBuild)) return readFileSync(besideBuild, 'utf8');
  const resolved = createRequire(import.meta.url).resolve('@whc/dom-checks/bundle');
  if (!existsSync(resolved)) {
    throw new Error('dom-checks bundle missing: run "npm run build -w @whc/dom-checks"');
  }
  return readFileSync(resolved, 'utf8');
}

/** Injects the bundle and runs the checks inside the page. */
export async function runDomChecksInPage(
  page: Page,
  bundle: string,
  options: DomCheckOptions,
): Promise<DomCheckResult> {
  await page.evaluate(bundle);
  return (await page.evaluate(
    `window.__whcDomChecks.run(${JSON.stringify(options)})`,
  )) as DomCheckResult;
}

/**
 * The Milestone 2 checks (layout, fonts and icons, component consistency). The bundle
 * must already be in the page (runDomChecksInPage injects it). `rootExpression` is a
 * JavaScript expression for the element to limit the layout checks to (default: body).
 */
export async function runExtraChecksInPage(
  page: Page,
  options: ExtraCheckOptions,
  rootExpression = 'document.body',
): Promise<ExtraResult> {
  return (await page.evaluate(
    `window.__whcDomChecks.extra(${JSON.stringify(options)}, ${rootExpression})`,
  )) as ExtraResult;
}
