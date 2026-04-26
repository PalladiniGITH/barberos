import 'server-only'

export interface OpenAIUsageSnapshot {
  inputTokens: number | null
  cachedInputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

function normalizeTokenCount(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null
}

export function extractOpenAIUsage(payload: unknown): OpenAIUsageSnapshot {
  if (!payload || typeof payload !== 'object') {
    return {
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      totalTokens: null,
    }
  }

  const usage = (payload as {
    usage?: {
      input_tokens?: unknown
      output_tokens?: unknown
      total_tokens?: unknown
      cached_input_tokens?: unknown
      input_tokens_details?: {
        cached_tokens?: unknown
      }
      prompt_tokens_details?: {
        cached_tokens?: unknown
      }
    }
  }).usage

  return {
    inputTokens: normalizeTokenCount(usage?.input_tokens),
    cachedInputTokens: normalizeTokenCount(
      usage?.input_tokens_details?.cached_tokens
      ?? usage?.prompt_tokens_details?.cached_tokens
      ?? usage?.cached_input_tokens
    ),
    outputTokens: normalizeTokenCount(usage?.output_tokens),
    totalTokens: normalizeTokenCount(usage?.total_tokens),
  }
}
