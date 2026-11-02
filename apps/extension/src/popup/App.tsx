import { useEffect, useMemo, useState } from 'react';
import { SEVERITY_RANK, type Severity } from '@whc/dom-checks';
import { dashboardHandoffUrl } from '../lib/handoff';
import { issueMarkdown, reportMarkdown } from '../lib/markdown';
import {
  checkTab,
  clearHighlightInTab,
  describeInjectionError,
  highlightInTab,
  pageSupport,
  SUPPORT_MESSAGES,
  targetTab,
} from '../lib/page-access';
import { loadSettings, normalizeDashboardUrl, saveSettings, type Settings } from '../lib/settings';
import { toIssues, type ExtensionIssue, type PageCheckResult } from '../types';

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const SEVERITY_STYLE: Record<Severity, string> = {
  CRITICAL: 'bg-sev-critical text-white',
  HIGH: 'bg-sev-high text-white',
  MEDIUM: 'bg-sev-medium text-black',
  LOW: 'bg-sev-low text-white',
  INFO: 'bg-muted text-fg',
};
type Category = 'ALL' | 'ACCESSIBILITY' | 'UI_HEALTH';

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback when the Clipboard API is unavailable (e.g. the popup lost focus).
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('copy failed');
  }
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${SEVERITY_STYLE[severity]}`}
    >
      {severity}
    </span>
  );
}

function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' },
) {
  const { variant = 'secondary', className = '', ...rest } = props;
  const look =
    variant === 'primary'
      ? 'bg-primary text-primary-fg hover:opacity-90'
      : 'border border-border bg-surface hover:bg-muted';
  return (
    <button
      type="button"
      className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 ${look} ${className}`}
      {...rest}
    />
  );
}

/** Shown until acknowledged, and kept on screen during that first use. */
function AuthorizationNotice({
  onAcknowledge,
  acknowledged,
}: {
  onAcknowledge: () => void;
  acknowledged: boolean;
}) {
  return (
    <section
      aria-labelledby="notice-title"
      className="rounded-md border border-warning-border bg-warning-bg p-3 text-sm text-warning-fg"
    >
      <h2 id="notice-title" className="font-semibold">
        Only check websites you own or are authorized to test
      </h2>
      <p className="mt-1">
        The check runs locally in your browser, on the page you are viewing, only when you click
        “Check this page”. Nothing is sent to a server. Results are not saved and are not official
        scans.
      </p>
      {acknowledged ? null : (
        <Button variant="primary" className="mt-2" onClick={onAcknowledge}>
          I understand
        </Button>
      )}
    </section>
  );
}

