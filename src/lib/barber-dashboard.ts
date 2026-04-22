import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  formatDateInTimezone,
  formatTimeInTimezone,
  getTodayIsoInTimezone,
  getUtcRangeForLocalDate,
  resolveBusinessTimezone,
} from '@/lib/timezone'
import {
  PROFESSIONAL_ATTENDANCE_SCOPE_LABELS,
  resolveProfessionalAttendanceScope,
  resolveProfessionalCommissionRatePercent,
} from '@/lib/professionals/operational-config'
import { calcGoalProgress, CHALLENGE_TYPE_LABELS, formatPeriodLabel } from '@/lib/utils'

export interface BarberDashboardData {
  professionalId: string
  professionalName: string
  attendanceScopeLabel: string
  commissionRatePercent: number
  periodLabel: string
  todayLabel: string
  monthRevenue: number
  commissionableRevenue: number
  estimatedCommission: number
  actualCommission: number | null
  appointmentsCompletedInPeriod: number
  averageTicket: number
  goalValue: number
  goalProgress: number
  scheduledTodayCount: number
  completedTodayCount: number
  productSalesCount: number
  productRevenue: number
  upcomingToday: Array<{
    id: string
    timeLabel: string
    customerName: string
    serviceName: string
    status: 'PENDING' | 'CONFIRMED'
  }>
  activeChallenge: {
    title: string
    typeLabel: string
    valueFormat: 'currency' | 'count'
    targetValue: number
    achievedValue: number
    progress: number
    reward: string | null
  } | null
}

