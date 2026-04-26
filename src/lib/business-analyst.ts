import 'server-only'

import { Prisma } from '@prisma/client'
import { assertAdministrativeRole } from '@/lib/auth'
import {
  buildDeterministicBusinessReport,
  type BusinessIntelligenceReport,
  type BusinessIntelligenceRuntimeState,
  type CustomerTypeFilter,
} from '@/lib/business-insights'
import {
  BUSINESS_ANALYST_CACHE_SOURCE,
  buildBusinessAnalystInputHash,
  buildBusinessAnalystNextRefreshLabel,
  buildBusinessAnalystScopeKey,
  buildBusinessAnalystUpdatedAtLabel,
  resolveBusinessAnalystCacheWindow,
} from '@/lib/business-analyst-cache'
import { getBusinessInsightsData } from '@/lib/insights-data'
import { prisma } from '@/lib/prisma'
import {
  BUSINESS_ANALYST_PROMPT_VERSION,
  describeBusinessAnalystMode,
  generateOpenAIBusinessReport,
  isOpenAIBusinessAnalystEnabled,
} from '@/lib/ai/openai-business-analyst'

const CACHE_WAIT_ATTEMPTS = 12
const CACHE_WAIT_DELAY_MS = 150
const RUNNING_STALE_MS = 90_000

type CacheRecord = Awaited<ReturnType<typeof prisma.aiBusinessInsightCache.findUnique>>

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function parseCachedReport(value: Prisma.JsonValue | null): BusinessIntelligenceReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (
    typeof candidate.mode !== 'string'
    || !candidate.runtime || typeof candidate.runtime !== 'object'
    || !candidate.summary || typeof candidate.summary !== 'object'
    || !Array.isArray(candidate.insights)
    || !Array.isArray(candidate.prioritized)
    || !Array.isArray(candidate.alerts)
    || !Array.isArray(candidate.opportunities)
    || !candidate.context || typeof candidate.context !== 'object'
  ) {
    return null
  }

  return candidate as unknown as BusinessIntelligenceReport
}

function isReusableCacheRecord(record: CacheRecord, inputHash: string, now = new Date()) {
  if (!record) {
    return false
  }

  if (record.inputHash !== inputHash) {
    return false
  }

  if (record.status !== 'SUCCESS' && record.status !== 'FALLBACK') {
    return false
  }

  if (!record.outputJson || !record.generatedAt) {
    return false
  }

  if (record.expiresAt.getTime() <= now.getTime()) {
    return false
  }

  return parseCachedReport(record.outputJson) !== null
}

function buildRuntimeState(input: {
  report: BusinessIntelligenceReport
  record: NonNullable<CacheRecord>
  referenceDate?: Date
}): BusinessIntelligenceRuntimeState {
  const fallbackUnavailable = input.record.status === 'FALLBACK'
    && Boolean(input.record.failureReason)
    && input.record.failureReason !== 'disabled'

  return {
    ...input.report.runtime,
    userModeLabel: input.report.mode === 'ai' ? 'IA do período' : 'Leitura local do período',
    periodLabel: input.record.periodKey === 'MORNING' ? 'Leitura da manhã' : 'Leitura da tarde',
    updatedAtLabel: buildBusinessAnalystUpdatedAtLabel(
      input.record.generatedAt ?? input.record.updatedAt,
      input.record.timezone,
      input.referenceDate
    ),
    nextRefreshLabel: buildBusinessAnalystNextRefreshLabel(
      input.record.expiresAt,
      input.record.timezone,
      input.referenceDate
    ),
    statusNote: fallbackUnavailable
      ? 'Análise automática temporariamente indisponível'
      : 'Leitura do período',
  }
}

function attachRuntimeMetadata(input: {
  report: BusinessIntelligenceReport
  record: NonNullable<CacheRecord>
  referenceDate?: Date
}): BusinessIntelligenceReport {
  return {
    ...input.report,
    runtime: buildRuntimeState(input),
  }
}

async function waitForSettledCacheRecord(where: {
  barbershopId_localDateIso_periodKey_source_scopeKey: {
    barbershopId: string
    localDateIso: string
    periodKey: 'MORNING' | 'EVENING'
    source: 'BUSINESS_ANALYST'
    scopeKey: string
  }
}) {
  for (let attempt = 0; attempt < CACHE_WAIT_ATTEMPTS; attempt += 1) {
    await sleep(CACHE_WAIT_DELAY_MS)
    const record = await prisma.aiBusinessInsightCache.findUnique({ where })

    if (!record) {
      return null
    }

    if (record.status !== 'RUNNING') {
      return record
    }
  }

  return prisma.aiBusinessInsightCache.findUnique({ where })
}

