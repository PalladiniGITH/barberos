import 'server-only'

import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { capitalize, formatPeriodLabel } from '@/lib/utils'
import { getComparisonWindow } from '@/lib/period'
import type {
  BusinessInsightProfessionalSnapshot,
  BusinessInsightServiceSnapshot,
  BusinessInsightsContext,
  BusinessInsightTrendPoint,
  CustomerTypeFilter,
} from '@/lib/business-insights'
import { buildCustomerIntelligenceContext } from '@/lib/customer-intelligence'

function calculateChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

function assertTenantScope(barbershopId: string) {
  if (!barbershopId || typeof barbershopId !== 'string') {
    throw new Error('Business insights require a valid tenant-scoped barbershopId.')
  }

  return barbershopId
}

function buildTrendSeries(
  month: number,
  year: number,
  revenues: Array<{ date: Date; amount: unknown }>,
  expenses: Array<{ dueDate: Date | null; createdAt: Date; amount: unknown }>
) {
  const buckets: Record<string, BusinessInsightTrendPoint> = {}

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(year, month - 1 - offset, 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

    buckets[key] = {
      label: capitalize(date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')),
      revenue: 0,
      expense: 0,
      profit: 0,
    }
  }

  revenues.forEach((entry) => {
    const date = new Date(entry.date)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (buckets[key]) {
      buckets[key].revenue += Number(entry.amount ?? 0)
    }
  })

  expenses.forEach((entry) => {
    const date = new Date(entry.dueDate ?? entry.createdAt)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (buckets[key]) {
      buckets[key].expense += Number(entry.amount ?? 0)
    }
  })

  return Object.values(buckets).map((bucket) => ({
    ...bucket,
    profit: bucket.revenue - bucket.expense,
  }))
}

function buildServiceSnapshot(service: {
  id: string
  name: string
  price: unknown
  duration: number
  active: boolean
  pricingRule: {
    commissionPercent: unknown
    cardFeePercent: unknown
    taxPercent: unknown
    directCost: unknown
  } | null
  serviceInputs: Array<{
    quantity: unknown
    supply: {
      unitCost: unknown
    }
  }>
}, revenueStats?: { revenue: number; appointments: number }): BusinessInsightServiceSnapshot {
  const price = Number(service.price)
  const commissionRate = service.pricingRule ? Number(service.pricingRule.commissionPercent) / 100 : 0.4
  const cardFeeRate = service.pricingRule ? Number(service.pricingRule.cardFeePercent) / 100 : 0.03
  const taxRate = service.pricingRule ? Number(service.pricingRule.taxPercent) / 100 : 0
  const directCost = service.pricingRule ? Number(service.pricingRule.directCost) : 0

  const inputCost = service.serviceInputs.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.supply.unitCost),
    0
  )
  const commissionCost = price * commissionRate
  const cardFee = price * cardFeeRate
  const tax = price * taxRate
  const totalCost = inputCost + commissionCost + cardFee + tax + directCost
  const margin = price - totalCost
  const marginPercent = price > 0 ? (margin / price) * 100 : 0

  return {
    id: service.id,
    name: service.name,
    active: service.active,
    price,
    duration: service.duration,
    revenue: revenueStats?.revenue ?? 0,
    appointments: revenueStats?.appointments ?? 0,
    inputCost,
    commissionCost,
    cardFee,
    tax,
    directCost,
    totalCost,
    margin,
    marginPercent,
  }
}

