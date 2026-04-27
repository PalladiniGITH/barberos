import 'server-only'

import type { AiChatUsageSource, BarbershopSubscriptionStatus, Prisma } from '@prisma/client'
import {
  OPENAI_PRICING_SOURCE_UPDATED_AT,
  OPENAI_PRICING_VERSION,
  convertUsdToBrl,
  getConfiguredOpenAIModelNames,
  getOpenAiUsdBrlRate,
} from '@/lib/ai/openai-pricing'
import { assertPlatformRoleAllowed } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatDateTimeInTimezone, resolveBusinessTimezone } from '@/lib/timezone'

const RECENT_ERROR_LIMIT = 8
const RECENT_ACTIVITY_LIMIT = 8

interface PlatformSessionIdentity {
  userId: string
  platformRole?: string | null
}

export interface PlatformOverviewFilters {
  search?: string | null
  status?: string | null
  plan?: string | null
}

export interface PlatformOverviewData {
  pricing: {
    version: string
    sourceUpdatedAt: Date
    pricedModels: string[]
    usdBrlRate: number | null
  }
  warnings: string[]
  filters: {
    search: string
    status: string
    plan: string
    availablePlans: string[]
  }
  cards: {
    activeBarbershops: number
    trialBarbershops: number
    pastDueBarbershops: number
    blockedBarbershops: number
    appointmentsThisMonth: number
    whatsappMessagesThisMonth: number
    aiTokensThisMonth: number
    aiEstimatedCostCents: number | null
    aiEstimatedCostUsd: number | null
    aiEstimatedCostBrl: number | null
    automationsToday: number
    recentErrors: number
  }
  barbershops: Array<{
    id: string
    name: string
    slug: string
    operationalActive: boolean
    subscriptionPlan: string | null
    subscriptionStatus: BarbershopSubscriptionStatus
    usersCount: number
    customersCount: number
    appointmentsThisMonth: number
    whatsappMessagesThisMonth: number
    aiTokensThisMonth: number
    aiEstimatedCostCents: number | null
    aiEstimatedCostUsd: number | null
    aiEstimatedCostBrl: number | null
    aiUnpricedRequests: number
    lastActivityAt: Date | null
    lastActivityLabel: string | null
  }>
  recentErrors: Array<{
    id: string
    kind: 'AI' | 'WHATSAPP' | 'AUTOMATION'
    barbershopId: string | null
    barbershopName: string
    message: string
    createdAt: Date
    createdAtLabel: string
  }>
}

export interface PlatformBarbershopDetailData {
  pricing: {
    version: string
    sourceUpdatedAt: Date
    pricedModels: string[]
    usdBrlRate: number | null
  }
  warnings: string[]
  barbershop: {
    id: string
    name: string
    slug: string
    timezone: string
    operationalActive: boolean
    subscriptionPlan: string | null
    subscriptionStatus: BarbershopSubscriptionStatus
    trialEndsAt: Date | null
    billingEmail: string | null
    blockedAt: Date | null
    blockedReason: string | null
    createdAt: Date
    createdAtLabel: string
  }
  totals: {
    users: number
    professionals: number
    customers: number
    appointmentsThisMonth: number
    whatsappMessagesThisMonth: number
    aiTokensThisMonth: number
    aiEstimatedCostCents: number | null
    aiEstimatedCostUsd: number | null
    aiEstimatedCostBrl: number | null
    automationsThisMonth: number
  }
  users: Array<{
    id: string
    name: string
    email: string
    role: string
    platformRole: string
    active: boolean
    createdAt: Date
  }>
  aiUsageBySource: Array<{
    source: AiChatUsageSource
    requests: number
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    totalTokens: number
    estimatedCostCents: number | null
    estimatedCostUsd: number | null
    estimatedCostBrl: number | null
    unpricedRequests: number
    lastUsedAt: Date | null
  }>
  integrations: {
    whatsappLastEventAt: Date | null
    automationActiveConfigs: number
    automationLastRunAt: Date | null
    aiLastUsageAt: Date | null
  }
  recentAutomations: Array<{
    id: string
    localDateIso: string
    status: string
    startedAt: Date
    completedAt: Date | null
    lastError: string | null
  }>
  recentUsage: Array<{
    id: string
    source: AiChatUsageSource
    model: string | null
    status: string
    totalTokens: number | null
    estimatedCostCents: number | null
    estimatedCostUsd: number | null
    pricingVersion: string | null
    errorMessage: string | null
    createdAt: Date
  }>
  recentErrors: Array<{
    id: string
    kind: 'AI' | 'WHATSAPP' | 'AUTOMATION'
    message: string
    createdAt: Date
  }>
}

interface AiUsageLogColumnAvailability {
  estimatedCostUsd: boolean
  estimatedCostCents: boolean
  cachedInputTokens: boolean
  pricingVersion: boolean
  errorMessage: boolean
  status: boolean
}

