import { createHash } from 'node:crypto'
import type { MonthMeta, SeedProfessionalRecord, SeedServiceRecord } from './types'

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

export function monthKey(month: number, year: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function createSeedId(namespace: string, ...parts: Array<string | number>) {
  const payload = [namespace, ...parts].join(':')
  const hash = createHash('sha1').update(payload).digest('hex').slice(0, 24)
  return `c${hash}`
}

export function getMonthMeta(baseDate: Date, offsetFromCurrent: number): MonthMeta {
  const date = new Date(baseDate.getFullYear(), baseDate.getMonth() - offsetFromCurrent, 1)
  const month = date.getMonth() + 1
  const year = date.getFullYear()

  return {
    key: monthKey(month, year),
    month,
    year,
    daysInMonth: new Date(year, month, 0).getDate(),
    isCurrent: offsetFromCurrent === 0,
    label: date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  }
}

export function listRecentMonths(baseDate: Date, count: number) {
  return Array.from({ length: count }, (_, index) => getMonthMeta(baseDate, count - 1 - index))
}

export function isOpenDay(date: Date) {
  return date.getDay() !== 0
}

export function ensureOpenDay(date: Date) {
  const target = new Date(date)

  while (!isOpenDay(target)) {
    target.setDate(target.getDate() + 1)
  }

  target.setHours(0, 0, 0, 0)
  return target
}

export function startOfDay(date: Date) {
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return target
}

export function dayOffset(baseDate: Date, offset: number) {
  const target = startOfDay(baseDate)
  target.setDate(target.getDate() + offset)
  return target
}

export function atTime(baseDate: Date, time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const target = new Date(baseDate)
  target.setHours(hours, minutes, 0, 0)
  return target
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

export function clampDay(day: number, daysInMonth: number) {
  return Math.max(1, Math.min(day, daysInMonth))
}

export function buildSafeDate(year: number, month: number, day: number) {
  return ensureOpenDay(new Date(year, month - 1, clampDay(day, new Date(year, month, 0).getDate())))
}

export function resolveOperationalPrice(
  service: Pick<SeedServiceRecord, 'price' | 'priceCategory'>,
  professional: Pick<SeedProfessionalRecord, 'haircutPrice' | 'beardPrice' | 'comboPrice'>
) {
  if (service.priceCategory === 'HAIRCUT') {
    return roundCurrency(professional.haircutPrice)
  }

  if (service.priceCategory === 'BEARD') {
    return roundCurrency(professional.beardPrice)
  }

  if (service.priceCategory === 'COMBO') {
    return roundCurrency(professional.comboPrice)
  }

  return roundCurrency(service.price)
}

export function buildAppointmentTimestamps(input: {
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'
  startAt: Date
  endAt: Date
}) {
  return {
    confirmedAt: input.status === 'CONFIRMED'
      ? addMinutes(input.startAt, -120)
      : input.status === 'COMPLETED'
        ? addMinutes(input.startAt, -150)
        : null,
    cancelledAt: input.status === 'CANCELLED' ? addMinutes(input.startAt, -90) : null,
    completedAt: input.status === 'COMPLETED' ? input.endAt : null,
  }
}
