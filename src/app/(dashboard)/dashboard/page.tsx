import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Crown,
  Receipt,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { requireSession } from '@/lib/auth'
import type { BusinessInsightHref, BusinessIntelligenceReport } from '@/lib/business-insights'
import { getBusinessAnalystReport } from '@/lib/business-analyst'
import { ProfessionalRanking } from '@/components/dashboard/professional-ranking'
import { RevenueChart } from '@/components/dashboard/revenue-chart'
import { DashboardInsightsPreview } from '@/components/inteligencia/insight-card'
import { PageHeader } from '@/components/layout/page-header'
import { PeriodSelector } from '@/components/shared/period-selector'
import { resolvePeriod } from '@/lib/period'
import { cn, formatCurrency, formatPercent } from '@/lib/utils'

export const metadata: Metadata = { title: 'Dashboard' }

interface Props {
  searchParams: { month?: string; year?: string }
}

interface DashboardAlert {
  tone: 'critical' | 'warning' | 'positive'
  title: string
  body: string
  href: BusinessInsightHref
  actionLabel: string
  icon: LucideIcon
}

interface ComparisonMetric {
  label: string
  current: number
  previous: number
  change: number | null
  positiveIsGood?: boolean
}

function buildDashboardData(report: BusinessIntelligenceReport) {
  const { context } = report

  const ranking = context.professionals
    .filter((professional) => professional.revenue > 0)
    .sort((left, right) => right.revenue - left.revenue)
    .map((professional, index) => ({
      id: professional.id,
      name: professional.name,
      revenue: professional.revenue,
      goal: professional.goalValue,
      position: index + 1,
    }))

  return {
    chartData: context.trend.map((point) => ({
      month: point.label,
      receitas: point.revenue,
      despesas: point.expense,
    })),
    comparisonMonthLabel: context.period.comparisonLabel,
    expenseChange: context.financial.expenseChange,
    expenseLimit: context.goals.expenseLimit,
    expenseLimitUsage: context.goals.expenseLimitUsage,
    expectedProgress: context.goals.expectedProgress,
    goalAttainment: context.goals.goalAttainment,
    goalValue: context.goals.revenueGoal,
    isCurrentPeriod: context.period.isCurrentPeriod,
    minGoalValue: context.goals.revenueMin,
    monthLabel: context.period.label,
    overdueExpenseAmount: context.overdueExpenses.amount,
    overdueExpenseCount: context.overdueExpenses.count,
    partialComparison: context.period.partialComparison,
    prevExpense: context.financial.previousExpense,
    prevProfit: context.financial.previousProfit,
    prevRevenue: context.financial.previousRevenue,
    prevTicketAverage: context.financial.previousTicketAverage,
    profit: context.financial.profit,
    profitChange: context.financial.profitChange,
    profitMargin: context.financial.profitMargin,
    ranking,
    remainingDays: context.period.remainingDays,
    remainingToGoal: context.goals.remainingToGoal,
    requiredDailyRevenue: context.goals.requiredDailyRevenue,
    revenueChange: context.financial.revenueChange,
    ticketAverage: context.financial.ticketAverage,
    ticketChange: context.financial.ticketChange,
    totalAppointments: context.financial.totalAppointments,
    totalExpense: context.financial.totalExpense,
    totalRevenue: context.financial.totalRevenue,
  }
}

function getTrendConfig(change: number | null, positiveIsGood = true, surface: 'light' | 'dark' = 'light') {
  if (change === null) {
    return {
      Icon: Clock3,
      className: surface === 'dark'
        ? 'border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.06)] text-slate-100'
        : 'border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground',
      label: 'Sem base anterior',
    }
  }

  if (Math.abs(change) < 0.05) {
    return {
      Icon: Clock3,
      className: surface === 'dark'
        ? 'border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.06)] text-slate-100'
        : 'border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground',
      label: 'Estavel',
    }
  }

  const improving = positiveIsGood ? change > 0 : change < 0

  return {
    Icon: change > 0 ? ArrowUpRight : ArrowDownRight,
    className: surface === 'dark'
      ? improving
        ? 'border border-[rgba(52,211,153,0.16)] bg-[rgba(52,211,153,0.12)] text-emerald-50'
        : 'border border-[rgba(251,113,133,0.16)] bg-[rgba(251,113,133,0.12)] text-rose-50'
      : improving
        ? 'border border-[rgba(52,211,153,0.2)] bg-[rgba(52,211,153,0.1)] text-emerald-200'
        : 'border border-[rgba(251,113,133,0.2)] bg-[rgba(251,113,133,0.1)] text-rose-200',
    label: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
  }
}

