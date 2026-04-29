import { formatCurrency, formatPercent } from '@/lib/utils'

export const BUSINESS_INSIGHT_TYPES = [
  'profit',
  'expense',
  'goal',
  'ticket',
  'professional',
  'service_margin',
  'customer_margin',
  'subscription_health',
  'customer_frequency',
  'trend',
  'opportunity',
  'cash',
] as const

export const BUSINESS_INSIGHT_SEVERITIES = [
  'critical',
  'warning',
  'opportunity',
  'positive',
] as const

export const BUSINESS_INSIGHT_HREFS = [
  '/financeiro',
  '/financeiro/receitas',
  '/financeiro/despesas',
  '/financeiro/categorias',
  '/financeiro/fluxo-caixa',
  '/equipe',
  '/equipe/profissionais',
  '/equipe/metas',
  '/equipe/desempenho',
  '/precificacao',
  '/precificacao/servicos',
  '/precificacao/insumos',
  '/precificacao/resultado',
  '/indicadores',
  '/inteligencia',
  '/clientes',
] as const

export type BusinessInsightType = (typeof BUSINESS_INSIGHT_TYPES)[number]
export type BusinessInsightSeverity = (typeof BUSINESS_INSIGHT_SEVERITIES)[number]
export type BusinessInsightHref = (typeof BUSINESS_INSIGHT_HREFS)[number]

export type BusinessInsightMode = 'deterministic' | 'ai'

export interface BusinessInsight {
  id: string
  type: BusinessInsightType
  severity: BusinessInsightSeverity
  title: string
  explanation: string
  recommendedAction: string
  href: BusinessInsightHref
  priority: number
  metric?: {
    label: string
    value: string
  }
}

export interface BusinessInsightPeriod {
  month: number
  year: number
  label: string
  comparisonMonth: number
  comparisonYear: number
  comparisonLabel: string
  partialComparison: boolean
  isCurrentPeriod: boolean
  daysInMonth: number
  elapsedDays: number
  remainingDays: number
}

export interface BusinessInsightFinancialSnapshot {
  totalRevenue: number
  previousRevenue: number
  totalExpense: number
  previousExpense: number
  profit: number
  previousProfit: number
  totalAppointments: number
  previousAppointments: number
  ticketAverage: number
  previousTicketAverage: number
  revenueChange: number | null
  expenseChange: number | null
  profitChange: number | null
  ticketChange: number | null
  profitMargin: number
  previousProfitMargin: number
  expenseRate: number
  previousExpenseRate: number
  expenseRateChange: number | null
}

export interface BusinessInsightGoalSnapshot {
  revenueGoal: number
  revenueMin: number
  expenseLimit: number
  goalAttainment: number
  expectedProgress: number
  remainingToGoal: number
  requiredDailyRevenue: number
  expenseLimitUsage: number
  ticketReference: number
}

export interface BusinessInsightProfessionalSnapshot {
  id: string
  name: string
  avatar: string | null
  active: boolean
  revenue: number
  previousRevenue: number
  revenueChange: number | null
  appointments: number
  ticketAverage: number
  goalValue: number
  goalMin: number
  progress: number
}

export interface BusinessInsightServiceSnapshot {
  id: string
  name: string
  active: boolean
  price: number
  duration: number
  revenue: number
  appointments: number
  inputCost: number
  commissionCost: number
  cardFee: number
  tax: number
  directCost: number
  totalCost: number
  margin: number
  marginPercent: number
}

export interface BusinessInsightTrendPoint {
  label: string
  revenue: number
  expense: number
  profit: number
}

export type CustomerTypeFilter = 'all' | 'subscription' | 'walk_in'

export interface CustomerIntelligenceFilters {
  professionalId: string | null
  customerType: CustomerTypeFilter
}

export interface CustomerIntelligenceCustomerSnapshot {
  id: string
  name: string
  type: 'SUBSCRIPTION' | 'WALK_IN'
  visits: number
  includedVisits: number
  extraVisits: number
  totalRevenue: number
  realRevenue: number
  estimatedRevenue: number
  subscriptionRevenue: number
  directSubscriptionRevenue: number
  estimatedSubscriptionRevenue: number
  serviceRevenue: number
  directServiceRevenue: number
  estimatedServiceRevenue: number
  estimatedCost: number
  margin: number
  marginPercent: number
  revenuePerVisit: number
  costPerVisit: number
  publicValueConsumed: number
  usageVsFeePercent: number | null
  costVsFeePercent: number | null
  subscriptionPrice: number | null
  lastVisitAt: string | null
  revenueConfidence: 'real' | 'mixed' | 'estimated'
  revenueConfidenceLabel: string
  riskLevel: 'healthy' | 'warning' | 'loss' | 'underused' | 'neutral'
  riskLabel: string
  professionalNames: string[]
}

