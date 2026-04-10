import { CategoryType } from '@prisma/client'
import { format, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { capitalize } from '@/lib/utils'

export const FINANCE_SECTION_TABS = [
  {
    href: '/financeiro',
    label: 'Visao geral',
    helper: 'Resumo executivo, tendencia e pontos de atencao.',
  },
  {
    href: '/financeiro/receitas',
    label: 'Receitas',
    helper: 'Entradas, ticket e origem do faturamento.',
  },
  {
    href: '/financeiro/despesas',
    label: 'Despesas',
    helper: 'Custos fixos, variaveis e contas a pagar.',
  },
  {
    href: '/financeiro/categorias',
    label: 'Categorias',
    helper: 'Leitura por tipo e uso real.',
  },
  {
    href: '/financeiro/fluxo-caixa',
    label: 'Fluxo de caixa',
    helper: 'Tendencia, saldo e previsao simples.',
  },
]

export const CATEGORY_TYPE_META: Record<CategoryType, { label: string; tone: string; border: string }> = {
  REVENUE: {
    label: 'Receita',
    tone: 'text-emerald-700 bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  EXPENSE_FIXED: {
    label: 'Despesa fixa',
    tone: 'text-sky-700 bg-sky-500/10',
    border: 'border-sky-500/20',
  },
  EXPENSE_VARIABLE: {
    label: 'Despesa variavel',
    tone: 'text-amber-700 bg-amber-500/10',
    border: 'border-amber-500/20',
  },
}

export interface MonthSeriesPoint {
  key: string
  label: string
  revenue: number
  expense: number
  net: number
}

export function getFinanceMonthWindow(month: number, year: number) {
  const base = new Date(year, month - 1, 1)
  const start = startOfMonth(base)
  const end = new Date(year, month, 0, 23, 59, 59, 999)

  return { start, end }
}

export function buildMonthSeries(
  month: number,
  year: number,
  revenues: Array<{ amount: unknown; date: Date }>,
  expenses: Array<{ amount: unknown; dueDate: Date | null; createdAt: Date }>
): MonthSeriesPoint[] {
  const base = new Date(year, month - 1, 1)
  const points: MonthSeriesPoint[] = []

  for (let offset = 5; offset >= 0; offset -= 1) {
    const current = new Date(base.getFullYear(), base.getMonth() - offset, 1)
    const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`

    points.push({
      key,
      label: capitalize(format(current, 'MMM', { locale: ptBR }).replace('.', '')),
      revenue: 0,
      expense: 0,
      net: 0,
    })
  }

  const byKey = new Map(points.map((point) => [point.key, point]))

  revenues.forEach((entry) => {
    const date = new Date(entry.date)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const point = byKey.get(key)
    if (!point) return
    point.revenue += Number(entry.amount ?? 0)
  })

  expenses.forEach((entry) => {
    const date = new Date(entry.dueDate ?? entry.createdAt)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const point = byKey.get(key)
    if (!point) return
    point.expense += Number(entry.amount ?? 0)
  })

  points.forEach((point) => {
    point.net = point.revenue - point.expense
  })

  return points
}

export function buildForecast(input: {
  currentNet: number
  daysElapsed: number
  daysInMonth: number
  isCurrentMonth: boolean
  recentNetHistory: number[]
}) {
  const remainingDays = Math.max(0, input.daysInMonth - input.daysElapsed)
  const dailyNet = input.daysElapsed > 0 ? input.currentNet / input.daysElapsed : 0
  const trailingAverage = input.recentNetHistory.length > 0
    ? input.recentNetHistory.reduce((sum, value) => sum + value, 0) / input.recentNetHistory.length
    : 0

  return {
    currentNet: input.currentNet,
    dailyNet,
    projectedNet: input.isCurrentMonth
      ? input.currentNet + (dailyNet * remainingDays)
      : trailingAverage,
    remainingDays,
    trailingAverage,
  }
}
