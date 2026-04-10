import type {
  BusinessInsightServiceSnapshot,
  CustomerIntelligenceContext,
  CustomerIntelligenceCustomerSnapshot,
  CustomerIntelligenceFilters,
  CustomerIntelligenceGroupSnapshot,
} from '@/lib/business-insights'

interface CustomerBaseRow {
  id: string
  name: string
  type: 'SUBSCRIPTION' | 'WALK_IN'
  active: boolean
  subscriptionStatus: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | null
  subscriptionPrice: number | null
  subscriptionStartedAt: Date | null
}

interface CustomerAppointmentRow {
  customerId: string
  professionalId: string
  professionalName: string
  serviceId: string
  serviceName: string
  startAt: Date
  priceSnapshot: number
  billingModel: 'AVULSO' | 'SUBSCRIPTION_INCLUDED' | 'SUBSCRIPTION_EXTRA'
}

interface CustomerRevenueRow {
  customerId: string
  professionalId: string | null
  amount: number
  origin: 'SERVICE' | 'SUBSCRIPTION' | 'PRODUCT' | 'OTHER'
}

interface BuildCustomerIntelligenceParams {
  customers: CustomerBaseRow[]
  appointments: CustomerAppointmentRow[]
  revenues: CustomerRevenueRow[]
  services: BusinessInsightServiceSnapshot[]
  filters: CustomerIntelligenceFilters
  periodStart: Date
  periodEnd: Date
}

