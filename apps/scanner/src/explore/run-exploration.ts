import type { FormProbeMode } from '@whc/dom-checks';
import type { Browser } from 'playwright';
import { newScanContext } from '../browser';
import type { ViewportSpec } from '../browser-types';
import { attachCollectors } from '../checks/collectors';
import { normalizeUrl } from '../crawler/urls';
import type { IssueDraft } from '../issues';
import type { Logger } from '../logger';
import { saveScreenshot } from '../persistence';
import type { ScanDeps } from '../pipeline/run-scan';
import { explorePage, type ExplorationSummary } from './explore-page';
import { formProbe, type FormsSummary } from './form-probe';
import { keyboardProbe, type KeyboardSummary } from './keyboard-probe';
import { installSafety } from './safety';

/**
 * The explorer stage of a health scan (Phase 9, Milestone 1): the first `pageLimit`
 * scanned pages, in a separate browser context with the safety layer. Issues are
 * saved per page; the per-page summary (explored, skipped, blocked) is stored on the
 * page. Then, on the same pages, the keyboard and form probes (Milestone 2,
 * Checkpoint 2), if the website allows them. Returns the pages each part covered (for
 * issue tracking: such problems are only marked resolved where they were checked again).
 */
export interface ExploredPages {
  explored: Set<string>;
  keyboard: Set<string>;
  /** Pages whose fields were read (STATIC or more). */
  formsRead: Set<string>;
  /** Pages whose fields were focused and left (BLUR or SYNTHETIC). */
  formsProbed: Set<string>;
  /** Pages where invalid values were also typed (SYNTHETIC). */
  formsSynthetic: Set<string>;
}
export async function runExploration(args: {
  browser: Browser;
  deps: ScanDeps;
  scanId: string;
  websiteId: string;
  siteHostname: string;
  viewport: ViewportSpec;
  targets: { id: string; url: string; normalizedUrl: string }[];
  controlLimit: number;
  keyboardProbe: boolean;
  formProbeMode: FormProbeMode;
  cropBudget: { remaining: number };
  storeIssues: (scanPageId: string | null, drafts: IssueDraft[]) => Promise<void>;
  onPage: (index: number, url: string) => Promise<void>;
  checkpoint: () => void;
  shouldStop: () => boolean;
  log: Logger;
}): Promise<ExploredPages> {
  const { deps } = args;
  const covered: ExploredPages = {
    explored: new Set(),
    keyboard: new Set(),
    formsRead: new Set(),
    formsProbed: new Set(),
    formsSynthetic: new Set(),
  };
  const explored = covered.explored;
  const context = await newScanContext(args.browser, args.viewport);
  try {
    const safety = await installSafety(context, { siteHostname: args.siteHostname });
    for (const [index, target] of args.targets.entries()) {
      args.checkpoint();
      if (args.shouldStop()) break;
      await args.onPage(index, target.url);
      safety.disarm();
      const page = await context.newPage();
      const { log, detach } = attachCollectors(page);
      let summary:
        | (ExplorationSummary & {
            keyboard?: KeyboardSummary | { error: string } | null;
            forms?: FormsSummary | { error: string } | null;
          })
        | { url: string; error: string };
      try {
        const response = await page.goto(target.url, {
          waitUntil: 'load',
          timeout: deps.config.navTimeoutMs,
        });
        if (!response || response.status() >= 400) throw new Error('The page did not load again.');
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
        const url = page.url();
        safety.arm();
        const result = await explorePage({
          page,
          url,
          ctx: { websiteId: args.websiteId, pageUrl: target.url, viewport: args.viewport.label },
          siteHostname: args.siteHostname,
          domBundle: deps.domBundle,
          log,
          blocked: safety.blocked,
          allowNavigation: safety.allowNavigation,
          collectPageBlocks: safety.collectPageBlocks,
          controlLimit: args.controlLimit,
          cropBudget: args.cropBudget,
          checkpoint: args.checkpoint,
          logger: args.log,
        });
        for (const draft of result.drafts) {
          const crop = result.crops.get(draft.id);
          if (!crop) continue;
          draft.screenshotId = await saveScreenshot(deps.prisma, deps.storage, {
            scanId: args.scanId,
            scanPageId: target.id,
            kind: 'ISSUE_CROP',
            viewport: args.viewport.label,
            key: `scans/${args.scanId}/issues/${draft.id}.jpg`,
            ...crop,
          });
        }
        await args.storeIssues(target.id, result.drafts);
        summary = result.summary;
        const pageKeys = [normalizeUrl(target.url) ?? target.url, target.normalizedUrl];
        pageKeys.forEach((key) => explored.add(key));

        // Keyboard and form probes (Milestone 2, Checkpoint 2), on a fresh copy of the page.
        const ctx = {
          websiteId: args.websiteId,
          pageUrl: target.url,
          viewport: args.viewport.label,
        };
        const probe = {
          page,
          url,
          domBundle: deps.domBundle,
          log,
          blocked: safety.blocked,
          allowNavigation: safety.allowNavigation,
          collectPageBlocks: safety.collectPageBlocks,
          checkpoint: args.checkpoint,
        };
        const blockedBeforeProbes = safety.blocked.length;
        summary.keyboard = null;
        if (args.keyboardProbe) {
          try {
            const keyboard = await keyboardProbe({
              ...probe,
              ctx,
              established: result.activation.established,
              activationSkipped: result.activation.skipped,
              cropBudget: args.cropBudget,
              logger: args.log,
            });
            for (const draft of keyboard.drafts) {
              const crop = keyboard.crops.get(draft.id);
              if (!crop) continue;
              draft.screenshotId = await saveScreenshot(deps.prisma, deps.storage, {
                scanId: args.scanId,
                scanPageId: target.id,
                kind: 'ISSUE_CROP',
                viewport: args.viewport.label,
                key: `scans/${args.scanId}/issues/${draft.id}.jpg`,
                ...crop,
              });
            }
            await args.storeIssues(target.id, keyboard.drafts);
            summary.keyboard = keyboard.summary;
            if (keyboard.summary.stoppedBy !== 'error')
              pageKeys.forEach((key) => covered.keyboard.add(key));
          } catch (error) {
            args.checkpoint();
            args.log.info(
              { url: target.url, err: (error as Error).message },
              'keyboard probe failed',
            );
            summary.keyboard = { error: 'The keyboard probe could not finish on this page.' };
          }
        }
        summary.forms = null;
        if (args.formProbeMode !== 'OFF') {
          try {
            const forms = await formProbe({
              ...probe,
              ctx,
              mode: args.formProbeMode,
              knownViolations: result.knownViolations,
            });
            await args.storeIssues(target.id, forms.drafts);
            summary.forms = forms.summary;
            if (forms.summary) {
              pageKeys.forEach((key) => covered.formsRead.add(key));
              if (args.formProbeMode !== 'STATIC')
                pageKeys.forEach((key) => covered.formsProbed.add(key));
              if (args.formProbeMode === 'SYNTHETIC')
                pageKeys.forEach((key) => covered.formsSynthetic.add(key));
            }
          } catch (error) {
            args.checkpoint();
            args.log.info({ url: target.url, err: (error as Error).message }, 'form probe failed');
            summary.forms = { error: 'The form probe could not finish on this page.' };
          }
        }
        // Actions the safety layer blocked during the probes are listed with the page's others.
        summary.blocked = [...summary.blocked, ...safety.blocked.slice(blockedBeforeProbes)].slice(
          0,
          50,
        );
      } catch (error) {
        args.checkpoint(); // a cancelled scan stops here
        args.log.info({ url: target.url, err: (error as Error).message }, 'exploration failed');
        summary = { url: target.url, error: 'The page could not be explored.' };
      } finally {
        detach();
        await page.close().catch(() => {});
      }
      await deps.prisma.scanPage.update({
        where: { id: target.id },
        data: { exploration: summary as unknown as object },
      });
    }
  } finally {
    await context.close().catch(() => {});
  }
  return covered;
}