export interface CustomerIntelligenceGroupSnapshot {
  type: 'SUBSCRIPTION' | 'WALK_IN'
  label: string
  customers: number
  visits: number
  totalRevenue: number
  realRevenue: number
  estimatedRevenue: number
  totalCost: number
  margin: number
  marginPercent: number
  revenueSharePercent: number
  operationalSharePercent: number
  averageTicket: number
  averageVisitsPerCustomer: number
  averageRevenuePerVisit: number
  averageMarginPerCustomer: number
  averageCostPerVisit: number
}

export interface SubscriptionPlanHealthSnapshot {
  enabled: boolean
  monthlyPriceReference: number
  activeMembers: number
  activeMembersWithVisits: number
  totalRevenue: number
  realRevenue: number
  estimatedRevenue: number
  totalCost: number
  margin: number
  marginPercent: number
  revenueSharePercent: number
  operationalSharePercent: number
  averageVisitsPerMember: number
  averagePublicValueConsumed: number
  averageCostCoverage: number | null
  riskCount: number
  lossCount: number
  underusedCount: number
  healthyCount: number
  topRiskProfessionalName: string | null
  topRiskServiceName: string | null
}

export interface CustomerIntelligenceSummary {
  activeCustomers: number
  visibleCustomers: number
  visits: number
  totalRevenue: number
  realRevenue: number
  estimatedRevenue: number
  totalCost: number
  totalMargin: number
  averageTicket: number
  averageVisitsPerCustomer: number
  profitableCustomers: number
  lossCustomers: number
}

export interface CustomerIntelligenceMethodology {
  realRevenueDefinition: string
  estimatedRevenueDefinition: string
  costDefinition: string
  marginDefinition: string
  caution: string
}

export interface CustomerIntelligenceContext {
  filters: CustomerIntelligenceFilters
  summary: CustomerIntelligenceSummary
  methodology: CustomerIntelligenceMethodology
  groups: {
    subscription: CustomerIntelligenceGroupSnapshot
    walkIn: CustomerIntelligenceGroupSnapshot
  }
  plan: SubscriptionPlanHealthSnapshot
  rankings: {
    mostProfitable: CustomerIntelligenceCustomerSnapshot[]
    leastProfitable: CustomerIntelligenceCustomerSnapshot[]
    mostFrequent: CustomerIntelligenceCustomerSnapshot[]
    atRiskSubscribers: CustomerIntelligenceCustomerSnapshot[]
    lossSubscribers: CustomerIntelligenceCustomerSnapshot[]
    underusedSubscribers: CustomerIntelligenceCustomerSnapshot[]
    profitableSubscribers: CustomerIntelligenceCustomerSnapshot[]
    valuableWalkIns: CustomerIntelligenceCustomerSnapshot[]
  }
  table: CustomerIntelligenceCustomerSnapshot[]
}

export interface BusinessInsightsContext {
  period: BusinessInsightPeriod
  financial: BusinessInsightFinancialSnapshot
  goals: BusinessInsightGoalSnapshot
  overdueExpenses: {
    count: number
    amount: number
  }
  professionals: BusinessInsightProfessionalSnapshot[]
  services: BusinessInsightServiceSnapshot[]
  trend: BusinessInsightTrendPoint[]
  benchmarks: {
    averageServicePrice: number
    averageMarginPercent: number
    idealMarginPercent: number
  }
  customers: CustomerIntelligenceContext
}

export interface BusinessInsightSummary {
  headline: string
  body: string
  focus: string
}

export interface BusinessIntelligenceRuntimeState {
  userModeLabel: string
  periodLabel?: string
  updatedAtLabel?: string
  nextRefreshLabel?: string
  statusNote?: string
}

