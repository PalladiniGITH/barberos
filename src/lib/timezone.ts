export interface TimezoneNowContext {
  timezone: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekdayIndex: number
  weekdayLabel: string
  dateIso: string
  dateTimeLabel: string
}

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
    weekday: 'long',
    hour12: false,
  })
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
  const formatter = getFormatter(resolvedTimezone)
  const parts = formatter.formatToParts(referenceDate)

  const year = Number(parts.find((part) => part.type === 'year')?.value ?? referenceDate.getFullYear())
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? referenceDate.getMonth() + 1)
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? referenceDate.getDate())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? referenceDate.getHours())
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? referenceDate.getMinutes())
  const weekdayLabel = parts.find((part) => part.type === 'weekday')?.value ?? 'Monday'
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay()
  const dateIso = formatIsoDateParts({ year, month, day })

  return {
    timezone: resolvedTimezone,
    year,
    month,
    day,
    hour,
    minute,
    weekdayIndex,
    weekdayLabel,
    dateIso,
    dateTimeLabel: `${dateIso} ${pad(hour)}:${pad(minute)}`,
  }
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
