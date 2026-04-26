import 'server-only'

import { Prisma, type AiChatUsageSource, type AiUsageStatus } from '@prisma/client'
import { estimateOpenAIUsageCost } from '@/lib/ai/openai-pricing'
import { prisma } from '@/lib/prisma'

function normalizeOptionalNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
}

export async function recordAiUsage(input: {
  barbershopId: string
  userId?: string | null
  threadId?: string | null
  source: AiChatUsageSource
  model?: string | null
  inputTokens?: number | null
  cachedInputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  status?: AiUsageStatus
  errorMessage?: string | null
  metadataJson?: Prisma.InputJsonValue | null
}) {
  try {
    const normalizedInputTokens = normalizeOptionalNumber(input.inputTokens)
    const normalizedCachedInputTokens = normalizeOptionalNumber(input.cachedInputTokens)
    const normalizedOutputTokens = normalizeOptionalNumber(input.outputTokens)
    const normalizedTotalTokens = normalizeOptionalNumber(input.totalTokens)
    const pricingEstimate = estimateOpenAIUsageCost({
      model: input.model,
      inputTokens: normalizedInputTokens,
      cachedInputTokens: normalizedCachedInputTokens,
      outputTokens: normalizedOutputTokens,
    })

    await prisma.aiChatUsageLog.create({
      data: {
        barbershopId: input.barbershopId,
        userId: input.userId ?? null,
        threadId: input.threadId ?? null,
        source: input.source,
        model: input.model ?? null,
        inputTokens: normalizedInputTokens,
        cachedInputTokens: normalizedCachedInputTokens,
        outputTokens: normalizedOutputTokens,
        totalTokens: normalizedTotalTokens,
        status: input.status ?? 'SUCCESS',
        estimatedCostCents: pricingEstimate.estimatedCostCents,
        estimatedCostUsd: pricingEstimate.estimatedCostUsd !== null
          ? new Prisma.Decimal(pricingEstimate.estimatedCostUsd.toFixed(6))
          : null,
        pricingVersion: input.model ? pricingEstimate.pricingVersion : null,
        pricingSourceUpdatedAt: input.model ? pricingEstimate.pricingSourceUpdatedAt : null,
        errorMessage: input.errorMessage?.slice(0, 500) ?? null,
        metadataJson: input.metadataJson ?? undefined,
      },
    })
  } catch (error) {
    console.warn('[ai-usage] log_failed', {
      source: input.source,
      barbershopId: input.barbershopId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
