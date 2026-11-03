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
import { installSafety } from './safety';

/**
 * The explorer stage of a health scan (Phase 9, Milestone 1): the first `pageLimit`
 * scanned pages, in a separate browser context with the safety layer. Issues are
 * saved per page; the per-page summary (explored, skipped, blocked) is stored on the
 * page. Returns the pages that were explored (for issue tracking: interaction
 * problems are only marked resolved on pages that were explored again).
 */
export async function runExploration(args: {
  browser: Browser;
  deps: ScanDeps;
  scanId: string;
  websiteId: string;
  siteHostname: string;
  viewport: ViewportSpec;
  targets: { id: string; url: string; normalizedUrl: string }[];
  controlLimit: number;
  cropBudget: { remaining: number };
  storeIssues: (scanPageId: string | null, drafts: IssueDraft[]) => Promise<void>;
  onPage: (index: number, url: string) => Promise<void>;
  checkpoint: () => void;
  shouldStop: () => boolean;
  log: Logger;
}): Promise<Set<string>> {
  const { deps } = args;
  const explored = new Set<string>();
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
      let summary: ExplorationSummary | { url: string; error: string };
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
        explored.add(normalizeUrl(target.url) ?? target.url);
        explored.add(target.normalizedUrl);
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
  return explored;
}