type PlatformOverviewAiUsageRow = {
  barbershopId: string
  totalTokens: number
  estimatedCostCents: number | null
  estimatedCostUsd: number | null
}

type PlatformDetailAiUsageRow = {
  source: AiChatUsageSource
  requests: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostCents: number | null
  estimatedCostUsd: number | null
  lastUsedAt: Date | null
}

type PlatformRecentUsageRow = {
  id: string
  source: AiChatUsageSource
  model: string | null
  status: string
  totalTokens: number | null
  estimatedCostCents: number | null
  estimatedCostUsd: number | null
  pricingVersion: string | null
  errorMessage: string | null
  createdAt: Date
}

function normalizeText(value?: string | null) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNumericValue(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function buildPlatformPricingMeta() {
  return {
    version: OPENAI_PRICING_VERSION,
    sourceUpdatedAt: OPENAI_PRICING_SOURCE_UPDATED_AT,
    pricedModels: getConfiguredOpenAIModelNames(),
    usdBrlRate: getOpenAiUsdBrlRate(),
  }
}

function getDateWindows(referenceDate = new Date()) {
  const startOfMonth = new Date(referenceDate)
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const startOfDay = new Date(referenceDate)
  startOfDay.setHours(0, 0, 0, 0)

  const sevenDaysAgo = new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000)

  return {
    startOfMonth,
    startOfDay,
    sevenDaysAgo,
  }
}

function sumNullable(values: Array<number | null | undefined>) {
  return values.reduce<number>((total, value) => total + (typeof value === 'number' ? value : 0), 0)
}

function maxDate(values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, current) => {
    if (!current) {
      return latest
    }

    if (!latest || current.getTime() > latest.getTime()) {
      return current
    }

    return latest
  }, null)
}

function normalizeSubscriptionStatus(value?: string | null): BarbershopSubscriptionStatus | null {
  if (
    value === 'TRIAL'
    || value === 'ACTIVE'
    || value === 'PAST_DUE'
    || value === 'BLOCKED'
    || value === 'CANCELED'
  ) {
    return value
  }

  return null
}

