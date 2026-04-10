import { getMonthRange } from '@/lib/utils'

export function resolvePeriod(searchParams: { month?: string; year?: string }) {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const rawMonth = parseInt(searchParams.month ?? '', 10)
  const rawYear = parseInt(searchParams.year ?? '', 10)

  const month = rawMonth >= 1 && rawMonth <= 12 ? rawMonth : currentMonth
  const year = rawYear >= 2020 && rawYear <= 2030 ? rawYear : currentYear

  return { month, year }
}

export function getComparisonWindow(month: number, year: number) {
  const { start, end } = getMonthRange(month, year)
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const prevRange = getMonthRange(prevMonth, prevYear)
  const now = new Date()
  const isCurrentMonth = now.getMonth() + 1 === month && now.getFullYear() === year

  if (!isCurrentMonth) {
    return {
      currentStart: start,
      currentEnd: end,
      previousStart: prevRange.start,
      previousEnd: prevRange.end,
      prevMonth,
      prevYear,
      partialComparison: false,
    }
  }

  const elapsedDay = now.getDate()
  const previousComparableDay = Math.min(elapsedDay, prevRange.end.getDate())

  return {
    currentStart: start,
    currentEnd: new Date(year, month - 1, elapsedDay, 23, 59, 59, 999),
    previousStart: prevRange.start,
    previousEnd: new Date(prevYear, prevMonth - 1, previousComparableDay, 23, 59, 59, 999),
    prevMonth,
    prevYear,
    partialComparison: true,
  }
}
