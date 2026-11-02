import { z } from 'zod';

/**
 * The fixed shape of an AI explanation. Claude must answer in exactly this JSON
 * (structured outputs), and the server validates it again before saving.
 * The UI renders every field as plain text or a code block, never as HTML.
 */
export const aiExplanationSchema = z.object({
  /** What the problem is, in plain language. */
  summary: z.string(),
  /** Why it matters for visitors and for the business. */
  whyItMatters: z.string(),
  /** Who is affected, e.g. "Screen reader users". */
  whoIsAffected: z.array(z.string()),
  /** Steps a tester can follow to see the problem themselves. */
  howToReproduce: z.array(z.string()),
  /** Concrete steps to fix it. */
  howToFix: z.array(z.string()),
  /** Before/after code when a code change fixes it; null when not applicable. */
  codeExample: z.object({ language: z.string(), before: z.string(), after: z.string() }).nullable(),
  /** What could not be known from the issue data (honest uncertainty). */
  limitations: z.string(),
});
export type AiExplanation = z.infer<typeof aiExplanationSchema>;

export interface AiInsightDto {
  issueId: string;
  kind: 'EXPLANATION';
  model: string;
  content: AiExplanation;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
  /** True when it was reused from the same problem in an earlier scan (no new AI call). */
  reused: boolean;
}

export interface AiStatusDto {
  enabled: boolean;
  /** Shown to users before they send anything. */
  provider: 'Anthropic' | null;
  model: string | null;
  limits: { perUserPerHour: number; perDay: number; maxOutputTokens: number };
  usageToday: { requests: number; inputTokens: number; outputTokens: number };
}
