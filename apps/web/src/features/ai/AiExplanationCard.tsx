import type { AiInsightDto } from '@whc/shared';
import { Loader2, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { ErrorState } from '@/components/common/ErrorState';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { useAiInsight, useAiStatus, useExplainIssue } from './api';

/**
 * "Explain with AI" for one issue. Only the issue ID is sent from the browser; the
 * server builds a redacted prompt. The answer is shown as text and code blocks only.
 */
export function AiExplanationCard({ issueId }: { issueId: string }) {
  const status = useAiStatus();
  const insight = useAiInsight(issueId);
  const explain = useExplainIssue(issueId);

  let body: ReactNode;
  if (status.isPending || insight.isPending) {
    body = <Skeleton className="h-20" />;
  } else if (status.isError || insight.isError) {
    // A failed request is not the same as "AI not configured": say what really happened.
    body = (
      <ErrorState
        title="Couldn't load AI information"
        error={status.error ?? insight.error}
        onRetry={() => {
          void status.refetch();
          void insight.refetch();
        }}
      />
    );
  } else if (insight.data) {
    body = <Explanation insight={insight.data} />;
  } else if (!status.data?.enabled) {
    body = (
      <p className="text-sm text-muted-foreground">
        AI explanations are not set up on this server (no Anthropic API key). Everything else works
        normally. An administrator can enable it in the server&apos;s <code>.env</code> file.
      </p>
    );
  } else {
    body = (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Sends this issue&apos;s rule, description, CSS selector and a cleaned HTML snippet to{' '}
          {status.data.provider} ({status.data.model}). Form values, e-mail addresses, tokens and
          URL query strings are removed first; cookies and screenshots are never sent.
        </p>
        <Button onClick={() => explain.mutate()} disabled={explain.isPending}>
          {explain.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles aria-hidden="true" />
          )}
          {explain.isPending ? 'Asking the AI…' : 'Explain with AI'}
        </Button>
        {explain.isError ? (
          <ErrorState title="No explanation this time" error={explain.error} />
        ) : null}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden="true" /> AI explanation
        </CardTitle>
        <CardDescription>
          Optional. Written by AI from the scan data: check it before acting on it.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function Explanation({ insight }: { insight: AiInsightDto }) {
  const c = insight.content;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-base">{c.summary}</p>
      <Block title="Why it matters">
        <p>{c.whyItMatters}</p>
      </Block>
      {c.whoIsAffected.length ? (
        <Block title="Who is affected">
          <ul className="list-disc pl-5">
            {c.whoIsAffected.map((who) => (
              <li key={who}>{who}</li>
            ))}
          </ul>
        </Block>
      ) : null}
      {c.howToReproduce.length ? (
        <Block title="How to see it yourself">
          <ol className="list-decimal pl-5">
            {c.howToReproduce.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </Block>
      ) : null}
      <Block title="How to fix it">
        <ol className="list-decimal pl-5">
          {c.howToFix.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </Block>
      {c.codeExample ? (
        <Block title={`Code example (${c.codeExample.language})`}>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Before</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                {c.codeExample.before}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">After</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                {c.codeExample.after}
              </pre>
            </div>
          </div>
        </Block>
      ) : null}
      {c.limitations ? (
        <Alert>
          <AlertDescription>
            <b>Limits of this explanation:</b> {c.limitations}
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{insight.model}</Badge>
        {formatDateTime(insight.createdAt)}
        {insight.reused ? ' · reused from the same problem in an earlier scan' : ''}
        {insight.inputTokens !== null
          ? ` · ${insight.inputTokens + (insight.outputTokens ?? 0)} tokens`
          : ''}
      </p>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