export interface BusinessIntelligenceReport {
  mode: BusinessInsightMode
  runtime: BusinessIntelligenceRuntimeState
  summary: BusinessInsightSummary
  insights: BusinessInsight[]
  prioritized: BusinessInsight[]
  alerts: BusinessInsight[]
  opportunities: BusinessInsight[]
  context: BusinessInsightsContext
}

function calculateGapPercent(current: number, reference: number) {
  if (reference <= 0) return null
  return ((current - reference) / reference) * 100
}

function severityWeight(severity: BusinessInsightSeverity) {
  switch (severity) {
    case 'critical':
      return 400
    case 'warning':
      return 300
    case 'opportunity':
      return 200
    case 'positive':
    default:
      return 100
  }
}

function buildStableInsight(context: BusinessInsightsContext): BusinessInsight {
  return {
    id: 'stable-operation',
    type: 'opportunity',
    severity: 'positive',
    title: 'A operação está estável neste período',
    explanation: `${context.period.label} está com receita, custo e ritmo sob controle. Isso dá espaço para subir ticket e margem com mais calma.`,
    recommendedAction: 'Mantenha a disciplina do caixa e use a semana para empurrar serviços premium ou combos.',
    href: '/indicadores',
    priority: 45,
    metric: {
      label: 'Lucro estimado',
      value: formatCurrency(context.financial.profit),
    },
  }
}

function buildSummary(context: BusinessInsightsContext, prioritized: BusinessInsight[]): BusinessInsightSummary {
  const goalCopy = context.goals.revenueGoal > 0
    ? `${formatPercent(context.goals.goalAttainment, 0)} da meta`
    : 'sem meta configurada'
  const topInsight = prioritized[0]

  if (context.financial.totalRevenue <= 0) {
    return {
      headline: 'Ainda faltam dados para uma leitura forte do mês',
      body: 'Sem receitas registradas, a inteligência consegue apontar riscos estruturais, mas ainda não lê o negócio com profundidade.',
      focus: 'Comece registrando receitas e despesas para transformar a análise em direção prática.',
    }
  }

  if (!topInsight) {
    return {
      headline: `Leitura automática de ${context.period.label}`,
      body: `${formatCurrency(context.financial.totalRevenue)} de faturamento, ${formatCurrency(context.financial.profit)} de lucro estimado e ${goalCopy}.`,
      focus: 'Mantenha o ritmo e use a análise completa para proteger margem, time e meta.',
    }
  }

  return {
    headline: topInsight.title,
    body: `${formatCurrency(context.financial.totalRevenue)} de faturamento, ${formatCurrency(context.financial.profit)} de lucro estimado e ${goalCopy}. ${topInsight.explanation}`,
    focus: topInsight.recommendedAction,
  }
}

