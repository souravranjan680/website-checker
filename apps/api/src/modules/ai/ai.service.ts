import type { PrismaClient } from '@whc/db';
import { aiExplanationSchema, type AiInsightDto, type AiStatusDto } from '@whc/shared';
import type { AppConfig } from '../../config/env';
import type { AiProvider } from '../../lib/ai-provider';
import { AppError, notFound } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import type { AuthUser } from '../../types/express';
import { requireProjectRole } from '../projects/project-access';
import { AI_PROMPT_INCLUDE, buildIssuePrompt, ISSUE_EXPLAIN_PROMPT_VERSION } from './prompt';

const startOfToday = () => {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  return day;
};

export type AiService = ReturnType<typeof createAiService>;

/**
 * AI issue explanations. Optional: with no provider (no API key) every call answers
 * "AI not configured" and nothing else in the app changes.
 * Cost controls: cached per issue AND per tracked problem (rescans reuse answers),
 * a per-user hourly limit (route), a daily limit for the whole system, a token cap.
 */
export function createAiService(deps: {
  prisma: PrismaClient;
  provider: AiProvider | null;
  config: AppConfig;
  logger: Logger;
}) {
  const { prisma, provider, config, logger } = deps;

  async function issueAccess(user: AuthUser, issueId: string) {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        ...AI_PROMPT_INCLUDE,
        scan: { select: { website: { select: { projectId: true } } } },
      },
    });
    if (!issue) throw notFound('Issue');
    await requireProjectRole(
      prisma,
      user,
      issue.scan.website.projectId,
      'VIEWER',
      'use AI explanations',
    );
    return issue;
  }

  /**
   * An existing explanation made with the current prompt version, for this issue or
   * for the same problem found in another scan.
   */
  async function cached(issueId: string, trackedIssueId: string | null) {
    const own = await prisma.aiInsight.findUnique({
      where: { issueId_kind: { issueId, kind: 'EXPLANATION' } },
    });
    if (own && own.promptVersion === ISSUE_EXPLAIN_PROMPT_VERSION)
      return { row: own, reused: false };
    if (!trackedIssueId) return null;
    const sibling = await prisma.aiInsight.findFirst({
      where: {
        kind: 'EXPLANATION',
        promptVersion: ISSUE_EXPLAIN_PROMPT_VERSION,
        issue: { trackedIssueId },
      },
      orderBy: { createdAt: 'desc' },
    });
    return sibling ? { row: sibling, reused: true } : null;
  }

  function toDto(
    row: {
      content: unknown;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
      createdAt: Date;
    },
    issueId: string,
    reused: boolean,
  ): AiInsightDto {
    return {
      issueId,
      kind: 'EXPLANATION',
      model: row.model,
      content: aiExplanationSchema.parse(row.content),
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      createdAt: row.createdAt.toISOString(),
      reused,
    };
  }

  return {
    async status(): Promise<AiStatusDto> {
      const usage = await prisma.aiInsight.aggregate({
        where: { createdAt: { gte: startOfToday() } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      });
      return {
        enabled: provider !== null,
        provider: provider ? 'Anthropic' : null,
        model: provider?.model ?? null,
        limits: {
          perUserPerHour: config.ai.userHourlyLimit,
          perDay: config.ai.dailyLimit,
          maxOutputTokens: config.ai.maxOutputTokens,
        },
        usageToday: {
          requests: usage._count._all,
          inputTokens: usage._sum.inputTokens ?? 0,
          outputTokens: usage._sum.outputTokens ?? 0,
        },
      };
    },

    /** The saved explanation (no AI call), or null. */
    async get(user: AuthUser, issueId: string): Promise<AiInsightDto | null> {
      const issue = await issueAccess(user, issueId);
      const hit = await cached(issueId, issue.trackedIssueId);
      return hit ? toDto(hit.row, issueId, hit.reused) : null;
    },

    /** Returns the cached explanation, or asks the AI once and saves the answer. */
    async explain(
      user: AuthUser,
      issueId: string,
    ): Promise<{ insight: AiInsightDto; cached: boolean }> {
      const issue = await issueAccess(user, issueId);
      const hit = await cached(issueId, issue.trackedIssueId);
      if (hit) return { insight: toDto(hit.row, issueId, hit.reused), cached: true };

      if (!provider) {
        throw new AppError(
          503,
          'AI_NOT_CONFIGURED',
          'AI explanations are not set up on this server (no Anthropic API key). Everything else works normally.',
        );
      }
      const today = await prisma.aiInsight.count({ where: { createdAt: { gte: startOfToday() } } });
      if (today >= config.ai.dailyLimit) {
        throw new AppError(
          429,
          'AI_DAILY_LIMIT',
          'The daily limit for AI explanations has been reached. Saved explanations still work; new ones are possible again tomorrow (UTC).',
        );
      }

      const result = await provider.explain(buildIssuePrompt(issue));
      const answer = {
        model: provider.model,
        promptVersion: ISSUE_EXPLAIN_PROMPT_VERSION,
        content: result.content,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        createdById: user.id,
      };
      const row = await prisma.aiInsight.upsert({
        // An answer from an older prompt version is replaced. (Two people clicking
        // at once: the second answer replaces the first; both used the same prompt.)
        where: { issueId_kind: { issueId, kind: 'EXPLANATION' } },
        create: { issueId, kind: 'EXPLANATION', ...answer },
        update: { ...answer, createdAt: new Date() },
      });
      logger.info(
        {
          issueId,
          model: provider.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          promptVersion: ISSUE_EXPLAIN_PROMPT_VERSION,
        },
        'AI explanation created',
      );
      return { insight: toDto(row, issueId, false), cached: false };
    },
  };
}
