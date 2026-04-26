import 'server-only'

import type { AiChatUsageSource, AiUsageStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

function normalizeOptionalNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
}

function estimateAiUsageCostCents(input: {
  model: string | null | undefined
  inputTokens: number | null | undefined
  outputTokens: number | null | undefined
}) {
  void input
  return null
}

export async function recordAiUsage(input: {
  barbershopId: string
  userId?: string | null
  threadId?: string | null
  source: AiChatUsageSource
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  status?: AiUsageStatus
  errorMessage?: string | null
  metadataJson?: Prisma.InputJsonValue | null
}) {
  try {
    await prisma.aiChatUsageLog.create({
      data: {
        barbershopId: input.barbershopId,
        userId: input.userId ?? null,
        threadId: input.threadId ?? null,
        source: input.source,
        model: input.model ?? null,
        inputTokens: normalizeOptionalNumber(input.inputTokens),
        outputTokens: normalizeOptionalNumber(input.outputTokens),
        totalTokens: normalizeOptionalNumber(input.totalTokens),
        status: input.status ?? 'SUCCESS',
        estimatedCostCents: estimateAiUsageCostCents({
          model: input.model,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
        }),
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
