import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { aiExplanationSchema, type AiExplanation } from '@whc/shared';
import { AppError } from './errors';
import type { Logger } from './logger';

/** What the AI feature needs from a model provider. Tests use a fake (no network, no cost). */
export interface AiProvider {
  model: string;
  explain(prompt: { system: string; user: string }): Promise<{
    content: AiExplanation;
    inputTokens: number | null;
    outputTokens: number | null;
  }>;
}

/**
 * Claude via the official Anthropic SDK (server-side only; the key never reaches a browser).
 * Structured outputs force the answer into aiExplanationSchema, and messages.parse()
 * validates it. Effort "low" keeps answers quick and cheap: this is an explanation,
 * not deep reasoning.
 */
export function createClaudeProvider(options: {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  logger: Logger;
}): AiProvider {
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: 60_000 });
  const { logger } = options;

  return {
    model: options.model,
    async explain(prompt) {
      let response;
      try {
        response = await client.messages.parse({
          model: options.model,
          max_tokens: options.maxOutputTokens,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          output_config: { effort: 'low', format: zodOutputFormat(aiExplanationSchema) },
        });
      } catch (error) {
        throw toAppError(error, logger);
      }
      if (response.stop_reason === 'refusal') {
        logger.warn(
          { category: response.stop_details?.category ?? null },
          'AI refused to explain an issue',
        );
        throw new AppError(422, 'AI_REFUSED', 'The AI declined to explain this issue.');
      }
      if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
        logger.warn(
          { stopReason: response.stop_reason },
          'AI answer incomplete or not in the expected format',
        );
        throw new AppError(502, 'AI_INCOMPLETE', 'The AI answer was incomplete. Please try again.');
      }
      return {
        content: response.parsed_output,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}

/** SDK errors → friendly API errors. Typed classes only; messages are never shown to users. */
function toAppError(error: unknown, logger: Logger): AppError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    logger.error({ status: error.status }, 'Anthropic rejected the API key');
    return new AppError(
      503,
      'AI_UNAVAILABLE',
      'AI is not available right now (configuration problem). An administrator has been notified in the logs.',
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    logger.warn('Anthropic rate limit reached');
    return new AppError(429, 'AI_BUSY', 'The AI service is busy. Please try again in a minute.');
  }
  if (error instanceof Anthropic.BadRequestError) {
    logger.error({ status: error.status, type: error.error }, 'Anthropic rejected the request');
    return new AppError(502, 'AI_FAILED', 'The AI request failed. Please try again later.');
  }
  if (error instanceof Anthropic.APIError) {
    logger.warn({ status: error.status }, 'Anthropic API error');
    return new AppError(
      503,
      'AI_UNAVAILABLE',
      'The AI service is not reachable right now. Please try again later.',
    );
  }
  logger.error({ err: error }, 'unexpected AI provider error');
  return new AppError(502, 'AI_FAILED', 'The AI request failed. Please try again later.');
}
