export interface TimezoneNowContext {
  timezone: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekdayIndex: number
  weekdayLabel: string
  dateIso: string
  dateTimeLabel: string
}

export type BusinessPeriod = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'CLOSED'

const DEFAULT_TIMEZONE = 'America/Sao_Paulo'
const APP_TIMEZONE_ENV = 'APP_TIMEZONE'

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

function readAppTimezoneEnv() {
  const value = process.env[APP_TIMEZONE_ENV]
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveBusinessTimezone(timezone?: string | null) {
  const preferred = timezone?.trim()
  if (preferred && isValidTimezone(preferred)) {
    return preferred
  }

  const appTimezone = readAppTimezoneEnv()
  if (appTimezone && isValidTimezone(appTimezone)) {
    return appTimezone
  }

  return DEFAULT_TIMEZONE
}

function getFormatter(timezone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
    hour12: false,
  })
}

function getDateTimePartsInTimezone(referenceDate: Date, timezone: string) {
  const formatter = getFormatter(timezone)
  const parts = formatter.formatToParts(referenceDate)

  const year = Number(parts.find((part) => part.type === 'year')?.value ?? referenceDate.getFullYear())
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? referenceDate.getMonth() + 1)
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? referenceDate.getDate())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? referenceDate.getHours())
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? referenceDate.getMinutes())
  const second = Number(parts.find((part) => part.type === 'second')?.value ?? referenceDate.getSeconds())
  const weekdayLabel = parts.find((part) => part.type === 'weekday')?.value ?? 'Monday'
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay()
  const dateIso = formatIsoDateParts({ year, month, day })

  return {
    timezone,
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekdayIndex,
    weekdayLabel,
    dateIso,
    dateTimeLabel: `${dateIso} ${pad(hour)}:${pad(minute)}`,
  }
}

function parseTimezoneOffsetLabel(value: string) {
  const normalized = value.trim().toUpperCase()

  if (normalized === 'GMT' || normalized === 'UTC') {
    return 0
  }

  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(normalized)
  if (!match) {
    return null
  }

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? '0')

  return sign * (hours * 60 + minutes)
}

function parseTimeLabel(timeLabel: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(timeLabel.trim())
  if (!match) {
    throw new Error(`Horario invalido: ${timeLabel}`)
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  }
}

export function formatIsoDateParts(input: {
  year: number
  month: number
  day: number
}) {
  return `${input.year}-${pad(input.month)}-${pad(input.day)}`
}

export function getCurrentDateTimeInTimezone(
  timezone?: string | null,
  referenceDate = new Date()
): TimezoneNowContext {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  return getDateTimePartsInTimezone(referenceDate, resolvedTimezone)
}

export function getTodayIsoInTimezone(timezone?: string | null, referenceDate = new Date()) {
  return getCurrentDateTimeInTimezone(timezone, referenceDate).dateIso
}

export function shiftIsoDate(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  date.setUTCDate(date.getUTCDate() + days)

  return formatIsoDateParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}

function getDaysInUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0)).getUTCDate()
}

export function shiftIsoDateByWeeks(dateIso: string, weeks: number) {
  return shiftIsoDate(dateIso, weeks * 7)
}

export function shiftIsoDateByMonths(dateIso: string, months: number) {
  const [year, month, day] = dateIso.split('-').map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const targetMonthIndex = anchor.getUTCMonth() + months
  const targetYear = anchor.getUTCFullYear() + Math.floor(targetMonthIndex / 12)
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12
  const clampedDay = Math.min(day, getDaysInUtcMonth(targetYear, normalizedMonthIndex))

  return formatIsoDateParts({
    year: targetYear,
    month: normalizedMonthIndex + 1,
    day: clampedDay,
  })
}

export function getStartOfWeekIsoDate(dateIso: string) {
  const [year, month, day] = dateIso.split('-').map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const weekday = anchor.getUTCDay()
  const offsetToMonday = weekday === 0 ? -6 : 1 - weekday
  anchor.setUTCDate(anchor.getUTCDate() + offsetToMonday)

  return formatIsoDateParts({
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  })
}

export function resolveWeekdayIsoDateInWeek(input: {
  referenceDateIso: string
  weekdayIndex: number
  weekOffset?: number
}) {
  const weekStartIso = shiftIsoDateByWeeks(getStartOfWeekIsoDate(input.referenceDateIso), input.weekOffset ?? 0)
  const dayOffset = input.weekdayIndex === 0 ? 6 : input.weekdayIndex - 1
  return shiftIsoDate(weekStartIso, dayOffset)
}

export function nextWeekdayIsoDate(baseIsoDate: string, weekdayIndex: number) {
  const [year, month, day] = baseIsoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const currentWeekday = date.getUTCDay()
  let delta = weekdayIndex - currentWeekday

  if (delta <= 0) {
    delta += 7
  }

  date.setUTCDate(date.getUTCDate() + delta)

  return formatIsoDateParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}

export function buildDateAnchorUtc(dateIso: string) {
  const [year, month, day] = dateIso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

export function formatWeekdayFromIsoDate(
  dateIso: string,
  timezone?: string | null,
  locale = 'pt-BR'
) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)

  return buildDateAnchorUtc(dateIso).toLocaleDateString(locale, {
    timeZone: resolvedTimezone,
    weekday: 'long',
  })
}

export function formatDayLabelFromIsoDate(
  dateIso: string,
  timezone?: string | null,
  locale = 'pt-BR'
) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)

  if (dateIso === getTodayIsoInTimezone(resolvedTimezone)) {
    return locale === 'pt-BR' ? 'Hoje' : 'Today'
  }

  return buildDateAnchorUtc(dateIso).toLocaleDateString(locale, {
    timeZone: resolvedTimezone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  })
}

