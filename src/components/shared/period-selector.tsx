import Link from 'next/link'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PeriodSelectorProps {
  month: number
  year: number
  pathname: string
  queryParams?: Record<string, string | number | null | undefined>
}

function formatLabel(month: number, year: number) {
  return new Date(year, month - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    .replace(/^\w/, (char) => char.toUpperCase())
}

function buildPeriodHref(
  pathname: string,
  month: number,
  year: number,
  queryParams?: Record<string, string | number | null | undefined>
) {
  const params = new URLSearchParams()
  params.set('month', String(month))
  params.set('year', String(year))

  Object.entries(queryParams ?? {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      return
    }

    params.set(key, String(value))
  })

  return `${pathname}?${params.toString()}`
}

export function PeriodSelector({ month, year, pathname, queryParams }: PeriodSelectorProps) {
  const previousMonth = month === 1 ? 12 : month - 1
  const previousYear = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year

  const now = new Date()
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1

  return (
    <div className="flex items-center gap-1 rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-1 shadow-[0_18px_34px_-24px_rgba(2,6,23,0.58)]">
      <Link
        href={buildPeriodHref(pathname, previousMonth, previousYear, queryParams)}
        className="rounded-[0.8rem] p-2 text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>

      <div className="flex items-center gap-2 rounded-[0.9rem] border border-[rgba(124,58,237,0.18)] bg-[rgba(124,58,237,0.12)] px-3 py-1.5 text-foreground shadow-[0_16px_30px_-20px_rgba(2,6,23,0.48)]">
        <Calendar className="h-3.5 w-3.5 text-primary" />
        <span className="min-w-36 text-center text-[13px] font-semibold text-foreground">
          {formatLabel(month, year)}
        </span>
      </div>

      {isCurrentMonth ? (
        <span
          aria-disabled="true"
          className={cn(
            'rounded-[0.85rem] p-2 text-muted-foreground/40',
            'cursor-not-allowed'
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </span>
      ) : (
        <Link
          href={buildPeriodHref(pathname, nextMonth, nextYear, queryParams)}
          className="rounded-[0.8rem] p-2 text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  )
}
