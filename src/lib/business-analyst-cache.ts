import { createHash } from 'crypto'
import {
  buildBusinessDateTime,
  formatDateInTimezone,
  formatIsoDateInTimezone,
  formatTimeInTimezone,
  getCurrentDateTimeInTimezone,
  resolveBusinessTimezone,
  shiftIsoDate,
} from '@/lib/timezone'
import type { CustomerTypeFilter } from '@/lib/business-insights'

export type BusinessAnalystCachePeriodKey = 'MORNING' | 'EVENING'
export type BusinessAnalystCacheSource = 'BUSINESS_ANALYST'

export const BUSINESS_ANALYST_CACHE_SOURCE: BusinessAnalystCacheSource = 'BUSINESS_ANALYST'

export interface BusinessAnalystCacheWindow {
  timezone: string
  localDateIso: string
  periodKey: BusinessAnalystCachePeriodKey
  periodLabel: string
  expiresAt: Date
}

interface BusinessAnalystScopeInput {
  month: number
  year: number
  professionalId: string | null
  customerType: CustomerTypeFilter
}

function buildStableHashPayload(input: Record<string, unknown>) {
  return JSON.stringify(input, Object.keys(input).sort())
}

export function resolveBusinessAnalystCacheWindow(timezone?: string | null, referenceDate = new Date()): BusinessAnalystCacheWindow {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  const now = getCurrentDateTimeInTimezone(resolvedTimezone, referenceDate)
  const isEveningWindow = now.hour >= 17
  const periodKey: BusinessAnalystCachePeriodKey = isEveningWindow ? 'EVENING' : 'MORNING'
  const expiresAt = isEveningWindow
    ? buildBusinessDateTime(shiftIsoDate(now.dateIso, 1), 8, 0, resolvedTimezone)
    : buildBusinessDateTime(now.dateIso, 17, 0, resolvedTimezone)

  return {
    timezone: resolvedTimezone,
    localDateIso: now.dateIso,
    periodKey,
    periodLabel: periodKey === 'MORNING' ? 'Leitura da manhã' : 'Leitura da tarde',
    expiresAt,
  }
}

export function buildBusinessAnalystScopeKey(input: BusinessAnalystScopeInput) {
  return [
    `month:${input.month}`,
    `year:${input.year}`,
    `professional:${input.professionalId ?? 'all'}`,
    `customer:${input.customerType}`,
  ].join('|')
}

export function buildBusinessAnalystInputHash(input: BusinessAnalystScopeInput & {
  aiEnabled: boolean
  promptVersion: string
}) {
  return createHash('sha256')
    .update(buildStableHashPayload({
      month: input.month,
      year: input.year,
      professionalId: input.professionalId ?? 'all',
      customerType: input.customerType,
      aiEnabled: input.aiEnabled,
      promptVersion: input.promptVersion,
    }))
    .digest('hex')
}

export function buildBusinessAnalystUpdatedAtLabel(
  generatedAt: Date,
  timezone?: string | null,
  referenceDate = new Date()
) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  const generatedDateIso = formatIsoDateInTimezone(generatedAt, resolvedTimezone)
  const currentDateIso = getCurrentDateTimeInTimezone(resolvedTimezone, referenceDate).dateIso
  const timeLabel = formatTimeInTimezone(generatedAt, resolvedTimezone)

  if (generatedDateIso === currentDateIso) {
    return `Análise atualizada hoje às ${timeLabel}`
  }

  return `Análise atualizada em ${formatDateInTimezone(generatedAt, resolvedTimezone)} às ${timeLabel}`
}

export function buildBusinessAnalystNextRefreshLabel(
  nextRefreshAt: Date,
  timezone?: string | null,
  referenceDate = new Date()
) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  const nextDateIso = formatIsoDateInTimezone(nextRefreshAt, resolvedTimezone)
  const currentDateIso = getCurrentDateTimeInTimezone(resolvedTimezone, referenceDate).dateIso
  const timeLabel = formatTimeInTimezone(nextRefreshAt, resolvedTimezone)

  if (nextDateIso === currentDateIso) {
    return `Próxima atualização prevista: ${timeLabel}`
  }

  return `Próxima atualização prevista: ${formatDateInTimezone(nextRefreshAt, resolvedTimezone)} às ${timeLabel}`
}
