import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { type LucideIcon, ArrowUpRight, BadgeDollarSign, Banknote, Layers3, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { assertAdministrativeRole, requireSession } from '@/lib/auth'
import { formatCurrency, formatPercent, getMonthRange } from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { cn } from '@/lib/utils'
import { buildForecast, buildMonthSeries, FINANCE_SECTION_TABS } from './_financeiro'

export const metadata: Metadata = { title: 'Financeiro' }

interface Props {
  searchParams: { month?: string; year?: string }
}

function MetricCard({
  title,
  value,
  helper,
  tone = 'neutral',
  icon: Icon,
}: {
  title: string
  value: string
  helper: string
  tone?: 'neutral' | 'positive' | 'warning'
  icon: LucideIcon
}) {
  const toneClasses = {
    neutral: 'text-sky-700 bg-sky-500/10',
    positive: 'text-emerald-700 bg-emerald-500/10',
    warning: 'text-amber-700 bg-amber-500/10',
  }[tone]

  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{title}</p>
          <p className="mt-2 text-[2.05rem] font-semibold leading-none tabular-nums text-foreground">{value}</p>
        </div>
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-[0.9rem]', toneClasses)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2.5 text-[12px] leading-5 text-muted-foreground">{helper}</p>
    </div>
  )
}

