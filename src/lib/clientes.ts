import 'server-only'

import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { getComparisonWindow } from '@/lib/period'
import { getBusinessInsightsData } from '@/lib/insights-data'
import type {
  CustomerIntelligenceCustomerSnapshot,
  CustomerTypeFilter,
} from '@/lib/business-insights'

export type CustomerFrequencyFilter = 'all' | 'high' | 'medium' | 'low'
export type CustomerValueFilter = 'all' | 'high' | 'medium' | 'low'

export interface CustomerDirectoryRow {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  type: 'SUBSCRIPTION' | 'WALK_IN'
  subscriptionStatus: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | null
  subscriptionPrice: number | null
  visits: number
  totalRevenue: number
  realRevenue: number
  estimatedRevenue: number
  estimatedCost: number
  margin: number
  marginPercent: number
  ticketAverage: number
  lastVisitAt: string | null
  mostFrequentProfessionalName: string | null
  favoriteServiceName: string | null
  riskLevel: CustomerIntelligenceCustomerSnapshot['riskLevel']
  riskLabel: string
  revenueConfidence: CustomerIntelligenceCustomerSnapshot['revenueConfidence']
  revenueConfidenceLabel: string
}

export interface CustomerDirectoryData {
  filters: {
    month: number
    year: number
    professionalId: string | null
    customerType: CustomerTypeFilter
    frequency: CustomerFrequencyFilter
    value: CustomerValueFilter
  }
  professionals: Array<{ id: string; name: string }>
  rows: CustomerDirectoryRow[]
  summary: {
    customers: number
    profitableCustomers: number
    atRiskCustomers: number
    totalRevenue: number
    estimatedRevenue: number
    totalMargin: number
    averageTicket: number
  }
  methodology: Awaited<ReturnType<typeof getBusinessInsightsData>>['customers']['methodology']
}

export interface CustomerProfileData {
  customer: {
    id: string
    name: string
    phone: string | null
    email: string | null
    notes: string | null
    type: 'SUBSCRIPTION' | 'WALK_IN'
    subscriptionStatus: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | null
    subscriptionPrice: number | null
  }
  filters: {
    month: number
    year: number
    professionalId: string | null
  }
  snapshot: CustomerDirectoryRow
  methodology: Awaited<ReturnType<typeof getBusinessInsightsData>>['customers']['methodology']
  professionals: Array<{ id: string; name: string }>
  periodSummary: {
    visits: number
    completedVisits: number
    totalRevenue: number
    realRevenue: number
    estimatedRevenue: number
    estimatedCost: number
    margin: number
    ticketAverage: number
  }
  lifetimeSummary: {
    completedVisits: number
    linkedRevenue: number
    firstVisitAt: string | null
    lastVisitAt: string | null
  }
  favoriteServices: Array<{
    name: string
    visits: number
    sharePercent: number
  }>
  favoriteProfessionals: Array<{
    name: string
    visits: number
    sharePercent: number
  }>
  appointmentHistory: Array<{
    id: string
    startAt: string
    status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'
    serviceName: string
    professionalName: string
    billingModel: 'AVULSO' | 'SUBSCRIPTION_INCLUDED' | 'SUBSCRIPTION_EXTRA'
    priceSnapshot: number
    notes: string | null
  }>
  recentBehavior: string[]
}

function normalizeFrequencyFilter(value?: string): CustomerFrequencyFilter {
  if (value === 'high') return 'high'
  if (value === 'medium') return 'medium'
  if (value === 'low') return 'low'
  return 'all'
}

function normalizeValueFilter(value?: string): CustomerValueFilter {
  if (value === 'high') return 'high'
  if (value === 'medium') return 'medium'
  if (value === 'low') return 'low'
  return 'all'
}

function matchesFrequencyFilter(visits: number, filter: CustomerFrequencyFilter) {
  if (filter === 'all') return true
  if (filter === 'high') return visits >= 4
  if (filter === 'medium') return visits >= 2 && visits <= 3
  return visits <= 1
}

function matchesValueFilter(value: number, filter: CustomerValueFilter) {
  if (filter === 'all') return true
  if (filter === 'high') return value >= 250
  if (filter === 'medium') return value >= 120 && value < 250
  return value < 120
}