async function resolveCacheExecutionMode(input: {
  key: {
    barbershopId: string
    localDateIso: string
    periodKey: 'MORNING' | 'EVENING'
    source: 'BUSINESS_ANALYST'
    scopeKey: string
  }
  inputHash: string
  timezone: string
  expiresAt: Date
  promptVersion: string
}) {
  const where = {
    barbershopId_localDateIso_periodKey_source_scopeKey: input.key,
  } as const

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await prisma.aiBusinessInsightCache.findUnique({ where })

    if (isReusableCacheRecord(record, input.inputHash)) {
      return { mode: 'cached' as const, record }
    }

    if (!record) {
      try {
        const created = await prisma.aiBusinessInsightCache.create({
          data: {
            ...input.key,
            timezone: input.timezone,
            inputHash: input.inputHash,
            promptVersion: input.promptVersion,
            status: 'RUNNING',
            expiresAt: input.expiresAt,
          },
        })

        return { mode: 'generate' as const, record: created }
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          continue
        }

        throw error
      }
    }

    if (record.status === 'RUNNING') {
      const isStale = Date.now() - record.updatedAt.getTime() > RUNNING_STALE_MS

      if (isStale) {
        const stolen = await prisma.aiBusinessInsightCache.updateMany({
          where: {
            id: record.id,
            status: 'RUNNING',
            updatedAt: record.updatedAt,
          },
          data: {
            inputHash: input.inputHash,
            promptVersion: input.promptVersion,
            expiresAt: input.expiresAt,
            timezone: input.timezone,
            failureReason: null,
          },
        })

        if (stolen.count === 1) {
          const refreshed = await prisma.aiBusinessInsightCache.findUnique({ where })

          if (refreshed) {
            return { mode: 'generate' as const, record: refreshed }
          }
        }
      }

      const settled = await waitForSettledCacheRecord(where)

      if (isReusableCacheRecord(settled, input.inputHash)) {
        return { mode: 'cached' as const, record: settled }
      }

      continue
    }

    const claimed = await prisma.aiBusinessInsightCache.updateMany({
      where: {
        id: record.id,
        updatedAt: record.updatedAt,
        status: {
          in: ['SUCCESS', 'FALLBACK', 'FAILED'],
        },
      },
      data: {
        inputHash: input.inputHash,
        promptVersion: input.promptVersion,
        expiresAt: input.expiresAt,
        timezone: input.timezone,
        status: 'RUNNING',
        failureReason: null,
        generatedAt: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
    })

    if (claimed.count === 1) {
      const refreshed = await prisma.aiBusinessInsightCache.findUnique({ where })

      if (refreshed) {
        return { mode: 'generate' as const, record: refreshed }
      }
    }
  }

  const latest = await prisma.aiBusinessInsightCache.findUnique({ where })

  if (isReusableCacheRecord(latest, input.inputHash)) {
    return { mode: 'cached' as const, record: latest }
  }

  return {
    mode: 'generate' as const,
    record: latest,
  }
}

async function persistCompletedCacheRecord(input: {
  recordId: string
  report: BusinessIntelligenceReport
  status: 'SUCCESS' | 'FALLBACK'
  timezone: string
  expiresAt: Date
  promptVersion: string
  model: string | null
  failureReason: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}) {
  return prisma.aiBusinessInsightCache.update({
    where: { id: input.recordId },
    data: {
      status: input.status,
      outputJson: JSON.parse(JSON.stringify(input.report)),
      promptVersion: input.promptVersion,
      model: input.model,
      failureReason: input.failureReason,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.totalTokens,
      timezone: input.timezone,
      expiresAt: input.expiresAt,
      generatedAt: new Date(),
    },
  })
}

async function markCacheFailure(input: {
  recordId: string
  promptVersion: string
  expiresAt: Date
  timezone: string
  error: unknown
}) {
  const message = input.error instanceof Error ? input.error.message : 'unknown_error'

  await prisma.aiBusinessInsightCache.update({
    where: { id: input.recordId },
    data: {
      status: 'FAILED',
      failureReason: message.slice(0, 300),
      promptVersion: input.promptVersion,
      expiresAt: input.expiresAt,
      timezone: input.timezone,
    },
  })
}

function logCacheEvent(message: string, context: Record<string, string | number | null>) {
  const details = Object.entries(context)
    .map(([key, value]) => `${key}=${value ?? 'null'}`)
    .join(' ')

  console.info(`[business-analyst/cache] ${message} ${details}`.trim())
}

