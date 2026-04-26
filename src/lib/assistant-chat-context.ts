import 'server-only'

import type { AppRole } from '@/lib/auth-routes'
import { normalizeAppRole } from '@/lib/auth-routes'
import { AuthorizationError } from '@/lib/auth'
import { getBarberDashboardData } from '@/lib/barber-dashboard'
import { buildBarbershopHealthSnapshot } from '@/lib/barbershop-health'
import { getBusinessAnalystReport } from '@/lib/business-analyst'
import { getCampaignAutomationManagementData } from '@/lib/campaign-automation'
import { prisma } from '@/lib/prisma'
import { findSessionProfessional } from '@/lib/professionals/session-professional'
import { getAssistantBaseUiConfig } from '@/lib/assistant-screen-context'
import {
  formatDateInTimezone,
  formatTimeInTimezone,
  getCurrentDateTimeInTimezone,
  resolveBusinessTimezone,
} from '@/lib/timezone'
import { formatCurrency, formatPeriodLabel } from '@/lib/utils'
import type { AssistantChatScope } from '@/lib/ai/assistant-chat-types'

const MANAGEMENT_SUGGESTIONS = [
  'Como posso faturar mais essa semana?',
  'Quais clientes devo reativar?',
  'Qual serviço tem melhor margem?',
  'Como está minha taxa de retorno?',
] as const

const FINANCIAL_SUGGESTIONS = [
  'Como está minha margem este mês?',
  'Onde minhas despesas estão pesando mais?',
  'Qual serviço sustenta melhor o lucro?',
  'Qual tendência financeira eu preciso acompanhar?',
] as const

const PROFESSIONAL_SUGGESTIONS = [
  'Como bato minha meta?',
  'O que vender nos próximos atendimentos?',
  'Como está minha agenda amanhã?',
  'Quantos atendimentos faltam para minha meta?',
] as const

const WEEKDAY_LABELS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

export interface AssistantScopeResolution {
  appRole: AppRole
  roleScope: AssistantChatScope
  professionalId: string | null
  professionalName: string | null
  scopeLabel: string
}

export interface AssistantContextEnvelope {
  scope: AssistantScopeResolution
  suggestions: string[]
  placeholder: string
  description: string
  dataWindowLabel: string
  dataFreshnessLabel: string
  compactContext: Record<string, unknown>
  fallbackAnswer: string
}

interface AssistantSessionIdentity {
  role: string | null | undefined
  barbershopId: string
  name?: string | null
  email?: string | null
}

function getRoleUiConfig(scope: AssistantChatScope) {
  return getAssistantBaseUiConfig(scope)

  if (scope === 'PROFESSIONAL') {
    return {
      suggestions: [...PROFESSIONAL_SUGGESTIONS],
      placeholder: 'Pergunte sobre sua meta, agenda, vendas ou próximos atendimentos.',
      description: 'Respostas individuais com foco no seu desempenho, agenda e oportunidades de venda.',
    }
  }

  if (scope === 'FINANCIAL') {
    return {
      suggestions: [...FINANCIAL_SUGGESTIONS],
      placeholder: 'Pergunte sobre margem, despesas, tendência e leitura financeira da barbearia.',
      description: 'Leitura global com foco financeiro, margem, caixa e sinais do período.',
    }
  }

  return {
    suggestions: [...MANAGEMENT_SUGGESTIONS],
    placeholder: 'Pergunte sobre faturamento, clientes, equipe, margem, campanhas e oportunidades.',
    description: 'Leitura da operacao com foco em decisoes praticas para a barbearia.',
  }
}

function buildQuestionThreadTitle(question: string) {
  const normalized = question.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 72) {
    return normalized
  }

  return `${normalized.slice(0, 69).trimEnd()}...`
}

function buildWeekdayPerformanceSummary(input: Array<{ startAt: Date; priceSnapshot: unknown }>) {
  const buckets = WEEKDAY_LABELS.map((label) => ({
    label,
    appointments: 0,
    revenue: 0,
  }))

  input.forEach((appointment) => {
    const weekdayIndex = appointment.startAt.getDay()
    buckets[weekdayIndex].appointments += 1
    buckets[weekdayIndex].revenue += Number(appointment.priceSnapshot ?? 0)
  })

  const sorted = buckets
    .slice()
    .sort((left, right) => (left.revenue - right.revenue) || (left.appointments - right.appointments))

  return {
    weakest: sorted[0],
    strongest: sorted[sorted.length - 1],
    byWeekday: buckets,
  }
}

