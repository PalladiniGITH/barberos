import Link from 'next/link'
import {
  BadgeDollarSign,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react'
import type {
  BusinessIntelligenceReport,
  CustomerIntelligenceCustomerSnapshot,
  CustomerTypeFilter,
} from '@/lib/business-insights'
import {
  APPOINTMENT_BILLING_MODEL_LABELS,
  CUSTOMER_TYPE_LABELS,
  cn,
  formatCurrency,
  formatPercent,
} from '@/lib/utils'

interface CustomerIntelligenceSectionProps {
  month: number
  year: number
  report: BusinessIntelligenceReport
}

function buildIntelligenceHref(input: {
  month: number
  year: number
  professionalId?: string | null
  customerType?: CustomerTypeFilter
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('month', String(input.month))
  searchParams.set('year', String(input.year))

  if (input.professionalId) {
    searchParams.set('professionalId', input.professionalId)
  }

  if (input.customerType && input.customerType !== 'all') {
    searchParams.set('customerType', input.customerType)
  }

  return `/inteligencia?${searchParams.toString()}`
}

function buildCustomerProfileHref(input: {
  customerId: string
  month: number
  year: number
  professionalId?: string | null
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('month', String(input.month))
  searchParams.set('year', String(input.year))

  if (input.professionalId) {
    searchParams.set('professionalId', input.professionalId)
  }

  return `/clientes/${input.customerId}?${searchParams.toString()}`
}

function FilterLink({
  active,
  href,
  label,
}: {
  active: boolean
  href: string
  label: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
        active
          ? 'border-[rgba(91,33,182,0.22)] bg-[rgba(91,33,182,0.16)] text-violet-100'
          : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-slate-300 hover:bg-[rgba(91,33,182,0.12)] hover:text-slate-100'
      )}
    >
      {label}
    </Link>
  )
}

function SummaryMetric({
  title,
  value,
  helper,
  icon: Icon,
  tone = 'neutral',
}: {
  title: string
  value: string
  helper: string
  icon: typeof Users
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  const toneClass = {
    neutral: 'border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.98),rgba(21,24,33,0.98))]',
    positive: 'border-[rgba(22,163,74,0.2)] bg-[radial-gradient(circle_at_top_left,rgba(22,163,74,0.16),transparent_38%),linear-gradient(180deg,rgba(24,38,32,0.98),rgba(21,24,33,0.98))]',
    warning: 'border-[rgba(245,158,11,0.22)] bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_38%),linear-gradient(180deg,rgba(40,31,24,0.98),rgba(21,24,33,0.98))]',
  }[tone]

  return (
    <div className={cn('surface-inverse rounded-[1.1rem] border p-4 shadow-[0_22px_44px_-34px_rgba(2,6,23,0.82)]', toneClass)}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-[rgba(91,33,182,0.12)] bg-[rgba(91,33,182,0.08)] text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{helper}</p>
    </div>
  )
}

function CustomerRiskBadge({ customer }: { customer: CustomerIntelligenceCustomerSnapshot }) {
  const toneClass = {
    healthy: 'border-[rgba(52,211,153,0.22)] bg-[rgba(16,185,129,0.12)] text-emerald-100',
    warning: 'border-[rgba(251,191,36,0.22)] bg-[rgba(251,191,36,0.12)] text-amber-100',
    loss: 'border-[rgba(251,113,133,0.22)] bg-[rgba(251,113,133,0.12)] text-rose-100',
    underused: 'border-[rgba(56,189,248,0.22)] bg-[rgba(56,189,248,0.12)] text-sky-100',
    neutral: 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-slate-300',
  }[customer.riskLevel]

  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold', toneClass)}>
      {customer.riskLabel}
    </span>
  )
}

function RevenueConfidenceBadge({ customer }: { customer: CustomerIntelligenceCustomerSnapshot }) {
  const toneClass = {
    real: 'border-[rgba(52,211,153,0.22)] bg-[rgba(16,185,129,0.12)] text-emerald-100',
    mixed: 'border-[rgba(251,191,36,0.22)] bg-[rgba(251,191,36,0.12)] text-amber-100',
    estimated: 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-slate-300',
  }[customer.revenueConfidence]

  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold', toneClass)}>
      {customer.revenueConfidenceLabel}
    </span>
  )
}