export function buildDeterministicBusinessReport(context: BusinessInsightsContext): BusinessIntelligenceReport {
  const insights: BusinessInsight[] = []
  const { financial, goals, overdueExpenses, professionals, services, trend, benchmarks, period } = context
  const customerContext = context.customers

  const activeProfessionals = professionals.filter((professional) => professional.active)
  const professionalsBelowMin = activeProfessionals.filter(
    (professional) => professional.goalMin > 0 && professional.revenue < professional.goalMin
  )
  const professionalsOffPace = activeProfessionals.filter(
    (professional) => professional.goalValue > 0 && professional.progress + 8 < goals.expectedProgress
  )
  const impactedProfessionalMap = new Map(
    [...professionalsBelowMin, ...professionalsOffPace].map((professional) => [professional.id, professional])
  )

  const lowMarginServices = services
    .filter((service) => service.active && service.marginPercent > 0 && service.marginPercent < benchmarks.idealMarginPercent)
    .sort((left, right) => (left.marginPercent - right.marginPercent) || (right.revenue - left.revenue))

  const highMarginOpportunities = services
    .filter(
      (service) =>
        service.active &&
        service.marginPercent >= Math.max(benchmarks.averageMarginPercent + 5, 30) &&
        service.appointments <= 2
    )
    .sort((left, right) => right.marginPercent - left.marginPercent)

  const ticketGapPercent = calculateGapPercent(financial.ticketAverage, goals.ticketReference)
  const latestTrend = trend.slice(-3)
  const isProfitFallingForThreeMonths = latestTrend.length >= 3
    && latestTrend[2].profit < latestTrend[1].profit
    && latestTrend[1].profit < latestTrend[0].profit
  const negativeProfitMonths = trend.filter((item) => item.profit < 0).length
  const highestRevenueProfessional = [...activeProfessionals].sort((left, right) => right.revenue - left.revenue)[0]
  const subscriptionGroup = customerContext.groups.subscription
  const walkInGroup = customerContext.groups.walkIn
  const topAtRiskSubscriber = customerContext.rankings.atRiskSubscribers[0]
  const topUnderusedSubscriber = customerContext.rankings.profitableSubscribers.find(
    (customer) => customer.riskLevel === 'underused'
  )
  const topProfitableCustomer = customerContext.rankings.mostProfitable[0]
  const leastProfitableCustomer = customerContext.rankings.leastProfitable[0]

  if (financial.totalRevenue <= 0) {
    insights.push({
      id: 'no-revenue',
      type: 'cash',
      severity: 'critical',
      title: 'Ainda não há faturamento suficiente para ler o mês',
      explanation: 'Sem receitas lançadas, lucro, ticket e meta ficam distorcidos e o dono perde referência do que está acontecendo.',
      recommendedAction: 'Registre as entradas do período para ativar a leitura automática do negócio.',
      href: '/financeiro/receitas',
      priority: 98,
      metric: {
        label: 'Receitas lançadas',
        value: formatCurrency(financial.totalRevenue),
      },
    })
  }

  if (overdueExpenses.count > 0) {
    insights.push({
      id: 'overdue-expenses',
      type: 'expense',
      severity: 'critical',
      title: `${overdueExpenses.count} despesa${overdueExpenses.count > 1 ? 's' : ''} está${overdueExpenses.count > 1 ? 'o' : ''} em aberto`,
      explanation: `${formatCurrency(overdueExpenses.amount)} ainda não foi regularizado no período. Isso pressiona o caixa e atrapalha a leitura real do lucro.`,
      recommendedAction: 'Revise as contas em aberto e priorize o que precisa ser pago ou renegociado primeiro.',
      href: '/financeiro/despesas',
      priority: 94,
      metric: {
        label: 'Valor pendente',
        value: formatCurrency(overdueExpenses.amount),
      },
    })
  }

  if (financial.profit < 0 || (financial.profitChange !== null && financial.profitChange <= -12)) {
    insights.push({
      id: 'profit-pressure',
      type: 'profit',
      severity: financial.profit < 0 ? 'critical' : 'warning',
      title: financial.profit < 0 ? 'O mês está operando com lucro negativo' : 'O lucro caiu forte contra o período anterior',
      explanation: `${formatCurrency(financial.profit)} de lucro estimado em ${period.label}. Quando o lucro cai mais rápido que o faturamento, a barbearia trabalha mais e sobra menos caixa.`,
      recommendedAction: 'Revise custos do mês e puxe primeiro os serviços com melhor margem para recuperar folga no caixa.',
      href: '/financeiro',
      priority: financial.profit < 0 ? 93 : 86,
      metric: {
        label: 'Variação do lucro',
        value: financial.profitChange === null ? 'Sem base' : formatPercent(financial.profitChange, 0),
      },
    })
  }

  if (
    financial.expenseChange !== null
    && financial.expenseChange >= 10
    && (financial.revenueChange === null || financial.expenseChange > financial.revenueChange + 6)
  ) {
    insights.push({
      id: 'expense-growth',
      type: 'expense',
      severity: financial.expenseChange >= 20 ? 'critical' : 'warning',
      title: 'As despesas cresceram mais rápido que a receita',
      explanation: `${formatCurrency(financial.totalExpense)} saiu do caixa em ${period.label}, com alta de ${formatPercent(financial.expenseChange, 0)}. Esse descompasso comprime margem e dificulta bater meta com saúde.`,
      recommendedAction: 'Revise custos fixos, compras pontuais e tudo o que entrou acima do ritmo da receita.',
      href: '/financeiro/despesas',
      priority: 84,
      metric: {
        label: 'Despesa do mês',
        value: formatCurrency(financial.totalExpense),
      },
    })
  }

  if (goals.expenseLimit > 0 && goals.expenseLimitUsage >= 100) {
    insights.push({
      id: 'expense-limit-hit',
      type: 'expense',
      severity: 'critical',
      title: 'O teto de despesas já foi ultrapassado',
      explanation: `As despesas consumiram ${formatPercent(goals.expenseLimitUsage, 0)} do limite definido para o mês. Isso corrói a margem e aumenta o risco de fechar sem sobra.`,
      recommendedAction: 'Congele despesas não urgentes e renegocie o que for recorrente enquanto o mês ainda está em andamento.',
      href: '/financeiro/despesas',
      priority: 88,
      metric: {
        label: 'Teto usado',
        value: formatPercent(goals.expenseLimitUsage, 0),
      },
    })
  } else if (goals.expenseLimit > 0 && goals.expenseLimitUsage >= 85) {
    insights.push({
      id: 'expense-limit-warning',
      type: 'expense',
      severity: 'warning',
      title: 'O custo do mês está encostando no limite',
      explanation: `${formatPercent(goals.expenseLimitUsage, 0)} do teto já foi consumido. Se esse ritmo continuar, o caixa fecha mais apertado do que o planejado.`,
      recommendedAction: 'Segure novas saídas e concentre o esforço em receita e ticket até fechar o mês.',
      href: '/financeiro/despesas',
      priority: 78,
      metric: {
        label: 'Teto usado',
        value: formatPercent(goals.expenseLimitUsage, 0),
      },
    })
  }

  if (goals.revenueGoal > 0) {
    if (period.isCurrentPeriod && goals.goalAttainment + 8 < goals.expectedProgress && goals.remainingToGoal > 0) {
      insights.push({
        id: 'goal-off-pace',
        type: 'goal',
        severity: 'warning',
        title: 'A meta mensal está abaixo do ritmo ideal',
        explanation: `A barbearia alcançou ${formatPercent(goals.goalAttainment, 0)} da meta, quando o ritmo esperado para agora seria ${formatPercent(goals.expectedProgress, 0)}. Isso empurra pressão para os próximos dias.`,
        recommendedAction: `Faltam ${formatCurrency(goals.remainingToGoal)}. Suba o foco comercial para ${formatCurrency(goals.requiredDailyRevenue)} por dia até o fechamento.`,
        href: '/equipe/metas',
        priority: 82,
        metric: {
          label: 'Falta para a meta',
          value: formatCurrency(goals.remainingToGoal),
        },
      })
    } else if (!period.isCurrentPeriod && goals.goalAttainment < 100) {
      insights.push({
        id: 'goal-missed',
        type: 'goal',
        severity: 'warning',
        title: 'O período fechou abaixo da meta',
        explanation: `${period.label} encerrou com ${formatPercent(goals.goalAttainment, 0)} da meta principal. Quando a meta não fecha, fica mais fácil aceitar preço ruim e custo alto no mês seguinte.`,
        recommendedAction: 'Use esse fechamento para recalibrar meta, ticket e foco do time no próximo ciclo.',
        href: '/equipe/metas',
        priority: 74,
        metric: {
          label: 'Meta atingida',
          value: formatPercent(goals.goalAttainment, 0),
        },
      })
    }
  } else {
    insights.push({
      id: 'missing-goal',
      type: 'goal',
      severity: 'warning',
      title: 'Ainda não existe meta mensal configurada',
      explanation: 'Sem meta, o dono vê faturamento, mas não enxerga direção nem sabe se o ritmo do mês está saudável.',
      recommendedAction: 'Defina a meta principal, a meta mínima e o teto de despesas para dar contexto à operação.',
      href: '/equipe/metas',
      priority: 72,
      metric: {
        label: 'Meta atual',
        value: 'Sem meta',
      },
    })
  }

  if (ticketGapPercent !== null && ticketGapPercent <= -12 && financial.totalAppointments >= 8) {
    insights.push({
      id: 'ticket-below-reference',
      type: 'ticket',
      severity: 'warning',
      title: 'O ticket médio está abaixo da referência da operação',
      explanation: `${formatCurrency(financial.ticketAverage)} por atendimento, ${formatPercent(Math.abs(ticketGapPercent), 0)} abaixo da referência atual da barbearia. Isso reduz faturamento mesmo quando a agenda está rodando.`,
      recommendedAction: 'Teste combos, upgrades de barba e empurre os serviços premium para subir o valor por atendimento.',
      href: '/financeiro/receitas',
      priority: 76,
      metric: {
        label: 'Ticket médio',
        value: formatCurrency(financial.ticketAverage),
      },
    })
  }

  if (impactedProfessionalMap.size > 0) {
    const impactedProfessionals = Array.from(impactedProfessionalMap.values())
      .slice(0, 2)
      .map((professional) => professional.name)
      .join(', ')

    insights.push({
      id: 'team-below-goal',
      type: 'professional',
      severity: 'warning',
      title: `${impactedProfessionalMap.size} profissional${impactedProfessionalMap.size > 1 ? 's' : ''} está${impactedProfessionalMap.size > 1 ? 'o' : ''} puxando o mês para baixo`,
      explanation: `${impactedProfessionals || 'Parte da equipe'} está abaixo do ritmo esperado para a meta do período. Isso reduz a chance de fechar o mês com folga.`,
      recommendedAction: 'Acompanhe agenda, oferta de combo e conversão desses profissionais ainda esta semana.',
      href: '/equipe/desempenho',
      priority: 74,
      metric: {
        label: 'Equipe abaixo do ritmo',
        value: `${impactedProfessionalMap.size} profissional${impactedProfessionalMap.size > 1 ? 's' : ''}`,
      },
    })
  }

  if (lowMarginServices.length > 0) {
    const worstService = lowMarginServices[0]

    insights.push({
      id: `margin-${worstService.id}`,
      type: 'service_margin',
      severity: worstService.marginPercent < 15 ? 'warning' : 'opportunity',
      title: `${worstService.name} está com margem abaixo do ideal`,
      explanation: `${formatPercent(worstService.marginPercent, 0)} de margem estimada. Quando um serviço vende com sobra curta, ele ocupa agenda e deixa pouco dinheiro no caixa.`,
      recommendedAction: 'Reavalie preço, comissão ou custo dos insumos desse serviço antes de empurrar mais volume.',
      href: '/precificacao/servicos',
      priority: 70 + Math.min(12, worstService.appointments * 2),
      metric: {
        label: 'Margem estimada',
        value: formatPercent(worstService.marginPercent, 0),
      },
    })
  }

  if (isProfitFallingForThreeMonths || negativeProfitMonths >= 2) {
    insights.push({
      id: 'negative-trend',
      type: 'trend',
      severity: negativeProfitMonths >= 2 ? 'critical' : 'warning',
      title: 'A tendência recente do negócio merece atenção',
      explanation: isProfitFallingForThreeMonths
        ? 'Os últimos três meses mostram queda sequencial no lucro estimado. Quando a curva vira para baixo, o problema costuma aparecer no caixa logo depois.'
        : `${negativeProfitMonths} dos últimos ${trend.length} meses ficaram com lucro estimado negativo. Isso mostra instabilidade na operação.`,
      recommendedAction: 'Use os indicadores para revisar preço, despesa e ritmo comercial antes que a tendência se consolide.',
      href: '/indicadores',
      priority: 73,
      metric: {
        label: 'Meses pressionados',
        value: `${negativeProfitMonths}`,
      },
    })
  }

  if (financial.revenueChange !== null && financial.revenueChange >= 10 && financial.profitMargin >= 25) {
    insights.push({
      id: 'revenue-traction',
      type: 'opportunity',
      severity: 'opportunity',
      title: 'O mês ganhou tração com margem saudável',
      explanation: `${formatPercent(financial.revenueChange, 0)} de alta na receita com ${formatPercent(financial.profitMargin, 0)} de margem estimada. Esse é o melhor momento para vender serviço de maior valor.`,
      recommendedAction: 'Aproveite o ritmo para puxar combos, premium e recorrência sem depender só de volume.',
      href: '/precificacao/resultado',
      priority: 63,
      metric: {
        label: 'Crescimento da receita',
        value: formatPercent(financial.revenueChange, 0),
      },
    })
  }

  if (highMarginOpportunities.length > 0) {
    const opportunityService = highMarginOpportunities[0]
    insights.push({
      id: `opportunity-${opportunityService.id}`,
      type: 'opportunity',
      severity: 'opportunity',
      title: `${opportunityService.name} pode aumentar a margem do mês`,
      explanation: `${formatPercent(opportunityService.marginPercent, 0)} de margem estimada, mas com baixa participação na agenda atual. Isso mostra oportunidade de crescimento sem pressionar custo.`,
      recommendedAction: 'Traga esse serviço para combo, upgrade ou abordagem no balcão para aumentar faturamento com sobra melhor.',
      href: '/precificacao/resultado',
      priority: 60,
      metric: {
        label: 'Margem do serviço',
        value: formatPercent(opportunityService.marginPercent, 0),
      },
    })
  }

  if (highestRevenueProfessional && highestRevenueProfessional.goalValue > 0 && highestRevenueProfessional.progress >= 90) {
    insights.push({
      id: `leader-${highestRevenueProfessional.id}`,
      type: 'professional',
      severity: 'positive',
      title: `${highestRevenueProfessional.name} pode puxar o fechamento do mês`,
      explanation: `${formatCurrency(highestRevenueProfessional.revenue)} já foi gerado por esse profissional, com ${formatPercent(highestRevenueProfessional.progress, 0)} da meta individual.`,
      recommendedAction: 'Use esse profissional como referência comercial para acelerar combo, upsell e fechamento do mês.',
      href: '/equipe/desempenho',
      priority: 58,
      metric: {
        label: 'Meta individual',
        value: formatPercent(highestRevenueProfessional.progress, 0),
      },
    })
  }

  if (customerContext.plan.enabled) {
    if (customerContext.plan.margin < 0 || (customerContext.plan.averageCostCoverage !== null && customerContext.plan.averageCostCoverage >= 92)) {
      const concentrationCopy = [
        customerContext.plan.topRiskProfessionalName ? `${customerContext.plan.topRiskProfessionalName} concentra boa parte do consumo pressionado` : null,
        customerContext.plan.topRiskServiceName ? `${customerContext.plan.topRiskServiceName} aparece como servico recorrente nesses clientes` : null,
      ]
        .filter(Boolean)
        .join('. ')

      insights.push({
        id: 'subscription-plan-underpriced',
        type: 'subscription_health',
        severity: customerContext.plan.margin < 0 ? 'critical' : 'warning',
        title: customerContext.plan.margin < 0
          ? 'O plano de assinatura ja esta operando no prejuizo'
          : 'O plano de assinatura esta perto de perder margem',
        explanation: `${subscriptionGroup.customers} assinante${subscriptionGroup.customers > 1 ? 's' : ''} geraram ${formatCurrency(subscriptionGroup.totalRevenue)} e consumiram ${formatCurrency(subscriptionGroup.totalCost)} em custo estimado no periodo. ${concentrationCopy}`.trim(),
        recommendedAction: 'Revise preco, regras de uso, extras cobrados a parte e o repasse operacional antes de aumentar volume de assinantes.',
        href: '/clientes',
        priority: customerContext.plan.margin < 0 ? 91 : 80,
        metric: {
          label: 'Cobertura de custo',
          value: customerContext.plan.averageCostCoverage === null
            ? 'Sem base'
            : formatPercent(customerContext.plan.averageCostCoverage, 0),
        },
      })
    } else if (topAtRiskSubscriber) {
      insights.push({
        id: `subscription-risk-${topAtRiskSubscriber.id}`,
        type: 'subscription_health',
        severity: topAtRiskSubscriber.riskLevel === 'loss' ? 'critical' : 'warning',
        title: `${topAtRiskSubscriber.name} esta pressionando a saude da assinatura`,
        explanation: `${topAtRiskSubscriber.visits} visitas no periodo, ${formatCurrency(topAtRiskSubscriber.estimatedCost)} de custo estimado e ${topAtRiskSubscriber.costVsFeePercent === null ? 'sem base de mensalidade' : `${formatPercent(topAtRiskSubscriber.costVsFeePercent, 0)} de consumo da mensalidade`}.`,
        recommendedAction: 'Monitore esses assinantes de perto, defina regra para extras e acompanhe a concentracao por barbeiro e servico.',
        href: '/clientes',
        priority: 79,
        metric: {
          label: 'Margem do cliente',
          value: formatCurrency(topAtRiskSubscriber.margin),
        },
      })
    }
  }

  if (
    subscriptionGroup.customers > 0
    && walkInGroup.customers > 0
    && walkInGroup.averageMarginPerCustomer > subscriptionGroup.averageMarginPerCustomer * 1.35
  ) {
    insights.push({
      id: 'walk-in-margin-advantage',
      type: 'customer_margin',
      severity: 'opportunity',
      title: 'Os clientes avulsos estao puxando mais margem por cliente',
      explanation: `${formatCurrency(walkInGroup.averageMarginPerCustomer)} de margem media por cliente avulso contra ${formatCurrency(subscriptionGroup.averageMarginPerCustomer)} na assinatura. Isso sugere que a casa pode estar monetizando melhor o atendimento fora do plano.`,
      recommendedAction: 'Use essa diferenca para revisar o preco da assinatura, limitar inclusoes e vender extras premium para assinantes.',
      href: '/clientes',
      priority: 67,
      metric: {
        label: 'Vantagem do avulso',
        value: formatCurrency(walkInGroup.averageMarginPerCustomer - subscriptionGroup.averageMarginPerCustomer),
      },
    })
  }

  if (topUnderusedSubscriber) {
    insights.push({
      id: `subscription-underused-${topUnderusedSubscriber.id}`,
      type: 'customer_frequency',
      severity: 'positive',
      title: `${topUnderusedSubscriber.name} esta entre os assinantes mais rentaveis`,
      explanation: `${topUnderusedSubscriber.visits} visita${topUnderusedSubscriber.visits === 1 ? '' : 's'} no periodo, ${formatCurrency(topUnderusedSubscriber.margin)} de margem estimada e baixo consumo da mensalidade.`,
      recommendedAction: 'Olhe esse perfil como referencia de plano saudavel antes de reajustar o desenho comercial.',
      href: '/clientes',
      priority: 56,
      metric: {
        label: 'Consumo da mensalidade',
        value: topUnderusedSubscriber.costVsFeePercent === null
          ? 'Sem base'
          : formatPercent(topUnderusedSubscriber.costVsFeePercent, 0),
      },
    })
  }

  if (leastProfitableCustomer && leastProfitableCustomer.margin < 0) {
    insights.push({
      id: `customer-loss-${leastProfitableCustomer.id}`,
      type: 'customer_margin',
      severity: 'warning',
      title: `${leastProfitableCustomer.name} consome mais do que retorna hoje`,
      explanation: `${leastProfitableCustomer.visits} visitas no periodo, ${formatCurrency(leastProfitableCustomer.totalRevenue)} de receita e ${formatCurrency(leastProfitableCustomer.estimatedCost)} de custo estimado. Esse tipo de relacao derruba margem sem aparecer no faturamento bruto.`,
      recommendedAction: 'Use a tabela de clientes para decidir se vale reajustar o plano, cobrar extras ou redirecionar o mix de atendimento.',
      href: '/clientes',
      priority: 68,
      metric: {
        label: 'Margem estimada',
        value: formatCurrency(leastProfitableCustomer.margin),
      },
    })
  } else if (topProfitableCustomer && topProfitableCustomer.margin > 0 && topProfitableCustomer.visits > 0) {
    insights.push({
      id: `customer-top-${topProfitableCustomer.id}`,
      type: 'customer_margin',
      severity: 'positive',
      title: `${topProfitableCustomer.name} esta entre os clientes que mais ajudam no lucro`,
      explanation: `${formatCurrency(topProfitableCustomer.totalRevenue)} de valor gerado com ${formatCurrency(topProfitableCustomer.margin)} de margem estimada. Esse cliente ajuda a casa a crescer com qualidade, nao so com volume.`,
      recommendedAction: 'Proteja esse perfil com bom atendimento, recorrencia e oferta certa de servicos premium ou reposicao.',
      href: '/clientes',
      priority: 54,
      metric: {
        label: 'Margem do cliente',
        value: formatCurrency(topProfitableCustomer.margin),
      },
    })
  }

  if (insights.length === 0) {
    insights.push(buildStableInsight(context))
  }

  const orderedInsights = insights
    .map((insight) => ({ ...insight, priority: insight.priority + severityWeight(insight.severity) }))
    .sort((left, right) => right.priority - left.priority)

  const prioritized = orderedInsights.slice(0, 5)
  const alerts = orderedInsights.filter((insight) => insight.severity === 'critical' || insight.severity === 'warning').slice(0, 5)
  let opportunities = orderedInsights
    .filter((insight) => insight.severity === 'opportunity' || insight.severity === 'positive')
    .slice(0, 5)

  if (opportunities.length === 0) {
    opportunities = [buildStableInsight(context)]
  }

  return {
    mode: 'deterministic',
    runtime: {
      userModeLabel: 'Deterministico local',
    },
    summary: buildSummary(context, prioritized),
    insights: orderedInsights,
    prioritized,
    alerts,
    opportunities,
    context,
  }
}