function IssueItem({
  issue,
  expanded,
  onToggle,
  onHighlight,
  onCopy,
}: {
  issue: ExtensionIssue;
  expanded: boolean;
  onToggle: () => void;
  onHighlight: () => void;
  onCopy: () => void;
}) {
  return (
    <li
      className="border-b border-border last:border-b-0"
      data-rule-id={issue.ruleId}
      data-category={issue.category}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <SeverityBadge severity={issue.severity} />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{issue.title}</span>
          <span className="block truncate text-xs text-fg-muted">
            {issue.wcag.length > 0 ? `WCAG ${issue.wcag.join(', ')} · ` : ''}
            {issue.selector ?? issue.ruleId}
          </span>
        </span>
      </button>
      {expanded ? (
        <div className="space-y-2 px-3 pb-3 text-sm">
          <p>{issue.description}</p>
          {issue.html ? (
            <pre className="max-h-24 overflow-auto rounded bg-muted p-2 text-xs break-all whitespace-pre-wrap">
              {issue.html}
            </pre>
          ) : null}
          <div>
            <h4 className="text-xs font-semibold uppercase text-fg-muted">How to fix</h4>
            <p className="whitespace-pre-wrap break-words">{issue.suggestedFix}</p>
          </div>
          <p className="text-xs text-fg-muted">Rule: {issue.ruleId}</p>
          <div className="flex gap-2">
            {issue.selector ? <Button onClick={onHighlight}>Highlight on page</Button> : null}
            <Button onClick={onCopy}>Copy details</Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function SettingsPanel({
  settings,
  onSaved,
  onClose,
}: {
  settings: Settings;
  onSaved: (s: Settings) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(settings.dashboardUrl);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const normalized = normalizeDashboardUrl(value);
        if (!normalized) {
          setError('Enter an address starting with http:// or https:// (no query string).');
          return;
        }
        await saveSettings({ dashboardUrl: normalized });
        onSaved({ ...settings, dashboardUrl: normalized });
      }}
    >
      <h2 className="font-semibold">Settings</h2>
      <label className="block text-sm" htmlFor="dashboard-url">
        Dashboard address
      </label>
      <input
        id="dashboard-url"
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby="dashboard-url-help"
      />
      <p id="dashboard-url-help" className="text-xs text-fg-muted">
        Used only by “Open in dashboard”. The extension stores this address and nothing else (no
        passwords, keys or results).
      </p>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" type="submit">
          Save
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<chrome.tabs.Tab | undefined>();
  const [tabLoaded, setTabLoaded] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'checking' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PageCheckResult | null>(null);
  const [category, setCategory] = useState<Category>('ALL');
  const [hidden, setHidden] = useState<Set<Severity>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [firstUse, setFirstUse] = useState(false);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettings(loaded);
      setFirstUse(!loaded.noticeAcknowledged);
    });
    void targetTab().then((t) => {
      setTab(t);
      setTabLoaded(true);
    });
  }, []);

  const issues = useMemo(() => (result ? toIssues(result) : []), [result]);
  const visible = issues
    .filter((i) => category === 'ALL' || i.category === category)
    .filter((i) => !hidden.has(i.severity))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, issues.filter((i) => i.severity === s).length]),
  ) as Record<Severity, number>;

  if (!settings || !tabLoaded) return <p className="p-4 text-sm">Loading…</p>;

  const support = pageSupport(tab?.url);
  const acknowledge = async () => {
    await saveSettings({ noticeAcknowledged: true });
    setSettings({ ...settings, noticeAcknowledged: true });
  };

  async function runCheck() {
    if (!tab?.id) return;
    setPhase('checking');
    setError(null);
    setExpanded(null);
    setStatus('Checking the page…');
    try {
      const checked = await checkTab(tab.id);
      setResult(checked);
      setPhase('done');
      setStatus(`Check finished: ${toIssues(checked).length} issues found.`);
    } catch (e) {
      setPhase('error');
      setError(describeInjectionError(e));
      setStatus('The check failed.');
    }
  }

  async function act(action: () => Promise<void>, done: string) {
    try {
      await action();
      setStatus(done);
    } catch (e) {
      setStatus(describeInjectionError(e));
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold">UI Health Checker</h1>
          <p className="text-xs text-fg-muted">Local check of the current page</p>
        </div>
        <Button aria-label="Settings" onClick={() => setShowSettings((v) => !v)}>
          Settings
        </Button>
      </header>

      {showSettings ? (
        <SettingsPanel
          settings={settings}
          onSaved={(s) => {
            setSettings(s);
            setShowSettings(false);
            setStatus('Settings saved.');
          }}
          onClose={() => setShowSettings(false)}
        />
      ) : null}

      {firstUse ? (
        <AuthorizationNotice
          acknowledged={settings.noticeAcknowledged}
          onAcknowledge={() => void acknowledge()}
        />
      ) : null}

      {!support.supported ? (
        <p role="alert" className="rounded-md border border-border bg-muted p-3 text-sm">
          {SUPPORT_MESSAGES[support.reason]}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="truncate text-xs text-fg-muted" title={tab?.url}>
            {tab?.url}
          </p>
          <Button
            variant="primary"
            className="w-full"
            disabled={!settings.noticeAcknowledged || phase === 'checking'}
            onClick={() => void runCheck()}
          >
            {phase === 'checking' ? 'Checking…' : result ? 'Check again' : 'Check this page'}
          </Button>
          {!settings.noticeAcknowledged ? (
            <p className="text-xs text-fg-muted">
              Read the notice above and click “I understand” first.
            </p>
          ) : null}
        </div>
      )}

      {phase === 'error' && error ? (
        <p
          role="alert"
          className="rounded-md border border-danger bg-surface p-3 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      {result && phase !== 'checking' ? (
        <section aria-label="Results" className="space-y-2">
          <p
            className="rounded-md border border-border bg-muted p-2 text-xs"
            data-testid="local-note"
          >
            <strong>Local check, not saved.</strong> This is not an official scan: nothing was
            stored or sent. For crawling, all screen sizes, performance, history and reports, run a
            full scan in the dashboard.
          </p>
          <ul className="grid grid-cols-5 gap-1 text-center" aria-label="Issues by severity">
            {SEVERITIES.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  aria-pressed={!hidden.has(s)}
                  title={
                    hidden.has(s)
                      ? `Show ${s.toLowerCase()} issues`
                      : `Hide ${s.toLowerCase()} issues`
                  }
                  onClick={() =>
                    setHidden((prev) => {
                      const next = new Set(prev);
                      if (next.has(s)) next.delete(s);
                      else next.add(s);
                      return next;
                    })
                  }
                  className={`w-full rounded-md border border-border p-1 ${hidden.has(s) ? 'opacity-40' : ''}`}
                >
                  <span className="block text-lg font-semibold tabular-nums">{counts[s]}</span>
                  <span className="block text-[10px] uppercase text-fg-muted">{s}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1" role="group" aria-label="Filter by category">
            {(
              [
                ['ALL', 'All'],
                ['ACCESSIBILITY', 'Accessibility'],
                ['UI_HEALTH', 'UI'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                aria-pressed={category === value}
                className={category === value ? 'bg-muted' : ''}
                onClick={() => setCategory(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {result.frames.total > 0 ? (
            <p className="text-xs text-fg-muted" data-testid="frames-note">
              {result.frames.total} embedded frame{result.frames.total === 1 ? ' was' : 's were'}{' '}
              not checked
              {result.frames.crossOrigin > 0
                ? ` (${result.frames.crossOrigin} from other websites)`
                : ''}
              . Open a frame’s own page to check it.
            </p>
          ) : null}
          {result.imagesFixedOnRetry.length > 0 ? (
            <p className="text-xs text-fg-muted">
              {result.imagesFixedOnRetry.length} image(s) did not display at first but loaded on a
              retry; not reported.
            </p>
          ) : null}
          {visible.length === 0 ? (
            <p className="text-sm">
              {issues.length === 0
                ? 'No problems found by the automated checks. Automated checks find only part of all accessibility problems; test with a keyboard and a screen reader too.'
                : 'No issues match the filters.'}
            </p>
          ) : (
            <ul
              className="max-h-80 overflow-auto rounded-md border border-border"
              aria-label="Issues"
            >
              {visible.map((issue) => (
                <IssueItem
                  key={issue.key}
                  issue={issue}
                  expanded={expanded === issue.key}
                  onToggle={() => setExpanded(expanded === issue.key ? null : issue.key)}
                  onHighlight={() =>
                    void act(async () => {
                      const found = await highlightInTab(tab!.id!, issue.selector!, issue.title);
                      if (!found)
                        throw new Error(
                          'The element is no longer on the page. Check the page again.',
                        );
                    }, 'Highlighted on the page.')
                  }
                  onCopy={() =>
                    void act(
                      () => copyText(issueMarkdown(issue, result)),
                      'Issue details copied as Markdown.',
                    )
                  }
                />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void act(
                  () => copyText(reportMarkdown(visible, result)),
                  'Issue list copied as Markdown.',
                )
              }
            >
              Copy all as Markdown
            </Button>
            <Button
              onClick={() => void act(() => clearHighlightInTab(tab!.id!), 'Highlight removed.')}
            >
              Clear highlight
            </Button>
            <Button
              onClick={() =>
                void act(async () => {
                  await chrome.tabs.create({
                    url: dashboardHandoffUrl(settings.dashboardUrl, result.url),
                  });
                }, 'Opened the dashboard in a new tab.')
              }
            >
              Open in dashboard
            </Button>
          </div>
        </section>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {status ? (
        <p className="text-xs text-fg-muted" aria-hidden="true">
          {status}
        </p>
      ) : null}
      {!firstUse ? (
        <p className="border-t border-border pt-2 text-[11px] text-fg-muted">
          Only check websites you own or are authorized to test. Results are local and not saved.
        </p>
      ) : null}
    </div>
  );
}
