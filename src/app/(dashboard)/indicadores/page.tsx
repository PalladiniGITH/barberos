import type { Metadata } from 'next'
import { Suspense } from 'react'
import { assertAdministrativeRole, requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  formatCurrency,
  formatPeriodLabel,
  formatPercent,
  getMonthRange,
} from '@/lib/utils'
import { getComparisonWindow, resolvePeriod } from '@/lib/period'
import { PageHeader } from '@/components/layout/page-header'
import { PeriodSelector } from '@/components/shared/period-selector'
import { IndicatorsChart } from '@/components/indicadores/indicators-chart'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Gauge,
  Sparkles,
  Target,
  TrendingDown,
  Wallet,
} from 'lucide-react'

export const metadata: Metadata = { title: 'Indicadores' }

interface Props {
  searchParams: { month?: string; year?: string }
}

async function getIndicatorsData(
  barbershopId: string,
  month: number,
  year: number,
  currentPeriodEnd: Date
) {
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(year, month - 1 - index, 1)
    return { month: date.getMonth() + 1, year: date.getFullYear() }
  }).reverse()

  const data = await Promise.all(
    months.map(async ({ month: itemMonth, year: itemYear }) => {
      const { start, end } = getMonthRange(itemMonth, itemYear)
      const periodEnd = itemMonth === month && itemYear === year ? currentPeriodEnd : end

      const [revenues, expenses, professionals] = await Promise.all([
        prisma.revenue.aggregate({
          where: { barbershopId, date: { gte: start, lte: periodEnd } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.expense.aggregate({
          where: { barbershopId, dueDate: { gte: start, lte: periodEnd } },
          _sum: { amount: true },
        }),
        prisma.revenue.groupBy({
          by: ['professionalId'],
          where: { barbershopId, date: { gte: start, lte: periodEnd }, professionalId: { not: null } },
          _sum: { amount: true },
        }),
      ])

      const revenue = Number(revenues._sum.amount ?? 0)
      const expense = Number(expenses._sum.amount ?? 0)
      const profit = revenue - expense
      const ticket = revenues._count > 0 ? revenue / revenues._count : 0
      const expensePercent = revenue > 0 ? (expense / revenue) * 100 : 0
      const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0

      return {
        label: new Date(itemYear, itemMonth - 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        revenue,
        expenses: expense,
        profit,
        ticket,
        expensePercent,
        profitMargin,
        professionals: professionals.length,
      }
    })
  )

  return { data, currentMonth: { month, year } }
}

function calculateChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

function TrendIndicator({
  change,
  invert = false,
}: {
  change: number | null
  invert?: boolean
}) {
  if (change === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
        Sem base anterior
      </span>
    )
  }

  const positive = invert ? change < 0 : change > 0

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${positive ? 'bg-emerald-500/12 text-emerald-700' : 'bg-rose-500/12 text-rose-700'}`}>
      {change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {change >= 0 ? '+' : ''}{change.toFixed(1)}%
    </span>
  )
}

export default async function IndicadoresPage({ searchParams }: Props) {
  const session = await requireSession()
  assertAdministrativeRole(session.user.role, 'Sem permissao para consultar os indicadores executivos da barbearia.')
  const { month, year } = resolvePeriod(searchParams)
  const comparison = getComparisonWindow(month, year)
  const { data, currentMonth } = await getIndicatorsData(
    session.user.barbershopId,
    month,
    year,
    comparison.currentEnd
  )

  const [previousRevenueSummary, previousExpenseSummary] = await Promise.all([
    prisma.revenue.aggregate({
      where: {
        barbershopId: session.user.barbershopId,
        date: { gte: comparison.previousStart, lte: comparison.previousEnd },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: {
        barbershopId: session.user.barbershopId,
        dueDate: { gte: comparison.previousStart, lte: comparison.previousEnd },
      },
      _sum: { amount: true },
    }),
  ])

  const current = data[data.length - 1] ?? {
    revenue: 0,
    expenses: 0,
    profit: 0,
    ticket: 0,
    expensePercent: 0,
    profitMargin: 0,
    professionals: 0,
    label: '',
  }

  const previousRevenue = Number(previousRevenueSummary._sum.amount ?? 0)
  const previousExpense = Number(previousExpenseSummary._sum.amount ?? 0)
  const previous = {
    revenue: previousRevenue,
    expenses: previousExpense,
    profit: previousRevenue - previousExpense,
    ticket: previousRevenueSummary._count > 0 ? previousRevenue / previousRevenueSummary._count : 0,
    expensePercent: previousRevenue > 0 ? (previousExpense / previousRevenue) * 100 : 0,
  }

  const monthLabel = formatPeriodLabel(currentMonth.month, currentMonth.year)
  const revenueChange = calculateChange(current.revenue, previous.revenue)
  const profitChange = calculateChange(current.profit, previous.profit)
  const ticketChange = calculateChange(current.ticket, previous.ticket)
  const expenseRateChange = calculateChange(current.expensePercent, previous.expensePercent)

  const averageRevenue = data.reduce((sum, item) => sum + item.revenue, 0) / Math.max(data.length, 1)
  const averageMargin = data.reduce((sum, item) => sum + item.profitMargin, 0) / Math.max(data.length, 1)
  const bestMonth = [...data].sort((left, right) => right.profit - left.profit)[0] ?? current

  const insights = [
    {
      title: 'Leitura do mês',
      body: current.revenue > 0
        ? `O período atual já colocou ${formatCurrency(current.revenue)} no caixa, com ${formatPercent(current.profitMargin, 0)} de margem estimada.`
        : 'Ainda não há movimento suficiente para uma leitura confiável do mês.',
      icon: Gauge,
    },
    {
      title: 'Comparação recente',
      body: revenueChange !== null && revenueChange >= 0
        ? comparison.partialComparison
          ? 'O faturamento acelerou frente ao mesmo intervalo do mês anterior, o que reforça a leitura de ritmo.'
          : 'O faturamento acelerou frente ao mês anterior, o que reforça a leitura de crescimento.'
        : comparison.partialComparison
          ? 'O ritmo está abaixo do mesmo intervalo anterior, então vale agir cedo no mês.'
          : 'O faturamento está pressionado frente ao mês anterior, então vale usar este painel para mostrar onde agir.',
      icon: BarChart3,
    },
    {
      title: 'Melhor janela dos últimos 6 meses',
      body: `O melhor resultado foi em ${bestMonth.label}, com ${formatCurrency(bestMonth.profit)} de lucro estimado e ${formatPercent(bestMonth.profitMargin, 0)} de margem.`,
      icon: Sparkles,
    },
  ]

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Saúde do negócio"
        description="Leia crescimento, margem e consistência da operação sem depender de planilha."
        action={(
          <Suspense>
            <PeriodSelector month={month} year={year} pathname="/indicadores" />
          </Suspense>
        )}
      />

      <section className="dashboard-panel dashboard-spotlight overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">
              Sala de leitura
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
              {formatCurrency(current.revenue)}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {monthLabel} aparece aqui como um retrato estratégico do negócio: faturamento, margem, ticket e custo operacional em uma linguagem que o dono entende rápido.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <TrendIndicator change={revenueChange} />
            <TrendIndicator change={profitChange} />
            <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              {formatPercent(current.profitMargin, 0)} de margem estimada
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Lucro estimado</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(current.profit)}</p>
            <p className="mt-1 text-xs text-slate-400">Quanto o faturamento realmente deixou.</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Ticket médio</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(current.ticket)}</p>
            <p className="mt-1 text-xs text-slate-400">Leitura rápida de preço, mix e upsell.</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">% Despesas sobre receita</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatPercent(current.expensePercent, 0)}</p>
            <p className="mt-1 text-xs text-slate-400">Quanto do faturamento está sendo consumido pela operação.</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Média de 6 meses</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(averageRevenue)}</p>
            <p className="mt-1 text-xs text-slate-400">Base para comparar o mês atual com a própria operação.</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Faturamento</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{formatCurrency(current.revenue)}</p>
          <div className="mt-3">
            <TrendIndicator change={revenueChange} />
          </div>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Lucro estimado</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{formatCurrency(current.profit)}</p>
          <div className="mt-3">
            <TrendIndicator change={profitChange} />
          </div>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Ticket médio</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{formatCurrency(current.ticket)}</p>
          <div className="mt-3">
            <TrendIndicator change={ticketChange} />
          </div>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">% Despesas / Receita</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{formatPercent(current.expensePercent, 0)}</p>
          <div className="mt-3">
            <TrendIndicator change={expenseRateChange} invert />
          </div>
        </div>
      </div>

      <IndicatorsChart data={data} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <section className="dashboard-panel p-6">
          <h2 className="text-lg font-semibold text-foreground">Insights executivos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Leitura simples, com cara de produto, para mostrar valor logo na apresentação.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {insights.map((insight) => (
              <div key={insight.title} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <insight.icon className="h-4 w-4" />
                </span>
                <p className="mt-4 text-sm font-semibold text-foreground">{insight.title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{insight.body}</p>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Leituras-chave</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="text-sm font-semibold text-foreground">Melhor mês recente</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{bestMonth.label}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {formatCurrency(bestMonth.revenue)} de faturamento e {formatCurrency(bestMonth.profit)} de lucro estimado.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="text-sm font-semibold text-foreground">Margem média de 6 meses</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{formatPercent(averageMargin, 0)}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Boa referência para posicionar a conversa de lucro sem depender de benchmark externo agora.
                </p>
              </div>
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Por que isso vende</h2>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p className="inline-flex items-start gap-2">
                <Wallet className="mt-0.5 h-4 w-4 text-primary" />
                Tira o sistema do lugar de cadastro e coloca no lugar de leitura de negócio.
              </p>
              <p className="inline-flex items-start gap-2">
                <TrendingDown className="mt-0.5 h-4 w-4 text-primary" />
                Mostra custo operacional e margem de um jeito que dono entende rápido.
              </p>
              <p className="inline-flex items-start gap-2">
                <Target className="mt-0.5 h-4 w-4 text-primary" />
                Abre caminho para benchmark e alertas mais fortes sem overengineering agora.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