function buildProductPerformance(entries: Array<{ description: string | null; amount: unknown }>) {
  const grouped = new Map<string, { name: string; revenue: number; sales: number }>()

  entries.forEach((entry) => {
    const name = entry.description?.trim() || 'Produto sem nome'
    const current = grouped.get(name) ?? { name, revenue: 0, sales: 0 }
    current.revenue += Number(entry.amount ?? 0)
    current.sales += 1
    grouped.set(name, current)
  })

  const ranked = Array.from(grouped.values()).sort((left, right) => right.revenue - left.revenue)

  return {
    topProducts: ranked.slice(0, 5),
    lowProducts: ranked.slice(-3).reverse(),
  }
}

function buildManagementFallbackAnswer(input: {
  periodLabel: string
  revenue: number
  profit: number
  ticketAverage: number
  topMarginService: { name: string; marginPercent: number } | null
  topProfessional: { name: string; revenue: number } | null
  atRiskCustomers: Array<{ name: string }>
  healthSummary: string
}) {
  const parts = [
    `Resumo rápido de ${input.periodLabel}: faturamento de ${formatCurrency(input.revenue)}, lucro estimado de ${formatCurrency(input.profit)} e ticket médio de ${formatCurrency(input.ticketAverage)}.`,
  ]

  if (input.topProfessional) {
    parts.push(`Hoje o melhor desempenho do período é de ${input.topProfessional.name}, com ${formatCurrency(input.topProfessional.revenue)} em receita.`)
  }

  if (input.topMarginService) {
    parts.push(`O serviço com melhor margem entre os destaques é ${input.topMarginService.name}, com ${input.topMarginService.marginPercent.toFixed(0)}% de margem estimada.`)
  }

  if (input.atRiskCustomers.length > 0) {
    parts.push(`Clientes que pedem reativação agora: ${input.atRiskCustomers.map((customer) => customer.name).join(', ')}.`)
  }

  parts.push(input.healthSummary)

  return parts.join(' ')
}

function buildProfessionalFallbackAnswer(input: {
  professionalName: string
  periodLabel: string
  monthRevenue: number
  goalValue: number
  goalGap: number
  scheduledTodayCount: number
  estimatedCommission: number
}) {
  const progressCopy = input.goalValue > 0
    ? input.goalGap > 0
      ? `Ainda faltam ${formatCurrency(input.goalGap)} para bater sua meta.`
      : 'Sua meta do período já foi batida.'
    : 'Sua meta individual ainda não está configurada.'

  return [
    `${input.professionalName}, aqui vai um resumo do seu período em ${input.periodLabel}.`,
    `Você gerou ${formatCurrency(input.monthRevenue)} até agora e sua comissão estimada está em ${formatCurrency(input.estimatedCommission)}.`,
    progressCopy,
    `Hoje você ainda tem ${input.scheduledTodayCount} atendimento${input.scheduledTodayCount === 1 ? '' : 's'} programado${input.scheduledTodayCount === 1 ? '' : 's'}.`,
  ].join(' ')
}

export function buildAiAssistantThreadTitle(question: string) {
  return buildQuestionThreadTitle(question)
}

export async function resolveAssistantScopeForSession(session: AssistantSessionIdentity): Promise<AssistantScopeResolution> {
  const appRole = normalizeAppRole(session.role)

  if (!appRole) {
    throw new AuthorizationError('Sem permissao para usar o assistente interno.')
  }

  if (appRole === 'BARBER') {
    const professional = await findSessionProfessional({
      barbershopId: session.barbershopId,
      email: session.email,
      name: session.name,
    })

    if (!professional) {
      throw new AuthorizationError(
        'Seu usuário ainda não está vinculado a um barbeiro ativo. Conecte o login ao cadastro profissional antes de usar o assistente.'
      )
    }

    return {
      appRole,
      roleScope: 'PROFESSIONAL',
      professionalId: professional.id,
      professionalName: professional.name,
      scopeLabel: 'Escopo individual do barbeiro',
    }
  }

  if (appRole === 'FINANCIAL') {
    return {
      appRole,
      roleScope: 'FINANCIAL',
      professionalId: null,
      professionalName: null,
      scopeLabel: 'Financeiro da barbearia',
    }
  }

  return {
    appRole,
    roleScope: 'MANAGEMENT',
    professionalId: null,
    professionalName: null,
    scopeLabel: 'Gestao da barbearia',
  }
}