function TrendBadge({
  change,
  positiveIsGood = true,
  surface = 'light',
}: {
  change: number | null
  positiveIsGood?: boolean
  surface?: 'light' | 'dark'
}) {
  const config = getTrendConfig(change, positiveIsGood, surface)

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold', config.className)}>
      <config.Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  )
}

function KpiCard({
  title,
  value,
  helper,
  trend,
  positiveIsGood = true,
  tone = 'neutral',
}: {
  title: string
  value: string
  helper: string
  trend?: number | null
  positiveIsGood?: boolean
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  const toneClass = {
    neutral: 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)]',
    positive: 'border-[rgba(52,211,153,0.16)] bg-[rgba(52,211,153,0.08)]',
    warning: 'border-[rgba(251,191,36,0.16)] bg-[rgba(251,191,36,0.08)]',
  }[tone]

  return (
    <div className={cn('rounded-[1.45rem] border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-sm', toneClass)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">{title}</p>
          <p className="mt-3 text-[1.8rem] font-semibold tracking-tight text-white">{value}</p>
        </div>
        {trend !== undefined && <TrendBadge change={trend} positiveIsGood={positiveIsGood} surface="dark" />}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{helper}</p>
    </div>
  )
}

function AlertBanner({ alert }: { alert: DashboardAlert }) {
  const toneClass = {
    critical: 'border-[rgba(251,113,133,0.2)] bg-[rgba(251,113,133,0.08)]',
    warning: 'border-[rgba(251,191,36,0.2)] bg-[rgba(251,191,36,0.08)]',
    positive: 'border-[rgba(52,211,153,0.2)] bg-[rgba(52,211,153,0.08)]',
  }[alert.tone]

  const iconClass = {
    critical: 'bg-[rgba(251,113,133,0.14)] text-rose-200',
    warning: 'bg-[rgba(251,191,36,0.14)] text-amber-200',
    positive: 'bg-[rgba(52,211,153,0.14)] text-emerald-200',
  }[alert.tone]

  return (
    <section className={cn('dashboard-panel border p-5', toneClass)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className={cn('mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl', iconClass)}>
            <alert.icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Principal alerta do mes
            </p>
            <h2 className="mt-2 text-lg font-semibold text-foreground">{alert.title}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{alert.body}</p>
          </div>
        </div>

        <Link href={alert.href} className="premium-dark-button self-start">
          {alert.actionLabel}
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  )
}

function ComparisonRow({ metric }: { metric: ComparisonMetric }) {
  return (
    <div className="rounded-[1.35rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(30,41,59,0.78),rgba(15,23,42,0.7))] px-4 py-3 shadow-[0_20px_44px_-34px_rgba(2,6,23,0.82)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{metric.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">Antes: {formatCurrency(metric.previous)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-foreground">{formatCurrency(metric.current)}</p>
          <div className="mt-2">
            <TrendBadge change={metric.change} positiveIsGood={metric.positiveIsGood} />
          </div>
        </div>
      </div>
    </div>
  )
}

function buildAlerts(input: {
  comparisonMonthLabel: string
  expenseLimit: number
  expenseLimitUsage: number
  expectedProgress: number
  goalAttainment: number
  goalValue: number
  isCurrentPeriod: boolean
  remainingToGoal: number
  requiredDailyRevenue: number
  revenueChange: number | null
  ticketAverage: number
  ticketChange: number | null
  topProfessional?: { goal: number; name: string; revenue: number }
  totalRevenue: number
  overdueExpenseAmount: number
  overdueExpenseCount: number
}) {
  const alerts: DashboardAlert[] = []

  if (input.totalRevenue === 0) {
    alerts.push({
      actionLabel: 'Lancar receitas',
      body: 'Sem receitas registradas, o painel perde a leitura real da operacao e do lucro.',
      href: '/financeiro/receitas',
      icon: AlertTriangle,
      title: 'Nenhuma receita lancada neste periodo',
      tone: 'critical',
    })
  }

  if (input.overdueExpenseCount > 0) {
    alerts.push({
      actionLabel: 'Revisar despesas',
      body: `${formatCurrency(input.overdueExpenseAmount)} ainda esta pendente. Regularizar isso protege caixa e evita distorcao no lucro.`,
      href: '/financeiro/despesas',
      icon: Clock3,
      title: `${input.overdueExpenseCount} despesa${input.overdueExpenseCount > 1 ? 's' : ''} em aberto no periodo`,
      tone: 'critical',
    })
  }

  if (input.goalValue <= 0) {
    alerts.push({
      actionLabel: 'Definir meta mensal',
      body: 'Sem meta, a equipe enxerga faturamento, mas nao enxerga direcao nem ritmo esperado.',
      href: '/equipe/metas',
      icon: Target,
      title: 'Defina a meta do mes para dar contexto aos numeros',
      tone: 'warning',
    })
  } else if (input.isCurrentPeriod && input.goalAttainment + 8 < input.expectedProgress && input.remainingToGoal > 0) {
    alerts.push({
      actionLabel: 'Acompanhar metas da equipe',
      body: `Faltam ${formatCurrency(input.remainingToGoal)} para bater a meta. Para recuperar o mes, o ritmo precisa subir para ${formatCurrency(input.requiredDailyRevenue)} por dia.`,
      href: '/equipe/metas',
      icon: Target,
      title: 'A meta esta abaixo do ritmo ideal',
      tone: 'warning',
    })
  }

  if (input.expenseLimit > 0 && input.expenseLimitUsage >= 100) {
    alerts.push({
      actionLabel: 'Cortar ou renegociar despesas',
      body: `As despesas consumiram ${formatPercent(input.expenseLimitUsage, 0)} do teto mensal.`,
      href: '/financeiro/despesas',
      icon: TrendingDown,
      title: 'O limite de despesas ja foi ultrapassado',
      tone: 'critical',
    })
  }

  if (input.ticketChange !== null && input.ticketChange <= -10) {
    alerts.push({
      actionLabel: 'Revisar servicos e combos',
      body: `O ticket medio caiu para ${formatCurrency(input.ticketAverage)} em relacao a ${input.comparisonMonthLabel}.`,
      href: '/precificacao/resultado',
      icon: Receipt,
      title: 'O ticket medio caiu com forca',
      tone: 'warning',
    })
  }

  if (input.revenueChange !== null && input.revenueChange >= 10) {
    alerts.push({
      actionLabel: 'Aproveitar o ritmo atual',
      body: `O faturamento acelerou frente a ${input.comparisonMonthLabel}. Hora boa para puxar servicos premium.`,
      href: '/precificacao/resultado',
      icon: TrendingUp,
      title: 'O mes esta com tracao acima do anterior',
      tone: 'positive',
    })
  }

  if (input.topProfessional && input.topProfessional.goal > 0) {
    const topProgress = (input.topProfessional.revenue / input.topProfessional.goal) * 100

    if (topProgress >= 90) {
      alerts.push({
        actionLabel: 'Ver metas da equipe',
        body: `${input.topProfessional.name} ja esta em ${formatPercent(topProgress, 0)} da meta individual.`,
        href: '/equipe/desempenho',
        icon: Crown,
        title: `${input.topProfessional.name} pode acelerar o fechamento do mes`,
        tone: 'positive',
      })
    }
  }

  if (alerts.length === 0) {
    alerts.push({
      actionLabel: 'Manter o ritmo',
      body: 'Receita, despesas e meta estao equilibradas. A sensacao e de controle, nao de correria.',
      href: '/equipe/desempenho',
      icon: Sparkles,
      title: 'A operacao esta sob controle',
      tone: 'positive',
    })
  }

  const priorityOrder = { critical: 0, warning: 1, positive: 2 }
  return alerts.sort((left, right) => priorityOrder[left.tone] - priorityOrder[right.tone]).slice(0, 3)
}

export default async function DashboardPage({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const intelligenceReport = await getBusinessAnalystReport({
    barbershopId: session.user.barbershopId,
    month,
    year,
  })
  const data = buildDashboardData(intelligenceReport)

  const goalBarProgress = Math.min(100, data.goalAttainment)
  const alerts = buildAlerts({
    comparisonMonthLabel: data.comparisonMonthLabel,
    expenseLimit: data.expenseLimit,
    expenseLimitUsage: data.expenseLimitUsage,
    expectedProgress: data.expectedProgress,
    goalAttainment: data.goalAttainment,
    goalValue: data.goalValue,
    isCurrentPeriod: data.isCurrentPeriod,
    remainingToGoal: data.remainingToGoal,
    requiredDailyRevenue: data.requiredDailyRevenue,
    revenueChange: data.revenueChange,
    ticketAverage: data.ticketAverage,
    ticketChange: data.ticketChange,
    topProfessional: data.ranking[0],
    totalRevenue: data.totalRevenue,
    overdueExpenseAmount: data.overdueExpenseAmount,
    overdueExpenseCount: data.overdueExpenseCount,
  })

  const primaryAlert = alerts[0]
  const secondaryAlerts = alerts.slice(1)
  const comparisonMetrics: ComparisonMetric[] = [
    { label: 'Faturamento', current: data.totalRevenue, previous: data.prevRevenue, change: data.revenueChange, positiveIsGood: true },
    { label: 'Lucro estimado', current: data.profit, previous: data.prevProfit, change: data.profitChange, positiveIsGood: true },
    { label: 'Despesas', current: data.totalExpense, previous: data.prevExpense, change: data.expenseChange, positiveIsGood: false },
    { label: 'Ticket medio', current: data.ticketAverage, previous: data.prevTicketAverage, change: data.ticketChange, positiveIsGood: true },
  ]

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Painel do negocio"
        description="A leitura mais rapida do mes: faturamento, lucro, meta, despesas, ticket e a principal prioridade de acao."
        action={(
          <Suspense>
            <PeriodSelector month={month} year={year} pathname="/dashboard" />
          </Suspense>
        )}
      />

      <section className="dashboard-panel dashboard-spotlight overflow-hidden p-6 sm:p-7">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
          <div className="max-w-3xl">
            <p className="spotlight-kicker">
              Visao executiva do mes
            </p>
            <h2 className="spotlight-title">
              {formatCurrency(data.totalRevenue)}
            </h2>
            <p className="spotlight-copy max-w-2xl">
              Faturamento acumulado em {data.monthLabel}.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <TrendBadge change={data.revenueChange} surface="dark" />
              <span className="spotlight-chip">
                {data.partialComparison ? 'Mesmo intervalo do mes anterior' : data.comparisonMonthLabel}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <KpiCard
              title="Lucro estimado"
              value={formatCurrency(data.profit)}
              helper={data.profit >= 0 ? `${formatPercent(data.profitMargin, 0)} de margem sobre o faturamento` : 'O lucro estimado ficou negativo neste periodo.'}
              trend={data.profitChange}
              tone={data.profit >= 0 ? 'positive' : 'warning'}
            />
            <KpiCard
              title="Meta mensal"
              value={data.goalValue > 0 ? formatPercent(data.goalAttainment, 0) : 'Sem meta'}
              helper={data.goalValue > 0 ? `${formatPercent(data.goalAttainment, 0)} de ${formatCurrency(data.goalValue)}` : 'Defina uma meta para dar contexto ao faturamento do mes.'}
              tone={data.goalValue > 0 && data.goalAttainment >= data.expectedProgress ? 'positive' : 'warning'}
            />
            <KpiCard
              title="Despesas do mes"
              value={formatCurrency(data.totalExpense)}
              helper={data.expenseLimit > 0 ? `${formatPercent(data.expenseLimitUsage, 0)} do teto mensal de despesas` : 'Acompanhe o custo para proteger o caixa.'}
              trend={data.expenseChange}
              positiveIsGood={false}
            />
            <KpiCard
              title="Ticket medio"
              value={formatCurrency(data.ticketAverage)}
              helper={data.totalAppointments > 0 ? `${data.totalAppointments} atendimentos registrados no periodo` : 'Cadastre receitas para ler o ticket real.'}
              trend={data.ticketChange}
            />
          </div>
        </div>
      </section>

      <DashboardInsightsPreview report={intelligenceReport} />

      {primaryAlert && <AlertBanner alert={primaryAlert} />}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <RevenueChart data={data.chartData} />

        <aside className="space-y-5">
          <section className="dashboard-panel p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Meta do mes</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  O suficiente para entender se o mes esta no ritmo certo sem poluir o topo.
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {data.monthLabel}
              </span>
            </div>

            {data.goalValue > 0 ? (
              <>
                <div className="mt-5 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Realizado ate agora</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                      {formatCurrency(data.totalRevenue)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Meta principal</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">
                      {formatCurrency(data.goalValue)}
                    </p>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Percentual atingido</span>
                    <span>{formatPercent(data.goalAttainment, 0)}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-700',
                        data.goalAttainment >= 100 ? 'bg-emerald-500' : data.goalAttainment >= data.expectedProgress ? 'bg-primary' : 'bg-amber-500'
                      )}
                      style={{ width: `${goalBarProgress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Minimo saudavel: {formatCurrency(data.minGoalValue)}</span>
                    <span>Ritmo ideal: {formatPercent(data.expectedProgress, 0)}</span>
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {data.goalAttainment >= 100 ? 'Acima da meta' : 'Falta para bater'}
                    </p>
                    <p className="mt-2 text-xl font-semibold text-foreground">
                      {formatCurrency(data.goalAttainment >= 100 ? data.totalRevenue - data.goalValue : data.remainingToGoal)}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {data.goalAttainment >= 100 ? 'O mes ja superou o objetivo principal.' : data.remainingDays > 0 ? `${formatCurrency(data.requiredDailyRevenue)} por dia para fechar o objetivo.` : 'Use esse gap para calibrar o proximo periodo.'}
                    </p>
                  </div>

                  {data.expenseLimit > 0 && (
                    <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Teto de despesas
                      </p>
                      <p className="mt-2 text-xl font-semibold text-foreground">
                        {formatCurrency(data.expenseLimit)}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {formatPercent(data.expenseLimitUsage, 0)} do teto consumido neste mes.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-5">
                <p className="text-sm font-medium text-foreground">Meta ainda nao configurada</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Defina a meta e o mes deixa de ser so faturamento solto para virar direcao comercial clara.
                </p>
                <Link
                  href="/equipe/metas"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary"
                >
                  Configurar meta
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </section>

          <section className="dashboard-panel p-6">
            <h3 className="text-lg font-semibold text-foreground">Movimentos rapidos</h3>
            <div className="mt-4 space-y-3">
              <Link href="/financeiro" className="flex items-center justify-between rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-[rgba(255,255,255,0.06)]">
                Abrir visao financeira
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
              <Link href="/equipe/desempenho" className="flex items-center justify-between rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-[rgba(255,255,255,0.06)]">
                Ver desempenho do time
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
              <Link href="/precificacao/resultado" className="flex items-center justify-between rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-[rgba(255,255,255,0.06)]">
                Revisar resultado da margem
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
            </div>
          </section>
        </aside>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,1fr)]">
        {data.ranking.length > 0 ? (
          <ProfessionalRanking data={data.ranking.slice(0, 5)} />
        ) : (
          <section className="dashboard-panel flex min-h-[280px] flex-col justify-center p-6">
            <div className="rounded-2xl border border-dashed border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-5 text-center">
              <p className="text-sm font-medium text-foreground">Ranking ainda indisponivel</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Assim que as receitas forem lancadas por profissional, a equipe aparece aqui com clareza.
              </p>
              <Link href="/financeiro/receitas" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                Lancar receitas
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        )}

        <details className="disclosure-panel">
          <summary className="disclosure-summary">
            <div>
              <p className="page-kicker">Leitura complementar</p>
              <h3 className="mt-2 text-lg font-semibold text-foreground">Comparativos e sinais secundarios</h3>
            </div>
            <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-xs font-semibold text-slate-300">
              Abrir detalhes
            </span>
          </summary>

          <div className="disclosure-body">
            <div className="space-y-3">
              {comparisonMetrics.map((metric) => (
                <ComparisonRow key={metric.label} metric={metric} />
              ))}
            </div>

            {secondaryAlerts.length > 0 && (
              <div className="mt-5 space-y-3">
                {secondaryAlerts.map((alert) => (
                  <Link key={alert.title} href={alert.href} className="block rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 transition-colors hover:bg-[rgba(255,255,255,0.05)]">
                    <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{alert.body}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}
