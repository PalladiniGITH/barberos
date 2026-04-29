import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  buildBusinessDateTime,
  formatIsoDateInTimezone,
  formatTimeInTimezone,
  getCurrentDateTimeInTimezone,
  resolveBusinessTimezone,
} from '@/lib/timezone'

export const SCHEDULE_START_HOUR = 8
export const SCHEDULE_END_HOUR = 21
export const SCHEDULE_SLOT_STEP_MINUTES = 15
export const ACTIVE_APPOINTMENT_STATUS_VALUES = ['PENDING', 'CONFIRMED'] as const
export const DEFAULT_OPERATIONAL_BUFFER_MINUTES = 5
export const DEFAULT_MIN_LEAD_TIME_MINUTES = 20
const AVAILABILITY_DB_RETRY_DELAY_MS = 150
const TRANSIENT_PRISMA_ERROR_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024'])

export type AvailabilityTimePreference =
  | 'NONE'
  | 'EXACT'
  | 'MORNING'
  | 'AFTERNOON'
  | 'LATE_AFTERNOON'
  | 'EVENING'
  | (string & {})

export interface BlockingAppointment {
  id: string
  professionalId: string
  startAt: Date
  endAt: Date
  sourceReference: string | null
}

export class AvailabilityInfrastructureError extends Error {
  label: string

  constructor(label: string, cause?: unknown) {
    super(`availability_infrastructure_error:${label}`)
    this.name = 'AvailabilityInfrastructureError'
    this.label = label
    if (cause instanceof Error && cause.stack) {
      this.stack = cause.stack
    }
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractAvailabilityErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function isTransientAvailabilityDbError(error: unknown) {
  if (error instanceof AvailabilityInfrastructureError) {
    return true
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof Prisma.PrismaClientInitializationError
    || error instanceof Prisma.PrismaClientRustPanicError
    || error instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : null
    if (code && TRANSIENT_PRISMA_ERROR_CODES.has(code)) {
      return true
    }
  }

  const message = extractAvailabilityErrorMessage(error).toLowerCase()
  return /(?:connection|closed the connection|server has closed|can't reach database|timeout|timed out|econnreset|econnrefused|pool)/i.test(
    message
  )
}

export async function runAvailabilityDbQueryWithRetry<T>(input: {
  label: string
  operation: () => Promise<T>
}) {
  let attempt = 1

  while (attempt <= 2) {
    console.info('[availability] db query started', {
      label: input.label,
      attempt,
    })

    try {
      const result = await input.operation()

      if (attempt > 1) {
        console.info('[availability] db query success after retry', {
          label: input.label,
          attempt,
        })
      }

      return result
    } catch (error) {
      const transient = isTransientAvailabilityDbError(error)

      console.warn('[availability] db query failed', {
        label: input.label,
        attempt,
        transient,
        error: extractAvailabilityErrorMessage(error),
      })

      if (!transient || attempt >= 2) {
        if (transient) {
          throw new AvailabilityInfrastructureError(input.label, error)
        }

        throw error
      }

      console.info('[availability] db query retry', {
        label: input.label,
        attempt,
        retryInMs: AVAILABILITY_DB_RETRY_DELAY_MS,
      })

      await wait(AVAILABILITY_DB_RETRY_DELAY_MS)
      attempt += 1
    }
  }

  throw new AvailabilityInfrastructureError(input.label)
}

export function buildLocalDate(baseDateIso: string, hours = 0, minutes = 0, timezone?: string | null) {
  return buildBusinessDateTime(baseDateIso, hours, minutes, timezone)
}

export function formatLocalDate(date: Date, timezone?: string | null) {
  return formatIsoDateInTimezone(date, timezone)
}

export function formatTimeLabel(date: Date, timezone?: string | null) {
  return formatTimeInTimezone(date, timezone)
}

export function normalizeAvailabilityTimePreference(value?: string | null) {
  if (!value) {
    return 'NONE'
  }

  return value.trim().toUpperCase() as AvailabilityTimePreference
}

export function getOperationalBufferMinutes() {
  const rawValue = process.env.WHATSAPP_APPOINTMENT_BUFFER_MINUTES
  const parsed = Number(rawValue)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_OPERATIONAL_BUFFER_MINUTES
  }

  return Math.min(30, Math.round(parsed))
}

function roundDateUpToStep(date: Date) {
  const rounded = new Date(date)
  rounded.setSeconds(0, 0)

  const roundedMinutes =
    Math.ceil(rounded.getMinutes() / SCHEDULE_SLOT_STEP_MINUTES) * SCHEDULE_SLOT_STEP_MINUTES

  if (roundedMinutes >= 60) {
    rounded.setHours(rounded.getHours() + 1, 0, 0, 0)
  } else {
    rounded.setMinutes(roundedMinutes, 0, 0)
  }

  return rounded
}

export function getMinimumLeadTimeMinutes() {
  const rawValue = process.env.WHATSAPP_MIN_LEAD_TIME_MINUTES
  const parsed = Number(rawValue)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MIN_LEAD_TIME_MINUTES
  }

  return Math.min(240, Math.round(parsed))
}