export async function getBarberDashboardData(input: {
  barbershopId: string
  professionalId: string
  month: number
  year: number
}): Promise<BarberDashboardData | null> {
  const [barbershop, professional] = await Promise.all([
    prisma.barbershop.findUnique({
      where: { id: input.barbershopId },
      select: { timezone: true },
    }),
    prisma.professional.findFirst({
      where: {
        id: input.professionalId,
        barbershopId: input.barbershopId,
        active: true,
      },
      select: {
        id: true,
        name: true,
        commissionRate: true,
        acceptsWalkIn: true,
        acceptsSubscription: true,
      },
    }),
  ])

  if (!professional) {
    return null
  }

  const timezone = resolveBusinessTimezone(barbershop?.timezone)
  const todayIso = getTodayIsoInTimezone(timezone)
  const todayRange = getUtcRangeForLocalDate({
    dateIso: todayIso,
    timezone,
  })
  const monthStart = new Date(input.year, input.month - 1, 1)
  const monthEnd = new Date(input.year, input.month, 0, 23, 59, 59, 999)

  const [
    todayAppointments,
    completedAppointmentsInPeriod,
    totalRevenueAggregate,
    commissionableRevenueAggregate,
    productRevenueAggregate,
    productSalesCount,
    professionalGoal,
    monthlyGoal,
    commissionRecord,
    activeChallenge,
  ] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barbershopId: input.barbershopId,
        professionalId: professional.id,
        startAt: { gte: todayRange.startAtUtc, lt: todayRange.endAtUtc },
        status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
      },
      orderBy: { startAt: 'asc' },
      select: {
        id: true,
        startAt: true,
        status: true,
        customer: { select: { name: true } },
        service: { select: { name: true } },
      },
    }),
    prisma.appointment.count({
      where: {
        barbershopId: input.barbershopId,
        professionalId: professional.id,
        startAt: { gte: monthStart, lte: monthEnd },
        status: 'COMPLETED',
      },
    }),
    prisma.revenue.aggregate({
      where: {
        barbershopId: input.barbershopId,
        professionalId: professional.id,
        date: { gte: monthStart, lte: monthEnd },
      },
      _sum: { amount: true },
    }),
    prisma.revenue.aggregate({
      where: {
        barbershopId: input.barbershopId,
        professionalId: professional.id,
        date: { gte: monthStart, lte: monthEnd },
        origin: { in: ['SERVICE', 'SUBSCRIPTION', 'OTHER'] },
      },
      _sum: { amount: true },
    }),
    prisma.revenue.aggregate({
      where: {
        barbershopId: input.barbershopId,
        professionalId: professional.id,
        date: { gte: monthStart, lte: monthEnd },
        origin: 'PRODUCT',
      },
      _sum: { amount: true },
    }),
    prisma.revenue.count({
      where: {
        barbershopId: input.barbershopId,
        professionalId: professional.id,
        date: { gte: monthStart, lte: monthEnd },
        origin: 'PRODUCT',
      },
    }),
    prisma.professionalGoal.findUnique({
      where: {
        professionalId_month_year: {
          professionalId: professional.id,
          month: input.month,
          year: input.year,
        },
      },
      select: { revenueGoal: true },
    }),
    prisma.monthlyGoal.findUnique({
      where: {
        barbershopId_month_year: {
          barbershopId: input.barbershopId,
          month: input.month,
          year: input.year,
        },
      },
      select: { revenueGoal: true },
    }),
    prisma.commission.findUnique({
      where: {
        professionalId_month_year: {
          professionalId: professional.id,
          month: input.month,
          year: input.year,
        },
      },
      select: {
        commissionAmount: true,
        bonus: true,
      },
    }),
    prisma.challenge.findFirst({
      where: {
        barbershopId: input.barbershopId,
        active: true,
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
        results: {
          some: { professionalId: professional.id },
        },
      },
      orderBy: { endDate: 'asc' },
      select: {
        title: true,
        type: true,
        targetValue: true,
        reward: true,
        results: {
          where: { professionalId: professional.id },
          select: { achievedValue: true },
          take: 1,
        },
      },
    }),
  ])

  const monthRevenue = Number(totalRevenueAggregate._sum.amount ?? 0)
  const commissionableRevenue = Number(commissionableRevenueAggregate._sum.amount ?? 0)
  const productRevenue = Number(productRevenueAggregate._sum.amount ?? 0)
  const goalValue = Number(professionalGoal?.revenueGoal ?? monthlyGoal?.revenueGoal ?? 0)
  const commissionRatePercent = resolveProfessionalCommissionRatePercent({
    professionalRate: professional.commissionRate ? Number(professional.commissionRate) : null,
  })
  const actualCommission = commissionRecord
    ? Number(commissionRecord.commissionAmount) + Number(commissionRecord.bonus)
    : null
  const estimatedCommission = actualCommission ?? (commissionableRevenue * commissionRatePercent) / 100
  const averageTicket = completedAppointmentsInPeriod > 0 ? commissionableRevenue / completedAppointmentsInPeriod : 0
  const goalProgress = calcGoalProgress(monthRevenue, goalValue)
  const scheduledTodayCount = todayAppointments.filter((appointment) =>
    appointment.status === 'PENDING' || appointment.status === 'CONFIRMED'
  ).length
  const completedTodayCount = todayAppointments.filter((appointment) => appointment.status === 'COMPLETED').length
  const upcomingToday = todayAppointments
    .filter((appointment) => appointment.status === 'PENDING' || appointment.status === 'CONFIRMED')
    .map((appointment) => ({
      id: appointment.id,
      timeLabel: formatTimeInTimezone(appointment.startAt, timezone),
      customerName: appointment.customer.name,
      serviceName: appointment.service.name,
      status: appointment.status === 'PENDING' ? ('PENDING' as const) : ('CONFIRMED' as const),
    }))

  const challengeResult = activeChallenge?.results[0]
  const activeChallengeSummary = activeChallenge
    ? {
        title: activeChallenge.title,
        typeLabel: CHALLENGE_TYPE_LABELS[activeChallenge.type],
        valueFormat: activeChallenge.type === 'REVENUE' || activeChallenge.type === 'TICKET_AVERAGE'
          ? ('currency' as const)
          : ('count' as const),
        targetValue: Number(activeChallenge.targetValue),
        achievedValue: Number(challengeResult?.achievedValue ?? 0),
        progress: calcGoalProgress(
          Number(challengeResult?.achievedValue ?? 0),
          Number(activeChallenge.targetValue)
        ),
        reward: activeChallenge.reward,
      }
    : null

  return {
    professionalId: professional.id,
    professionalName: professional.name,
    attendanceScopeLabel: PROFESSIONAL_ATTENDANCE_SCOPE_LABELS[
      resolveProfessionalAttendanceScope({
        acceptsSubscription: professional.acceptsSubscription,
        acceptsWalkIn: professional.acceptsWalkIn,
      })
    ],
    commissionRatePercent,
    periodLabel: formatPeriodLabel(input.month, input.year),
    todayLabel: formatDateInTimezone(todayRange.startAtUtc, timezone),
    monthRevenue,
    commissionableRevenue,
    estimatedCommission,
    actualCommission,
    appointmentsCompletedInPeriod: completedAppointmentsInPeriod,
    averageTicket,
    goalValue,
    goalProgress,
    scheduledTodayCount,
    completedTodayCount,
    productSalesCount,
    productRevenue,
    upcomingToday,
    activeChallenge: activeChallengeSummary,
  }
}