function buildCustomerRow(
  snapshot: CustomerIntelligenceCustomerSnapshot,
  customer: {
    phone: string | null
    email: string | null
    notes: string | null
    subscriptionStatus: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | null
    subscriptionPrice: number | null
  } | null,
  metadata: {
    lastVisitAt: Date | null
    mostFrequentProfessionalName: string | null
    favoriteServiceName: string | null
  }
): CustomerDirectoryRow {
  return {
    id: snapshot.id,
    name: snapshot.name,
    phone: customer?.phone ?? null,
    email: customer?.email ?? null,
    notes: customer?.notes ?? null,
    type: snapshot.type,
    subscriptionStatus: customer?.subscriptionStatus ?? null,
    subscriptionPrice: customer?.subscriptionPrice ?? snapshot.subscriptionPrice ?? null,
    visits: snapshot.visits,
    totalRevenue: snapshot.totalRevenue,
    realRevenue: snapshot.realRevenue,
    estimatedRevenue: snapshot.estimatedRevenue,
    estimatedCost: snapshot.estimatedCost,
    margin: snapshot.margin,
    marginPercent: snapshot.marginPercent,
    ticketAverage: snapshot.revenuePerVisit,
    lastVisitAt: metadata.lastVisitAt ? metadata.lastVisitAt.toISOString() : snapshot.lastVisitAt,
    mostFrequentProfessionalName: metadata.mostFrequentProfessionalName,
    favoriteServiceName: metadata.favoriteServiceName,
    riskLevel: snapshot.riskLevel,
    riskLabel: snapshot.riskLabel,
    revenueConfidence: snapshot.revenueConfidence,
    revenueConfidenceLabel: snapshot.revenueConfidenceLabel,
  }
}

function buildRecentBehavior(args: {
  snapshot: CustomerDirectoryRow
  favoriteServices: Array<{ name: string; visits: number; sharePercent: number }>
  favoriteProfessionals: Array<{ name: string; visits: number; sharePercent: number }>
}) {
  const messages: string[] = []

  if (args.snapshot.type === 'SUBSCRIPTION') {
    if (args.snapshot.riskLevel === 'loss' || args.snapshot.riskLevel === 'warning') {
      messages.push(`Uso da assinatura em ${args.snapshot.riskLabel.toLowerCase()}.`)
    } else if (args.snapshot.riskLevel === 'underused') {
      messages.push('Assinatura com uso baixo e margem muito favoravel.')
    } else {
      messages.push('Assinatura com comportamento operacional saudavel no recorte.')
    }
  } else if (args.snapshot.margin > 0) {
    messages.push('Cliente avulso com contribuicao positiva para a margem.')
  } else {
    messages.push('Cliente avulso com retorno abaixo do esperado no recorte.')
  }

  if (args.favoriteServices[0]) {
    messages.push(`Servico dominante: ${args.favoriteServices[0].name}.`)
  }

  if (args.favoriteProfessionals[0]) {
    messages.push(`Barbeiro mais frequente: ${args.favoriteProfessionals[0].name}.`)
  }

  if (args.snapshot.estimatedRevenue > 0) {
    messages.push('Parte da leitura depende de receita estimada e deve ser lida com cautela.')
  } else {
    messages.push('A receita usada neste cliente esta 100% ancorada em lancamentos reais.')
  }

  return messages
}