const loadBusinessInsightsData = cache(async (
  barbershopId: string,
  month: number,
  year: number,
  professionalId: string | null,
  customerType: CustomerTypeFilter
): Promise<BusinessInsightsContext> => {
  const tenantBarbershopId = assertTenantScope(barbershopId)
  const comparison = getComparisonWindow(month, year)
  const {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    prevMonth,
    prevYear,
    partialComparison,
  } = comparison

  const historyStart = new Date(year, month - 6, 1)
  const now = new Date()
  const overdueReference = currentEnd < now ? currentEnd : now
  const isCurrentPeriod = year === now.getFullYear() && month === now.getMonth() + 1
  const daysInMonth = new Date(year, month, 0).getDate()
  const elapsedDays = isCurrentPeriod ? Math.max(1, Math.min(now.getDate(), daysInMonth)) : daysInMonth
  const remainingDays = isCurrentPeriod ? Math.max(0, daysInMonth - now.getDate()) : 0

  const expenseWhere = (start: Date, end: Date) => ({
    barbershopId: tenantBarbershopId,
    OR: [
      { dueDate: { gte: start, lte: end } },
      { dueDate: null, createdAt: { gte: start, lte: end } },
    ],
  })

  // Every Prisma query below carries the same tenant scope to prevent cross-barbershop reads.
  const [
    currentRevenueSummary,
    previousRevenueSummary,
    currentExpenseSummary,
    previousExpenseSummary,
    monthlyGoal,
    professionals,
    professionalGoals,
    currentRevenueByProfessional,
    previousRevenueByProfessional,
    services,
    currentRevenueByService,
    historyRevenues,
    historyExpenses,
    overdueExpenses,
    activeCustomers,
    completedAppointments,
    customerRevenues,
  ] = await Promise.all([
    prisma.revenue.aggregate({
      where: { barbershopId: tenantBarbershopId, date: { gte: currentStart, lte: currentEnd } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.revenue.aggregate({
      where: { barbershopId: tenantBarbershopId, date: { gte: previousStart, lte: previousEnd } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: expenseWhere(currentStart, currentEnd),
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: expenseWhere(previousStart, previousEnd),
      _sum: { amount: true },
    }),
    prisma.monthlyGoal.findUnique({
      where: { barbershopId_month_year: { barbershopId: tenantBarbershopId, month, year } },
    }),
    prisma.professional.findMany({
      where: { barbershopId: tenantBarbershopId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        avatar: true,
        active: true,
      },
    }),
    prisma.professionalGoal.findMany({
      where: { barbershopId: tenantBarbershopId, month, year },
      select: {
        professionalId: true,
        revenueGoal: true,
        revenueMin: true,
      },
    }),
    prisma.revenue.groupBy({
      by: ['professionalId'],
      where: {
        barbershopId: tenantBarbershopId,
        date: { gte: currentStart, lte: currentEnd },
        professionalId: { not: null },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.revenue.groupBy({
      by: ['professionalId'],
      where: {
        barbershopId: tenantBarbershopId,
        date: { gte: previousStart, lte: previousEnd },
        professionalId: { not: null },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.service.findMany({
      where: { barbershopId: tenantBarbershopId },
      orderBy: { name: 'asc' },
      include: {
        pricingRule: {
          select: {
            commissionPercent: true,
            cardFeePercent: true,
            taxPercent: true,
            directCost: true,
          },
        },
        serviceInputs: {
          include: {
            supply: {
              select: {
                unitCost: true,
              },
            },
          },
        },
      },
    }),
    prisma.revenue.groupBy({
      by: ['serviceId'],
      where: {
        barbershopId: tenantBarbershopId,
        date: { gte: currentStart, lte: currentEnd },
        serviceId: { not: null },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.revenue.findMany({
      where: { barbershopId: tenantBarbershopId, date: { gte: historyStart, lte: currentEnd } },
      select: { date: true, amount: true },
    }),
    prisma.expense.findMany({
      where: {
        barbershopId: tenantBarbershopId,
        OR: [
          { dueDate: { gte: historyStart, lte: currentEnd } },
          { dueDate: null, createdAt: { gte: historyStart, lte: currentEnd } },
        ],
      },
      select: { amount: true, dueDate: true, createdAt: true },
    }),
    prisma.expense.aggregate({
      where: {
        barbershopId: tenantBarbershopId,
        paid: false,
        dueDate: { gte: currentStart, lte: overdueReference },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.customer.findMany({
      where: { barbershopId: tenantBarbershopId, active: true },
      select: {
        id: true,
        name: true,
        type: true,
        active: true,
        subscriptionStatus: true,
        subscriptionPrice: true,
        subscriptionStartedAt: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.appointment.findMany({
      where: {
        barbershopId: tenantBarbershopId,
        status: 'COMPLETED',
        startAt: { gte: currentStart, lte: currentEnd },
      },
      select: {
        customerId: true,
        professionalId: true,
        billingModel: true,
        startAt: true,
        priceSnapshot: true,
        professional: {
          select: {
            name: true,
          },
        },
        service: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.revenue.findMany({
      where: {
        barbershopId: tenantBarbershopId,
        customerId: { not: null },
        date: { gte: currentStart, lte: currentEnd },
      },
      select: {
        customerId: true,
        professionalId: true,
        amount: true,
        origin: true,
      },
    }),
  ])

  const totalRevenue = Number(currentRevenueSummary._sum.amount ?? 0)
  const previousRevenue = Number(previousRevenueSummary._sum.amount ?? 0)
  const totalExpense = Number(currentExpenseSummary._sum.amount ?? 0)
  const previousExpense = Number(previousExpenseSummary._sum.amount ?? 0)
  const profit = totalRevenue - totalExpense
  const previousProfit = previousRevenue - previousExpense
  const totalAppointments = currentRevenueSummary._count
  const previousAppointments = previousRevenueSummary._count
  const ticketAverage = totalAppointments > 0 ? totalRevenue / totalAppointments : 0
  const previousTicketAverage = previousAppointments > 0 ? previousRevenue / previousAppointments : 0
  const profitMargin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0
  const previousProfitMargin = previousRevenue > 0 ? (previousProfit / previousRevenue) * 100 : 0
  const expenseRate = totalRevenue > 0 ? (totalExpense / totalRevenue) * 100 : 0
  const previousExpenseRate = previousRevenue > 0 ? (previousExpense / previousRevenue) * 100 : 0

  const goalsByProfessional = new Map(
    professionalGoals.map((goal) => [
      goal.professionalId,
      {
        revenueGoal: Number(goal.revenueGoal),
        revenueMin: Number(goal.revenueMin),
      },
    ])
  )

  const currentProfessionalMap = new Map(
    currentRevenueByProfessional
      .filter((item) => item.professionalId)
      .map((item) => [
        item.professionalId as string,
        {
          revenue: Number(item._sum.amount ?? 0),
          appointments: item._count,
        },
      ])
  )

  const previousProfessionalMap = new Map(
    previousRevenueByProfessional
      .filter((item) => item.professionalId)
      .map((item) => [
        item.professionalId as string,
        {
          revenue: Number(item._sum.amount ?? 0),
          appointments: item._count,
        },
      ])
  )

  const professionalSnapshots: BusinessInsightProfessionalSnapshot[] = professionals.map((professional) => {
    const current = currentProfessionalMap.get(professional.id)
    const previous = previousProfessionalMap.get(professional.id)
    const goal = goalsByProfessional.get(professional.id)
    const revenue = current?.revenue ?? 0
    const appointments = current?.appointments ?? 0
    const goalValue = goal?.revenueGoal ?? 0

    return {
      id: professional.id,
      name: professional.name,
      avatar: professional.avatar,
      active: professional.active,
      revenue,
      previousRevenue: previous?.revenue ?? 0,
      revenueChange: calculateChange(revenue, previous?.revenue ?? 0),
      appointments,
      ticketAverage: appointments > 0 ? revenue / appointments : 0,
      goalValue,
      goalMin: goal?.revenueMin ?? 0,
      progress: goalValue > 0 ? (revenue / goalValue) * 100 : 0,
    }
  })

  const currentServiceMap = new Map(
    currentRevenueByService
      .filter((item) => item.serviceId)
      .map((item) => [
        item.serviceId as string,
        {
          revenue: Number(item._sum.amount ?? 0),
          appointments: item._count,
        },
      ])
  )

  const serviceSnapshots = services.map((service) => buildServiceSnapshot(service, currentServiceMap.get(service.id)))
  const activeServices = serviceSnapshots.filter((service) => service.active)
  const customerIntelligence = buildCustomerIntelligenceContext({
    customers: activeCustomers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      type: customer.type,
      active: customer.active,
      subscriptionStatus: customer.subscriptionStatus,
      subscriptionPrice: customer.subscriptionPrice ? Number(customer.subscriptionPrice) : null,
      subscriptionStartedAt: customer.subscriptionStartedAt,
    })),
    appointments: completedAppointments.map((appointment) => ({
      customerId: appointment.customerId,
      professionalId: appointment.professionalId,
      professionalName: appointment.professional.name,
      serviceId: appointment.service.id,
      serviceName: appointment.service.name,
      startAt: appointment.startAt,
      priceSnapshot: Number(appointment.priceSnapshot),
      billingModel: appointment.billingModel,
    })),
    revenues: customerRevenues
      .filter((revenue): revenue is typeof revenue & { customerId: string } => Boolean(revenue.customerId))
      .map((revenue) => ({
        customerId: revenue.customerId as string,
        professionalId: revenue.professionalId,
        amount: Number(revenue.amount),
        origin: revenue.origin,
      })),
    services: serviceSnapshots,
    filters: {
      professionalId,
      customerType,
    },
    periodStart: currentStart,
    periodEnd: currentEnd,
  })
  const averageServicePrice = activeServices.reduce((sum, service) => sum + service.price, 0) / Math.max(activeServices.length, 1)
  const averageMarginPercent = activeServices.reduce((sum, service) => sum + service.marginPercent, 0) / Math.max(activeServices.length, 1)
  const ticketReference = Math.max(previousTicketAverage, averageServicePrice)
  const revenueGoal = Number(monthlyGoal?.revenueGoal ?? 0)
  const revenueMin = Number(monthlyGoal?.revenueMin ?? 0)
  const expenseLimit = Number(monthlyGoal?.expenseLimit ?? 0)
  const goalAttainment = revenueGoal > 0 ? (totalRevenue / revenueGoal) * 100 : 0
  const expectedProgress = revenueGoal > 0 ? (elapsedDays / daysInMonth) * 100 : 0
  const remainingToGoal = Math.max(0, revenueGoal - totalRevenue)
  const requiredDailyRevenue = remainingDays > 0 ? remainingToGoal / remainingDays : remainingToGoal
  const expenseLimitUsage = expenseLimit > 0 ? (totalExpense / expenseLimit) * 100 : 0

  return {
    period: {
      month,
      year,
      label: formatPeriodLabel(month, year),
      comparisonMonth: prevMonth,
      comparisonYear: prevYear,
      comparisonLabel: formatPeriodLabel(prevMonth, prevYear),
      partialComparison,
      isCurrentPeriod,
      daysInMonth,
      elapsedDays,
      remainingDays,
    },
    financial: {
      totalRevenue,
      previousRevenue,
      totalExpense,
      previousExpense,
      profit,
      previousProfit,
      totalAppointments,
      previousAppointments,
      ticketAverage,
      previousTicketAverage,
      revenueChange: calculateChange(totalRevenue, previousRevenue),
      expenseChange: calculateChange(totalExpense, previousExpense),
      profitChange: calculateChange(profit, previousProfit),
      ticketChange: calculateChange(ticketAverage, previousTicketAverage),
      profitMargin,
      previousProfitMargin,
      expenseRate,
      previousExpenseRate,
      expenseRateChange: calculateChange(expenseRate, previousExpenseRate),
    },
    goals: {
      revenueGoal,
      revenueMin,
      expenseLimit,
      goalAttainment,
      expectedProgress,
      remainingToGoal,
      requiredDailyRevenue,
      expenseLimitUsage,
      ticketReference,
    },
    overdueExpenses: {
      count: overdueExpenses._count,
      amount: Number(overdueExpenses._sum.amount ?? 0),
    },
    professionals: professionalSnapshots,
    services: serviceSnapshots,
    trend: buildTrendSeries(month, year, historyRevenues, historyExpenses),
    benchmarks: {
      averageServicePrice,
      averageMarginPercent,
      idealMarginPercent: 25,
    },
    customers: customerIntelligence,
  }
})

export function getBusinessInsightsData(params: {
  barbershopId: string
  month: number
  year: number
  professionalId?: string | null
  customerType?: CustomerTypeFilter
}) {
  return loadBusinessInsightsData(
    params.barbershopId,
    params.month,
    params.year,
    params.professionalId ?? null,
    params.customerType ?? 'all'
  )
}
