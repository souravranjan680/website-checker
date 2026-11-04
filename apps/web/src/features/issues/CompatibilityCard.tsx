import type { IssueDto } from '@whc/shared';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BROWSER_LABEL, COMPATIBILITY_CHECK_LABEL } from '@/lib/labels';

const MATCH: Record<string, string> = {
  attribute: 'a unique attribute (id, name, label, link or image address)',
  path: 'its position in the page and its text',
  selector: 'its CSS selector',
};

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const obj = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * A cross-browser difference (Phase 9, Milestone 3): which browser, compared with which
 * Chromium, how the element was matched, whether a second load confirmed it, and the stored
 * evidence. Evidence comes from the scanned site: every value is shown as text, read
 * defensively (missing or unexpected fields are left out).
 */
export function CompatibilityCard({
  compatibility: c,
}: {
  compatibility: NonNullable<IssueDto['compatibility']>;
}) {
  const e = obj(c.evidence) ?? {};
  const error = obj(e.error);
  const font = obj(e.font);
  const finding = obj(e.finding);
  const declarations = Array.isArray(e.declarations)
    ? e.declarations
        .map(obj)
        .filter((d): d is Record<string, unknown> => d !== null && str(d.property) !== null)
    : [];
  const confirmed = e.confirmed === true ? true : e.confirmed === false ? false : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Browser difference
          <Badge variant="secondary">{BROWSER_LABEL[c.browser] ?? c.browser}</Badge>
        </CardTitle>
        <CardDescription>
          Seen in {c.browserVersion}, not in {c.baselineVersion} on the same page and screen size.
          Never part of the scores.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid gap-2">
          <Row label="Check">{COMPATIBILITY_CHECK_LABEL[c.checkType] ?? c.checkType}</Row>
          {str(e.underlying) ? (
            <Row label="Found by">
              <code className="text-xs">{str(e.underlying)}</code>
            </Row>
          ) : null}
          {c.matchMethod ? (
            <Row label="Element matched by">{MATCH[c.matchMethod] ?? c.matchMethod}</Row>
          ) : null}
          <Row label="Second load">
            {confirmed === true
              ? 'Seen again: confirmed'
              : confirmed === false
                ? 'Not confirmed'
                : 'Not recorded'}
          </Row>
          {str(e.why) ? <Row label="Why">{str(e.why)}</Row> : null}
          {error ? (
            <Row label="Error">
              <span className="break-all">
                {str(error.message) ?? 'No message'}
                {str(error.source)
                  ? ` (${str(error.source)}${num(error.line) !== null ? `:${num(error.line)}` : ''})`
                  : ''}
              </span>
            </Row>
          ) : null}
          {str(e.url) ? (
            <Row label="Resource">
              <span className="break-all">{str(e.url)}</span>
              {num(e.status) !== null ? ` (HTTP ${num(e.status)})` : ''}
              {str(e.resourceType) ? ` · ${str(e.resourceType)}` : ''}
            </Row>
          ) : null}
          {font ? (
            <Row label="Font">
              {str(font.family) ?? 'Unknown'} {str(font.weight) ?? ''} {str(font.style) ?? ''}
              {Array.isArray(font.sources) && font.sources.some((s) => str(s)) ? (
                <ul className="mt-1 break-all text-muted-foreground">
                  {font.sources
                    .map(str)
                    .filter((s): s is string => s !== null)
                    .slice(0, 5)
                    .map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                </ul>
              ) : null}
            </Row>
          ) : null}
          {finding && str(finding.selector) ? (
            <Row label="Element">
              <code className="break-all text-xs">{str(finding.selector)}</code>
            </Row>
          ) : null}
        </dl>
        {declarations.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              CSS this browser reports it does not support
            </p>
            <ul className="space-y-0.5">
              {declarations.slice(0, 20).map((d, i) => (
                <li key={i} className="break-all">
                  <code className="text-xs">
                    {str(d.property)}: {str(d.value) ?? ''}
                  </code>
                  {str(d.selector) ? (
                    <span className="text-muted-foreground"> in {str(d.selector)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <details>
          <summary className="cursor-pointer text-muted-foreground">All recorded evidence</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs break-all whitespace-pre-wrap">
            {JSON.stringify(c.evidence, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