interface MutableCustomerAggregate {
  customer: CustomerBaseRow
  visits: number
  includedVisits: number
  extraVisits: number
  directSubscriptionRevenue: number
  directServiceRevenue: number
  directOtherRevenue: number
  fallbackServiceRevenue: number
  estimatedCost: number
  publicValueConsumed: number
  lastVisitAt: Date | null
  professionalNames: Set<string>
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function sortByMarginDesc(left: CustomerIntelligenceCustomerSnapshot, right: CustomerIntelligenceCustomerSnapshot) {
  return (right.margin - left.margin) || (right.totalRevenue - left.totalRevenue) || left.name.localeCompare(right.name)
}

function sortByMarginAsc(left: CustomerIntelligenceCustomerSnapshot, right: CustomerIntelligenceCustomerSnapshot) {
  return (left.margin - right.margin) || (right.visits - left.visits) || left.name.localeCompare(right.name)
}

function sortByFrequency(left: CustomerIntelligenceCustomerSnapshot, right: CustomerIntelligenceCustomerSnapshot) {
  return (right.visits - left.visits) || (right.totalRevenue - left.totalRevenue) || left.name.localeCompare(right.name)
}

function createEmptyGroup(type: 'SUBSCRIPTION' | 'WALK_IN', label: string): CustomerIntelligenceGroupSnapshot {
  return {
    type,
    label,
    customers: 0,
    visits: 0,
    totalRevenue: 0,
    realRevenue: 0,
    estimatedRevenue: 0,
    totalCost: 0,
    margin: 0,
    marginPercent: 0,
    revenueSharePercent: 0,
    operationalSharePercent: 0,
    averageTicket: 0,
    averageVisitsPerCustomer: 0,
    averageRevenuePerVisit: 0,
    averageMarginPerCustomer: 0,
    averageCostPerVisit: 0,
  }
}

function buildGroupSnapshot(
  customers: CustomerIntelligenceCustomerSnapshot[],
  type: 'SUBSCRIPTION' | 'WALK_IN',
  label: string
): CustomerIntelligenceGroupSnapshot {
  if (customers.length === 0) {
    return createEmptyGroup(type, label)
  }

  const totals = customers.reduce(
    (accumulator, customer) => {
      accumulator.visits += customer.visits
      accumulator.totalRevenue += customer.totalRevenue
      accumulator.realRevenue += customer.realRevenue
      accumulator.estimatedRevenue += customer.estimatedRevenue
      accumulator.totalCost += customer.estimatedCost
      accumulator.margin += customer.margin
      return accumulator
    },
    {
      visits: 0,
      totalRevenue: 0,
      realRevenue: 0,
      estimatedRevenue: 0,
      totalCost: 0,
      margin: 0,
    }
  )

  return {
    type,
    label,
    customers: customers.length,
    visits: totals.visits,
    totalRevenue: roundCurrency(totals.totalRevenue),
    realRevenue: roundCurrency(totals.realRevenue),
    estimatedRevenue: roundCurrency(totals.estimatedRevenue),
    totalCost: roundCurrency(totals.totalCost),
    margin: roundCurrency(totals.margin),
    marginPercent: totals.totalRevenue > 0 ? (totals.margin / totals.totalRevenue) * 100 : 0,
    revenueSharePercent: 0,
    operationalSharePercent: 0,
    averageTicket: totals.visits > 0 ? totals.totalRevenue / totals.visits : 0,
    averageVisitsPerCustomer: totals.visits / customers.length,
    averageRevenuePerVisit: totals.visits > 0 ? totals.totalRevenue / totals.visits : 0,
    averageMarginPerCustomer: totals.margin / customers.length,
    averageCostPerVisit: totals.visits > 0 ? totals.totalCost / totals.visits : 0,
  }
}

function resolveRevenueConfidence(realRevenue: number, estimatedRevenue: number) {
  if (estimatedRevenue <= 0) {
    return {
      level: 'real' as const,
      label: 'Receita real',
    }
  }

  if (realRevenue <= 0) {
    return {
      level: 'estimated' as const,
      label: 'Receita estimada',
    }
  }

  return {
    level: 'mixed' as const,
    label: 'Receita mista',
  }
}

function resolveRisk(customer: {
  type: 'SUBSCRIPTION' | 'WALK_IN'
  visits: number
  margin: number
  costVsFeePercent: number | null
}) {
  if (customer.type !== 'SUBSCRIPTION') {
    return {
      riskLevel: 'neutral' as const,
      riskLabel: 'Cliente avulso',
    }
  }

  if (customer.margin < 0 || (customer.costVsFeePercent !== null && customer.costVsFeePercent >= 100)) {
    return {
      riskLevel: 'loss' as const,
      riskLabel: 'Ja opera no prejuizo',
    }
  }

  if (customer.costVsFeePercent !== null && customer.costVsFeePercent >= 82) {
    return {
      riskLevel: 'warning' as const,
      riskLabel: 'Perto de pressionar a margem',
    }
  }

  if (customer.visits <= 1 || (customer.costVsFeePercent !== null && customer.costVsFeePercent < 35)) {
    return {
      riskLevel: 'underused' as const,
      riskLabel: 'Subutilizado e muito lucrativo',
    }
  }

  return {
    riskLevel: 'healthy' as const,
    riskLabel: 'Uso saudavel do plano',
  }
}

function isActiveSubscriber(customer: CustomerBaseRow) {
  return (
    customer.type === 'SUBSCRIPTION'
    && customer.subscriptionStatus !== 'CANCELLED'
    && customer.subscriptionStatus !== 'PAUSED'
  )
}

function countBillableMonths(periodStart: Date, periodEnd: Date, subscriptionStartedAt: Date | null) {
  const effectiveStart = subscriptionStartedAt && subscriptionStartedAt > periodStart
    ? subscriptionStartedAt
    : periodStart

  if (effectiveStart > periodEnd) {
    return 0
  }

  const startMonthIndex = effectiveStart.getUTCFullYear() * 12 + effectiveStart.getUTCMonth()
  const endMonthIndex = periodEnd.getUTCFullYear() * 12 + periodEnd.getUTCMonth()

  return Math.max(0, endMonthIndex - startMonthIndex + 1)
}

export function buildCustomerIntelligenceContext(
  params: BuildCustomerIntelligenceParams
): CustomerIntelligenceContext {
  const serviceCostMap = new Map(
    params.services.map((service) => [
      service.id,
      {
        operationalCost: service.inputCost + service.commissionCost + service.directCost,
        monetizationCost: service.cardFee + service.tax,
      },
    ])
  )

  const allVisitsByCustomer = new Map<string, number>()

  params.appointments.forEach((appointment) => {
    allVisitsByCustomer.set(
      appointment.customerId,
      (allVisitsByCustomer.get(appointment.customerId) ?? 0) + 1
    )
  })

  const filteredAppointments = params.filters.professionalId
    ? params.appointments.filter((appointment) => appointment.professionalId === params.filters.professionalId)
    : params.appointments

  const filteredVisitsByCustomer = new Map<string, number>()

  filteredAppointments.forEach((appointment) => {
    filteredVisitsByCustomer.set(
      appointment.customerId,
      (filteredVisitsByCustomer.get(appointment.customerId) ?? 0) + 1
    )
  })

  const aggregateMap = new Map<string, MutableCustomerAggregate>(
    params.customers.map((customer) => [
      customer.id,
      {
        customer,
        visits: 0,
        includedVisits: 0,
        extraVisits: 0,
        directSubscriptionRevenue: 0,
        directServiceRevenue: 0,
        directOtherRevenue: 0,
        fallbackServiceRevenue: 0,
        estimatedCost: 0,
        publicValueConsumed: 0,
        lastVisitAt: null,
        professionalNames: new Set<string>(),
      },
    ])
  )

  filteredAppointments.forEach((appointment) => {
    const aggregate = aggregateMap.get(appointment.customerId)
    if (!aggregate) return

    const serviceCost = serviceCostMap.get(appointment.serviceId)
    const appointmentCost = (serviceCost?.operationalCost ?? 0)
      + (appointment.billingModel === 'SUBSCRIPTION_INCLUDED' ? 0 : (serviceCost?.monetizationCost ?? 0))

    aggregate.visits += 1
    aggregate.publicValueConsumed += appointment.priceSnapshot
    aggregate.estimatedCost += appointmentCost
    aggregate.professionalNames.add(appointment.professionalName)
    aggregate.lastVisitAt = aggregate.lastVisitAt && aggregate.lastVisitAt > appointment.startAt
      ? aggregate.lastVisitAt
      : appointment.startAt

    if (appointment.billingModel === 'SUBSCRIPTION_INCLUDED') {
      aggregate.includedVisits += 1
    } else {
      aggregate.fallbackServiceRevenue += appointment.priceSnapshot
    }

    if (appointment.billingModel === 'SUBSCRIPTION_EXTRA') {
      aggregate.extraVisits += 1
    }
  })

  params.revenues.forEach((revenue) => {
    const aggregate = aggregateMap.get(revenue.customerId)
    if (!aggregate) return

    let allocatedAmount = revenue.amount

    if (params.filters.professionalId) {
      if (revenue.professionalId === params.filters.professionalId) {
        allocatedAmount = revenue.amount
      } else if (revenue.professionalId) {
        allocatedAmount = 0
      } else {
        const totalVisits = allVisitsByCustomer.get(revenue.customerId) ?? 0
        const filteredVisits = filteredVisitsByCustomer.get(revenue.customerId) ?? 0
        allocatedAmount = totalVisits > 0 ? revenue.amount * (filteredVisits / totalVisits) : 0
      }
    }

    if (allocatedAmount <= 0) return

    if (revenue.origin === 'SUBSCRIPTION') {
      aggregate.directSubscriptionRevenue += allocatedAmount
      return
    }

    if (revenue.origin === 'SERVICE') {
      aggregate.directServiceRevenue += allocatedAmount
      return
    }

    aggregate.directOtherRevenue += allocatedAmount
  })

  const customerSnapshots = Array.from(aggregateMap.values())
    .map((aggregate) => {
      const customer = aggregate.customer
      const totalVisits = allVisitsByCustomer.get(customer.id) ?? 0
      const visibleVisits = filteredVisitsByCustomer.get(customer.id) ?? 0
      const visitShare = totalVisits > 0 ? visibleVisits / totalVisits : 0
      const billableMonths = countBillableMonths(
        params.periodStart,
        params.periodEnd,
        customer.subscriptionStartedAt
      )
      const fallbackSubscriptionRevenue = isActiveSubscriber(customer)
        ? roundCurrency(
            (customer.subscriptionPrice ?? 199.9)
            * billableMonths
            * (params.filters.professionalId ? visitShare : 1)
          )
        : 0
      const directSubscriptionRevenue = roundCurrency(aggregate.directSubscriptionRevenue)
      const estimatedSubscriptionRevenue = aggregate.directSubscriptionRevenue > 0 ? 0 : fallbackSubscriptionRevenue
      const directServiceRevenue = roundCurrency(aggregate.directServiceRevenue + aggregate.directOtherRevenue)
      const estimatedServiceRevenue = aggregate.directServiceRevenue > 0
        ? 0
        : roundCurrency(aggregate.fallbackServiceRevenue)
      const subscriptionRevenue = roundCurrency(directSubscriptionRevenue + estimatedSubscriptionRevenue)
      const serviceRevenue = roundCurrency(directServiceRevenue + estimatedServiceRevenue)
      const realRevenue = roundCurrency(directSubscriptionRevenue + directServiceRevenue)
      const estimatedRevenue = roundCurrency(estimatedSubscriptionRevenue + estimatedServiceRevenue)
      const totalRevenue = roundCurrency(realRevenue + estimatedRevenue)
      const estimatedCost = roundCurrency(aggregate.estimatedCost)
      const margin = roundCurrency(totalRevenue - estimatedCost)
      const revenueConfidence = resolveRevenueConfidence(realRevenue, estimatedRevenue)
      const usageVsFeePercent = subscriptionRevenue > 0
        ? (aggregate.publicValueConsumed / subscriptionRevenue) * 100
        : null
      const costVsFeePercent = subscriptionRevenue > 0
        ? (estimatedCost / subscriptionRevenue) * 100
        : null
      const risk = resolveRisk({
        type: customer.type,
        visits: aggregate.visits,
        margin,
        costVsFeePercent,
      })

      return {
        id: customer.id,
        name: customer.name,
        type: customer.type,
        visits: aggregate.visits,
        includedVisits: aggregate.includedVisits,
        extraVisits: aggregate.extraVisits,
        totalRevenue,
        realRevenue,
        estimatedRevenue,
        subscriptionRevenue,
        directSubscriptionRevenue,
        estimatedSubscriptionRevenue,
        serviceRevenue,
        directServiceRevenue,
        estimatedServiceRevenue,
        estimatedCost,
        margin,
        marginPercent: totalRevenue > 0 ? (margin / totalRevenue) * 100 : 0,
        revenuePerVisit: aggregate.visits > 0 ? totalRevenue / aggregate.visits : totalRevenue,
        costPerVisit: aggregate.visits > 0 ? estimatedCost / aggregate.visits : 0,
        publicValueConsumed: roundCurrency(aggregate.publicValueConsumed),
        usageVsFeePercent,
        costVsFeePercent,
        subscriptionPrice: customer.subscriptionPrice,
        lastVisitAt: aggregate.lastVisitAt ? aggregate.lastVisitAt.toISOString() : null,
        revenueConfidence: revenueConfidence.level,
        revenueConfidenceLabel: revenueConfidence.label,
        riskLevel: risk.riskLevel,
        riskLabel: risk.riskLabel,
        professionalNames: Array.from(aggregate.professionalNames).sort((left, right) => left.localeCompare(right)),
      } satisfies CustomerIntelligenceCustomerSnapshot
    })
    .filter((customer) => {
      const hasActivity = customer.visits > 0 || customer.totalRevenue > 0
      if (hasActivity) return true
      return !params.filters.professionalId && customer.type === 'SUBSCRIPTION'
    })

  const activeCustomers = customerSnapshots.length
  const subscriptionCustomers = customerSnapshots.filter((customer) => customer.type === 'SUBSCRIPTION')
  const walkInCustomers = customerSnapshots.filter((customer) => customer.type === 'WALK_IN')
  const visibleCustomers = params.filters.customerType === 'subscription'
    ? subscriptionCustomers
    : params.filters.customerType === 'walk_in'
      ? walkInCustomers
      : customerSnapshots

  const rankings = {
    mostProfitable: [...visibleCustomers].sort(sortByMarginDesc).slice(0, 5),
    leastProfitable: [...visibleCustomers].sort(sortByMarginAsc).slice(0, 5),
    mostFrequent: [...visibleCustomers].sort(sortByFrequency).slice(0, 5),
    atRiskSubscribers: [...subscriptionCustomers]
      .filter((customer) => customer.riskLevel === 'warning' || customer.riskLevel === 'loss')
      .sort(sortByMarginAsc)
      .slice(0, 5),
    lossSubscribers: [...subscriptionCustomers]
      .filter((customer) => customer.riskLevel === 'loss')
      .sort(sortByMarginAsc)
      .slice(0, 5),
    underusedSubscribers: [...subscriptionCustomers]
      .filter((customer) => customer.riskLevel === 'underused')
      .sort(sortByMarginDesc)
      .slice(0, 5),
    profitableSubscribers: [...subscriptionCustomers]
      .filter((customer) => customer.riskLevel === 'healthy' || customer.riskLevel === 'underused')
      .sort(sortByMarginDesc)
      .slice(0, 5),
    valuableWalkIns: [...walkInCustomers]
      .sort((left, right) => (right.totalRevenue - left.totalRevenue) || sortByMarginDesc(left, right))
      .slice(0, 5),
  }

  const subscriptionGroup = buildGroupSnapshot(subscriptionCustomers, 'SUBSCRIPTION', 'Assinatura')
  const walkInGroup = buildGroupSnapshot(walkInCustomers, 'WALK_IN', 'Avulso')
  const totalGroupedRevenue = subscriptionGroup.totalRevenue + walkInGroup.totalRevenue
  const totalGroupedVisits = subscriptionGroup.visits + walkInGroup.visits
  subscriptionGroup.revenueSharePercent = totalGroupedRevenue > 0
    ? (subscriptionGroup.totalRevenue / totalGroupedRevenue) * 100
    : 0
  walkInGroup.revenueSharePercent = totalGroupedRevenue > 0
    ? (walkInGroup.totalRevenue / totalGroupedRevenue) * 100
    : 0
  subscriptionGroup.operationalSharePercent = totalGroupedVisits > 0
    ? (subscriptionGroup.visits / totalGroupedVisits) * 100
    : 0
  walkInGroup.operationalSharePercent = totalGroupedVisits > 0
    ? (walkInGroup.visits / totalGroupedVisits) * 100
    : 0
  const riskySubscriberIds = new Set(
    subscriptionCustomers
      .filter((customer) => customer.riskLevel === 'warning' || customer.riskLevel === 'loss')
      .map((customer) => customer.id)
  )
  const riskProfessionalMap = new Map<string, number>()
  const riskServiceMap = new Map<string, number>()

  filteredAppointments.forEach((appointment) => {
    if (!riskySubscriberIds.has(appointment.customerId)) return

    riskProfessionalMap.set(
      appointment.professionalName,
      (riskProfessionalMap.get(appointment.professionalName) ?? 0) + 1
    )
    riskServiceMap.set(
      appointment.serviceName,
      (riskServiceMap.get(appointment.serviceName) ?? 0) + 1
    )
  })

  const topRiskProfessionalName = Array.from(riskProfessionalMap.entries())
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
  const topRiskServiceName = Array.from(riskServiceMap.entries())
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
  const subscriptionPriceReference = subscriptionCustomers.length > 0
    ? subscriptionCustomers.reduce((sum, customer) => sum + (customer.subscriptionPrice ?? 199.9), 0) / subscriptionCustomers.length
    : 199.9
  const subscriptionCostCoverage = subscriptionGroup.totalRevenue > 0
    ? (subscriptionGroup.totalCost / subscriptionGroup.totalRevenue) * 100
    : null
  const visibleSummary = visibleCustomers.reduce(
    (accumulator, customer) => {
      accumulator.visits += customer.visits
      accumulator.totalRevenue += customer.totalRevenue
      accumulator.realRevenue += customer.realRevenue
      accumulator.estimatedRevenue += customer.estimatedRevenue
      accumulator.totalCost += customer.estimatedCost
      accumulator.totalMargin += customer.margin
      accumulator.profitableCustomers += customer.margin > 0 ? 1 : 0
      accumulator.lossCustomers += customer.margin < 0 ? 1 : 0
      return accumulator
    },
    {
      visits: 0,
      totalRevenue: 0,
      realRevenue: 0,
      estimatedRevenue: 0,
      totalCost: 0,
      totalMargin: 0,
      profitableCustomers: 0,
      lossCustomers: 0,
    }
  )

  return {
    filters: params.filters,
    summary: {
      activeCustomers,
      visibleCustomers: visibleCustomers.length,
      visits: visibleSummary.visits,
      totalRevenue: roundCurrency(visibleSummary.totalRevenue),
      realRevenue: roundCurrency(visibleSummary.realRevenue),
      estimatedRevenue: roundCurrency(visibleSummary.estimatedRevenue),
      totalCost: roundCurrency(visibleSummary.totalCost),
      totalMargin: roundCurrency(visibleSummary.totalMargin),
      averageTicket: visibleSummary.visits > 0 ? visibleSummary.totalRevenue / visibleSummary.visits : 0,
      averageVisitsPerCustomer: visibleCustomers.length > 0 ? visibleSummary.visits / visibleCustomers.length : 0,
      profitableCustomers: visibleSummary.profitableCustomers,
      lossCustomers: visibleSummary.lossCustomers,
    },
    methodology: {
      realRevenueDefinition: 'Receita real usa apenas lancamentos financeiros vinculados ao cliente no periodo.',
      estimatedRevenueDefinition: 'Receita estimada usa mensalidade do assinante quando nao existe lancamento de assinatura e usa valor do atendimento cobrado quando nao ha receita vinculada.',
      costDefinition: 'Custo estimado considera insumos, comissao e custo direto do servico; taxas de cartao e imposto entram apenas quando a cobranca e direta.',
      marginDefinition: 'Margem estimada = receita total (real + estimada) menos custo estimado do atendimento.',
      caution: 'Quando a base financeira nao traz a mensalidade ou o cliente da receita, a analise assume estimativa conservadora e sinaliza isso na interface.',
    },
    groups: {
      subscription: subscriptionGroup,
      walkIn: walkInGroup,
    },
    plan: {
      enabled: subscriptionCustomers.length > 0,
      monthlyPriceReference: roundCurrency(subscriptionPriceReference),
      activeMembers: subscriptionCustomers.length,
      activeMembersWithVisits: subscriptionCustomers.filter((customer) => customer.visits > 0).length,
      totalRevenue: subscriptionGroup.totalRevenue,
      realRevenue: subscriptionGroup.realRevenue,
      estimatedRevenue: subscriptionGroup.estimatedRevenue,
      totalCost: subscriptionGroup.totalCost,
      margin: subscriptionGroup.margin,
      marginPercent: subscriptionGroup.marginPercent,
      revenueSharePercent: subscriptionGroup.revenueSharePercent,
      operationalSharePercent: subscriptionGroup.operationalSharePercent,
      averageVisitsPerMember: subscriptionGroup.customers > 0
        ? subscriptionGroup.visits / subscriptionGroup.customers
        : 0,
      averagePublicValueConsumed: subscriptionCustomers.length > 0
        ? subscriptionCustomers.reduce((sum, customer) => sum + customer.publicValueConsumed, 0) / subscriptionCustomers.length
        : 0,
      averageCostCoverage: subscriptionCostCoverage,
      riskCount: subscriptionCustomers.filter((customer) => customer.riskLevel === 'warning').length,
      lossCount: subscriptionCustomers.filter((customer) => customer.riskLevel === 'loss').length,
      underusedCount: subscriptionCustomers.filter((customer) => customer.riskLevel === 'underused').length,
      healthyCount: subscriptionCustomers.filter((customer) => customer.riskLevel === 'healthy').length,
      topRiskProfessionalName,
      topRiskServiceName,
    },
    rankings,
    table: [...visibleCustomers].sort(sortByMarginDesc),
  }
}