const getCustomersDirectoryDataCached = cache(async (
  barbershopId: string,
  month: number,
  year: number,
  professionalId: string | null,
  customerType: CustomerTypeFilter,
  frequency: CustomerFrequencyFilter,
  value: CustomerValueFilter,
): Promise<CustomerDirectoryData> => {
  const comparison = getComparisonWindow(month, year)
  const context = await getBusinessInsightsData({
    barbershopId,
    month,
    year,
    professionalId,
    customerType,
  })

  const [customers, completedAppointments, lastVisitByCustomer] = await Promise.all([
    prisma.customer.findMany({
      where: { barbershopId, active: true },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        notes: true,
        subscriptionStatus: true,
        subscriptionPrice: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.appointment.findMany({
      where: {
        barbershopId,
        status: 'COMPLETED',
        professionalId: professionalId ?? undefined,
        startAt: { gte: comparison.currentStart, lte: comparison.currentEnd },
      },
      select: {
        customerId: true,
        professional: { select: { name: true } },
        service: { select: { name: true } },
      },
    }),
    prisma.appointment.groupBy({
      by: ['customerId'],
      where: {
        barbershopId,
        status: 'COMPLETED',
        professionalId: professionalId ?? undefined,
      },
      _max: { startAt: true },
    }),
  ])

  const customersById = new Map(customers.map((customer) => [
    customer.id,
    {
      ...customer,
      subscriptionPrice: customer.subscriptionPrice ? Number(customer.subscriptionPrice) : null,
    },
  ]))
  const lastVisitMap = new Map(lastVisitByCustomer.map((item) => [item.customerId, item._max.startAt ?? null]))
  const professionalCountByCustomer = new Map<string, Map<string, number>>()
  const serviceCountByCustomer = new Map<string, Map<string, number>>()

  completedAppointments.forEach((appointment) => {
    const professionalBucket = professionalCountByCustomer.get(appointment.customerId) ?? new Map<string, number>()
    professionalBucket.set(
      appointment.professional.name,
      (professionalBucket.get(appointment.professional.name) ?? 0) + 1
    )
    professionalCountByCustomer.set(appointment.customerId, professionalBucket)

    const serviceBucket = serviceCountByCustomer.get(appointment.customerId) ?? new Map<string, number>()
    serviceBucket.set(
      appointment.service.name,
      (serviceBucket.get(appointment.service.name) ?? 0) + 1
    )
    serviceCountByCustomer.set(appointment.customerId, serviceBucket)
  })

  const rows = context.customers.table
    .map((snapshot) => {
      const professionalCounts = Array.from((professionalCountByCustomer.get(snapshot.id) ?? new Map()).entries())
        .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
      const serviceCounts = Array.from((serviceCountByCustomer.get(snapshot.id) ?? new Map()).entries())
        .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null

      return buildCustomerRow(
        snapshot,
        customersById.get(snapshot.id) ?? null,
        {
          lastVisitAt: lastVisitMap.get(snapshot.id) ?? null,
          mostFrequentProfessionalName: professionalCounts,
          favoriteServiceName: serviceCounts,
        }
      )
    })
    .filter((row) =>
      matchesFrequencyFilter(row.visits, frequency)
      && matchesValueFilter(row.totalRevenue, value)
    )

  const summary = rows.reduce(
    (accumulator, row) => {
      accumulator.totalRevenue += row.totalRevenue
      accumulator.estimatedRevenue += row.estimatedRevenue
      accumulator.totalMargin += row.margin
      accumulator.profitableCustomers += row.margin > 0 ? 1 : 0
      accumulator.atRiskCustomers += row.riskLevel === 'warning' || row.riskLevel === 'loss' ? 1 : 0
      return accumulator
    },
    {
      totalRevenue: 0,
      estimatedRevenue: 0,
      totalMargin: 0,
      profitableCustomers: 0,
      atRiskCustomers: 0,
    }
  )

  return {
    filters: {
      month,
      year,
      professionalId,
      customerType,
      frequency,
      value,
    },
    professionals: context.professionals.map((professional) => ({
      id: professional.id,
      name: professional.name,
    })),
    rows,
    summary: {
      customers: rows.length,
      profitableCustomers: summary.profitableCustomers,
      atRiskCustomers: summary.atRiskCustomers,
      totalRevenue: summary.totalRevenue,
      estimatedRevenue: summary.estimatedRevenue,
      totalMargin: summary.totalMargin,
      averageTicket: rows.length > 0
        ? rows.reduce((sum, row) => sum + row.ticketAverage, 0) / rows.length
        : 0,
    },
    methodology: context.customers.methodology,
  }
})

const getCustomerProfileDataCached = cache(async (
  barbershopId: string,
  customerId: string,
  month: number,
  year: number,
  professionalId: string | null,
): Promise<CustomerProfileData | null> => {
  const comparison = getComparisonWindow(month, year)
  const context = await getBusinessInsightsData({
    barbershopId,
    month,
    year,
    professionalId,
    customerType: 'all',
  })

  const customerRecord = await prisma.customer.findFirst({
    where: { id: customerId, barbershopId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      notes: true,
      type: true,
      subscriptionStatus: true,
      subscriptionPrice: true,
    },
  })

  if (!customerRecord) {
    return null
  }

  const snapshot = context.customers.table.find((item) => item.id === customerId)
  const safeSnapshot: CustomerDirectoryRow = snapshot
    ? buildCustomerRow(snapshot, {
        phone: customerRecord.phone,
        email: customerRecord.email,
        notes: customerRecord.notes,
        subscriptionStatus: customerRecord.subscriptionStatus,
        subscriptionPrice: customerRecord.subscriptionPrice ? Number(customerRecord.subscriptionPrice) : null,
      }, {
        lastVisitAt: snapshot.lastVisitAt ? new Date(snapshot.lastVisitAt) : null,
        mostFrequentProfessionalName: snapshot.professionalNames[0] ?? null,
        favoriteServiceName: null,
      })
    : {
        id: customerRecord.id,
        name: customerRecord.name,
        phone: customerRecord.phone,
        email: customerRecord.email,
        notes: customerRecord.notes,
        type: customerRecord.type,
        subscriptionStatus: customerRecord.subscriptionStatus,
        subscriptionPrice: customerRecord.subscriptionPrice ? Number(customerRecord.subscriptionPrice) : null,
        visits: 0,
        totalRevenue: 0,
        realRevenue: 0,
        estimatedRevenue: 0,
        estimatedCost: 0,
        margin: 0,
        marginPercent: 0,
        ticketAverage: 0,
        lastVisitAt: null,
        mostFrequentProfessionalName: null,
        favoriteServiceName: null,
        riskLevel: customerRecord.type === 'SUBSCRIPTION' ? 'healthy' : 'neutral',
        riskLabel: customerRecord.type === 'SUBSCRIPTION' ? 'Sem uso no periodo' : 'Cliente avulso',
        revenueConfidence: 'estimated' as const,
        revenueConfidenceLabel: 'Sem base no recorte',
      }

  const [appointmentHistory, completedAppointments, lifetimeSummary] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barbershopId,
        customerId,
        professionalId: professionalId ?? undefined,
        startAt: { gte: comparison.currentStart, lte: comparison.currentEnd },
      },
      orderBy: { startAt: 'desc' },
      take: 18,
      select: {
        id: true,
        startAt: true,
        status: true,
        billingModel: true,
        priceSnapshot: true,
        notes: true,
        service: { select: { name: true } },
        professional: { select: { name: true } },
      },
    }),
    prisma.appointment.findMany({
      where: {
        barbershopId,
        customerId,
        professionalId: professionalId ?? undefined,
        status: 'COMPLETED',
        startAt: { gte: comparison.currentStart, lte: comparison.currentEnd },
      },
      orderBy: { startAt: 'desc' },
      select: {
        startAt: true,
        service: { select: { name: true } },
        professional: { select: { name: true } },
      },
    }),
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        appointments: {
          where: {
            status: 'COMPLETED',
            professionalId: professionalId ?? undefined,
          },
          orderBy: { startAt: 'asc' },
          select: { startAt: true },
        },
        revenues: {
          where: {
            professionalId: professionalId ?? undefined,
            customerId,
          },
          select: { amount: true },
        },
      },
    }),
  ])

  const serviceCounts = new Map<string, number>()
  const professionalCounts = new Map<string, number>()

  completedAppointments.forEach((appointment) => {
    serviceCounts.set(
      appointment.service.name,
      (serviceCounts.get(appointment.service.name) ?? 0) + 1
    )
    professionalCounts.set(
      appointment.professional.name,
      (professionalCounts.get(appointment.professional.name) ?? 0) + 1
    )
  })

  const favoriteServices = Array.from(serviceCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([name, visits]) => ({
      name,
      visits,
      sharePercent: completedAppointments.length > 0 ? (visits / completedAppointments.length) * 100 : 0,
    }))

  const favoriteProfessionals = Array.from(professionalCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([name, visits]) => ({
      name,
      visits,
      sharePercent: completedAppointments.length > 0 ? (visits / completedAppointments.length) * 100 : 0,
    }))

  const profileSnapshot = {
    ...safeSnapshot,
    favoriteServiceName: safeSnapshot.favoriteServiceName ?? favoriteServices[0]?.name ?? null,
    mostFrequentProfessionalName: safeSnapshot.mostFrequentProfessionalName ?? favoriteProfessionals[0]?.name ?? null,
  }

  return {
    customer: {
      id: customerRecord.id,
      name: customerRecord.name,
      phone: customerRecord.phone,
      email: customerRecord.email,
      notes: customerRecord.notes,
      type: customerRecord.type,
      subscriptionStatus: customerRecord.subscriptionStatus,
      subscriptionPrice: customerRecord.subscriptionPrice ? Number(customerRecord.subscriptionPrice) : null,
    },
    filters: {
      month,
      year,
      professionalId,
    },
    snapshot: profileSnapshot,
    methodology: context.customers.methodology,
    professionals: context.professionals.map((professional) => ({
      id: professional.id,
      name: professional.name,
    })),
    periodSummary: {
      visits: appointmentHistory.length,
      completedVisits: completedAppointments.length,
      totalRevenue: profileSnapshot.totalRevenue,
      realRevenue: profileSnapshot.realRevenue,
      estimatedRevenue: profileSnapshot.estimatedRevenue,
      estimatedCost: profileSnapshot.estimatedCost,
      margin: profileSnapshot.margin,
      ticketAverage: profileSnapshot.ticketAverage,
    },
    lifetimeSummary: {
      completedVisits: lifetimeSummary?.appointments.length ?? 0,
      linkedRevenue: lifetimeSummary?.revenues.reduce((sum, revenue) => sum + Number(revenue.amount), 0) ?? 0,
      firstVisitAt: lifetimeSummary?.appointments[0]?.startAt?.toISOString() ?? null,
      lastVisitAt: lifetimeSummary?.appointments.at(-1)?.startAt?.toISOString() ?? null,
    },
    favoriteServices,
    favoriteProfessionals,
    appointmentHistory: appointmentHistory.map((appointment) => ({
      id: appointment.id,
      startAt: appointment.startAt.toISOString(),
      status: appointment.status,
      serviceName: appointment.service.name,
      professionalName: appointment.professional.name,
      billingModel: appointment.billingModel,
      priceSnapshot: Number(appointment.priceSnapshot),
      notes: appointment.notes,
    })),
    recentBehavior: buildRecentBehavior({
      snapshot: profileSnapshot,
      favoriteServices,
      favoriteProfessionals,
    }),
  }
})

