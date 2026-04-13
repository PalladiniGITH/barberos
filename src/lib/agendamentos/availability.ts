import 'server-only'

import { prisma } from '@/lib/prisma'
import { getCurrentDateTimeInTimezone } from '@/lib/timezone'

export const SCHEDULE_START_HOUR = 8
export const SCHEDULE_END_HOUR = 21
export const SCHEDULE_SLOT_STEP_MINUTES = 15
export const ACTIVE_APPOINTMENT_STATUS_VALUES = ['PENDING', 'CONFIRMED'] as const
export const DEFAULT_OPERATIONAL_BUFFER_MINUTES = 5

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
}

export function buildLocalDate(baseDateIso: string, hours = 0, minutes = 0) {
  const [year, month, day] = baseDateIso.split('-').map(Number)
  return new Date(year, month - 1, day, hours, minutes, 0, 0)
}

export function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatTimeLabel(date: Date) {
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
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

export function getNowRoundedToStep(timezone?: string | null) {
  const nowContext = getCurrentDateTimeInTimezone(timezone)
  const now = buildLocalDate(nowContext.dateIso, nowContext.hour, nowContext.minute)
  now.setSeconds(0, 0)

  const roundedMinutes =
    Math.ceil(now.getMinutes() / SCHEDULE_SLOT_STEP_MINUTES) * SCHEDULE_SLOT_STEP_MINUTES

  if (roundedMinutes >= 60) {
    now.setHours(now.getHours() + 1, 0, 0, 0)
  } else {
    now.setMinutes(roundedMinutes, 0, 0)
  }

  return now
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

export function matchesTimePreference(input: {
  startAt: Date
  preference?: string | null
  exactTime?: string | null
}) {
  const preference = normalizeAvailabilityTimePreference(input.preference)
  const [hours, minutes] = formatTimeLabel(input.startAt).split(':').map(Number)
  const minutesOfDay = hours * 60 + minutes

  if (preference === 'EXACT' && input.exactTime) {
    return formatTimeLabel(input.startAt) === input.exactTime
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
}) {
  const dayOpen = buildLocalDate(input.dateIso, SCHEDULE_START_HOUR, 0)
  const dayClose = buildLocalDate(input.dateIso, SCHEDULE_END_HOUR, 0)

  return prisma.appointment.findMany({
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
    },
  })
}