function roundUsd(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function resolveEstimatedCostUsd(input: {
  estimatedCostUsd?: Prisma.Decimal | number | null
  estimatedCostCents?: number | null
  totalTokens?: number | null
}) {
  const directUsd = normalizeNumericValue(input.estimatedCostUsd)
  if (directUsd !== null) {
    return directUsd
  }

  if (typeof input.estimatedCostCents === 'number') {
    return roundUsd(input.estimatedCostCents / 100)
  }

  return (input.totalTokens ?? 0) === 0 ? 0 : null
}

function resolveEstimatedCostCents(input: {
  estimatedCostUsd?: Prisma.Decimal | number | null
  estimatedCostCents?: number | null
  totalTokens?: number | null
}) {
  if (typeof input.estimatedCostCents === 'number') {
    return input.estimatedCostCents
  }

  const directUsd = normalizeNumericValue(input.estimatedCostUsd)
  if (directUsd !== null) {
    return Math.round(directUsd * 100)
  }

  return (input.totalTokens ?? 0) === 0 ? 0 : null
}

function buildLegacyAiUsageWarning() {
  return 'Algumas colunas novas do ledger de IA ainda nao existem neste banco. O painel segue carregando com leitura parcial; rode npm run db:push para liberar custos e diagnosticos completos.'
}

async function getAiUsageLogColumnAvailability(): Promise<AiUsageLogColumnAvailability> {
  try {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      select column_name
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'ai_chat_usage_logs'
    `

    const columns = new Set(rows.map((row) => row.column_name))

    return {
      estimatedCostUsd: columns.has('estimatedCostUsd'),
      estimatedCostCents: columns.has('estimatedCostCents'),
      cachedInputTokens: columns.has('cachedInputTokens'),
      pricingVersion: columns.has('pricingVersion'),
      errorMessage: columns.has('errorMessage'),
      status: columns.has('status'),
    }
  } catch (error) {
    console.warn('[platform-admin] usage_schema_probe_failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      estimatedCostUsd: false,
      estimatedCostCents: false,
      cachedInputTokens: false,
      pricingVersion: false,
      errorMessage: false,
      status: false,
    }
  }
}

function createEmptyPlatformOverviewData(
  filters: PlatformOverviewFilters,
  warnings: string[] = []
): PlatformOverviewData {
  return {
    pricing: buildPlatformPricingMeta(),
    warnings,
    filters: {
      search: normalizeText(filters.search),
      status: normalizeText(filters.status),
      plan: normalizeText(filters.plan),
      availablePlans: [],
    },
    cards: {
      activeBarbershops: 0,
      trialBarbershops: 0,
      pastDueBarbershops: 0,
      blockedBarbershops: 0,
      appointmentsThisMonth: 0,
      whatsappMessagesThisMonth: 0,
      aiTokensThisMonth: 0,
      aiEstimatedCostCents: 0,
      aiEstimatedCostUsd: 0,
      aiEstimatedCostBrl: convertUsdToBrl(0, getOpenAiUsdBrlRate()),
      automationsToday: 0,
      recentErrors: 0,
    },
    barbershops: [],
    recentErrors: [],
  }
}

async function recordPlatformAuditLog(input: {
  platformUserId: string
  action: string
  targetBarbershopId?: string | null
  metadataJson?: Prisma.InputJsonValue | null
}) {
  try {
    await prisma.platformAuditLog.create({
      data: {
        platformUserId: input.platformUserId,
        action: input.action,
        targetBarbershopId: input.targetBarbershopId ?? null,
        metadataJson: input.metadataJson ?? undefined,
      },
    })
  } catch (error) {
    console.warn('[platform-admin] audit_log_failed', {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function buildBarbershopWhere(filters: PlatformOverviewFilters): Prisma.BarbershopWhereInput {
  const search = normalizeText(filters.search)
  const status = normalizeSubscriptionStatus(filters.status)
  const plan = normalizeText(filters.plan)

  const where: Prisma.BarbershopWhereInput = {}

  if (search) {
    where.OR = [
      {
        name: {
          contains: search,
          mode: 'insensitive',
        },
      },
      {
        slug: {
          contains: search,
          mode: 'insensitive',
        },
      },
    ]
  }

  if (status) {
    where.subscriptionStatus = status
  }

  if (plan) {
    where.subscriptionPlan = plan
  }

  return where
}

async function loadOverviewAiUsageData(input: {
  startOfMonth: Date
  sevenDaysAgo: Date
  warnings: string[]
}) {
  const columns = await getAiUsageLogColumnAvailability()

  if (!columns.estimatedCostUsd || !columns.cachedInputTokens || !columns.pricingVersion || !columns.status) {
    input.warnings.push(buildLegacyAiUsageWarning())
  }

  try {
    const usageSum: Prisma.AiChatUsageLogSumAggregateInputType = {
      totalTokens: true,
      ...(columns.estimatedCostCents ? { estimatedCostCents: true } : {}),
      ...(columns.estimatedCostUsd ? { estimatedCostUsd: true } : {}),
    }

    const [usageGroups, unpricedGroups, aiActivity, failedAiUsage] = await Promise.all([
      prisma.aiChatUsageLog.groupBy({
        by: ['barbershopId'],
        where: {
          createdAt: {
            gte: input.startOfMonth,
          },
        },
        _sum: usageSum,
      }),
      columns.estimatedCostUsd
        ? prisma.aiChatUsageLog.groupBy({
          by: ['barbershopId'],
          where: {
            createdAt: {
              gte: input.startOfMonth,
            },
            model: {
              not: null,
            },
            totalTokens: {
              gt: 0,
            },
            estimatedCostUsd: null,
          },
          _count: {
            _all: true,
          },
        })
        : Promise.resolve([]),
      prisma.aiChatUsageLog.groupBy({
        by: ['barbershopId'],
        _max: {
          createdAt: true,
        },
      }),
      columns.status
        ? prisma.aiChatUsageLog.findMany({
          where: {
            status: 'FAILED',
            createdAt: {
              gte: input.sevenDaysAgo,
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: RECENT_ERROR_LIMIT,
          select: {
            id: true,
            ...(columns.errorMessage ? { errorMessage: true } : {}),
            createdAt: true,
            barbershop: {
              select: {
                id: true,
                name: true,
                timezone: true,
              },
            },
          },
        })
        : Promise.resolve([]),
    ])

    return {
      columns,
      usageGroups: usageGroups.map((group) => ({
        barbershopId: group.barbershopId,
        totalTokens: group._sum.totalTokens ?? 0,
        estimatedCostCents: resolveEstimatedCostCents({
          estimatedCostUsd: columns.estimatedCostUsd ? (group._sum as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (group._sum as any).estimatedCostCents ?? null : null,
          totalTokens: group._sum.totalTokens ?? 0,
        }),
        estimatedCostUsd: resolveEstimatedCostUsd({
          estimatedCostUsd: columns.estimatedCostUsd ? (group._sum as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (group._sum as any).estimatedCostCents ?? null : null,
          totalTokens: group._sum.totalTokens ?? 0,
        }),
      }) as PlatformOverviewAiUsageRow),
      unpricedGroups,
      aiActivity,
      failedAiUsage,
    }
  } catch (error) {
    console.error('[platform-admin] usage loaded failed', {
      stage: 'overview',
      error: error instanceof Error ? error.message : String(error),
    })
    input.warnings.push('Nao foi possivel carregar todas as metricas de IA desta visao. O restante do painel continua disponivel.')
    return {
      columns,
      usageGroups: [] as PlatformOverviewAiUsageRow[],
      unpricedGroups: [] as Array<{ barbershopId: string; _count: { _all: number } }>,
      aiActivity: [] as Array<{ barbershopId: string; _max: { createdAt: Date | null } }>,
      failedAiUsage: [] as Array<{
        id: string
        errorMessage?: string | null
        createdAt: Date
        barbershop: {
          id: string
          name: string
          timezone: string
        }
      }>,
    }
  }
}

async function loadDetailAiUsageData(input: {
  barbershopId: string
  startOfMonth: Date
  sevenDaysAgo: Date
  warnings: string[]
}) {
  const columns = await getAiUsageLogColumnAvailability()

  if (!columns.estimatedCostUsd || !columns.cachedInputTokens || !columns.pricingVersion || !columns.status) {
    input.warnings.push(buildLegacyAiUsageWarning())
  }

  try {
    const usageSum: Prisma.AiChatUsageLogSumAggregateInputType = {
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      ...(columns.cachedInputTokens ? { cachedInputTokens: true } : {}),
      ...(columns.estimatedCostCents ? { estimatedCostCents: true } : {}),
      ...(columns.estimatedCostUsd ? { estimatedCostUsd: true } : {}),
    }

    const [usageBySource, unpricedUsageBySource, recentUsage, aiLastUsage, failedAiUsage] = await Promise.all([
      prisma.aiChatUsageLog.groupBy({
        by: ['source'],
        where: {
          barbershopId: input.barbershopId,
          createdAt: {
            gte: input.startOfMonth,
          },
        },
        _count: {
          _all: true,
        },
        _sum: usageSum,
        _max: {
          createdAt: true,
        },
      }),
      columns.estimatedCostUsd
        ? prisma.aiChatUsageLog.groupBy({
          by: ['source'],
          where: {
            barbershopId: input.barbershopId,
            createdAt: {
              gte: input.startOfMonth,
            },
            model: {
              not: null,
            },
            totalTokens: {
              gt: 0,
            },
            estimatedCostUsd: null,
          },
          _count: {
            _all: true,
          },
        })
        : Promise.resolve([]),
      prisma.aiChatUsageLog.findMany({
        where: {
          barbershopId: input.barbershopId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: RECENT_ACTIVITY_LIMIT,
        select: {
          id: true,
          source: true,
          model: true,
          ...(columns.status ? { status: true } : {}),
          totalTokens: true,
          ...(columns.estimatedCostCents ? { estimatedCostCents: true } : {}),
          ...(columns.estimatedCostUsd ? { estimatedCostUsd: true } : {}),
          ...(columns.pricingVersion ? { pricingVersion: true } : {}),
          ...(columns.errorMessage ? { errorMessage: true } : {}),
          createdAt: true,
        },
      }),
      prisma.aiChatUsageLog.findFirst({
        where: {
          barbershopId: input.barbershopId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          createdAt: true,
        },
      }),
      columns.status
        ? prisma.aiChatUsageLog.findMany({
          where: {
            barbershopId: input.barbershopId,
            status: 'FAILED',
            createdAt: {
              gte: input.sevenDaysAgo,
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: RECENT_ERROR_LIMIT,
          select: {
            id: true,
            ...(columns.errorMessage ? { errorMessage: true } : {}),
            createdAt: true,
          },
        })
        : Promise.resolve([]),
    ])

    return {
      columns,
      usageBySource: usageBySource.map((item) => ({
        source: item.source,
        requests: item._count._all,
        inputTokens: item._sum.inputTokens ?? 0,
        cachedInputTokens: columns.cachedInputTokens ? ((item._sum as any).cachedInputTokens ?? 0) : 0,
        outputTokens: item._sum.outputTokens ?? 0,
        totalTokens: item._sum.totalTokens ?? 0,
        estimatedCostCents: resolveEstimatedCostCents({
          estimatedCostUsd: columns.estimatedCostUsd ? (item._sum as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (item._sum as any).estimatedCostCents ?? null : null,
          totalTokens: item._sum.totalTokens ?? 0,
        }),
        estimatedCostUsd: resolveEstimatedCostUsd({
          estimatedCostUsd: columns.estimatedCostUsd ? (item._sum as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (item._sum as any).estimatedCostCents ?? null : null,
          totalTokens: item._sum.totalTokens ?? 0,
        }),
        lastUsedAt: item._max.createdAt ?? null,
      }) as PlatformDetailAiUsageRow),
      unpricedUsageBySource,
      recentUsage: recentUsage.map((item) => ({
        id: item.id,
        source: item.source,
        model: item.model,
        status: columns.status ? ((item as any).status ?? 'SUCCESS') : 'SUCCESS',
        totalTokens: item.totalTokens,
        estimatedCostCents: resolveEstimatedCostCents({
          estimatedCostUsd: columns.estimatedCostUsd ? (item as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (item as any).estimatedCostCents ?? null : null,
          totalTokens: item.totalTokens ?? 0,
        }),
        estimatedCostUsd: resolveEstimatedCostUsd({
          estimatedCostUsd: columns.estimatedCostUsd ? (item as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (item as any).estimatedCostCents ?? null : null,
          totalTokens: item.totalTokens ?? 0,
        }),
        pricingVersion: columns.pricingVersion ? ((item as any).pricingVersion ?? null) : null,
        errorMessage: columns.errorMessage ? ((item as any).errorMessage ?? null) : null,
        createdAt: item.createdAt,
      }) as PlatformRecentUsageRow),
      aiLastUsage,
      failedAiUsage,
    }
  } catch (error) {
    console.error('[platform-admin] usage loaded failed', {
      stage: 'detail',
      barbershopId: input.barbershopId,
      error: error instanceof Error ? error.message : String(error),
    })
    input.warnings.push('Parte da telemetria de IA desta barbearia nao ficou disponivel nesta leitura. O restante do detalhe continua carregado.')
    return {
      columns,
      usageBySource: [] as PlatformDetailAiUsageRow[],
      unpricedUsageBySource: [] as Array<{ source: AiChatUsageSource; _count: { _all: number } }>,
      recentUsage: [] as PlatformRecentUsageRow[],
      aiLastUsage: null as { createdAt: Date } | null,
      failedAiUsage: [] as Array<{ id: string; errorMessage?: string | null; createdAt: Date }>,
    }
  }
}

export async function getPlatformOverviewData(
  session: PlatformSessionIdentity,
  filters: PlatformOverviewFilters
): Promise<PlatformOverviewData> {
  assertPlatformRoleAllowed(session.platformRole)
  console.info('[platform-admin] overview started', {
    userId: session.userId,
    filters: {
      search: normalizeText(filters.search) || null,
      status: normalizeText(filters.status) || null,
      plan: normalizeText(filters.plan) || null,
    },
  })

  try {
    const where = buildBarbershopWhere(filters)
    const { startOfMonth, startOfDay, sevenDaysAgo } = getDateWindows()
    const pricing = buildPlatformPricingMeta()
    const warnings: string[] = []

    const [
      barbershops,
      allPlans,
      appointmentGroups,
      messagingGroups,
      appointmentActivity,
      messagingActivity,
      automationActivity,
      automationToday,
      failedMessaging,
      failedAutomation,
    ] = await Promise.all([
      prisma.barbershop.findMany({
        where,
        orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          active: true,
          timezone: true,
          subscriptionPlan: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          _count: {
            select: {
              users: true,
              customers: true,
            },
          },
        },
      }),
      prisma.barbershop.findMany({
        select: {
          subscriptionPlan: true,
        },
        distinct: ['subscriptionPlan'],
        orderBy: {
          subscriptionPlan: 'asc',
        },
      }),
      prisma.appointment.groupBy({
        by: ['barbershopId'],
        where: {
          startAt: {
            gte: startOfMonth,
          },
        },
        _count: {
          _all: true,
        },
      }),
      prisma.messagingEvent.groupBy({
        by: ['barbershopId'],
        where: {
          createdAt: {
            gte: startOfMonth,
          },
        },
        _count: {
          _all: true,
        },
      }),
      prisma.appointment.groupBy({
        by: ['barbershopId'],
        _max: {
          updatedAt: true,
        },
      }),
      prisma.messagingEvent.groupBy({
        by: ['barbershopId'],
        _max: {
          createdAt: true,
        },
      }),
      prisma.campaignAutomationRun.groupBy({
        by: ['barbershopId'],
        _max: {
          startedAt: true,
        },
      }),
      prisma.campaignAutomationRun.count({
        where: {
          startedAt: {
            gte: startOfDay,
          },
        },
      }),
      prisma.messagingEvent.findMany({
        where: {
          status: 'FAILED',
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: RECENT_ERROR_LIMIT,
        select: {
          id: true,
          lastError: true,
          createdAt: true,
          barbershop: {
            select: {
              id: true,
              name: true,
              timezone: true,
            },
          },
        },
      }),
      prisma.campaignAutomationRun.findMany({
        where: {
          status: 'FAILED',
          startedAt: {
            gte: sevenDaysAgo,
          },
        },
        orderBy: {
          startedAt: 'desc',
        },
        take: RECENT_ERROR_LIMIT,
        select: {
          id: true,
          lastError: true,
          startedAt: true,
          barbershop: {
            select: {
              id: true,
              name: true,
              timezone: true,
            },
          },
        },
      }),
    ])

    console.info('[platform-admin] tenants loaded', {
      count: barbershops.length,
    })

    const {
      usageGroups,
      unpricedGroups,
      aiActivity,
      failedAiUsage,
    } = await loadOverviewAiUsageData({
      startOfMonth,
      sevenDaysAgo,
      warnings,
    })

    console.info('[platform-admin] usage loaded', {
      tenantsWithUsage: usageGroups.length,
      warnings: warnings.length,
    })

    const appointmentsByBarbershop = new Map(appointmentGroups.map((group) => [group.barbershopId, group._count._all]))
    const messagesByBarbershop = new Map(messagingGroups.map((group) => [group.barbershopId, group._count._all]))
    const aiUsageByBarbershop = new Map(usageGroups.map((group) => [group.barbershopId, group]))
    const unpricedAiUsageByBarbershop = new Map(
      unpricedGroups.map((group) => [group.barbershopId, group._count._all])
    )
    const appointmentActivityByBarbershop = new Map(appointmentActivity.map((item) => [item.barbershopId, item._max.updatedAt ?? null]))
    const messagingActivityByBarbershop = new Map(messagingActivity.map((item) => [item.barbershopId, item._max.createdAt ?? null]))
    const aiActivityByBarbershop = new Map(aiActivity.map((item) => [item.barbershopId, item._max.createdAt ?? null]))
    const automationActivityByBarbershop = new Map(automationActivity.map((item) => [item.barbershopId, item._max.startedAt ?? null]))

    const rows = barbershops.map((barbershop) => {
      const timezone = resolveBusinessTimezone(barbershop.timezone)
      const lastActivityAt = maxDate([
        appointmentActivityByBarbershop.get(barbershop.id),
        messagingActivityByBarbershop.get(barbershop.id),
        aiActivityByBarbershop.get(barbershop.id),
        automationActivityByBarbershop.get(barbershop.id),
      ])
      const aiUsage = aiUsageByBarbershop.get(barbershop.id)
      const aiTokensThisMonth = aiUsage?.totalTokens ?? 0
      const aiEstimatedCostCents = aiUsage?.estimatedCostCents ?? 0
      const aiEstimatedCostUsd = aiUsage?.estimatedCostUsd ?? 0

      return {
        id: barbershop.id,
        name: barbershop.name,
        slug: barbershop.slug,
        operationalActive: barbershop.active,
        subscriptionPlan: barbershop.subscriptionPlan,
        subscriptionStatus: barbershop.subscriptionStatus,
        usersCount: barbershop._count.users,
        customersCount: barbershop._count.customers,
        appointmentsThisMonth: appointmentsByBarbershop.get(barbershop.id) ?? 0,
        whatsappMessagesThisMonth: messagesByBarbershop.get(barbershop.id) ?? 0,
        aiTokensThisMonth,
        aiEstimatedCostCents,
        aiEstimatedCostUsd,
        aiEstimatedCostBrl: convertUsdToBrl(aiEstimatedCostUsd, pricing.usdBrlRate),
        aiUnpricedRequests: unpricedAiUsageByBarbershop.get(barbershop.id) ?? 0,
        lastActivityAt,
        lastActivityLabel: lastActivityAt ? formatDateTimeInTimezone(lastActivityAt, timezone) : null,
      }
    })

    const recentErrors = [
      ...failedAiUsage.map((item) => ({
        id: `ai:${item.id}`,
        kind: 'AI' as const,
        barbershopId: item.barbershop.id,
        barbershopName: item.barbershop.name,
        message: item.errorMessage ?? 'Falha de IA sem mensagem detalhada.',
        createdAt: item.createdAt,
        createdAtLabel: formatDateTimeInTimezone(item.createdAt, item.barbershop.timezone),
      })),
      ...failedMessaging.map((item) => ({
        id: `msg:${item.id}`,
        kind: 'WHATSAPP' as const,
        barbershopId: item.barbershop.id,
        barbershopName: item.barbershop.name,
        message: item.lastError ?? 'Falha de mensagem sem detalhe adicional.',
        createdAt: item.createdAt,
        createdAtLabel: formatDateTimeInTimezone(item.createdAt, item.barbershop.timezone),
      })),
      ...failedAutomation.map((item) => ({
        id: `automation:${item.id}`,
        kind: 'AUTOMATION' as const,
        barbershopId: item.barbershop.id,
        barbershopName: item.barbershop.name,
        message: item.lastError ?? 'Execucao automatica falhou sem detalhe adicional.',
        createdAt: item.startedAt,
        createdAtLabel: formatDateTimeInTimezone(item.startedAt, item.barbershop.timezone),
      })),
    ]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, RECENT_ERROR_LIMIT)

    console.info('[platform-admin] costs computed', {
      tokens: rows.reduce((sum, item) => sum + item.aiTokensThisMonth, 0),
      estimatedCostUsd: rows.reduce((sum, item) => sum + item.aiEstimatedCostUsd, 0),
    })

    await recordPlatformAuditLog({
      platformUserId: session.userId,
      action: 'platform.overview.view',
      metadataJson: {
        filters: {
          search: normalizeText(filters.search) || null,
          status: normalizeText(filters.status) || null,
          plan: normalizeText(filters.plan) || null,
        },
        visibleBarbershops: rows.length,
      },
    })

    return {
      pricing,
      warnings: Array.from(new Set(warnings)),
      filters: {
        search: normalizeText(filters.search),
        status: normalizeText(filters.status),
        plan: normalizeText(filters.plan),
        availablePlans: allPlans
          .map((item) => item.subscriptionPlan)
          .filter((value): value is string => Boolean(value)),
      },
      cards: {
        activeBarbershops: rows.filter((item) => item.subscriptionStatus === 'ACTIVE' && item.operationalActive).length,
        trialBarbershops: rows.filter((item) => item.subscriptionStatus === 'TRIAL').length,
        pastDueBarbershops: rows.filter((item) => item.subscriptionStatus === 'PAST_DUE').length,
        blockedBarbershops: rows.filter((item) => item.subscriptionStatus === 'BLOCKED').length,
        appointmentsThisMonth: rows.reduce((sum, item) => sum + item.appointmentsThisMonth, 0),
        whatsappMessagesThisMonth: rows.reduce((sum, item) => sum + item.whatsappMessagesThisMonth, 0),
        aiTokensThisMonth: rows.reduce((sum, item) => sum + item.aiTokensThisMonth, 0),
        aiEstimatedCostCents: sumNullable(rows.map((item) => item.aiEstimatedCostCents)),
        aiEstimatedCostUsd: sumNullable(rows.map((item) => item.aiEstimatedCostUsd)),
        aiEstimatedCostBrl: sumNullable(rows.map((item) => item.aiEstimatedCostBrl)),
        automationsToday: automationToday,
        recentErrors: recentErrors.length,
      },
      barbershops: rows,
      recentErrors,
    }
  } catch (error) {
    console.error('[platform-admin] overview failed', {
      userId: session.userId,
      error: error instanceof Error ? error.message : String(error),
    })

    return createEmptyPlatformOverviewData(filters, [
      'Nao foi possivel carregar a visao completa da plataforma agora. Verifique o schema do banco e tente novamente em instantes.',
    ])
  }
}

export async function getPlatformBarbershopDetailData(
  session: PlatformSessionIdentity,
  barbershopId: string
): Promise<PlatformBarbershopDetailData> {
  assertPlatformRoleAllowed(session.platformRole)

  const { startOfMonth, sevenDaysAgo } = getDateWindows()
  const pricing = buildPlatformPricingMeta()
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      active: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      billingEmail: true,
      blockedAt: true,
      blockedReason: true,
      createdAt: true,
      _count: {
        select: {
          users: true,
          professionals: true,
          customers: true,
        },
      },
    },
  })

  if (!barbershop) {
    throw new Error('Barbearia nao encontrada para a operacao interna.')
  }

  const timezone = resolveBusinessTimezone(barbershop.timezone)
  const warnings: string[] = []

  const [
    users,
    appointmentsThisMonth,
    whatsappMessagesThisMonth,
    recentAutomations,
    automationsThisMonthCount,
    automationActiveConfigs,
    messagingLastEvent,
    automationLastRun,
    failedMessaging,
    failedAutomation,
  ] = await Promise.all([
    prisma.user.findMany({
      where: {
        barbershopId,
      },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        platformRole: true,
        active: true,
        createdAt: true,
      },
    }),
    prisma.appointment.count({
      where: {
        barbershopId,
        startAt: {
          gte: startOfMonth,
        },
      },
    }),
    prisma.messagingEvent.count({
      where: {
        barbershopId,
        createdAt: {
          gte: startOfMonth,
        },
      },
    }),
    prisma.campaignAutomationRun.findMany({
      where: {
        barbershopId,
      },
      orderBy: {
        startedAt: 'desc',
      },
      take: RECENT_ACTIVITY_LIMIT,
      select: {
        id: true,
        localDateIso: true,
        status: true,
        startedAt: true,
        completedAt: true,
        lastError: true,
      },
    }),
    prisma.campaignAutomationRun.count({
      where: {
        barbershopId,
        startedAt: {
          gte: startOfMonth,
        },
      },
    }),
    prisma.campaignAutomationConfig.count({
      where: {
        barbershopId,
        active: true,
      },
    }),
    prisma.messagingEvent.findFirst({
      where: {
        barbershopId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        createdAt: true,
      },
    }),
    prisma.campaignAutomationRun.findFirst({
      where: {
        barbershopId,
      },
      orderBy: {
        startedAt: 'desc',
      },
      select: {
        startedAt: true,
      },
    }),
    prisma.messagingEvent.findMany({
      where: {
        barbershopId,
        status: 'FAILED',
        createdAt: {
          gte: sevenDaysAgo,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: RECENT_ERROR_LIMIT,
      select: {
        id: true,
        lastError: true,
        createdAt: true,
      },
    }),
    prisma.campaignAutomationRun.findMany({
      where: {
        barbershopId,
        status: 'FAILED',
        startedAt: {
          gte: sevenDaysAgo,
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
      take: RECENT_ERROR_LIMIT,
      select: {
        id: true,
        lastError: true,
        startedAt: true,
      },
    }),
  ])

  const {
    usageBySource,
    unpricedUsageBySource,
    recentUsage,
    aiLastUsage,
    failedAiUsage,
  } = await loadDetailAiUsageData({
    barbershopId,
    startOfMonth,
    sevenDaysAgo,
    warnings,
  })

  const aiTotals = usageBySource.reduce(
    (accumulator, item) => ({
      totalTokens: accumulator.totalTokens + item.totalTokens,
      estimatedCostCents: accumulator.estimatedCostCents + (item.estimatedCostCents ?? 0),
      estimatedCostUsd: accumulator.estimatedCostUsd + (item.estimatedCostUsd ?? 0),
    }),
    {
      totalTokens: 0,
      estimatedCostCents: 0,
      estimatedCostUsd: 0,
    }
  )
  const hasEstimatedAiCost = usageBySource.some((item) => item.estimatedCostUsd !== null)
  const unpricedAiUsageBySourceMap = new Map(
    unpricedUsageBySource.map((item) => [item.source, item._count._all])
  )

  const recentErrors = [
    ...failedAiUsage.map((item) => ({
      id: `ai:${item.id}`,
      kind: 'AI' as const,
      message: item.errorMessage ?? 'Falha de IA sem detalhe adicional.',
      createdAt: item.createdAt,
    })),
    ...failedMessaging.map((item) => ({
      id: `msg:${item.id}`,
      kind: 'WHATSAPP' as const,
      message: item.lastError ?? 'Falha de WhatsApp sem detalhe adicional.',
      createdAt: item.createdAt,
    })),
    ...failedAutomation.map((item) => ({
      id: `automation:${item.id}`,
      kind: 'AUTOMATION' as const,
      message: item.lastError ?? 'Falha de automacao sem detalhe adicional.',
      createdAt: item.startedAt,
    })),
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, RECENT_ERROR_LIMIT)

  await recordPlatformAuditLog({
    platformUserId: session.userId,
    action: 'platform.barbershop.view',
    targetBarbershopId: barbershopId,
    metadataJson: {
      slug: barbershop.slug,
    },
  })

  return {
    pricing,
    warnings: Array.from(new Set(warnings)),
    barbershop: {
      id: barbershop.id,
      name: barbershop.name,
      slug: barbershop.slug,
      timezone,
      operationalActive: barbershop.active,
      subscriptionPlan: barbershop.subscriptionPlan,
      subscriptionStatus: barbershop.subscriptionStatus,
      trialEndsAt: barbershop.trialEndsAt,
      billingEmail: barbershop.billingEmail,
      blockedAt: barbershop.blockedAt,
      blockedReason: barbershop.blockedReason,
      createdAt: barbershop.createdAt,
      createdAtLabel: formatDateTimeInTimezone(barbershop.createdAt, timezone),
    },
    totals: {
      users: barbershop._count.users,
      professionals: barbershop._count.professionals,
      customers: barbershop._count.customers,
      appointmentsThisMonth,
      whatsappMessagesThisMonth,
      aiTokensThisMonth: aiTotals.totalTokens,
      aiEstimatedCostCents: hasEstimatedAiCost ? aiTotals.estimatedCostCents : (aiTotals.totalTokens === 0 ? 0 : null),
      aiEstimatedCostUsd: hasEstimatedAiCost ? aiTotals.estimatedCostUsd : (aiTotals.totalTokens === 0 ? 0 : null),
      aiEstimatedCostBrl: hasEstimatedAiCost
        ? convertUsdToBrl(aiTotals.estimatedCostUsd, pricing.usdBrlRate)
        : aiTotals.totalTokens === 0
          ? convertUsdToBrl(0, pricing.usdBrlRate)
          : null,
      automationsThisMonth: automationsThisMonthCount,
    },
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      platformRole: user.platformRole,
      active: user.active,
      createdAt: user.createdAt,
    })),
    aiUsageBySource: usageBySource.map((item) => ({
      source: item.source,
      requests: item.requests,
      inputTokens: item.inputTokens,
      cachedInputTokens: item.cachedInputTokens,
      outputTokens: item.outputTokens,
      totalTokens: item.totalTokens,
      estimatedCostCents: item.estimatedCostCents,
      estimatedCostUsd: item.estimatedCostUsd,
      estimatedCostBrl: convertUsdToBrl(item.estimatedCostUsd, pricing.usdBrlRate),
      unpricedRequests: unpricedAiUsageBySourceMap.get(item.source) ?? 0,
      lastUsedAt: item.lastUsedAt,
    })),
    integrations: {
      whatsappLastEventAt: messagingLastEvent?.createdAt ?? null,
      automationActiveConfigs,
      automationLastRunAt: automationLastRun?.startedAt ?? null,
      aiLastUsageAt: aiLastUsage?.createdAt ?? null,
    },
    recentAutomations,
    recentUsage,
    recentErrors,
  }
}