export async function buildAiAssistantContext(input: AssistantSessionIdentity): Promise<AssistantContextEnvelope> {
  const scope = await resolveAssistantScopeForSession(input)
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: input.barbershopId },
    select: {
      name: true,
      timezone: true,
    },
  })

  const timezone = resolveBusinessTimezone(barbershop?.timezone)
  const localNow = getCurrentDateTimeInTimezone(timezone)
  const uiConfig = getRoleUiConfig(scope.roleScope)
  const dataWindowLabel = `Dados considerados até ${formatTimeInTimezone(new Date(), timezone)} em ${formatDateInTimezone(new Date(), timezone)}.`

  if (scope.roleScope === 'PROFESSIONAL') {
    const dashboardData = await getBarberDashboardData({
      barbershopId: input.barbershopId,
      professionalId: scope.professionalId!,
      month: localNow.month,
      year: localNow.year,
    })

    if (!dashboardData) {
      throw new AuthorizationError('Não foi possível montar o contexto individual do barbeiro agora.')
    }

    const [upcomingAppointments, recentProductRevenues, recentAppointments] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          barbershopId: input.barbershopId,
          professionalId: scope.professionalId!,
          startAt: { gte: new Date() },
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        orderBy: { startAt: 'asc' },
        take: 8,
        select: {
          id: true,
          startAt: true,
          customer: { select: { name: true } },
          service: { select: { name: true } },
        },
      }),
      prisma.revenue.findMany({
        where: {
          barbershopId: input.barbershopId,
          professionalId: scope.professionalId!,
          origin: 'PRODUCT',
          date: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { date: 'desc' },
        take: 40,
        select: {
          description: true,
          amount: true,
        },
      }),
      prisma.appointment.findMany({
        where: {
          barbershopId: input.barbershopId,
          professionalId: scope.professionalId!,
          status: 'COMPLETED',
          startAt: { gte: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { startAt: 'desc' },
        take: 120,
        select: {
          startAt: true,
          customerId: true,
          priceSnapshot: true,
          service: { select: { name: true } },
          customer: { select: { name: true } },
        },
      }),
    ])

    const customerLastVisit = new Map<string, { name: string; lastVisitAt: Date; visits: number }>()
    const servicePerformance = new Map<string, { name: string; revenue: number; appointments: number }>()

    recentAppointments.forEach((appointment) => {
      const currentCustomer = customerLastVisit.get(appointment.customerId)
      if (!currentCustomer) {
        customerLastVisit.set(appointment.customerId, {
          name: appointment.customer.name,
          lastVisitAt: appointment.startAt,
          visits: 1,
        })
      } else {
        currentCustomer.visits += 1
      }

      const currentService = servicePerformance.get(appointment.service.name) ?? {
        name: appointment.service.name,
        revenue: 0,
        appointments: 0,
      }
      currentService.revenue += Number(appointment.priceSnapshot ?? 0)
      currentService.appointments += 1
      servicePerformance.set(appointment.service.name, currentService)
    })

    const inactiveCustomers = Array.from(customerLastVisit.values())
      .filter((customer) => customer.lastVisitAt.getTime() <= Date.now() - 30 * 24 * 60 * 60 * 1000)
      .slice(0, 5)
      .map((customer) => ({
        name: customer.name,
        lastVisitAt: formatDateInTimezone(customer.lastVisitAt, timezone),
        visits: customer.visits,
      }))

    const productPerformance = buildProductPerformance(recentProductRevenues)
    const topServices = Array.from(servicePerformance.values())
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 5)

    const goalGap = Math.max(0, dashboardData.goalValue - dashboardData.monthRevenue)
    const daysLeft = Math.max(1, new Date(localNow.year, localNow.month, 0).getDate() - localNow.day + 1)
    const requiredDailyRevenue = goalGap > 0 ? goalGap / daysLeft : 0

    return {
      scope,
      suggestions: uiConfig.suggestions,
      placeholder: uiConfig.placeholder,
      description: uiConfig.description,
      dataWindowLabel,
      dataFreshnessLabel: `Base individual atualizada em ${dashboardData.periodLabel}.`,
      compactContext: {
        assistantScope: scope.roleScope,
        barbershopName: barbershop?.name ?? 'Barbearia',
        period: {
          month: localNow.month,
          year: localNow.year,
          label: dashboardData.periodLabel,
          todayLabel: dashboardData.todayLabel,
        },
        professional: {
          id: dashboardData.professionalId,
          name: dashboardData.professionalName,
          attendanceScopeLabel: dashboardData.attendanceScopeLabel,
          monthRevenue: dashboardData.monthRevenue,
          averageTicket: dashboardData.averageTicket,
          estimatedCommission: dashboardData.estimatedCommission,
          actualCommission: dashboardData.actualCommission,
          goalValue: dashboardData.goalValue,
          goalProgress: dashboardData.goalProgress,
          goalGap,
          requiredDailyRevenue,
          scheduledTodayCount: dashboardData.scheduledTodayCount,
          completedTodayCount: dashboardData.completedTodayCount,
          productRevenue: dashboardData.productRevenue,
          productSalesCount: dashboardData.productSalesCount,
          commissionRatePercent: dashboardData.commissionRatePercent,
        },
        activeChallenge: dashboardData.activeChallenge,
        upcomingAgenda: upcomingAppointments.map((appointment) => ({
          timeLabel: formatTimeInTimezone(appointment.startAt, timezone),
          dateLabel: formatDateInTimezone(appointment.startAt, timezone),
          customerName: appointment.customer.name,
          serviceName: appointment.service.name,
        })),
        topServices,
        productPerformance,
        inactiveCustomers,
        limitations: [
          'Use apenas os dados individuais do barbeiro.',
          'Não responder com números globais da barbearia nem ranking completo da equipe.',
        ],
      },
      fallbackAnswer: buildProfessionalFallbackAnswer({
        professionalName: dashboardData.professionalName,
        periodLabel: dashboardData.periodLabel,
        monthRevenue: dashboardData.monthRevenue,
        goalValue: dashboardData.goalValue,
        goalGap,
        scheduledTodayCount: dashboardData.scheduledTodayCount,
        estimatedCommission: dashboardData.estimatedCommission,
      }),
    }
  }

  const [report, weekdayAppointments, productRevenues] = await Promise.all([
    getBusinessAnalystReport({
      barbershopId: input.barbershopId,
      month: localNow.month,
      year: localNow.year,
      viewerRole: scope.appRole,
    }),
    prisma.appointment.findMany({
      where: {
        barbershopId: input.barbershopId,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        startAt: { gte: new Date(Date.now() - 56 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { startAt: 'desc' },
      take: 240,
      select: {
        startAt: true,
        priceSnapshot: true,
      },
    }),
    prisma.revenue.findMany({
      where: {
        barbershopId: input.barbershopId,
        origin: 'PRODUCT',
        date: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { date: 'desc' },
      take: 60,
      select: {
        description: true,
        amount: true,
      },
    }),
  ])

  const health = buildBarbershopHealthSnapshot(report.context.customers)
  const weekdayPerformance = buildWeekdayPerformanceSummary(weekdayAppointments)
  const productPerformance = buildProductPerformance(productRevenues)
  const topMarginServices = report.context.services
    .slice()
    .sort((left, right) => right.marginPercent - left.marginPercent)
    .slice(0, 5)
    .map((service) => ({
      name: service.name,
      marginPercent: Number(service.marginPercent.toFixed(1)),
      revenue: service.revenue,
    }))
  const topRevenueServices = report.context.services
    .slice()
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 5)
    .map((service) => ({
      name: service.name,
      revenue: service.revenue,
      appointments: service.appointments,
    }))
  const topProfessionals = report.context.professionals
    .slice()
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, scope.roleScope === 'FINANCIAL' ? 0 : 5)
    .map((professional) => ({
      name: professional.name,
      revenue: professional.revenue,
      progress: professional.progress,
      ticketAverage: professional.ticketAverage,
    }))

  const customerRiskHighlights = scope.roleScope === 'FINANCIAL'
    ? []
    : report.context.customers.rankings.atRiskSubscribers.slice(0, 5).map((customer) => ({
        name: customer.name,
        riskLabel: customer.riskLabel,
        visits: customer.visits,
        lastVisitAt: customer.lastVisitAt,
      }))

  const campaignData = scope.roleScope === 'MANAGEMENT'
    ? await getCampaignAutomationManagementData({
        barbershopId: input.barbershopId,
      })
    : null

  return {
    scope,
    suggestions: uiConfig.suggestions,
    placeholder: uiConfig.placeholder,
    description: uiConfig.description,
    dataWindowLabel,
    dataFreshnessLabel: report.runtime.updatedAtLabel ?? `Base de ${formatPeriodLabel(localNow.month, localNow.year)} pronta para leitura.`,
    compactContext: {
      assistantScope: scope.roleScope,
      barbershopName: barbershop?.name ?? 'Barbearia',
      period: {
        month: localNow.month,
        year: localNow.year,
        label: report.context.period.label,
        comparisonLabel: report.context.period.comparisonLabel,
      },
      summary: report.summary,
      financial: {
        revenue: report.context.financial.totalRevenue,
        expense: report.context.financial.totalExpense,
        profit: report.context.financial.profit,
        profitMargin: report.context.financial.profitMargin,
        ticketAverage: report.context.financial.ticketAverage,
        totalAppointments: report.context.financial.totalAppointments,
      },
      goals: {
        revenueGoal: report.context.goals.revenueGoal,
        goalAttainment: report.context.goals.goalAttainment,
        remainingToGoal: report.context.goals.remainingToGoal,
        requiredDailyRevenue: report.context.goals.requiredDailyRevenue,
        expenseLimitUsage: report.context.goals.expenseLimitUsage,
      },
      health: {
        label: health.healthLabel,
        healthScore: Number(health.healthScore.toFixed(1)),
        subscriberReturnRate: Number(health.subscriberReturnRate.toFixed(1)),
        walkInReturnRate: Number(health.walkInReturnRate.toFixed(1)),
        summary: health.summary,
      },
      topMarginServices,
      topRevenueServices,
      topProfessionals,
      customerRiskHighlights,
      productPerformance,
      weekdayPerformance: {
        weakest: weekdayPerformance.weakest,
        strongest: weekdayPerformance.strongest,
      },
      campaigns: campaignData
        ? {
            statusLabel: campaignData.statusLabel,
            todayTotals: campaignData.todayTotals,
            recentDeliveries: campaignData.recentDeliveries.slice(0, 5).map((delivery) => ({
              customerName: delivery.customerName,
              campaignType: delivery.campaignType,
              status: delivery.status,
              usedAi: delivery.usedAi,
            })),
          }
        : null,
      limitations: scope.roleScope === 'FINANCIAL'
        ? [
            'Responder apenas com leitura financeira e indicadores globais permitidos.',
            'Não expor clientes nominais, agenda individual ou comparação operacional sensível da equipe.',
          ]
        : [
            'Responder apenas com dados da barbearia atual.',
            'Não inventar números nem extrapolar clientes fora do contexto disponível.',
          ],
    },
    fallbackAnswer: buildManagementFallbackAnswer({
      periodLabel: report.context.period.label,
      revenue: report.context.financial.totalRevenue,
      profit: report.context.financial.profit,
      ticketAverage: report.context.financial.ticketAverage,
      topMarginService: topMarginServices[0] ?? null,
      topProfessional: topProfessionals[0] ?? null,
      atRiskCustomers: customerRiskHighlights.slice(0, 3),
      healthSummary: health.summary,
    }),
  }
}