function MonthBars({
  data,
}: {
  data: { label: string; revenue: number; expense: number; net: number }[]
}) {
  const maxAbs = Math.max(...data.map((item) => Math.max(item.revenue, item.expense, Math.abs(item.net))), 1)

  return (
    <div className="space-y-3">
      {data.map((item) => {
        const netPositive = item.net >= 0
        const netWidth = Math.max(8, (Math.abs(item.net) / maxAbs) * 100)

        return (
          <div key={item.label} className="rounded-2xl border border-border/70 bg-secondary/25 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{item.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Receita {formatCurrency(item.revenue)} e despesa {formatCurrency(item.expense)}
                </p>
              </div>
              <span className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold',
                netPositive ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-700'
              )}>
                {formatCurrency(item.net)}
              </span>
            </div>
            <div className="mt-4 grid gap-2">
              <div className="h-2 rounded-full bg-background/70">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${(item.revenue / maxAbs) * 100}%` }}
                />
              </div>
              <div className="h-2 rounded-full bg-background/70">
                <div
                  className="h-full rounded-full bg-orange-400"
                  style={{ width: `${(item.expense / maxAbs) * 100}%` }}
                />
              </div>
              <div className="h-2 rounded-full bg-background/70">
                <div
                  className={cn('h-full rounded-full', netPositive ? 'bg-emerald-400' : 'bg-rose-400')}
                  style={{ width: `${netWidth}%` }}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default async function FinanceiroPage({ searchParams }: Props) {
  const session = await requireSession()
  assertAdministrativeRole(session.user.role, 'Sem permissao para consultar o modulo financeiro da barbearia.')
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
    previousRevenue,
    currentExpense,
    previousExpense,
    monthlyGoal,
    paymentBreakdown,
    revenueCategories,
    expenseCategories,
    categories,
    historyRevenues,
    historyExpenses,
  ] = await Promise.all([
    prisma.revenue.aggregate({
      where: { barbershopId, date: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.revenue.aggregate({
      where: { barbershopId, date: { gte: prevStart, lte: prevEnd } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { barbershopId, dueDate: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { barbershopId, dueDate: { gte: prevStart, lte: prevEnd } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.monthlyGoal.findUnique({
      where: { barbershopId_month_year: { barbershopId, month, year } },
    }),
    prisma.revenue.groupBy({
      by: ['paymentMethod'],
      where: { barbershopId, date: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.revenue.groupBy({
      by: ['categoryId'],
      where: { barbershopId, date: { gte: start, lte: end }, categoryId: { not: null } },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
    }),
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: { barbershopId, dueDate: { gte: start, lte: end }, categoryId: { not: null } },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
    }),
    prisma.financialCategory.findMany({
      where: { barbershopId },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
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
  ])

  const series = buildMonthSeries(month, year, historyRevenues, historyExpenses)
  const currentNet = Number(currentRevenue._sum.amount ?? 0) - Number(currentExpense._sum.amount ?? 0)
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

  const totalRevenue = Number(currentRevenue._sum.amount ?? 0)
  const totalExpense = Number(currentExpense._sum.amount ?? 0)
  const profit = totalRevenue - totalExpense
  const profitMargin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0
  const revenueChange = Number(previousRevenue._sum.amount ?? 0) > 0
    ? ((totalRevenue - Number(previousRevenue._sum.amount ?? 0)) / Number(previousRevenue._sum.amount ?? 0)) * 100
    : null
  const expenseChange = Number(previousExpense._sum.amount ?? 0) > 0
    ? ((totalExpense - Number(previousExpense._sum.amount ?? 0)) / Number(previousExpense._sum.amount ?? 0)) * 100
    : null
  const goalValue = Number(monthlyGoal?.revenueGoal ?? 0)
  const expenseLimit = Number(monthlyGoal?.expenseLimit ?? 0)
  const goalAttainment = goalValue > 0 ? (totalRevenue / goalValue) * 100 : 0
  const expenseLimitUsage = expenseLimit > 0 ? (totalExpense / expenseLimit) * 100 : 0
  const sortedPaymentBreakdown = [...paymentBreakdown].sort(
    (left, right) => Number(right._sum.amount ?? 0) - Number(left._sum.amount ?? 0)
  )
  const paymentTotal = sortedPaymentBreakdown.reduce((sum, item) => sum + Number(item._sum.amount ?? 0), 0)

  const categoryMap = new Map(categories.map((item) => [item.id, item]))
  const revenueCategoryCards = revenueCategories
    .map((item) => ({
      category: item.categoryId ? categoryMap.get(item.categoryId) : null,
      amount: Number(item._sum.amount ?? 0),
      count: item._count,
    }))
    .filter((item) => item.category)

  const expenseCategoryCards = expenseCategories
    .map((item) => ({
      category: item.categoryId ? categoryMap.get(item.categoryId) : null,
      amount: Number(item._sum.amount ?? 0),
      count: item._count,
    }))
    .filter((item) => item.category)

  const topRevenueCategory = revenueCategoryCards[0]
  const topExpenseCategory = expenseCategoryCards[0]

  const summaryCopy = totalRevenue > 0
    ? `${formatCurrency(totalRevenue)} entrou no caixa neste periodo, com lucro estimado de ${formatCurrency(profit)} e margem de ${formatPercent(profitMargin, 0)}.`
    : 'Ainda nao ha movimentacao financeira registrada neste periodo. O painel continua pronto para assumir o primeiro ciclo.'

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Financeiro"
        description="Leitura do caixa, das despesas e do que mais merece atencao agora."
        action={(
          <Suspense>
            <PeriodSelector month={month} year={year} pathname="/financeiro" />
          </Suspense>
        )}
      />

      <SectionTabs items={FINANCE_SECTION_TABS} currentPath="/financeiro" />

      <section className="dashboard-panel dashboard-spotlight overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/80">Visao do periodo</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              {formatCurrency(currentNet)}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">{summaryCopy}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
            <Link href="/financeiro/receitas" className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 transition-colors hover:border-primary/30 hover:bg-white/[0.06]">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Receitas</p>
              <p className="mt-2 text-lg font-semibold text-white">{formatCurrency(totalRevenue)}</p>
              <p className="mt-1 text-xs text-slate-400">Abrir entradas</p>
            </Link>
            <Link href="/financeiro/despesas" className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 transition-colors hover:border-primary/30 hover:bg-white/[0.06]">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Despesas</p>
              <p className="mt-2 text-lg font-semibold text-white">{formatCurrency(totalExpense)}</p>
              <p className="mt-1 text-xs text-slate-400">Abrir saidas</p>
            </Link>
            <Link href="/financeiro/categorias" className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 transition-colors hover:border-primary/30 hover:bg-white/[0.06]">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Categorias</p>
              <p className="mt-2 text-lg font-semibold text-white">{categories.length}</p>
              <p className="mt-1 text-xs text-slate-400">Organizacao do uso</p>
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Banknote}
          title="Receita do periodo"
          value={formatCurrency(totalRevenue)}
          helper={revenueChange === null
            ? 'Sem base de comparacao no mes anterior.'
            : `Comparado ao mes anterior: ${formatPercent(revenueChange, 0)}.`}
          tone={revenueChange !== null && revenueChange >= 0 ? 'positive' : 'neutral'}
        />
        <MetricCard
          icon={TrendingDown}
          title="Despesa do periodo"
          value={formatCurrency(totalExpense)}
          helper={expenseChange === null
            ? 'Sem base de comparacao no mes anterior.'
            : `Comparado ao mes anterior: ${formatPercent(expenseChange, 0)}.`}
          tone={expenseChange !== null && expenseChange <= 0 ? 'positive' : 'warning'}
        />
        <MetricCard
          icon={Wallet}
          title="Lucro estimado"
          value={formatCurrency(profit)}
          helper={profit >= 0 ? 'Resultado positivo para o periodo.' : 'Resultado negativo pede ajuste de ritmo.'}
          tone={profit >= 0 ? 'positive' : 'warning'}
        />
        <MetricCard
          icon={BadgeDollarSign}
          title="Meta mensal"
          value={goalValue > 0 ? formatPercent(goalAttainment, 0) : 'Sem meta'}
          helper={goalValue > 0
            ? `Faltam ${formatCurrency(Math.max(0, goalValue - totalRevenue))} para bater a meta.`
            : 'Cadastre uma meta para medir o ritmo do mes.'}
          tone={goalValue > 0 && goalAttainment >= 100 ? 'positive' : 'neutral'}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <section className="dashboard-panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Tendencia dos ultimos 6 meses</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Uma linha simples para enxergar se o negocio ganhou tracao ou perdeu folego.
              </p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
              {isCurrentMonth ? 'Mes atual' : 'Mes fechado'}
            </span>
          </div>

          <div className="mt-6">
            <MonthBars data={series} />
          </div>
        </section>

        <section className="dashboard-panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Resumo para decidir</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Os sinais que ajudam a proteger caixa, meta e margem sem precisar abrir outra tela.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Projecao simples</p>
              <p className="mt-2 text-2xl font-semibold text-foreground tabular-nums">
                {formatCurrency(forecast.projectedNet)}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {forecast.projectedNet >= forecast.currentNet
                  ? 'Mantendo o ritmo atual, o fechamento tende a ficar acima do resultado parcial.'
                  : 'Com o ritmo atual, o fechamento precisa de recuperacao para preservar margem.'}
              </p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Meta e teto</p>
              <div className="mt-3 space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Meta de receita</span>
                    <span>{goalValue > 0 ? formatPercent(goalAttainment, 0) : 'Sem meta'}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-background/70">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(goalAttainment, 100)}%` }} />
                  </div>
                </div>
                {expenseLimit > 0 ? (
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Teto de despesas</span>
                      <span>{formatPercent(expenseLimitUsage, 0)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-background/70">
                      <div className={cn(
                        'h-full rounded-full',
                        expenseLimitUsage >= 100 ? 'bg-rose-500' : expenseLimitUsage >= 85 ? 'bg-amber-500' : 'bg-sky-500'
                      )} style={{ width: `${Math.min(expenseLimitUsage, 100)}%` }} />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    Nenhum teto de despesas configurado neste ciclo.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Sinais de maior peso</p>
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-xl bg-background/40 px-3 py-2">
                  <span className="text-sm text-foreground">Top receita</span>
                  <span className="text-sm text-muted-foreground">
                    {topRevenueCategory?.category?.name ?? 'Sem categoria'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-background/40 px-3 py-2">
                  <span className="text-sm text-foreground">Top despesa</span>
                  <span className="text-sm text-muted-foreground">
                    {topExpenseCategory?.category?.name ?? 'Sem categoria'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-background/40 px-3 py-2">
                  <span className="text-sm text-foreground">Movimentos</span>
                  <span className="text-sm text-muted-foreground">
                    {currentRevenue._count + currentExpense._count}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-background/40 px-3 py-2">
                  <span className="text-sm text-foreground">Mix de pagamentos</span>
                  <span className="text-sm text-muted-foreground">{formatCurrency(paymentTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Origem das receitas</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                A leitura comercial por canal de pagamento mostra onde o caixa fecha mais rapido.
              </p>
            </div>
            <Link href="/financeiro/receitas" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
              Ver receitas
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-5 space-y-3">
            {sortedPaymentBreakdown.length > 0 ? sortedPaymentBreakdown.map((item) => {
              const amount = Number(item._sum.amount ?? 0)
              const share = paymentTotal > 0 ? (amount / paymentTotal) * 100 : 0
              return (
                <div key={item.paymentMethod} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.paymentMethod}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatPercent(share, 0)} do total</p>
                    </div>
                    <p className="text-sm font-semibold text-foreground tabular-nums">{formatCurrency(amount)}</p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-background/70">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, share)}%` }} />
                  </div>
                </div>
              )
            }) : (
              <div className="rounded-2xl border border-dashed border-border bg-secondary/25 p-5 text-sm text-muted-foreground">
                Nenhuma receita registrada no periodo.
              </div>
            )}
          </div>
        </section>

        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Categorias que mais movem o caixa</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                O uso real de categorias mostra onde o resultado nasce e onde a saida aperta.
              </p>
            </div>
            <Link href="/financeiro/categorias" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
              Abrir categorias
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Top receita</p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {topRevenueCategory?.category?.name ?? 'Sem categoria'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {topRevenueCategory ? `${formatCurrency(topRevenueCategory.amount)} em ${topRevenueCategory.count} movimentos.` : 'Nenhum volume de receita por categoria.'}
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Top despesa</p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {topExpenseCategory?.category?.name ?? 'Sem categoria'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {topExpenseCategory ? `${formatCurrency(topExpenseCategory.amount)} em ${topExpenseCategory.count} movimentos.` : 'Nenhum volume de despesa por categoria.'}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/financeiro/fluxo-caixa" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              <TrendingUp className="h-4 w-4" />
              Ver fluxo de caixa
            </Link>
            <Link href="/financeiro/receitas" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
              <Layers3 className="h-4 w-4" />
              Revisar receitas
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