export async function getBusinessAnalystReport(params: {
  barbershopId: string
  month: number
  year: number
  professionalId?: string | null
  customerType?: CustomerTypeFilter
  viewerRole: string | null | undefined
}): Promise<BusinessIntelligenceReport> {
  assertAdministrativeRole(
    params.viewerRole,
    'Sem permissao para consultar a inteligencia global da barbearia.'
  )

  const barbershop = await prisma.barbershop.findUnique({
    where: { id: params.barbershopId },
    select: { timezone: true },
  })

  const window = resolveBusinessAnalystCacheWindow(barbershop?.timezone)
  const customerType = params.customerType ?? 'all'
  const professionalId = params.professionalId ?? null
  const aiEnabled = isOpenAIBusinessAnalystEnabled()
  const scopeKey = buildBusinessAnalystScopeKey({
    month: params.month,
    year: params.year,
    professionalId,
    customerType,
  })
  const inputHash = buildBusinessAnalystInputHash({
    month: params.month,
    year: params.year,
    professionalId,
    customerType,
    aiEnabled,
    promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
  })

  const key = {
    barbershopId: params.barbershopId,
    localDateIso: window.localDateIso,
    periodKey: window.periodKey,
    source: BUSINESS_ANALYST_CACHE_SOURCE,
    scopeKey,
  } as const

  const execution = await resolveCacheExecutionMode({
    key,
    inputHash,
    timezone: window.timezone,
    expiresAt: window.expiresAt,
    promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
  })

  if (execution.mode === 'cached' && execution.record) {
    const cachedReport = parseCachedReport(execution.record.outputJson)

    if (cachedReport) {
      logCacheEvent('hit', {
        barbershopId: params.barbershopId,
        localDateIso: execution.record.localDateIso,
        periodKey: execution.record.periodKey,
        scopeKey,
        status: execution.record.status,
      })

      return attachRuntimeMetadata({
        report: cachedReport,
        record: execution.record,
      })
    }
  }

  const generationRecord = execution.record

  if (!generationRecord) {
    throw new Error('Nao foi possivel preparar o cache da analise de negocio.')
  }

  try {
    const context = await getBusinessInsightsData({
      barbershopId: params.barbershopId,
      month: params.month,
      year: params.year,
      professionalId,
      customerType,
    })

    const deterministic = buildDeterministicBusinessReport(context)

    if (!aiEnabled) {
      const saved = await persistCompletedCacheRecord({
        recordId: generationRecord.id,
        report: deterministic,
        status: 'FALLBACK',
        timezone: window.timezone,
        expiresAt: window.expiresAt,
        promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
        model: null,
        failureReason: 'disabled',
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      })

      logCacheEvent('stored', {
        barbershopId: params.barbershopId,
        localDateIso: saved.localDateIso,
        periodKey: saved.periodKey,
        scopeKey,
        status: saved.status,
        mode: deterministic.mode,
        totalTokens: null,
      })

      return attachRuntimeMetadata({
        report: deterministic,
        record: saved,
      })
    }

    const aiAttempt = await generateOpenAIBusinessReport({
      context,
      deterministic,
    })

    const finalReport = aiAttempt.report ?? deterministic
    const finalStatus = aiAttempt.report ? 'SUCCESS' : 'FALLBACK'
    const saved = await persistCompletedCacheRecord({
      recordId: generationRecord.id,
      report: finalReport,
      status: finalStatus,
      timezone: window.timezone,
      expiresAt: window.expiresAt,
      promptVersion: aiAttempt.promptVersion,
      model: aiAttempt.model,
      failureReason: aiAttempt.failureReason,
      inputTokens: aiAttempt.inputTokens,
      outputTokens: aiAttempt.outputTokens,
      totalTokens: aiAttempt.totalTokens,
    })

    logCacheEvent('stored', {
      barbershopId: params.barbershopId,
      localDateIso: saved.localDateIso,
      periodKey: saved.periodKey,
      scopeKey,
      status: saved.status,
      mode: finalReport.mode,
      totalTokens: aiAttempt.totalTokens,
    })

    return attachRuntimeMetadata({
      report: finalReport,
      record: saved,
    })
  } catch (error) {
    await markCacheFailure({
      recordId: generationRecord.id,
      promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
      expiresAt: window.expiresAt,
      timezone: window.timezone,
      error,
    })

    throw error
  }
}

export function getBusinessAnalystIntegrationStatus() {
  return {
    deterministicReady: true,
    openAIConfigured: isOpenAIBusinessAnalystEnabled(),
    fallbackMode: describeBusinessAnalystMode('deterministic'),
    aiMode: describeBusinessAnalystMode('ai'),
    cacheMode: 'persisted-window',
  }
}
