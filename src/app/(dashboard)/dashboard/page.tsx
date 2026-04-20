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

function getTrendConfig(change: number | null, positiveIsGood = true) {
  if (change === null) {
    return {
      Icon: Clock3,
      className: 'border-[rgba(58,47,86,0.08)] bg-[rgba(91,33,182,0.04)] text-muted-foreground',
      label: 'Sem base anterior',
    }
  }

  if (Math.abs(change) < 0.05) {
    return {
      Icon: Clock3,
      className: 'border-[rgba(58,47,86,0.08)] bg-[rgba(91,33,182,0.04)] text-muted-foreground',
      label: 'Estavel',
    }
  }

  const improving = positiveIsGood ? change > 0 : change < 0

  return {
    Icon: change > 0 ? ArrowUpRight : ArrowDownRight,
    className: improving
      ? 'border-[rgba(16,185,129,0.12)] bg-[rgba(16,185,129,0.08)] text-emerald-700'
      : 'border-[rgba(244,63,94,0.12)] bg-[rgba(244,63,94,0.08)] text-rose-700',
    label: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
  }
}

function TrendBadge({
  change,
  positiveIsGood = true,
}: {
  change: number | null
  positiveIsGood?: boolean
}) {
  const config = getTrendConfig(change, positiveIsGood)

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold', config.className)}>
      <config.Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  )
}

function ExecutiveCard({
  title,
  value,
  helper,
  trend,
  positiveIsGood = true,
}: {
  title: string
  value: string
  helper: string
  trend?: number | null
  positiveIsGood?: boolean
}) {
  return (
    <article className="executive-metric">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="executive-label">{title}</p>
          <p className="executive-value">{value}</p>
        </div>
        {trend !== undefined && <TrendBadge change={trend} positiveIsGood={positiveIsGood} />}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{helper}</p>
    </article>
  )
}

