import 'server-only'

import { cache } from 'react'
import {
  endOfDay,
  endOfMonth,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { prisma } from '@/lib/prisma'
import { calcGoalProgress, capitalize } from '@/lib/utils'

export const SCHEDULE_START_HOUR = 8
export const SCHEDULE_END_HOUR = 21
export const SCHEDULE_PX_PER_MINUTE = 2

const ACTIVE_APPOINTMENT_STATUSES = new Set<string>(['PENDING', 'CONFIRMED'])

export type ScheduleView = 'day' | 'barber'

export interface ScheduleSearchParams {
  date?: string
  professionalId?: string
  view?: string
}

export interface ScheduleToolbarProfessional {
  id: string
  name: string
}

export interface ScheduleToolbarService {
  id: string
  name: string
  duration: number
  price: number
}

export interface ScheduleToolbarCustomer {
  id: string
  name: string
  phone: string | null
  email: string | null
  type: 'SUBSCRIPTION' | 'WALK_IN'
  subscriptionPrice: number | null
}

export interface ScheduleAppointmentItem {
  id: string
  customerId: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  customerType: 'SUBSCRIPTION' | 'WALK_IN'
  customerSubscriptionPrice: number | null
  professionalId: string
  professionalName: string
  serviceId: string
  serviceName: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'
  source: 'MANUAL' | 'WHATSAPP'
  billingModel: 'AVULSO' | 'SUBSCRIPTION_INCLUDED' | 'SUBSCRIPTION_EXTRA'
  startAt: string
  endAt: string
  durationMinutes: number
  priceSnapshot: number
  notes: string | null
}

export interface ScheduleMonthRevenueMap {
  total: number
  byProfessional: Record<string, number>
}

export interface ScheduleBarberPanel {
  mode: 'team' | 'professional'
  title: string
  subtitle: string
  periodRevenue: number
  periodGoal: number
  periodGoalProgress: number
  completedCount: number
  scheduledValueToday: number
  upcomingToday: ScheduleAppointmentItem[]
}

export interface SchedulePageData {
  date: string
  dateLabel: string
  rangeLabel: string
  view: ScheduleView
  selectedProfessionalId: string | null
  professionals: ScheduleToolbarProfessional[]
  services: ScheduleToolbarService[]
  recentCustomers: ScheduleToolbarCustomer[]
  appointments: ScheduleAppointmentItem[]
  visibleProfessionals: ScheduleToolbarProfessional[]
  days: Array<{
    key: string
    label: string
    shortLabel: string
    isSelected: boolean
  }>
  hours: string[]
  summary: {
    scheduledCount: number
    confirmedCount: number
    pendingCount: number
    completedCount: number
    cancelledCount: number
    scheduledValue: number
  }
  panel: ScheduleBarberPanel
  laneMap: Record<string, number>
  monthRevenue: ScheduleMonthRevenueMap
}

function isValidDateInput(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function normalizeDate(value?: string) {
  if (!isValidDateInput(value)) {
    return format(new Date(), 'yyyy-MM-dd')
  }

  const parsed = new Date(`${value}T09:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return format(new Date(), 'yyyy-MM-dd')
  }

  return format(parsed, 'yyyy-MM-dd')
}

function resolveScheduleView(value?: string): ScheduleView {
  return value === 'barber' || value === 'week' ? 'barber' : 'day'
}

function getRange(date: Date, view: ScheduleView) {
  return {
    start: startOfDay(date),
    end: endOfDay(date),
  }
}

function buildDayEntries(baseDate: Date, view: ScheduleView) {
  return [
    {
      key: format(baseDate, 'yyyy-MM-dd'),
      label: capitalize(format(baseDate, "EEEE, dd 'de' MMMM", { locale: ptBR })),
      shortLabel: capitalize(format(baseDate, 'EEE dd', { locale: ptBR }).replace('.', '')),
      isSelected: true,
    },
  ]
}

function buildHours() {
  return Array.from({ length: SCHEDULE_END_HOUR - SCHEDULE_START_HOUR }, (_, index) =>
    `${String(index + SCHEDULE_START_HOUR).padStart(2, '0')}:00`
  )
}

const getCachedSchedulePageData = cache(
  async (
    barbershopId: string,
    rawDate: string,
    rawView: ScheduleView,
    rawProfessionalId: string | null
  ): Promise<SchedulePageData> => {
    const normalizedDate = normalizeDate(rawDate)
    const baseDate = new Date(`${normalizedDate}T09:00:00`)
    const { start, end } = getRange(baseDate, rawView)
    const monthStart = startOfMonth(baseDate)
    const monthEnd = endOfMonth(baseDate)

    const [professionals, services, recentCustomers, monthlyGoal, monthRevenueTotal, monthRevenueByProfessional, appointments] =
      await Promise.all([
        prisma.professional.findMany({
          where: { barbershopId, active: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.service.findMany({
          where: { barbershopId, active: true },
          select: { id: true, name: true, duration: true, price: true },
          orderBy: { name: 'asc' },
        }),
        prisma.customer.findMany({
          where: { barbershopId, active: true },
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            type: true,
            subscriptionPrice: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 8,
        }),
        prisma.monthlyGoal.findUnique({
          where: {
            barbershopId_month_year: {
              barbershopId,
              month: baseDate.getMonth() + 1,
              year: baseDate.getFullYear(),
            },
          },
          include: {
            professionalGoals: {
              select: {
                professionalId: true,
                revenueGoal: true,
              },
            },
          },
        }),
        prisma.revenue.aggregate({
          where: {
            barbershopId,
            date: { gte: monthStart, lte: monthEnd },
          },
          _sum: { amount: true },
        }),
        prisma.revenue.groupBy({
          by: ['professionalId'],
          where: {
            barbershopId,
            date: { gte: monthStart, lte: monthEnd },
            professionalId: { not: null },
          },
          _sum: { amount: true },
        }),
        prisma.appointment.findMany({
          where: {
            barbershopId,
            professionalId: rawProfessionalId ?? undefined,
            startAt: { gte: start, lte: end },
          },
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                type: true,
                subscriptionPrice: true,
              },
            },
            professional: {
              select: {
                id: true,
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
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        }),
      ])

    const selectedProfessional = rawProfessionalId
      ? professionals.find((professional) => professional.id === rawProfessionalId) ?? null
      : null

    const visibleProfessionals = selectedProfessional ? [selectedProfessional] : professionals
    const laneMap = Object.fromEntries(visibleProfessionals.map((professional, index) => [professional.id, index]))

    const serializedAppointments: ScheduleAppointmentItem[] = appointments.map((appointment) => ({
      id: appointment.id,
      customerId: appointment.customerId,
      customerName: appointment.customer.name,
      customerPhone: appointment.customer.phone,
      customerEmail: appointment.customer.email,
      customerType: appointment.customer.type,
      customerSubscriptionPrice: appointment.customer.subscriptionPrice
        ? Number(appointment.customer.subscriptionPrice)
        : null,
      professionalId: appointment.professionalId,
      professionalName: appointment.professional.name,
      serviceId: appointment.serviceId,
      serviceName: appointment.service.name,
      status: appointment.status,
      source: appointment.source,
      billingModel: appointment.billingModel,
      startAt: appointment.startAt.toISOString(),
      endAt: appointment.endAt.toISOString(),
      durationMinutes: appointment.durationMinutes,
      priceSnapshot: Number(appointment.priceSnapshot),
      notes: appointment.notes,
    }))

    const selectedDayAppointments = serializedAppointments.filter((appointment) =>
      isSameDay(new Date(appointment.startAt), baseDate)
    )

    const focusProfessionalId = selectedProfessional?.id
      ?? selectedDayAppointments[0]?.professionalId
      ?? professionals[0]?.id
      ?? null

    const monthRevenueByProfessionalMap = Object.fromEntries(
      monthRevenueByProfessional
        .filter((entry) => entry.professionalId)
        .map((entry) => [entry.professionalId as string, Number(entry._sum.amount ?? 0)])
    )

    const focusGoal = focusProfessionalId
      ? Number(
          monthlyGoal?.professionalGoals.find((goal) => goal.professionalId === focusProfessionalId)?.revenueGoal ?? 0
        )
      : 0

    const activeDayAppointments = selectedDayAppointments.filter((appointment) =>
      ACTIVE_APPOINTMENT_STATUSES.has(appointment.status)
    )

    const upcomingToday = activeDayAppointments.slice(0, 5)

    const panelRevenue = selectedProfessional
      ? monthRevenueByProfessionalMap[focusProfessionalId ?? ''] ?? 0
      : Number(monthRevenueTotal._sum.amount ?? 0)

    const teamGoal = Number(monthlyGoal?.revenueGoal ?? 0)
    const panelGoal = selectedProfessional ? focusGoal : teamGoal
    const periodGoalProgress = calcGoalProgress(panelRevenue, panelGoal)

    return {
      date: normalizedDate,
      dateLabel: capitalize(format(baseDate, "dd 'de' MMMM", { locale: ptBR })),
      rangeLabel: capitalize(format(baseDate, "EEEE, dd 'de' MMMM", { locale: ptBR })),
      view: rawView,
      selectedProfessionalId: selectedProfessional?.id ?? null,
      professionals,
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        duration: service.duration,
        price: Number(service.price),
      })),
      recentCustomers: recentCustomers.map((customer) => ({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        type: customer.type,
        subscriptionPrice: customer.subscriptionPrice ? Number(customer.subscriptionPrice) : null,
      })),
      appointments: serializedAppointments,
      visibleProfessionals,
      days: buildDayEntries(baseDate, rawView),
      hours: buildHours(),
      summary: {
        scheduledCount: activeDayAppointments.length,
        confirmedCount: selectedDayAppointments.filter((appointment) => appointment.status === 'CONFIRMED').length,
        pendingCount: selectedDayAppointments.filter((appointment) => appointment.status === 'PENDING').length,
        completedCount: selectedDayAppointments.filter((appointment) => appointment.status === 'COMPLETED').length,
        cancelledCount: selectedDayAppointments.filter((appointment) => appointment.status === 'CANCELLED').length,
        scheduledValue: activeDayAppointments.reduce((sum, appointment) => sum + appointment.priceSnapshot, 0),
      },
      panel: {
        mode: selectedProfessional ? 'professional' : 'team',
        title: selectedProfessional ? selectedProfessional.name : 'Equipe do dia',
        subtitle: selectedProfessional
          ? 'Agenda do barbeiro, proximos atendimentos e meta do periodo.'
          : 'Leitura rapida da equipe, fluxo do dia e ritmo comercial.',
        periodRevenue: panelRevenue,
        periodGoal: panelGoal,
        periodGoalProgress,
        completedCount: selectedDayAppointments.filter((appointment) => appointment.status === 'COMPLETED').length,
        scheduledValueToday: activeDayAppointments.reduce((sum, appointment) => sum + appointment.priceSnapshot, 0),
        upcomingToday,
      },
      laneMap,
      monthRevenue: {
        total: Number(monthRevenueTotal._sum.amount ?? 0),
        byProfessional: monthRevenueByProfessionalMap,
      },
    }
  }
)

export function resolveScheduleSearch(searchParams: ScheduleSearchParams) {
  return {
    date: normalizeDate(searchParams.date),
    view: resolveScheduleView(searchParams.view),
    professionalId: searchParams.professionalId ? searchParams.professionalId : null,
  }
}

export function buildScheduleHref(input: {
  date: string
  view: ScheduleView
  professionalId?: string | null
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('date', input.date)
  searchParams.set('view', input.view)

  if (input.professionalId) {
    searchParams.set('professionalId', input.professionalId)
  }

  return `/agendamentos?${searchParams.toString()}`
}

export async function getSchedulePageData(input: {
  barbershopId: string
  date: string
  view: ScheduleView
  professionalId?: string | null
}) {
  return getCachedSchedulePageData(
    input.barbershopId,
    input.date,
    input.view,
    input.professionalId ?? null
  )
}
