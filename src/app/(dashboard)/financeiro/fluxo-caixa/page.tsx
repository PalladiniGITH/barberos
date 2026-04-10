import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { ArrowUpRight, BarChart3, TrendingDown, TrendingUp } from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatCurrency, formatPercent, getMonthRange, cn } from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { buildForecast, buildMonthSeries, FINANCE_SECTION_TABS } from '../_financeiro'

export const metadata: Metadata = { title: 'Fluxo de caixa' }

interface Props {
  searchParams: { month?: string; year?: string }
}

function FlowBars({
  data,
}: {
  data: { label: string; revenue: number; expense: number; net: number }[]
}) {
  const maxAbs = Math.max(...data.map((item) => Math.max(item.revenue, item.expense, Math.abs(item.net))), 1)

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {data.map((item) => {
        const positive = item.net >= 0
        const netWidth = Math.max(10, (Math.abs(item.net) / maxAbs) * 100)

        return (
          <div key={item.label} className="rounded-2xl border border-border/70 bg-secondary/25 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">{item.label}</p>
              <span className={cn(
                'rounded-full px-2.5 py-1 text-xs font-semibold',
                positive ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-700'
              )}>
                {formatCurrency(item.net)}
              </span>
            </div>
            <div className="mt-4 space-y-2">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Receitas</span>
                  <span>{formatCurrency(item.revenue)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-background/70">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(item.revenue / maxAbs) * 100}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Despesas</span>
                  <span>{formatCurrency(item.expense)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-background/70">
                  <div className="h-full rounded-full bg-orange-400" style={{ width: `${(item.expense / maxAbs) * 100}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Saldo</span>
                  <span>{positive ? 'positivo' : 'negativo'}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-background/70">
                  <div
                    className={cn('h-full rounded-full', positive ? 'bg-emerald-400' : 'bg-rose-400')}
                    style={{ width: `${netWidth}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default async function FluxoCaixaPage({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const { start, end } = getMonthRange(month, year)
  const previous = new Date(year, month - 2, 1)
  const prevMonth = previous.getMonth() + 1
  const prevYear = previous.getFullYear()
  const { start: prevStart, end: prevEnd } = getMonthRange(prevMonth, prevYear)
  const historyStart = new Date(year, month - 6, 1)
  const barbershopId = session.user.barbershopId

  const [
    currentRevenue,
    currentExpense,
    previousRevenue,
    previousExpense,
    historyRevenues,
    historyExpenses,
    monthlyGoal,
  ] = await Promise.all([
    prisma.revenue.aggregate({
      where: { barbershopId, date: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { barbershopId, dueDate: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.revenue.aggregate({
      where: { barbershopId, date: { gte: prevStart, lte: prevEnd } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { barbershopId, dueDate: { gte: prevStart, lte: prevEnd } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.revenue.findMany({
      where: { barbershopId, date: { gte: historyStart, lte: end } },
      select: { date: true, amount: true },
    }),
    prisma.expense.findMany({
      where: {
        barbershopId,
        OR: [
          { dueDate: { gte: historyStart, lte: end } },
          { dueDate: null, createdAt: { gte: historyStart, lte: end } },
        ],
      },
      select: { amount: true, dueDate: true, createdAt: true },
    }),
    prisma.monthlyGoal.findUnique({
      where: { barbershopId_month_year: { barbershopId, month, year } },
    }),
  ])

  const series = buildMonthSeries(month, year, historyRevenues, historyExpenses)
  const totalRevenue = Number(currentRevenue._sum.amount ?? 0)
  const totalExpense = Number(currentExpense._sum.amount ?? 0)
  const currentNet = totalRevenue - totalExpense
  const isCurrentMonth = new Date().getFullYear() === year && new Date().getMonth() + 1 === month
  const daysInMonth = new Date(year, month, 0).getDate()
  const daysElapsed = isCurrentMonth ? Math.max(1, Math.min(new Date().getDate(), daysInMonth)) : daysInMonth
  const forecast = buildForecast({
    currentNet,
    daysElapsed,
    daysInMonth,
    isCurrentMonth,
    recentNetHistory: series.slice(-3).map((point) => point.net),
  })

  const revenueChange = Number(previousRevenue._sum.amount ?? 0) > 0
    ? ((totalRevenue - Number(previousRevenue._sum.amount ?? 0)) / Number(previousRevenue._sum.amount ?? 0)) * 100
    : null
  const expenseChange = Number(previousExpense._sum.amount ?? 0) > 0
    ? ((totalExpense - Number(previousExpense._sum.amount ?? 0)) / Number(previousExpense._sum.amount ?? 0)) * 100
    : null
  const goalValue = Number(monthlyGoal?.revenueGoal ?? 0)
  const goalProgress = goalValue > 0 ? (totalRevenue / goalValue) * 100 : 0

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Fluxo de caixa"
        description="Entrada, saida, saldo e previsao simples para guiar o ritmo financeiro."
        action={(
          <Suspense>
            <PeriodSelector month={month} year={year} pathname="/financeiro/fluxo-caixa" />
          </Suspense>
        )}
      />

      <SectionTabs items={FINANCE_SECTION_TABS} currentPath="/financeiro/fluxo-caixa" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Receitas</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-700">{formatCurrency(totalRevenue)}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {revenueChange === null ? 'Sem comparacao anterior.' : `vs mes anterior: ${formatPercent(revenueChange, 0)}`}
          </p>
        </div>
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Despesas</p>
          <p className="text-2xl font-bold tabular-nums text-rose-700">{formatCurrency(totalExpense)}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {expenseChange === null ? 'Sem comparacao anterior.' : `vs mes anterior: ${formatPercent(expenseChange, 0)}`}
          </p>
        </div>
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Saldo do periodo</p>
          <p className={cn('text-2xl font-bold tabular-nums', currentNet >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
            {formatCurrency(currentNet)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {currentNet >= 0 ? 'Caixa positivo no periodo selecionado.' : 'Caixa pressionado no periodo selecionado.'}
          </p>
        </div>
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Previsao simples</p>
          <p className={cn('text-2xl font-bold tabular-nums', forecast.projectedNet >= 0 ? 'text-sky-700' : 'text-rose-700')}>
            {formatCurrency(forecast.projectedNet)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {isCurrentMonth ? 'Fechamento estimado com base no ritmo atual.' : 'Referencia baseada na media recente.'}
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Tendencia do saldo</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Cada bloco mostra receita, despesa e saldo liquido para acompanhar o movimento com clareza.
              </p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
              Ultimos 6 meses
            </span>
          </div>

          <div className="mt-6">
            <FlowBars data={series} />
          </div>
        </section>

        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Previsao do fechamento</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Uma leitura simples para antecipar se o mes tende a fechar com folga ou pressao.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Saldo projetado</p>
              <p className={cn('mt-2 text-2xl font-semibold tabular-nums', forecast.projectedNet >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                {formatCurrency(forecast.projectedNet)}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {isCurrentMonth
                  ? `${forecast.remainingDays} dia${forecast.remainingDays > 1 ? 's' : ''} restantes para reagir ao ritmo atual.`
                  : 'O fechamento historico serve de referencia para o proximo ciclo.'}
              </p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Meta do mes</p>
              <p className="mt-2 text-xl font-semibold text-foreground">
                {goalValue > 0 ? formatPercent(goalProgress, 0) : 'Sem meta'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {goalValue > 0
                  ? `${formatCurrency(totalRevenue)} realizados de ${formatCurrency(goalValue)} planejados.`
                  : 'Sem meta cadastrada para comparar com o caixa.'}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-background/70">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(goalProgress, 100)}%` }} />
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Media recente</p>
              <p className="mt-2 text-xl font-semibold text-foreground">
                {formatCurrency(forecast.trailingAverage)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Media dos ultimos 3 meses usada como referencia simples.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/financeiro/receitas" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                <TrendingUp className="h-4 w-4" />
                Abrir receitas
              </Link>
              <Link href="/financeiro/despesas" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
                <TrendingDown className="h-4 w-4" />
                Abrir despesas
              </Link>
              <Link href="/financeiro/categorias" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
                <BarChart3 className="h-4 w-4" />
                Ver categorias
              </Link>
            </div>
          </div>
        </section>
      </div>

      <section className="dashboard-panel p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Resumo do fluxo</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Uma visao consolidada para o dono enxergar caixa, sem depender de leitura tecnica.
            </p>
          </div>
          <Link href="/financeiro" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
            Abrir visao geral
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Saldo parcial</p>
            <p className={cn('mt-2 text-xl font-semibold tabular-nums', currentNet >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
              {formatCurrency(currentNet)}
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Entradas contabilizadas</p>
            <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{currentRevenue._count}</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Saidas contabilizadas</p>
            <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{currentExpense._count}</p>
          </div>
        </div>
      </section>
    </div>
  )
}