function AlertBanner({ alert }: { alert: DashboardAlert }) {
  const toneClass = {
    critical: 'border-[rgba(244,63,94,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,245,247,0.98))]',
    warning: 'border-[rgba(245,158,11,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,250,242,0.98))]',
    positive: 'border-[rgba(16,185,129,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,252,248,0.98))]',
  }[alert.tone]

  const iconClass = {
    critical: 'bg-[rgba(244,63,94,0.08)] text-rose-600',
    warning: 'bg-[rgba(245,158,11,0.08)] text-amber-600',
    positive: 'bg-[rgba(16,185,129,0.08)] text-emerald-600',
  }[alert.tone]

  return (
    <section className={cn('dashboard-panel p-5', toneClass)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className={cn('mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl', iconClass)}>
            <alert.icon className="h-5 w-5" />
          </span>
          <div>
            <p className="page-kicker">Principal alerta do mes</p>
            <h2 className="mt-2 text-lg font-semibold text-foreground">{alert.title}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-7 text-muted-foreground">{alert.body}</p>
          </div>
        </div>

        <Link href={alert.href} className="action-button-primary self-start">
          {alert.actionLabel}
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  )
}

function ComparisonRow({ metric }: { metric: ComparisonMetric }) {
  return (
    <div className="rounded-[1.2rem] border border-[rgba(58,47,86,0.08)] bg-[rgba(91,33,182,0.04)] px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{metric.label}</p>
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
      body: 'Sem receitas registradas, o painel perde leitura real de faturamento, margem e tracao.',
      href: '/financeiro/receitas',
      icon: AlertTriangle,
      title: 'Nenhuma receita lancada neste periodo',
      tone: 'critical',
    })
  }

  if (input.overdueExpenseCount > 0) {
    alerts.push({
      actionLabel: 'Revisar despesas',
      body: `${formatCurrency(input.overdueExpenseAmount)} ainda esta pendente. Corrigir isso protege o caixa e evita distorcao na margem.`,
      href: '/financeiro/despesas',
      icon: Clock3,
      title: `${input.overdueExpenseCount} despesa${input.overdueExpenseCount > 1 ? 's' : ''} em aberto`,
      tone: 'critical',
    })
  }

  if (input.goalValue <= 0) {
    alerts.push({
      actionLabel: 'Definir meta mensal',
      body: 'Sem meta, o time ve faturamento, mas nao enxerga direcao nem ritmo esperado.',
      href: '/equipe/metas',
      icon: Target,
      title: 'A casa ainda nao tem meta formal para o mes',
      tone: 'warning',
    })
  } else if (input.isCurrentPeriod && input.goalAttainment + 8 < input.expectedProgress && input.remainingToGoal > 0) {
    alerts.push({
      actionLabel: 'Acompanhar metas',
      body: `Faltam ${formatCurrency(input.remainingToGoal)} para bater a meta. O ritmo precisa subir para ${formatCurrency(input.requiredDailyRevenue)} por dia.`,
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
      title: 'O limite de despesas foi ultrapassado',
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
      actionLabel: 'Aproveitar o momento',
      body: `O faturamento acelerou frente a ${input.comparisonMonthLabel}. Esse e um bom momento para puxar servicos premium.`,
      href: '/precificacao/resultado',
      icon: TrendingUp,
      title: 'O mes ganhou tracao acima do anterior',
      tone: 'positive',
    })
  }

  if (input.topProfessional && input.topProfessional.goal > 0) {
    const topProgress = (input.topProfessional.revenue / input.topProfessional.goal) * 100

    if (topProgress >= 90) {
      alerts.push({
        actionLabel: 'Ver desempenho da equipe',
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
      body: 'Receita, despesas e meta estao equilibradas. O painel mostra controle, nao correria.',
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
    <div className="page-section flex flex-col gap-6">
      <PageHeader
        title="Painel executivo"
        description="Uma leitura mais clara, mais forte e mais acionavel do negocio, com menos ruido e mais hierarquia."
        action={(
          <Suspense>
            <PeriodSelector month={month} year={year} pathname="/dashboard" />
          </Suspense>
        )}
      />

      <section className="dashboard-spotlight overflow-hidden p-5 sm:p-6">
        <div className="dashboard-hero-grid">
          <div>
            <p className="spotlight-kicker">Radar operacional</p>
            <h2 className="spotlight-title">{formatCurrency(data.totalRevenue)}</h2>
            <p className="spotlight-copy max-w-2xl">
              Faturamento acumulado em {data.monthLabel}, organizado para dar contexto rapido sobre margem, meta, ticket medio e pressao do periodo.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <TrendBadge change={data.revenueChange} />
              <span className="spotlight-chip">
                {data.partialComparison ? 'Mesmo intervalo do mes anterior' : data.comparisonMonthLabel}
              </span>
              <span className="spotlight-chip">{data.totalAppointments} atendimentos no periodo</span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="hero-stat-card">
                <p className="executive-label">Margem atual</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                  {formatPercent(data.profitMargin, 0)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">Lucro estimado sobre a receita lancada.</p>
              </div>
              <div className="hero-stat-card">
                <p className="executive-label">Ticket medio</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                  {formatCurrency(data.ticketAverage)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">Quanto cada atendimento esta deixando no caixa.</p>
              </div>
              <div className="hero-stat-card">
                <p className="executive-label">Despesas do mes</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                  {formatCurrency(data.totalExpense)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">Leitura direta do peso de custo no periodo.</p>
              </div>
            </div>
          </div>

          <aside className="premium-rail p-5">
            <p className="page-kicker">Pulso do mes</p>
            <div className="mt-3 space-y-4">
              <div className="rounded-[0.95rem] border border-[rgba(52,44,78,0.1)] bg-[rgba(255,255,255,0.8)] p-4 shadow-[0_10px_18px_-14px_rgba(20,15,35,0.08)]">
                <p className="executive-label">Meta principal</p>
                <p className="mt-3 text-[1.8rem] font-semibold tracking-tight text-foreground">
                  {data.goalValue > 0 ? formatPercent(data.goalAttainment, 0) : 'Sem meta'}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {data.goalValue > 0
                    ? `${formatCurrency(data.totalRevenue)} de ${formatCurrency(data.goalValue)}`
                    : 'Defina uma meta para dar direcao ao faturamento do mes.'}
                </p>
              </div>

              <div className="rounded-[0.95rem] border border-[rgba(52,44,78,0.1)] bg-[rgba(255,255,255,0.8)] p-4 shadow-[0_10px_18px_-14px_rgba(20,15,35,0.08)]">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Percentual atingido</span>
                  <span>{formatPercent(data.goalAttainment, 0)}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-[rgba(91,33,182,0.08)]">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-700',
                      data.goalAttainment >= 100 ? 'bg-emerald-500' : data.goalAttainment >= data.expectedProgress ? 'bg-primary' : 'bg-amber-500'
                    )}
                    style={{ width: `${goalBarProgress}%` }}
                  />
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {data.goalAttainment >= 100
                    ? 'A meta principal ja foi batida.'
                    : data.remainingDays > 0
                      ? `${formatCurrency(data.requiredDailyRevenue)} por dia para fechar o objetivo.`
                      : 'Use esse gap para calibrar o proximo periodo.'}
                </p>
              </div>

              <div className="rounded-[0.95rem] border border-[rgba(52,44,78,0.1)] bg-[rgba(91,33,182,0.05)] p-4">
                <p className="executive-label">Leitura rapida</p>
                <div className="mt-3 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Falta para meta</span>
                    <strong>{formatCurrency(Math.max(0, data.remainingToGoal))}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Teto de despesas</span>
                    <strong>{data.expenseLimit > 0 ? formatPercent(data.expenseLimitUsage, 0) : 'Nao definido'}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Comparacao</span>
                    <strong>{data.comparisonMonthLabel}</strong>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        <ExecutiveCard
          title="Receita confirmada"
          value={formatCurrency(data.totalRevenue)}
          helper="Faturamento registrado no periodo com base real."
          trend={data.revenueChange}
        />
        <ExecutiveCard
          title="Lucro estimado"
          value={formatCurrency(data.profit)}
          helper={data.profit >= 0 ? `${formatPercent(data.profitMargin, 0)} de margem sobre a receita.` : 'O lucro estimado ficou negativo neste periodo.'}
          trend={data.profitChange}
        />
        <ExecutiveCard
          title="Despesas"
          value={formatCurrency(data.totalExpense)}
          helper={data.expenseLimit > 0 ? `${formatPercent(data.expenseLimitUsage, 0)} do teto mensal.` : 'Sem teto formal de despesa definido.'}
          trend={data.expenseChange}
          positiveIsGood={false}
        />
        <ExecutiveCard
          title="Ticket medio"
          value={formatCurrency(data.ticketAverage)}
          helper={`${data.totalAppointments} atendimentos registrados no periodo.`}
          trend={data.ticketChange}
        />
      </section>

      {primaryAlert && <AlertBanner alert={primaryAlert} />}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <RevenueChart data={data.chartData} />

        <aside className="space-y-5">
          <section className="premium-rail p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="page-kicker">Execucao da meta</p>
                <h3 className="mt-2 text-[1.4rem] font-semibold tracking-tight text-foreground">Meta do mes</h3>
              </div>
              <span className="surface-chip">{data.monthLabel}</span>
            </div>

            {data.goalValue > 0 ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-[0.95rem] border border-[rgba(52,44,78,0.1)] bg-[rgba(255,255,255,0.8)] p-4">
                  <p className="executive-label">Realizado ate agora</p>
                  <p className="mt-3 text-[2rem] font-semibold tracking-tight text-foreground">
                    {formatCurrency(data.totalRevenue)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">Meta principal: {formatCurrency(data.goalValue)}</p>
                </div>

                <div className="panel-soft">
                  <p className="executive-label">Meta minima saudavel</p>
                  <p className="mt-3 text-xl font-semibold text-foreground">{formatCurrency(data.minGoalValue)}</p>
                  <p className="mt-2 text-sm text-muted-foreground">Base minima para o mes nao ficar aquem do esperado.</p>
                </div>

                <div className="panel-soft">
                  <p className="executive-label">Ritmo necessario</p>
                  <p className="mt-3 text-xl font-semibold text-foreground">{formatCurrency(data.requiredDailyRevenue)}</p>
                  <p className="mt-2 text-sm text-muted-foreground">Por dia para fechar o objetivo no tempo restante.</p>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[1.2rem] border border-dashed border-[rgba(58,47,86,0.12)] bg-[rgba(91,33,182,0.04)] p-5">
                <p className="text-sm font-semibold text-foreground">Meta ainda nao configurada</p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Defina a meta e o painel deixa de ser so historico para virar direcao comercial.
                </p>
                <Link href="/equipe/metas" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Configurar meta
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </section>

          <section className="dashboard-panel p-6">
            <p className="page-kicker">Acoes rapidas</p>
            <h3 className="mt-2 text-[1.3rem] font-semibold tracking-tight text-foreground">Proximos atalhos</h3>
            <div className="mt-4 space-y-3">
              <Link href="/financeiro" className="action-button flex justify-between">
                Abrir visao financeira
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
              <Link href="/equipe/desempenho" className="action-button flex justify-between">
                Ver desempenho da equipe
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
              <Link href="/precificacao/resultado" className="action-button flex justify-between">
                Revisar resultado da margem
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
            </div>
          </section>
        </aside>
      </div>

      <DashboardInsightsPreview report={intelligenceReport} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,1fr)]">
        {data.ranking.length > 0 ? (
          <ProfessionalRanking data={data.ranking.slice(0, 5)} />
        ) : (
          <section className="dashboard-panel flex min-h-[280px] flex-col justify-center p-6">
              <div className="rounded-[0.95rem] border border-dashed border-[rgba(52,44,78,0.12)] bg-[rgba(91,33,182,0.035)] p-5 text-center">
              <p className="text-sm font-semibold text-foreground">Ranking ainda indisponivel</p>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                Assim que as receitas forem lancadas por profissional, o time aparece aqui com hierarquia e comparacao real.
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
              <h3 className="mt-2 text-[1.35rem] font-semibold tracking-tight text-foreground">Comparativos e sinais secundarios</h3>
            </div>
            <span className="surface-chip">Abrir detalhes</span>
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
                  <Link key={alert.title} href={alert.href} className="block rounded-[1.2rem] border border-[rgba(58,47,86,0.08)] bg-[rgba(91,33,182,0.04)] p-4 transition-colors hover:bg-[rgba(91,33,182,0.06)]">
                    <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                    <p className="mt-1 text-sm leading-7 text-muted-foreground">{alert.body}</p>
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
