/**
 * Runs INSIDE the page you are viewing, injected on demand by the popup
 * (chrome.scripting.executeScript, Chrome's isolated world: the page's own scripts
 * cannot see or change it). Bundled into one file: dist/page-runner.js.
 *
 * It is not a second scanning engine. The checks are the same code the server
 * scanner runs: axe-core with the shared rule set (AXE_OPTIONS) and the shared DOM
 * checks (@whc/dom-checks), presented with the shared titles, severities and fixes.
 *
 * Nothing is sent anywhere: the result is returned to the popup only.
 */
import axe from 'axe-core';
import {
  AXE_OPTIONS,
  axeFindings,
  domFindingPresentation,
  unnamedControlSelectors,
  type AxeOutput,
  type DomFinding,
} from '@whc/dom-checks';
import { runDomChecks } from '@whc/dom-checks/checks';
import type { PageCheckResult } from '../types';

const HIGHLIGHT_ID = '__whc-extension-highlight';

/** An <img> that did not display: does it display if loaded once more? */
function displaysOnRetry(src: string, timeoutMs = 5_000): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image.naturalWidth > 0);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    image.src = src;
  });
}

function countFrames(): PageCheckResult['frames'] {
  const frames = [...document.querySelectorAll('iframe, frame')] as HTMLIFrameElement[];
  let crossOrigin = 0;
  for (const frame of frames) {
    try {
      // Reading another site's frame is not allowed: that is how we tell them apart.
      if (!frame.contentDocument) crossOrigin += 1;
    } catch {
      crossOrigin += 1;
    }
  }
  return { total: frames.length, crossOrigin };
}

async function run(): Promise<PageCheckResult> {
  const raw = await axe.run(document, AXE_OPTIONS as axe.RunOptions);
  const axeOutput = {
    violations: raw.violations,
    incomplete: raw.incomplete,
    axeVersion: raw.testEngine.version,
  } as unknown as AxeOutput;
  const dom = runDomChecks({ mode: 'all', skipSelectors: unnamedControlSelectors(axeOutput) });

  // A broken image may be a one-off network failure: retry each once (same address).
  const imagesFixedOnRetry: string[] = [];
  const findings: DomFinding[] = [];
  for (const finding of dom.findings) {
    const src = finding.measurements?.src;
    if (finding.check === 'BROKEN_IMAGE' && typeof src === 'string' && /^https?:/i.test(src)) {
      if (await displaysOnRetry(src)) {
        imagesFixedOnRetry.push(src);
        continue;
      }
      findings.push({
        ...finding,
        message: `${finding.message} It still did not display after a retry.`,
      });
      continue;
    }
    findings.push(finding);
  }

  return {
    url: location.href,
    title: document.title,
    checkedAt: new Date().toISOString(),
    axeVersion: axeOutput.axeVersion,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    accessibility: axeFindings(axeOutput),
    ui: findings.map(domFindingPresentation),
    imagesFixedOnRetry,
    frames: countFrames(),
  };
}

function clearHighlight(): void {
  document.getElementById(HIGHLIGHT_ID)?.remove();
}

/**
 * Scrolls to the element and draws an outline over it. The outline lives in a closed
 * Shadow DOM, so the page's CSS cannot change or hide it, and it ignores the mouse.
 */
function highlight(selector: string, label: string): boolean {
  clearHighlight();
  let element: Element | null;
  try {
    // " >>> " separates shadow roots / frames in axe selectors: use the outermost part.
    element = document.querySelector(selector.split(' >>> ')[0]!);
  } catch {
    return false;
  }
  if (!element) return false;
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
  const rect = element.getBoundingClientRect();
  const host = document.createElement('div');
  host.id = HIGHLIGHT_ID;
  host.style.cssText =
    'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.style.cssText = `position:absolute;left:${rect.left + scrollX - 4}px;top:${rect.top + scrollY - 4}px;width:${Math.max(rect.width, 4) + 8}px;height:${Math.max(rect.height, 4) + 8}px;border:3px solid #d6336c;border-radius:4px;box-shadow:0 0 0 9999px rgba(0,0,0,.15);box-sizing:border-box;`;
  const tag = document.createElement('div');
  tag.textContent = label;
  tag.style.cssText =
    'position:absolute;left:0;bottom:100%;margin-bottom:4px;max-width:320px;padding:2px 6px;background:#d6336c;color:#fff;font:600 12px/1.4 system-ui,sans-serif;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  box.append(tag);
  shadow.append(box);
  document.documentElement.append(host);
  return true;
}

(globalThis as unknown as { __whcExtension: unknown }).__whcExtension = {
  run,
  highlight,
  clearHighlight,
};
