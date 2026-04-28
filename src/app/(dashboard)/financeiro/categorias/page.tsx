import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { type LucideIcon, ArrowUpRight, Tags, Wallet, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { assertAdministrativeRole, requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatCurrency, cn, getMonthRange } from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { AddCategoryButton } from '@/components/financeiro/add-category-button'
import { CATEGORY_TYPE_META, FINANCE_SECTION_TABS } from '../_financeiro'

export const metadata: Metadata = { title: 'Categorias' }

interface Props {
  searchParams: { month?: string; year?: string }
}

function SummaryCard({
  title,
  value,
  helper,
  icon: Icon,
}: {
  title: string
  value: string
  helper: string
  icon: LucideIcon
}) {
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-sky-300">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{helper}</p>
    </div>
  )
}

function CategoryBlock({
  title,
  tone,
  categories,
  totalAmount,
  totalMovements,
}: {
  title: string
  tone: keyof typeof CATEGORY_TYPE_META
  categories: Array<{
    id: string
    name: string
    color: string | null
    currentAmount: number
    totalAmount: number
    currentCount: number
    totalCount: number
  }>
  totalAmount: number
  totalMovements: number
}) {
  const meta = CATEGORY_TYPE_META[tone]

  return (
    <section className="dashboard-panel p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {meta.label} com leitura por uso real no periodo e no acumulado.
          </p>
        </div>
        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', meta.tone)}>
          {categories.length} categoria{categories.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {categories.map((category) => {
          const currentShare = totalAmount > 0 ? (category.currentAmount / totalAmount) * 100 : 0
          const totalShare = totalMovements > 0 ? (category.totalCount / totalMovements) * 100 : 0

          return (
            <div key={category.id} className={cn('rounded-2xl border bg-secondary/25 p-4', meta.border)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color ?? '#10b981' }} />
                    <p className="truncate text-sm font-semibold text-foreground">{category.name}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {category.currentCount} movimentos no periodo
                    {' '}
                    {category.totalCount > 0 ? `e ${category.totalCount} no total.` : 'e sem historico acumulado.'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(category.currentAmount)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{currentShare.toFixed(0)}% do total do grupo</p>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-background/70">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, currentShare)}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatCurrency(category.totalAmount)} acumulado</span>
                  <span>{totalShare.toFixed(0)}% do volume total</span>
                </div>
              </div>
            </div>
          )
        })}

        {categories.length === 0 && (
          <div className="empty-state-shell-subtle p-5 text-sm text-muted-foreground">
            Nenhuma categoria neste grupo. Quando houver movimentações, elas aparecerão aqui para acompanhar o uso real.
          </div>
        )}
      </div>
    </section>
  )
}

export default async function CategoriasPage({ searchParams }: Props) {
  const session = await requireSession()
  assertAdministrativeRole(session.user.role, 'Sem permissao para consultar as categorias financeiras da barbearia.')
  const { month, year } = resolvePeriod(searchParams)
  const { start, end } = getMonthRange(month, year)
  const { barbershopId } = session.user

  const [
    categories,
    revenueCurrent,
    revenueTotal,
    expenseFixedCurrent,
    expenseFixedTotal,
    expenseVariableCurrent,
    expenseVariableTotal,
  ] = await Promise.all([
    prisma.financialCategory.findMany({
      where: { barbershopId },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    prisma.revenue.groupBy({
      by: ['categoryId'],
      where: { barbershopId, date: { gte: start, lte: end }, categoryId: { not: null } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.revenue.groupBy({
      by: ['categoryId'],
      where: { barbershopId, categoryId: { not: null } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: { barbershopId, type: 'FIXED', dueDate: { gte: start, lte: end }, categoryId: { not: null } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: { barbershopId, type: 'FIXED', categoryId: { not: null } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: { barbershopId, type: 'VARIABLE', dueDate: { gte: start, lte: end }, categoryId: { not: null } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: { barbershopId, type: 'VARIABLE', categoryId: { not: null } },
      _sum: { amount: true },
      _count: true,
    }),
  ])

  function buildCategoryList(
    type: 'REVENUE' | 'EXPENSE_FIXED' | 'EXPENSE_VARIABLE',
    current: Array<{ categoryId: string | null; _sum: { amount: unknown | null }; _count: number }>,
    total: Array<{ categoryId: string | null; _sum: { amount: unknown | null }; _count: number }>
  ) {
    return categories
      .filter((category) => category.type === type)
      .map((category) => {
        const currentStats = current.find((item) => item.categoryId === category.id)
        const totalStats = total.find((item) => item.categoryId === category.id)

        return {
          id: category.id,
          name: category.name,
          color: category.color,
          currentAmount: Number(currentStats?._sum.amount ?? 0),
          totalAmount: Number(totalStats?._sum.amount ?? 0),
          currentCount: currentStats?._count ?? 0,
          totalCount: totalStats?._count ?? 0,
        }
      })
      .sort((left, right) => right.currentAmount - left.currentAmount)
  }

  const revenueCategories = buildCategoryList('REVENUE', revenueCurrent, revenueTotal)
  const fixedCategories = buildCategoryList('EXPENSE_FIXED', expenseFixedCurrent, expenseFixedTotal)
  const variableCategories = buildCategoryList('EXPENSE_VARIABLE', expenseVariableCurrent, expenseVariableTotal)

  const currentRevenueTotal = revenueCurrent.reduce((sum, item) => sum + Number(item._sum.amount ?? 0), 0)
  const currentFixedTotal = expenseFixedCurrent.reduce((sum, item) => sum + Number(item._sum.amount ?? 0), 0)
  const currentVariableTotal = expenseVariableCurrent.reduce((sum, item) => sum + Number(item._sum.amount ?? 0), 0)
  const allCategories = categories.length

  const usedCategories = categories.filter((category) => {
    const hasCurrent =
      revenueCurrent.some((item) => item.categoryId === category.id) ||
      expenseFixedCurrent.some((item) => item.categoryId === category.id) ||
      expenseVariableCurrent.some((item) => item.categoryId === category.id)

    return hasCurrent
  }).length

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Categorias"
        description="Acompanhe o uso real das categorias financeiras e veja onde o caixa entra ou sai com mais peso."
        action={(
          <div className="flex items-center gap-3">
            <Suspense>
              <PeriodSelector month={month} year={year} pathname="/financeiro/categorias" />
            </Suspense>
            <AddCategoryButton />
          </div>
        )}
      />

      <SectionTabs items={FINANCE_SECTION_TABS} currentPath="/financeiro/categorias" />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <SummaryCard
          icon={Tags}
          title="Categorias totais"
          value={String(allCategories)}
          helper="Todas as categorias cadastradas para receita e despesa."
        />
        <SummaryCard
          icon={Wallet}
          title="Categorias em uso"
          value={String(usedCategories)}
          helper="Categorias que receberam movimento no período atual."
        />
        <SummaryCard
          icon={ArrowUpCircle}
          title="Receitas categorizadas"
          value={formatCurrency(currentRevenueTotal)}
          helper="Volume comercial atribuido a categorias de receita."
        />
        <SummaryCard
          icon={ArrowDownCircle}
          title="Despesas categorizadas"
          value={formatCurrency(currentFixedTotal + currentVariableTotal)}
          helper="Saídas distribuídas entre despesas fixas e variáveis."
        />
      </div>

      <section className="dashboard-panel p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Leitura por tipo de uso</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              O mesmo cadastro responde por onde o caixa entra, onde a margem sai e o que merece ajuste.
            </p>
          </div>
          <Link href="/financeiro/fluxo-caixa" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
            Ver fluxo de caixa
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Receita</p>
            <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(currentRevenueTotal)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{revenueCategories.length} categorias com entrada registrada.</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Despesas fixas</p>
            <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(currentFixedTotal)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{fixedCategories.length} categorias monitoradas.</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Despesas variaveis</p>
            <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(currentVariableTotal)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{variableCategories.length} categorias monitoradas.</p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <CategoryBlock
          title="Receitas"
          tone="REVENUE"
          categories={revenueCategories}
          totalAmount={currentRevenueTotal}
          totalMovements={revenueCurrent.reduce((sum, item) => sum + item._count, 0)}
        />
        <CategoryBlock
          title="Despesas fixas"
          tone="EXPENSE_FIXED"
          categories={fixedCategories}
          totalAmount={currentFixedTotal}
          totalMovements={expenseFixedCurrent.reduce((sum, item) => sum + item._count, 0)}
        />
      </div>

      <CategoryBlock
        title="Despesas variaveis"
        tone="EXPENSE_VARIABLE"
        categories={variableCategories}
        totalAmount={currentVariableTotal}
        totalMovements={expenseVariableCurrent.reduce((sum, item) => sum + item._count, 0)}
      />

      <section className="dashboard-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Organizacao pronta para crescer</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Use a mesma estrutura de categoria para receitas, custo fixo e variavel sem perder leitura executiva.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/financeiro/receitas" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
              <ArrowUpCircle className="h-4 w-4" />
              Revisar receitas
            </Link>
            <Link href="/financeiro/despesas" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
              <ArrowDownCircle className="h-4 w-4" />
              Revisar despesas
            </Link>
            <AddCategoryButton />
          </div>
        </div>
      </section>
    </div>
  )
}
