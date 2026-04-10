import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AlertCircle, ArrowUpRight, CheckCircle2, Clock, TrendingDown } from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange, formatCurrency, formatDate, EXPENSE_TYPE_LABELS, cn } from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { serializeForClient } from '@/lib/serialize-for-client'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { AddExpenseButton, type ExpenseCategoryOption } from '@/components/financeiro/add-expense-button'
import { MarkPaidButton } from '@/components/financeiro/mark-paid-button'
import { DeleteExpenseButton } from '@/components/financeiro/delete-expense-button'
import { FINANCE_SECTION_TABS } from '../_financeiro'

export const metadata: Metadata = { title: 'Despesas' }

interface Props {
  searchParams: { month?: string; year?: string }
}

export default async function DespesasPage({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const { start, end } = getMonthRange(month, year)
  const { barbershopId } = session.user

  const [expenses, categories] = await Promise.all([
    prisma.expense.findMany({
      where: { barbershopId, dueDate: { gte: start, lte: end } },
      include: { category: true },
      orderBy: [{ paid: 'asc' }, { dueDate: 'asc' }],
    }),
    prisma.financialCategory.findMany({
      where: { barbershopId, type: { in: ['EXPENSE_FIXED', 'EXPENSE_VARIABLE'] } },
      orderBy: { name: 'asc' },
    }),
  ])

  const totalFixed = expenses.filter((expense) => expense.type === 'FIXED').reduce((sum, expense) => sum + Number(expense.amount), 0)
  const totalVariable = expenses.filter((expense) => expense.type === 'VARIABLE').reduce((sum, expense) => sum + Number(expense.amount), 0)
  const totalExpenses = totalFixed + totalVariable
  const totalPaid = expenses.filter((expense) => expense.paid).reduce((sum, expense) => sum + Number(expense.amount), 0)
  const totalPending = totalExpenses - totalPaid
  const today = new Date()
  const overdue = expenses.filter((expense) => !expense.paid && expense.dueDate && new Date(expense.dueDate) < today)
  const expenseCategoryOptions = serializeForClient(
    categories.map((category) => ({
      id: category.id,
      name: category.name,
    }))
  ) as unknown as ExpenseCategoryOption[]

  return (
    <div className="page-section mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Despesas"
        description="Custos do periodo para proteger margem, caixa e previsibilidade."
        action={
          <div className="flex items-center gap-3">
            <Suspense>
              <PeriodSelector month={month} year={year} pathname="/financeiro/despesas" />
            </Suspense>
            <AddExpenseButton categories={expenseCategoryOptions} />
          </div>
        }
      />

      <SectionTabs items={FINANCE_SECTION_TABS} currentPath="/financeiro/despesas" />

      {overdue.length > 0 && (
        <div className="mb-1 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-medium text-red-300">
              {overdue.length} despesa{overdue.length > 1 ? 's' : ''} vencida{overdue.length > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-red-300/70">
              Total em atraso: {formatCurrency(overdue.reduce((sum, expense) => sum + Number(expense.amount), 0))}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="text-2xl font-bold tabular-nums text-rose-700">{formatCurrency(totalExpenses)}</p>
        </div>
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Fixas</p>
          <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(totalFixed)}</p>
        </div>
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Variaveis</p>
          <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(totalVariable)}</p>
        </div>
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">A pagar</p>
          <p className={cn('text-2xl font-bold tabular-nums', totalPending > 0 ? 'text-amber-700' : 'text-emerald-700')}>
            {formatCurrency(totalPending)}
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="dashboard-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h3 className="font-semibold text-foreground">Saidas do periodo</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Pagas: {formatCurrency(totalPaid)}
              </span>
              <span>{expenses.length} movimentos</span>
            </div>
          </div>

          {expenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <TrendingDown className="mb-3 h-10 w-10 opacity-40 text-muted-foreground" />
              <p className="text-muted-foreground">Nenhuma despesa registrada neste periodo</p>
              <p className="mt-1 text-sm text-muted-foreground">Use o botao "Nova Despesa" para registrar o primeiro compromisso.</p>
              <Link href="/financeiro/categorias" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                Ver categorias
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full data-table">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-left">Descricao</th>
                    <th className="px-5 py-3 text-left">Categoria</th>
                    <th className="px-5 py-3 text-left">Tipo</th>
                    <th className="px-5 py-3 text-left">Vencimento</th>
                    <th className="px-5 py-3 text-right">Valor</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => {
                    const isOverdue = !expense.paid && expense.dueDate && new Date(expense.dueDate) < today

                    return (
                      <tr
                        key={expense.id}
                        className={cn(
                          'group border-b border-border/50 transition-colors hover:bg-secondary/30',
                          expense.paid && 'opacity-50'
                        )}
                      >
                        <td className="px-5 py-3">
                          {expense.paid ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          ) : isOverdue ? (
                            <AlertCircle className="h-4 w-4 text-red-400" />
                          ) : (
                            <Clock className="h-4 w-4 text-amber-700" />
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm font-medium text-foreground">
                          {expense.description}
                          {expense.recurrent && (
                            <span className="ml-2 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                              recorrente
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm text-muted-foreground">{expense.category?.name ?? 'Sem categoria'}</td>
                        <td className="px-5 py-3 text-sm">
                          <span className={cn(
                            'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                            expense.type === 'FIXED' ? 'bg-sky-500/10 text-sky-700' : 'bg-amber-500/10 text-amber-700'
                          )}>
                            {EXPENSE_TYPE_LABELS[expense.type]}
                          </span>
                        </td>
                        <td className={cn('px-5 py-3 text-sm tabular-nums', isOverdue ? 'font-medium text-red-300' : 'text-muted-foreground')}>
                          {expense.dueDate ? formatDate(expense.dueDate) : 'Sem vencimento'}
                        </td>
                        <td className="px-5 py-3 text-right text-sm font-semibold tabular-nums text-rose-700">
                          {formatCurrency(Number(expense.amount))}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1">
                            {!expense.paid && <MarkPaidButton id={expense.id} />}
                            <div className="opacity-0 transition-opacity group-hover:opacity-100">
                              <DeleteExpenseButton id={expense.id} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-secondary/20">
                    <td colSpan={5} className="px-5 py-3 text-sm font-medium text-muted-foreground">Total</td>
                    <td className="px-5 py-3 text-right font-bold tabular-nums text-rose-700">
                      {formatCurrency(totalExpenses)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <aside className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Controle do periodo</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Uma leitura rapida para proteger o caixa e nao deixar atraso passar batido.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Pendencias</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{formatCurrency(totalPending)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {overdue.length > 0
                  ? `Existem ${overdue.length} despesa${overdue.length > 1 ? 's' : ''} com vencimento atrasado.`
                  : 'Nenhuma despesa vencida no periodo.'}
              </p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Categorias mais usadas</p>
              <div className="mt-3 space-y-2">
                {categories.slice(0, 3).map((category) => (
                  <div key={category.id} className="flex items-center justify-between gap-3 rounded-xl bg-background/40 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{category.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {category.type === 'EXPENSE_FIXED' ? 'Fixa' : 'Variavel'}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">{category.color}</span>
                  </div>
                ))}
                {categories.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border bg-background/30 p-4 text-sm text-muted-foreground">
                    Nenhuma categoria de despesa encontrada.
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/financeiro/categorias" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                <TrendingDown className="h-4 w-4" />
                Organizar categorias
              </Link>
              <Link href="/financeiro/fluxo-caixa" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
                <ArrowUpRight className="h-4 w-4" />
                Ver fluxo de caixa
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
