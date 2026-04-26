import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import {
  CalendarRange,
  CircleDollarSign,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { resolvePeriod } from '@/lib/period'
import { getBusinessAnalystReport } from '@/lib/business-analyst'
import { CustomerIntelligenceSection } from '@/components/inteligencia/customer-intelligence'
import { InsightCard, IntelligenceModeBadge, IntelligenceRuntimeDetails } from '@/components/inteligencia/insight-card'
import { PageHeader } from '@/components/layout/page-header'
import { PeriodSelector } from '@/components/shared/period-selector'
import { cn, formatCurrency, formatPercent } from '@/lib/utils'
import type { CustomerTypeFilter } from '@/lib/business-insights'

export const metadata: Metadata = { title: 'Inteligencia do negocio' }

interface Props {
  searchParams: { month?: string; year?: string; professionalId?: string; customerType?: string }
}

function normalizeCustomerTypeFilter(value?: string): CustomerTypeFilter {
  if (value === 'subscription') return 'subscription'
  if (value === 'walk_in') return 'walk_in'
  return 'all'
}

function ComparisonCard({
  label,
  currentValue,
  previousValue,
  change,
  tone = 'neutral',
}: {
  label: string
  currentValue: string
  previousValue: string
  change: number | null
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  const toneClass = {
    neutral: 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)]',
    positive: 'border-[rgba(52,211,153,0.18)] bg-[rgba(52,211,153,0.08)]',
    warning: 'border-[rgba(251,191,36,0.18)] bg-[rgba(251,191,36,0.08)]',
  }[tone]

  const badgeClass = {
    neutral: 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground',
    positive: 'border-[rgba(52,211,153,0.2)] bg-[rgba(52,211,153,0.1)] text-emerald-100',
    warning: 'border-[rgba(251,191,36,0.2)] bg-[rgba(251,191,36,0.1)] text-amber-100',
  }[tone]

  return (
    <div className={cn('surface-inverse rounded-[1.35rem] border p-4 shadow-[0_20px_44px_-34px_rgba(2,6,23,0.82)]', toneClass)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
          <p className="mt-2.5 text-[1.9rem] font-semibold leading-none tracking-tight text-foreground">{currentValue}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">Antes: {previousValue}</p>
        </div>
        <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold', badgeClass)}>
          {change === null ? 'Sem base' : `${change >= 0 ? '+' : ''}${formatPercent(change, 0)}`}
        </span>
      </div>
    </div>
  )
}

export default async function InteligenciaPage({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const customerType = normalizeCustomerTypeFilter(searchParams.customerType)
  const professionalId = searchParams.professionalId ?? null
  const report = await getBusinessAnalystReport({
    barbershopId: session.user.barbershopId,
    month,
    year,
    professionalId,
    customerType,
    viewerRole: session.user.role,
  })

  const { context } = report
  const topRecommendations = report.prioritized.slice(0, 3)

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Inteligencia do negocio"
        description="Um relatorio automatico da barbearia: le caixa, meta, equipe, ticket e margem para dizer o que agir primeiro."
        action={(
          <div className="flex flex-col items-end gap-2">
            <Suspense>
              <PeriodSelector
                month={month}
                year={year}
                pathname="/inteligencia"
                queryParams={{
                  professionalId,
                  customerType: customerType === 'all' ? null : customerType,
                }}
              />
            </Suspense>
            <div className="flex items-center gap-3">
              <IntelligenceModeBadge report={report} />
            </div>
            <IntelligenceRuntimeDetails report={report} align="right" />
          </div>
        )}
      />

      <section className="dashboard-panel overflow-hidden p-0">
        <div className="dashboard-spotlight px-5 py-6 sm:px-6">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="spotlight-chip">
                  <CalendarRange className="h-3.5 w-3.5" />
                  {context.period.label}
                </span>
                <span className="spotlight-chip">
                  <CircleDollarSign className="h-3.5 w-3.5" />
                  {context.period.partialComparison
                    ? `Comparado ao mesmo ritmo de ${context.period.comparisonLabel}`
                    : `Comparado a ${context.period.comparisonLabel}`}
                </span>
              </div>

              <p className="spotlight-kicker mt-6">Relatorio automatico do mes</p>
              <h2 className="mt-3 max-w-2xl text-3xl font-semibold text-white sm:text-[2.7rem]">
                {report.summary.headline}
              </h2>
              <p className="spotlight-copy max-w-2xl">{report.summary.body}</p>

              <div className="mt-5 rounded-[1.7rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <p className="spotlight-kicker">Prioridade agora</p>
                <p className="mt-3 text-base leading-7 text-slate-100">{report.summary.focus}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="spotlight-stat">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Faturamento</p>
                <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(context.financial.totalRevenue)}</p>
                <p className="mt-1 text-sm text-slate-300">
                  {context.financial.revenueChange === null
                    ? 'Sem base anterior'
                    : `${context.financial.revenueChange >= 0 ? '+' : ''}${formatPercent(context.financial.revenueChange, 0)} vs ${context.period.comparisonLabel}`}
                </p>
              </div>
              <div className="spotlight-stat">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Lucro estimado</p>
                <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(context.financial.profit)}</p>
                <p className="mt-1 text-sm text-slate-300">{formatPercent(context.financial.profitMargin, 0)} de margem</p>
              </div>
              <div className="spotlight-stat">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Meta mensal</p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {context.goals.revenueGoal > 0 ? formatPercent(context.goals.goalAttainment, 0) : 'Sem meta'}
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  {context.goals.revenueGoal > 0
                    ? `${formatCurrency(context.goals.remainingToGoal)} para fechar`
                    : 'Defina meta para leitura completa'}
                </p>
              </div>
              <div className="spotlight-stat">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Ticket medio</p>
                <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(context.financial.ticketAverage)}</p>
                <p className="mt-1 text-sm text-slate-300">{context.financial.totalAppointments} atendimentos no periodo</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid xl:grid-cols-[minmax(0,1.45fr)_360px]">
          <div className="space-y-5 p-5 sm:p-6">
            <section className="premium-block">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="page-kicker">Riscos e prioridades</p>
                  <h3 className="mt-2 text-xl font-semibold text-foreground">Pontos de atencao do periodo</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    O que mais ameaca caixa, lucro, meta ou ritmo do mes agora.
                  </p>
                </div>
                <span className="rounded-full border border-[rgba(251,113,133,0.18)] bg-[rgba(251,113,133,0.1)] px-3 py-1 text-xs font-semibold text-rose-200">
                  {report.alerts.length} alerta{report.alerts.length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="mt-5 grid gap-4">
                {report.alerts.length > 0 ? (
                  report.alerts.map((insight) => (
                    <InsightCard key={insight.id} insight={insight} />
                  ))
                ) : (
                  <div className="rounded-[1.35rem] border border-[rgba(52,211,153,0.18)] bg-[rgba(52,211,153,0.08)] p-5">
                    <p className="text-sm font-semibold text-foreground">Sem alertas criticos neste periodo</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      O analista nao encontrou risco imediato de caixa ou meta. O melhor uso agora e acelerar ticket e margem.
                    </p>
                  </div>
                )}
              </div>
            </section>

            <section className="premium-block">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="page-kicker">Alavancas do mes</p>
                  <h3 className="mt-2 text-xl font-semibold text-foreground">Oportunidades de melhoria</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    O que pode melhorar faturamento, ticket ou margem sem depender so de mais volume.
                  </p>
                </div>
                <span className="rounded-full border border-[rgba(56,189,248,0.18)] bg-[rgba(56,189,248,0.1)] px-3 py-1 text-xs font-semibold text-sky-200">
                  {report.opportunities.length} oportunidade{report.opportunities.length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {report.opportunities.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            </section>
          </div>

          <aside className="border-t border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(17,24,39,0.86),rgba(15,23,42,0.8))] p-5 sm:p-6 xl:border-l xl:border-t-0">
            <div className="space-y-5">
              <details className="disclosure-panel">
                <summary className="disclosure-summary">
                  <div>
                    <p className="page-kicker">Comparativo</p>
                    <h3 className="mt-2 text-lg font-semibold text-foreground">Leitura contra a base anterior</h3>
                  </div>
                  <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-xs font-semibold text-slate-300">
                    Abrir
                  </span>
                </summary>

                <div className="disclosure-body space-y-3">
                  <ComparisonCard
                    label="Receita"
                    currentValue={formatCurrency(context.financial.totalRevenue)}
                    previousValue={formatCurrency(context.financial.previousRevenue)}
                    change={context.financial.revenueChange}
                    tone={context.financial.revenueChange !== null && context.financial.revenueChange > 0 ? 'positive' : 'neutral'}
                  />
                  <ComparisonCard
                    label="Despesas"
                    currentValue={formatCurrency(context.financial.totalExpense)}
                    previousValue={formatCurrency(context.financial.previousExpense)}
                    change={context.financial.expenseChange}
                    tone={context.financial.expenseChange !== null && context.financial.expenseChange > 10 ? 'warning' : 'neutral'}
                  />
                  <ComparisonCard
                    label="Lucro"
                    currentValue={formatCurrency(context.financial.profit)}
                    previousValue={formatCurrency(context.financial.previousProfit)}
                    change={context.financial.profitChange}
                    tone={context.financial.profitChange !== null && context.financial.profitChange > 0 ? 'positive' : 'warning'}
                  />
                  <ComparisonCard
                    label="Ticket"
                    currentValue={formatCurrency(context.financial.ticketAverage)}
                    previousValue={formatCurrency(context.financial.previousTicketAverage)}
                    change={context.financial.ticketChange}
                  />
                </div>
              </details>

              <section className="premium-rail">
                <p className="page-kicker">Plano curto</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">Prioridades de acao</h3>
                <div className="mt-4 space-y-3">
                  {topRecommendations.map((insight, index) => (
                    <div key={insight.id} className="surface-inverse rounded-[1.25rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4 shadow-[0_18px_34px_-26px_rgba(2,6,23,0.82)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        {index + 1}. agir agora
                      </p>
                      <p className="mt-2 text-sm font-semibold text-foreground">{insight.title}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{insight.recommendedAction}</p>
                    </div>
                  ))}
                </div>
              </section>

              <details className="disclosure-panel">
                <summary className="disclosure-summary">
                  <div>
                    <p className="page-kicker">Acoes no produto</p>
                    <h3 className="mt-2 text-lg font-semibold text-foreground">Saia da analise e execute</h3>
                  </div>
                  <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-xs font-semibold text-slate-300">
                    Abrir
                  </span>
                </summary>

                <div className="disclosure-body grid gap-3">
                  <Link href="/financeiro/despesas" className="surface-inverse rounded-[1.25rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4 transition-colors hover:bg-[rgba(255,255,255,0.06)]">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <TrendingDown className="h-4 w-4 text-primary" />
                      Revisar despesas
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Use quando o custo crescer acima da receita ou encostar no teto.
                    </p>
                  </Link>

                  <Link href="/equipe/desempenho" className="surface-inverse rounded-[1.25rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4 transition-colors hover:bg-[rgba(255,255,255,0.06)]">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Target className="h-4 w-4 text-primary" />
                      Ajustar time
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Abra desempenho quando a meta depender demais de poucos profissionais.
                    </p>
                  </Link>

                  <Link href="/precificacao/resultado" className="surface-inverse rounded-[1.25rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4 transition-colors hover:bg-[rgba(255,255,255,0.06)]">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <CircleDollarSign className="h-4 w-4 text-primary" />
                      Defender margem
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Veja rapido onde preco, comissao ou insumo precisam de ajuste.
                    </p>
                  </Link>

                  <Link href="/indicadores" className="surface-inverse rounded-[1.25rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4 transition-colors hover:bg-[rgba(255,255,255,0.06)]">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <TrendingUp className="h-4 w-4 text-primary" />
                      Ler tendencia
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Use quando a queda parecer repetida e voce quiser confirmar a tendencia.
                    </p>
                  </Link>
                </div>
              </details>
            </div>
          </aside>
        </div>
      </section>

      <CustomerIntelligenceSection month={month} year={year} report={report} />
    </div>
  )
}
