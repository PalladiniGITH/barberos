import 'server-only'

import type { AiChatUsageSource, BarbershopSubscriptionStatus, Prisma } from '@prisma/client'
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
  filters: {
    search: string
    status: string
    plan: string
    availablePlans: string[]
  }
  cards: {
    activeBarbershops: number
    trialBarbershops: number
    appointmentsThisMonth: number
    whatsappMessagesThisMonth: number
    aiTokensThisMonth: number
    aiEstimatedCostCents: number | null
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
    outputTokens: number
    totalTokens: number
    estimatedCostCents: number | null
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

function normalizeText(value?: string | null) {
  return typeof value === 'string' ? value.trim() : ''
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

export async function getPlatformOverviewData(
  session: PlatformSessionIdentity,
  filters: PlatformOverviewFilters
): Promise<PlatformOverviewData> {
  assertPlatformRoleAllowed(session.platformRole)

  const where = buildBarbershopWhere(filters)
  const { startOfMonth, startOfDay, sevenDaysAgo } = getDateWindows()

  const [
    barbershops,
    allPlans,
    appointmentGroups,
    messagingGroups,
    aiUsageGroups,
    appointmentActivity,
    messagingActivity,
    aiActivity,
    automationActivity,
    automationToday,
    failedAiUsage,
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
    prisma.aiChatUsageLog.groupBy({
      by: ['barbershopId'],
      where: {
        createdAt: {
          gte: startOfMonth,
        },
      },
      _sum: {
        totalTokens: true,
        estimatedCostCents: true,
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
    prisma.aiChatUsageLog.groupBy({
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
    prisma.aiChatUsageLog.findMany({
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
        errorMessage: true,
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

  const appointmentsByBarbershop = new Map(appointmentGroups.map((group) => [group.barbershopId, group._count._all]))
  const messagesByBarbershop = new Map(messagingGroups.map((group) => [group.barbershopId, group._count._all]))
  const aiUsageByBarbershop = new Map(aiUsageGroups.map((group) => [
    group.barbershopId,
    {
      totalTokens: group._sum.totalTokens ?? 0,
      estimatedCostCents: group._sum.estimatedCostCents ?? null,
    },
  ]))
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
      aiTokensThisMonth: aiUsage?.totalTokens ?? 0,
      aiEstimatedCostCents: aiUsage?.estimatedCostCents ?? null,
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
      appointmentsThisMonth: rows.reduce((sum, item) => sum + item.appointmentsThisMonth, 0),
      whatsappMessagesThisMonth: rows.reduce((sum, item) => sum + item.whatsappMessagesThisMonth, 0),
      aiTokensThisMonth: rows.reduce((sum, item) => sum + item.aiTokensThisMonth, 0),
      aiEstimatedCostCents: (() => {
        const values = rows.map((item) => item.aiEstimatedCostCents).filter((value): value is number => typeof value === 'number')
        return values.length > 0 ? sumNullable(values) : null
      })(),
      automationsToday: automationToday,
      recentErrors: recentErrors.length,
    },
    barbershops: rows,
    recentErrors,
  }
}

export async function getPlatformBarbershopDetailData(
  session: PlatformSessionIdentity,
  barbershopId: string
): Promise<PlatformBarbershopDetailData> {
  assertPlatformRoleAllowed(session.platformRole)

  const { startOfMonth, sevenDaysAgo } = getDateWindows()
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

  const [
    users,
    appointmentsThisMonth,
    whatsappMessagesThisMonth,
    aiUsageBySource,
    recentUsage,
    recentAutomations,
    automationsThisMonthCount,
    automationActiveConfigs,
    messagingLastEvent,
    automationLastRun,
    aiLastUsage,
    failedAiUsage,
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
    prisma.aiChatUsageLog.groupBy({
      by: ['source'],
      where: {
        barbershopId,
        createdAt: {
          gte: startOfMonth,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCostCents: true,
      },
      _max: {
        createdAt: true,
      },
    }),
    prisma.aiChatUsageLog.findMany({
      where: {
        barbershopId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: RECENT_ACTIVITY_LIMIT,
      select: {
        id: true,
        source: true,
        model: true,
        status: true,
        totalTokens: true,
        errorMessage: true,
        createdAt: true,
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
    prisma.aiChatUsageLog.findFirst({
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
    prisma.aiChatUsageLog.findMany({
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
        errorMessage: true,
        createdAt: true,
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

  const aiTotals = aiUsageBySource.reduce(
    (accumulator, item) => ({
      totalTokens: accumulator.totalTokens + (item._sum.totalTokens ?? 0),
      estimatedCostCents: accumulator.estimatedCostCents + (item._sum.estimatedCostCents ?? 0),
    }),
    {
      totalTokens: 0,
      estimatedCostCents: 0,
    }
  )
  const hasEstimatedAiCost = aiUsageBySource.some((item) => typeof item._sum.estimatedCostCents === 'number')

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
      aiEstimatedCostCents: hasEstimatedAiCost ? aiTotals.estimatedCostCents : null,
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
    aiUsageBySource: aiUsageBySource.map((item) => ({
      source: item.source,
      requests: item._count._all,
      inputTokens: item._sum.inputTokens ?? 0,
      outputTokens: item._sum.outputTokens ?? 0,
      totalTokens: item._sum.totalTokens ?? 0,
      estimatedCostCents: item._sum.estimatedCostCents ?? null,
      lastUsedAt: item._max.createdAt ?? null,
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