export function getNowRoundedToStep(timezone?: string | null, referenceDate = new Date()) {
  const resolvedTimezone = resolveBusinessTimezone(timezone)
  const nowContext = getCurrentDateTimeInTimezone(resolvedTimezone, referenceDate)
  const now = buildLocalDate(nowContext.dateIso, nowContext.hour, nowContext.minute, resolvedTimezone)
  return roundDateUpToStep(now)
}

export function getEarliestCustomerSlotStart(input: {
  timezone?: string | null
  leadTimeMinutes?: number | null
  referenceDate?: Date
}) {
  const resolvedTimezone = resolveBusinessTimezone(input.timezone)
  const leadTimeMinutes = typeof input.leadTimeMinutes === 'number'
    ? Math.max(0, Math.round(input.leadTimeMinutes))
    : getMinimumLeadTimeMinutes()
  const referenceDate = input.referenceDate ?? new Date()
  const nowContext = getCurrentDateTimeInTimezone(resolvedTimezone, referenceDate)
  const now = buildLocalDate(nowContext.dateIso, nowContext.hour, nowContext.minute, resolvedTimezone)
  const withLeadTime = new Date(now.getTime() + leadTimeMinutes * 60_000)

  return roundDateUpToStep(withLeadTime)
}

export function overlaps(startAt: Date, endAt: Date, blockedStart: Date, blockedEnd: Date) {
  return startAt < blockedEnd && endAt > blockedStart
}

export function hasBufferedConflict(input: {
  candidateStart: Date
  candidateEnd: Date
  blockedStart: Date
  blockedEnd: Date
  bufferMinutes: number
}) {
  const bufferMs = input.bufferMinutes * 60_000
  const candidateBufferedEnd = new Date(input.candidateEnd.getTime() + bufferMs)
  const blockedBufferedEnd = new Date(input.blockedEnd.getTime() + bufferMs)

  return overlaps(input.candidateStart, candidateBufferedEnd, input.blockedStart, blockedBufferedEnd)
}

export function isAppointmentWithinWorkingWindow(input: {
  startAt: Date
  endAt: Date
  dayOpen: Date
  dayClose: Date
}) {
  return input.startAt >= input.dayOpen && input.endAt <= input.dayClose
}

export function matchesTimePreference(input: {
  startAt: Date
  preference?: string | null
  exactTime?: string | null
  timezone?: string | null
}) {
  const preference = normalizeAvailabilityTimePreference(input.preference)
  const [hours, minutes] = formatTimeLabel(input.startAt, input.timezone).split(':').map(Number)
  const minutesOfDay = hours * 60 + minutes

  if (preference === 'EXACT' && input.exactTime) {
    return formatTimeLabel(input.startAt, input.timezone) === input.exactTime
  }

  if (preference === 'NONE') {
    return true
  }

  if (preference === 'MORNING') {
    return minutesOfDay >= 8 * 60 && minutesOfDay <= 11 * 60 + 59
  }

  if (preference === 'AFTERNOON') {
    return minutesOfDay >= 12 * 60 && minutesOfDay <= 17 * 60 + 59
  }

  if (preference === 'LATE_AFTERNOON') {
    return minutesOfDay >= 16 * 60 && minutesOfDay <= 17 * 60 + 59
  }

  if (preference === 'EVENING') {
    return minutesOfDay >= 18 * 60 && minutesOfDay <= 20 * 60 + 59
  }

  return true
}

export function describeTimePreferenceWindow(preference?: string | null) {
  const normalized = normalizeAvailabilityTimePreference(preference)

  if (normalized === 'MORNING') return '08:00-11:59'
  if (normalized === 'AFTERNOON') return '12:00-17:59'
  if (normalized === 'LATE_AFTERNOON') return '16:00-17:59'
  if (normalized === 'EVENING') return '18:00-21:00'
  if (normalized === 'EXACT') return 'horario_exato'
  return '08:00-21:00'
}

export async function listBlockingAppointmentsForDay(input: {
  barbershopId: string
  dateIso: string
  professionalIds?: string[]
  timezone?: string | null
}) {
  const resolvedTimezone = resolveBusinessTimezone(input.timezone)
  const dayOpen = buildLocalDate(input.dateIso, SCHEDULE_START_HOUR, 0, resolvedTimezone)
  const dayClose = buildLocalDate(input.dateIso, SCHEDULE_END_HOUR, 0, resolvedTimezone)

  return runAvailabilityDbQueryWithRetry({
    label: 'blocking_appointments_for_day',
    operation: () => prisma.appointment.findMany({
      where: {
        barbershopId: input.barbershopId,
        professionalId: input.professionalIds?.length
          ? { in: input.professionalIds }
          : undefined,
        status: { in: [...ACTIVE_APPOINTMENT_STATUS_VALUES] },
        startAt: { lt: dayClose },
        endAt: { gt: dayOpen },
      },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        professionalId: true,
        startAt: true,
        endAt: true,
        sourceReference: true,
      },
    }),
  })
}

export const __testing = {
  getMinimumLeadTimeMinutes,
  getEarliestCustomerSlotStart,
  isAppointmentWithinWorkingWindow,
  isTransientAvailabilityDbError,
  matchesTimePreference,
  runAvailabilityDbQueryWithRetry,
}