export function getTimezoneOffsetMinutes(timezone: string, referenceDate = new Date()) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimezone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const timezoneNamePart = offsetFormatter
    .formatToParts(referenceDate)
    .find((part) => part.type === 'timeZoneName')?.value

  const parsedOffset = timezoneNamePart
    ? parseTimezoneOffsetLabel(timezoneNamePart)
    : null

  if (parsedOffset !== null) {
    return parsedOffset
  }

  const parts = getDateTimePartsInTimezone(referenceDate, resolvedTimezone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  )

  return Math.round((asUtc - referenceDate.getTime()) / 60_000)
}

export function buildBusinessDateTime(
  dateIso: string,
  hours = 0,
  minutes = 0,
  timezone?: string | null
) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  const [year, month, day] = dateIso.split('-').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hours, minutes, 0, 0)

  let offsetMinutes = getTimezoneOffsetMinutes(resolvedTimezone, new Date(utcGuess))
  let resolvedDate = new Date(utcGuess - offsetMinutes * 60_000)
  const adjustedOffsetMinutes = getTimezoneOffsetMinutes(resolvedTimezone, resolvedDate)

  if (adjustedOffsetMinutes !== offsetMinutes) {
    offsetMinutes = adjustedOffsetMinutes
    resolvedDate = new Date(utcGuess - offsetMinutes * 60_000)
  }

  return resolvedDate
}

export function buildBusinessDateTimeFromTimeLabel(
  dateIso: string,
  timeLabel: string,
  timezone?: string | null
) {
  const { hours, minutes } = parseTimeLabel(timeLabel)
  return buildBusinessDateTime(dateIso, hours, minutes, timezone)
}

export function localDateTimeToUtc(input: {
  dateIso: string
  timeLabel: string
  timezone?: string | null
}) {
  const resolvedTimezone = resolveBusinessTimezone(input.timezone)

  return {
    timezone: resolvedTimezone,
    startAtUtc: buildBusinessDateTimeFromTimeLabel(
      input.dateIso,
      input.timeLabel,
      resolvedTimezone
    ),
  }
}

export function getUtcRangeForLocalDate(input: {
  dateIso: string
  timezone?: string | null
}) {
  const resolvedTimezone = resolveBusinessTimezone(input.timezone)
  const startAtUtc = buildBusinessDateTime(input.dateIso, 0, 0, resolvedTimezone)
  const endAtUtc = buildBusinessDateTime(shiftIsoDate(input.dateIso, 1), 0, 0, resolvedTimezone)

  return {
    timezone: resolvedTimezone,
    startAtUtc,
    endAtUtc,
  }
}

export function serializeDateTimeInTimezone(date: Date, timezone?: string | null) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)

  return {
    timezone: resolvedTimezone,
    startAtUtc: date.toISOString(),
    dateIso: formatIsoDateInTimezone(date, resolvedTimezone),
    dateLabel: formatDateInTimezone(date, resolvedTimezone),
    timeLabel: formatTimeInTimezone(date, resolvedTimezone),
    dateTimeLabel: formatDateTimeInTimezone(date, resolvedTimezone),
  }
}

export function formatIsoDateInTimezone(date: Date, timezone?: string | null) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  return getDateTimePartsInTimezone(date, resolvedTimezone).dateIso
}

export function formatTimeInTimezone(date: Date, timezone?: string | null) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  const parts = getDateTimePartsInTimezone(date, resolvedTimezone)
  return `${pad(parts.hour)}:${pad(parts.minute)}`
}

export function formatDateTimeInTimezone(date: Date, timezone?: string | null) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  return getDateTimePartsInTimezone(date, resolvedTimezone).dateTimeLabel
}

export function formatDateInTimezone(
  date: Date,
  timezone?: string | null,
  locale = 'pt-BR'
) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  return date.toLocaleDateString(locale, {
    timeZone: resolvedTimezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function getMinutesOfDayInTimezone(date: Date, timezone?: string | null) {
  const [hours, minutes] = formatTimeInTimezone(date, timezone).split(':').map(Number)
  return hours * 60 + minutes
}

export function getCurrentBusinessPeriod(
  input: Pick<TimezoneNowContext, 'hour' | 'minute'>
): BusinessPeriod {
  const minutesOfDay = input.hour * 60 + input.minute

  if (minutesOfDay >= 21 * 60) {
    return 'CLOSED'
  }

  if (minutesOfDay >= 18 * 60) {
    return 'EVENING'
  }

  if (minutesOfDay >= 12 * 60) {
    return 'AFTERNOON'
  }

  return 'MORNING'
}

export function getAvailableBusinessPeriodsForDate(input: {
  selectedDateIso?: string | null
  nowContext: Pick<TimezoneNowContext, 'dateIso' | 'hour' | 'minute'>
}) {
  const allPeriods: Array<Exclude<BusinessPeriod, 'CLOSED'>> = ['MORNING', 'AFTERNOON', 'EVENING']

  if (!input.selectedDateIso || input.selectedDateIso !== input.nowContext.dateIso) {
    return allPeriods
  }

  const currentPeriod = getCurrentBusinessPeriod(input.nowContext)

  if (currentPeriod === 'CLOSED') {
    return [] as Array<Exclude<BusinessPeriod, 'CLOSED'>>
  }

  if (currentPeriod === 'EVENING') {
    return ['EVENING'] as Array<Exclude<BusinessPeriod, 'CLOSED'>>
  }

  if (currentPeriod === 'AFTERNOON') {
    return ['AFTERNOON', 'EVENING'] as Array<Exclude<BusinessPeriod, 'CLOSED'>>
  }

  return allPeriods
}
