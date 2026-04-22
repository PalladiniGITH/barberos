import type { CustomerIntelligenceContext } from '@/lib/business-insights'

export interface BarbershopHealthSnapshot {
  activeSubscribers: number
  subscribersWithVisits: number
  subscriberReturnRate: number
  averageVisitsPerSubscriber: number
  walkInCustomers: number
  returningWalkInCustomers: number
  walkInReturnRate: number
  averageVisitsPerWalkIn: number
  subscriptionMarginPercent: number
  riskSubscriberPercent: number
  healthScore: number
  healthStatus: 'healthy' | 'attention' | 'cooling'
  healthLabel: string
  summary: string
  methodology: {
    subscriberReturnRate: string
    walkInReturnRate: string
    healthScore: string
  }
}

function toPercent(current: number, total: number) {
  if (total <= 0) {
    return 0
  }

  return (current / total) * 100
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function buildBarbershopHealthSnapshot(
  customers: CustomerIntelligenceContext
): BarbershopHealthSnapshot {
  const activeSubscribers = customers.plan.activeMembers
  const subscribersWithVisits = customers.plan.activeMembersWithVisits
  const subscriberReturnRate = toPercent(subscribersWithVisits, activeSubscribers)
  const averageVisitsPerSubscriber = customers.plan.averageVisitsPerMember

  const walkInCustomers = customers.groups.walkIn.customers
  const returningWalkInCustomers = customers.table.filter((customer) =>
    customer.type === 'WALK_IN' && customer.visits >= 2
  ).length
  const walkInReturnRate = toPercent(returningWalkInCustomers, walkInCustomers)
  const averageVisitsPerWalkIn = customers.groups.walkIn.averageVisitsPerCustomer

  const riskSubscriberPercent = toPercent(
    customers.plan.riskCount + customers.plan.lossCount,
    activeSubscribers
  )

  const engagementScore = subscriberReturnRate * 0.45
  const frequencyScore = clamp((averageVisitsPerSubscriber / 2) * 100, 0, 100) * 0.25
  const walkInScore = walkInReturnRate * 0.15
  const marginScore = clamp(customers.plan.marginPercent, 0, 100) * 0.1
  const stabilityScore = clamp(100 - riskSubscriberPercent, 0, 100) * 0.05
  const healthScore = engagementScore + frequencyScore + walkInScore + marginScore + stabilityScore

  const healthStatus = healthScore >= 72 && customers.plan.lossCount === 0
    ? 'healthy'
    : healthScore >= 55
      ? 'attention'
      : 'cooling'

  const healthLabel = healthStatus === 'healthy'
    ? 'Base saudavel'
    : healthStatus === 'attention'
      ? 'Base pedindo atencao'
      : 'Base esfriando'

  const summary = healthStatus === 'healthy'
    ? 'Os assinantes estao retornando bem e a base continua gerando recorrencia com margem.'
    : healthStatus === 'attention'
      ? 'Existe recorrencia, mas o engajamento ou a margem ja pedem ajuste de oferta, plano ou relacionamento.'
      : 'A recorrencia da base caiu demais ou a assinatura esta consumindo margem acima do ideal.'

  return {
    activeSubscribers,
    subscribersWithVisits,
    subscriberReturnRate,
    averageVisitsPerSubscriber,
    walkInCustomers,
    returningWalkInCustomers,
    walkInReturnRate,
    averageVisitsPerWalkIn,
    subscriptionMarginPercent: customers.plan.marginPercent,
    riskSubscriberPercent,
    healthScore,
    healthStatus,
    healthLabel,
    summary,
    methodology: {
      subscriberReturnRate: 'Assinantes com ao menos 1 visita no periodo / total de assinantes ativos no periodo.',
      walkInReturnRate: 'Clientes avulsos com 2 ou mais visitas no periodo / total de clientes avulsos visiveis no periodo.',
      healthScore: 'Score pondera retorno dos assinantes, frequencia media, retorno dos avulsos, margem da assinatura e percentual de assinantes em risco.',
    },
  }
}