function RevenueSplitLine({
  realRevenue,
  estimatedRevenue,
}: {
  realRevenue: number
  estimatedRevenue: number
}) {
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      <span>{formatCurrency(realRevenue)} real</span>
      <span className="mx-1.5 text-slate-400">/</span>
      <span>{formatCurrency(estimatedRevenue)} estimado</span>
    </div>
  )
}

function RankingList({
  title,
  subtitle,
  items,
  renderMetric,
  month,
  year,
  professionalId,
}: {
  title: string
  subtitle: string
  items: CustomerIntelligenceCustomerSnapshot[]
  renderMetric: (customer: CustomerIntelligenceCustomerSnapshot) => string
  month: number
  year: number
  professionalId?: string | null
}) {
  return (
    <section className="premium-block">
      <p className="page-kicker">{title}</p>
      <h3 className="mt-2 text-lg font-semibold text-foreground">{subtitle}</h3>

      <div className="mt-4 space-y-3">
        {items.length > 0 ? items.map((customer) => (
          <div key={customer.id} className="surface-inverse rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.96),rgba(21,24,33,0.96))] p-4 shadow-[0_22px_44px_-34px_rgba(2,6,23,0.82)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={buildCustomerProfileHref({
                    customerId: customer.id,
                    month,
                    year,
                    professionalId,
                  })}
                  className="truncate text-sm font-semibold text-foreground transition-colors hover:text-primary"
                >
                  {customer.name}
                </Link>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[11px] text-muted-foreground">
                    {CUSTOMER_TYPE_LABELS[customer.type]}
                  </span>
                  <CustomerRiskBadge customer={customer} />
                  <RevenueConfidenceBadge customer={customer} />
                </div>
                <RevenueSplitLine
                  realRevenue={customer.realRevenue}
                  estimatedRevenue={customer.estimatedRevenue}
                />
              </div>

              <div className="text-right">
                <p className="text-sm font-semibold text-foreground">{renderMetric(customer)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{customer.visits} visita{customer.visits === 1 ? '' : 's'}</p>
              </div>
            </div>
          </div>
        )) : (
          <div className="surface-inverse rounded-[1rem] border border-dashed border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] p-4 text-sm text-muted-foreground">
            Ainda nao ha dados suficientes para montar este ranking no filtro atual.
          </div>
        )}
      </div>
    </section>
  )
}

function renderPlanStatus(report: BusinessIntelligenceReport) {
  const { plan } = report.context.customers

  if (!plan.enabled) {
    return {
      label: 'Sem base de assinatura',
      tone: 'neutral' as const,
      helper: 'Cadastre clientes de assinatura para acompanhar saude, custo e sustentabilidade do plano.',
    }
  }

  if (plan.margin < 0 || (plan.averageCostCoverage !== null && plan.averageCostCoverage >= 100)) {
    return {
      label: 'Plano em prejuizo',
      tone: 'warning' as const,
      helper: 'A recorrencia atual ja consome mais custo do que a mensalidade devolve.',
    }
  }

  if (plan.averageCostCoverage !== null && plan.averageCostCoverage >= 82) {
    return {
      label: 'Plano em observacao',
      tone: 'warning' as const,
      helper: 'A cobertura de custo esta apertando e pede revisao antes de ganhar mais volume.',
    }
  }

  return {
    label: 'Plano saudavel',
    tone: 'positive' as const,
    helper: 'A assinatura ainda preserva margem e pode ser escalada com mais seguranca.',
  }
}