export function resolveCustomerDirectoryFilters(searchParams: {
  customerType?: string
  frequency?: string
  value?: string
}): {
  customerType: CustomerTypeFilter
  frequency: CustomerFrequencyFilter
  value: CustomerValueFilter
} {
  const customerType = searchParams.customerType === 'subscription'
    ? 'subscription'
    : searchParams.customerType === 'walk_in'
      ? 'walk_in'
      : 'all'

  return {
    customerType,
    frequency: normalizeFrequencyFilter(searchParams.frequency),
    value: normalizeValueFilter(searchParams.value),
  }
}

export function getCustomersDirectoryData(params: {
  barbershopId: string
  month: number
  year: number
  professionalId?: string | null
  customerType?: CustomerTypeFilter
  frequency?: CustomerFrequencyFilter
  value?: CustomerValueFilter
}) {
  return getCustomersDirectoryDataCached(
    params.barbershopId,
    params.month,
    params.year,
    params.professionalId ?? null,
    params.customerType ?? 'all',
    params.frequency ?? 'all',
    params.value ?? 'all',
  )
}

export function getCustomerProfileData(params: {
  barbershopId: string
  customerId: string
  month: number
  year: number
  professionalId?: string | null
}) {
  return getCustomerProfileDataCached(
    params.barbershopId,
    params.customerId,
    params.month,
    params.year,
    params.professionalId ?? null,
  )
}