export function CustomerIntelligenceSection({
  month,
  year,
  report,
}: CustomerIntelligenceSectionProps) {
  const { customers, professionals } = report.context
  const planStatus = renderPlanStatus(report)
  const customerInsights = report.insights
    .filter((insight) =>
      insight.type === 'customer_margin'
      || insight.type === 'subscription_health'
      || insight.type === 'customer_frequency'
    )
    .slice(0, 4)
  const executiveAlerts = [
    customers.plan.enabled
      ? `${customers.plan.riskCount + customers.plan.lossCount} assinantes estao acima do nivel saudavel de margem.`
      : 'Ainda nao existe base suficiente de assinatura para um alerta estrutural.',
    `${formatPercent(customers.groups.subscription.operationalSharePercent, 0)} da operacao do periodo foi consumida por assinantes.`,
    customers.groups.walkIn.margin > customers.groups.subscription.margin
      ? 'Clientes avulsos entregaram margem total maior do que a base de assinatura neste corte.'
      : 'A assinatura ainda segura a maior fatia de margem total neste corte.',
    customers.summary.estimatedRevenue > 0
      ? `${formatCurrency(customers.summary.estimatedRevenue)} da receita desta leitura e estimada e deve ser lida com cautela.`
      : 'A leitura atual esta ancorada em receita real, sem dependencia relevante de estimativa.',
  ]

  return (
    <div className="space-y-6">
      <section className="dashboard-panel p-5 sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="page-kicker">Inteligencia de clientes</p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">Rentabilidade, recorrencia e saude da assinatura</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Esta leitura cruza visitas, valor gerado, custo estimado e margem por cliente para mostrar quem sustenta o lucro e onde o plano precisa de ajuste.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <FilterLink
                active={customers.filters.customerType === 'all'}
                href={buildIntelligenceHref({
                  month,
                  year,
                  professionalId: customers.filters.professionalId,
                  customerType: 'all',
                })}
                label="Todos"
              />
              <FilterLink
                active={customers.filters.customerType === 'subscription'}
                href={buildIntelligenceHref({
                  month,
                  year,
                  professionalId: customers.filters.professionalId,
                  customerType: 'subscription',
                })}
                label="Assinatura"
              />
              <FilterLink
                active={customers.filters.customerType === 'walk_in'}
                href={buildIntelligenceHref({
                  month,
                  year,
                  professionalId: customers.filters.professionalId,
                  customerType: 'walk_in',
                })}
                label="Avulso"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <FilterLink
                active={!customers.filters.professionalId}
                href={buildIntelligenceHref({
                  month,
                  year,
                  customerType: customers.filters.customerType,
                })}
                label="Equipe"
              />
              {professionals.map((professional) => (
                <FilterLink
                  key={professional.id}
                  active={customers.filters.professionalId === professional.id}
                  href={buildIntelligenceHref({
                    month,
                    year,
                    professionalId: professional.id,
                    customerType: customers.filters.customerType,
                  })}
                  label={professional.name}
                />
              ))}
            </div>

            <Link
              href={`/clientes?month=${month}&year=${year}${customers.filters.professionalId ? `&professionalId=${customers.filters.professionalId}` : ''}${customers.filters.customerType !== 'all' ? `&customerType=${customers.filters.customerType}` : ''}`}
              className="inline-flex items-center gap-2 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-[rgba(91,33,182,0.12)] hover:text-slate-50"
            >
              <UserRound className="h-4 w-4" />
              Abrir modulo de clientes
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryMetric
            title="Base filtrada"
            value={`${customers.summary.visibleCustomers} clientes`}
            helper={`${customers.summary.visits} visitas no periodo atual deste corte.`}
            icon={Users}
          />
          <SummaryMetric
            title="Valor gerado"
            value={formatCurrency(customers.summary.totalRevenue)}
            helper={`${formatCurrency(customers.summary.realRevenue)} real e ${formatCurrency(customers.summary.estimatedRevenue)} estimado.`}
            icon={BadgeDollarSign}
          />
          <SummaryMetric
            title="Margem estimada"
            value={formatCurrency(customers.summary.totalMargin)}
            helper={`${customers.summary.lossCustomers} cliente${customers.summary.lossCustomers === 1 ? '' : 's'} abaixo de zero no filtro atual.`}
            icon={TriangleAlert}
            tone={customers.summary.lossCustomers > 0 ? 'warning' : 'positive'}
          />
          <SummaryMetric
            title="Plano assinatura"
            value={planStatus.label}
            helper={`${planStatus.helper} ${customers.plan.enabled ? `${customers.plan.activeMembersWithVisits} com uso no periodo.` : ''}`}
            icon={ShieldAlert}
            tone={planStatus.tone}
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_360px]">
        <section className="space-y-5">
          <section className="dashboard-panel p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="page-kicker">Comparacao por grupo</p>
                <h3 className="mt-2 text-xl font-semibold text-foreground">Assinatura versus avulso</h3>
              </div>
              <span className="surface-chip">
                <RefreshCw className="h-3.5 w-3.5" />
                Visao gerencial
              </span>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {[customers.groups.subscription, customers.groups.walkIn].map((group) => (
                <div key={group.type} className="surface-inverse rounded-[1.2rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.98),rgba(21,24,33,0.98))] p-5 shadow-[0_22px_44px_-34px_rgba(2,6,23,0.82)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{group.label}</p>
                      <p className="mt-3 text-2xl font-semibold text-foreground">{formatCurrency(group.margin)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{formatPercent(group.marginPercent, 0)} de margem estimada</p>
                    </div>
                    <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-xs font-semibold text-muted-foreground">
                      {group.customers} cliente{group.customers === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="surface-soft p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Receita</p>
                      <p className="mt-2 text-base font-semibold text-foreground">{formatCurrency(group.totalRevenue)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(group.realRevenue)} real</p>
                    </div>
                    <div className="surface-soft p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Custo estimado</p>
                      <p className="mt-2 text-base font-semibold text-foreground">{formatCurrency(group.totalCost)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(group.averageCostPerVisit)} por visita</p>
                    </div>
                    <div className="surface-soft p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ticket medio</p>
                      <p className="mt-2 text-base font-semibold text-foreground">{formatCurrency(group.averageTicket)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatPercent(group.revenueSharePercent, 0)} da receita do recorte</p>
                    </div>
                    <div className="surface-soft p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Volume operacional</p>
                      <p className="mt-2 text-base font-semibold text-foreground">{group.averageVisitsPerCustomer.toFixed(1)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatPercent(group.operationalSharePercent, 0)} da agenda consumida</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-3">
            <RankingList
              title="Mais lucrativos"
              subtitle="Quem mais ajuda no lucro"
              items={customers.rankings.mostProfitable}
              renderMetric={(customer) => formatCurrency(customer.margin)}
              month={month}
              year={year}
              professionalId={customers.filters.professionalId}
            />
            <RankingList
              title="Menos lucrativos"
              subtitle="Quem mais pressiona a margem"
              items={customers.rankings.leastProfitable}
              renderMetric={(customer) => formatCurrency(customer.margin)}
              month={month}
              year={year}
              professionalId={customers.filters.professionalId}
            />
            <RankingList
              title="Maior recorrencia"
              subtitle="Quem mais consome agenda"
              items={customers.rankings.mostFrequent}
              renderMetric={(customer) => `${customer.visits} visitas`}
              month={month}
              year={year}
              professionalId={customers.filters.professionalId}
            />
            <RankingList
              title="Assinantes em risco"
              subtitle="Uso acima do nivel saudavel"
              items={customers.rankings.atRiskSubscribers}
              renderMetric={(customer) => formatPercent(customer.costVsFeePercent ?? 0, 0)}
              month={month}
              year={year}
              professionalId={customers.filters.professionalId}
            />
            <RankingList
              title="Assinantes em prejuizo"
              subtitle="Margem ja negativa"
              items={customers.rankings.lossSubscribers}
              renderMetric={(customer) => formatCurrency(customer.margin)}
              month={month}
              year={year}
              professionalId={customers.filters.professionalId}
            />
            <RankingList
              title="Avulsos mais valiosos"
              subtitle="Maior contribuicao comercial"
              items={customers.rankings.valuableWalkIns}
              renderMetric={(customer) => formatCurrency(customer.totalRevenue)}
              month={month}
              year={year}
              professionalId={customers.filters.professionalId}
            />
          </div>
        </section>

        <aside className="space-y-5">
          <section className="premium-rail">
            <p className="page-kicker">Saude do plano</p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">Leitura da assinatura</h3>

            <div className="mt-4 space-y-3">
              <div className="surface-soft-strong p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Preco de referencia</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{formatCurrency(customers.plan.monthlyPriceReference)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{customers.plan.activeMembers} assinante{customers.plan.activeMembers === 1 ? '' : 's'} ativos</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="surface-soft p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Clientes em risco</p>
                  <p className="mt-2 text-xl font-semibold text-foreground">{customers.plan.riskCount + customers.plan.lossCount}</p>
                </div>
                <div className="surface-soft p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Subutilizados</p>
                  <p className="mt-2 text-xl font-semibold text-foreground">{customers.plan.underusedCount}</p>
                </div>
                <div className="surface-soft p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Receita do plano</p>
                  <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(customers.plan.totalRevenue)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{formatCurrency(customers.plan.realRevenue)} real / {formatCurrency(customers.plan.estimatedRevenue)} estimado</p>
                </div>
                <div className="surface-soft p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Participacao</p>
                  <p className="mt-2 text-xl font-semibold text-foreground">{formatPercent(customers.plan.revenueSharePercent, 0)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{formatPercent(customers.plan.operationalSharePercent, 0)} da operacao do periodo</p>
                </div>
              </div>

              <div className="surface-soft p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Cobertura media de custo</p>
                <p className="mt-2 text-xl font-semibold text-foreground">
                  {customers.plan.averageCostCoverage === null ? 'Sem base' : formatPercent(customers.plan.averageCostCoverage, 0)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {customers.plan.topRiskProfessionalName
                    ? `${customers.plan.topRiskProfessionalName} concentra boa parte do uso pressionado.`
                    : 'Sem concentracao relevante por barbeiro neste corte.'}
                </p>
              </div>

              <div className="surface-soft p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Extras compensam?</p>
                <p className="mt-2 text-xl font-semibold text-foreground">
                  {formatCurrency(customers.groups.subscription.averageRevenuePerVisit)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">Receita media por visita dos assinantes neste recorte.</p>
              </div>
            </div>
          </section>

          <section className="premium-block">
            <p className="page-kicker">Insights automaticos</p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">Leitura para decisao</h3>

            <div className="mt-4 space-y-3">
              {customerInsights.length > 0 ? customerInsights.map((insight) => (
                <div key={insight.id} className="surface-inverse rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                  <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{insight.explanation}</p>
                </div>
              )) : (
                <div className="surface-inverse rounded-[1rem] border border-dashed border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] p-4 text-sm text-muted-foreground">
                  Ainda nao ha leitura suficiente para montar alertas de clientes neste recorte.
                </div>
              )}
            </div>
          </section>

          <section className="premium-block">
            <p className="page-kicker">Metodo de leitura</p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">Transparencia analitica</h3>

            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="surface-inverse rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="font-semibold text-foreground">Receita real</p>
                <p className="mt-2 leading-6">{customers.methodology.realRevenueDefinition}</p>
              </div>
              <div className="surface-inverse rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="font-semibold text-foreground">Receita estimada</p>
                <p className="mt-2 leading-6">{customers.methodology.estimatedRevenueDefinition}</p>
              </div>
              <div className="surface-inverse rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="font-semibold text-foreground">Custo e margem</p>
                <p className="mt-2 leading-6">{customers.methodology.marginDefinition}</p>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="dashboard-panel p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="page-kicker">Operacao detalhada</p>
              <h3 className="mt-2 text-xl font-semibold text-foreground">Tabela executiva de clientes</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Valor gerado, custo estimado, margem, recorrencia e forma de consumo em um unico quadro.
              </p>
            </div>
            <span className="surface-chip">{customers.table.length} linha{customers.table.length === 1 ? '' : 's'}</span>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.08)] text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="pb-3 pr-4">Cliente</th>
                  <th className="pb-3 pr-4">Modelo</th>
                  <th className="pb-3 pr-4">Visitas</th>
                  <th className="pb-3 pr-4">Gerado</th>
                  <th className="pb-3 pr-4">Custo</th>
                  <th className="pb-3 pr-4">Margem</th>
                  <th className="pb-3 pr-4">Receita/visita</th>
                  <th className="pb-3">Leitura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                {customers.table.length > 0 ? customers.table.slice(0, 12).map((customer) => (
                  <tr key={customer.id} className="align-top">
                    <td className="py-4 pr-4">
                      <div className="min-w-[220px]">
                        <Link
                          href={buildCustomerProfileHref({
                            customerId: customer.id,
                            month,
                            year,
                            professionalId: customers.filters.professionalId,
                          })}
                          className="font-semibold text-foreground transition-colors hover:text-primary"
                        >
                          {customer.name}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {customer.professionalNames.length > 0 ? customer.professionalNames.join(', ') : 'Sem barbeiro predominante'}
                        </p>
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="flex flex-col gap-2">
                        <span className="inline-flex w-fit items-center rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[11px] text-muted-foreground">
                          {CUSTOMER_TYPE_LABELS[customer.type]}
                        </span>
                        {customer.type === 'SUBSCRIPTION' && (
                          <span className="inline-flex w-fit items-center rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[11px] text-muted-foreground">
                            {customer.extraVisits > 0
                              ? APPOINTMENT_BILLING_MODEL_LABELS.SUBSCRIPTION_EXTRA
                              : APPOINTMENT_BILLING_MODEL_LABELS.SUBSCRIPTION_INCLUDED}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-foreground">{customer.visits}</td>
                    <td className="py-4 pr-4">
                      <p className="font-semibold text-foreground">{formatCurrency(customer.totalRevenue)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(customer.realRevenue)} real / {formatCurrency(customer.estimatedRevenue)} est.</p>
                    </td>
                    <td className="py-4 pr-4 text-foreground">{formatCurrency(customer.estimatedCost)}</td>
                    <td className="py-4 pr-4">
                      <div>
                        <p className="font-semibold text-foreground">{formatCurrency(customer.margin)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatPercent(customer.marginPercent, 0)}</p>
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-foreground">{formatCurrency(customer.revenuePerVisit)}</td>
                    <td className="py-4">
                      <div className="flex min-w-[190px] flex-wrap gap-2">
                        <CustomerRiskBadge customer={customer} />
                        <RevenueConfidenceBadge customer={customer} />
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      Ainda nao ha clientes suficientes para exibir a tabela neste recorte.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="premium-rail">
            <p className="page-kicker">Perguntas de gestao</p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">Respostas do recorte atual</h3>

            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="surface-inverse rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="font-semibold text-foreground">Quem mais ajuda no lucro?</p>
                <p className="mt-2 leading-6">
                  {customers.rankings.mostProfitable[0]
                    ? `${customers.rankings.mostProfitable[0].name} lidera com ${formatCurrency(customers.rankings.mostProfitable[0].margin)} de margem estimada.`
                    : 'Ainda sem base suficiente neste recorte.'}
                </p>
              </div>

              <div className="surface-inverse rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="font-semibold text-foreground">Quem mais consome tempo e retorno baixo?</p>
                <p className="mt-2 leading-6">
                  {customers.rankings.leastProfitable[0]
                    ? `${customers.rankings.leastProfitable[0].name} aparece no extremo inferior com ${customers.rankings.leastProfitable[0].visits} visitas e margem de ${formatCurrency(customers.rankings.leastProfitable[0].margin)}.`
                    : 'Ainda sem base suficiente neste recorte.'}
                </p>
              </div>

              <div className="surface-inverse rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="font-semibold text-foreground">O plano atual esta saudavel?</p>
                <p className="mt-2 leading-6">
                  {customers.plan.enabled
                    ? customers.plan.margin < 0 || (customers.plan.averageCostCoverage !== null && customers.plan.averageCostCoverage >= 92)
                      ? 'Nao. O plano ja esta apertando margem e merece revisao de preco, limite operacional e extras cobrados a parte.'
                      : 'Sim, mas o acompanhamento de risco e subutilizacao deve orientar o proximo ajuste comercial.'
                    : 'Ainda nao ha base de assinatura suficiente para responder com confianca.'}
                </p>
              </div>

              <div className="surface-inverse rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="font-semibold text-foreground">Alertas executivos</p>
                <div className="mt-2 space-y-2 leading-6">
                  {executiveAlerts.map((alert) => (
                    <p key={alert}>{alert}</p>
                  ))}
                </div>
              </div>

              <div className="surface-inverse rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="font-semibold text-foreground">Leitura de incerteza</p>
                <p className="mt-2 leading-6">{customers.methodology.caution}</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
