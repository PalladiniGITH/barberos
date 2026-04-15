import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  formatWeekdayFromIsoDate,
  getTodayIsoInTimezone,
  getUtcRangeForLocalDate,
  resolveBusinessTimezone,
  serializeDateTimeInTimezone,
  shiftIsoDate,
} from '@/lib/timezone'

export type ExistingCustomerBookingQueryScope = 'NEXT' | 'DAY' | 'WEEK'

export interface ExistingCustomerBookingItem {
  id: string
  status: 'PENDING' | 'CONFIRMED'
  startAtUtc?: string
  dateIso: string
  dateLabel: string
  timeLabel: string
  professionalName: string
  serviceName: string
}

function serializeExistingCustomerBooking(input: {
  appointment: {
    id: string
    status: 'PENDING' | 'CONFIRMED'
    startAt: Date
    professional: { name: string }
    service: { name: string }
  }
  timezone: string
}) {
  const dateTime = serializeDateTimeInTimezone(input.appointment.startAt, input.timezone)

  return {
    id: input.appointment.id,
    status: input.appointment.status,
    startAtUtc: dateTime.startAtUtc,
    dateIso: dateTime.dateIso,
    dateLabel: dateTime.dateLabel,
    timeLabel: dateTime.timeLabel,
    professionalName: input.appointment.professional.name,
    serviceName: input.appointment.service.name,
  } satisfies ExistingCustomerBookingItem
}

export async function getExistingCustomerBookings(input: {
  barbershopId: string
  customerId: string
  timezone: string
  requestedDateIso?: string | null
  queryScope?: ExistingCustomerBookingQueryScope
  referenceDateIso?: string | null
  limit?: number
}) {
  const timezone = resolveBusinessTimezone(input.timezone)
  const limit = input.limit ?? 3
  const queryScope = input.queryScope ?? (input.requestedDateIso ? 'DAY' : 'NEXT')
  const referenceDateIso = input.referenceDateIso ?? getTodayIsoInTimezone(timezone)

  const nextWeekStartIso = (() => {
    const [year, month, day] = referenceDateIso.split('-').map(Number)
    const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    const weekday = anchor.getUTCDay()
    const daysUntilNextMonday = weekday === 0 ? 1 : 8 - weekday
    return shiftIsoDate(referenceDateIso, daysUntilNextMonday)
  })()

  const startAtFilter = queryScope === 'DAY' && input.requestedDateIso
    ? (() => {
        const { startAtUtc: startOfDay, endAtUtc: startOfNextDay } = getUtcRangeForLocalDate({
          dateIso: input.requestedDateIso,
          timezone,
        })

        return {
          gte: startOfDay,
          lt: startOfNextDay,
        }
      })()
    : queryScope === 'WEEK'
      ? (() => {
          const { startAtUtc: startOfReferenceDay } = getUtcRangeForLocalDate({
            dateIso: referenceDateIso,
            timezone,
          })
          const { startAtUtc: startOfNextWeek } = getUtcRangeForLocalDate({
            dateIso: nextWeekStartIso,
            timezone,
          })

          return {
            gte: startOfReferenceDay,
            lt: startOfNextWeek,
          }
      })()
    : {
        gte: getUtcRangeForLocalDate({
          dateIso: referenceDateIso,
          timezone,
        }).startAtUtc,
      }

  const appointments = await prisma.appointment.findMany({
    where: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: startAtFilter,
    },
    orderBy: { startAt: 'asc' },
    take: limit,
    select: {
      id: true,
      status: true,
      startAt: true,
      professional: {
        select: { name: true },
      },
      service: {
        select: { name: true },
      },
    },
  })

  return appointments.map((appointment) =>
    serializeExistingCustomerBooking({
      appointment: {
        id: appointment.id,
        status: appointment.status as ExistingCustomerBookingItem['status'],
        startAt: appointment.startAt,
        professional: appointment.professional,
        service: appointment.service,
      },
      timezone,
    })
  ) satisfies ExistingCustomerBookingItem[]
}

function describeQueryDay(dateIso: string, timezone: string, referenceDateIso?: string | null) {
  const todayIso = referenceDateIso ?? getTodayIsoInTimezone(timezone)
  if (dateIso === todayIso) {
    return 'hoje'
  }

  if (dateIso === shiftIsoDate(todayIso, 1)) {
    return 'amanha'
  }

  return `em ${dateIso.split('-').reverse().join('/')}`
}

function describeWeekday(dateIso: string, timezone: string) {
  return formatWeekdayFromIsoDate(dateIso, timezone).toLowerCase()
}

function capitalizeLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function buildDaySentenceLead(dateIso: string, timezone: string, referenceDateIso?: string | null) {
  const relativeDay = describeQueryDay(dateIso, timezone, referenceDateIso)

  if (relativeDay === 'hoje' || relativeDay === 'amanha') {
    return capitalizeLabel(relativeDay)
  }

  const weekday = describeWeekday(dateIso, timezone)
  const article = /^(sabado|domingo)/.test(
    weekday.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  ) ? 'No' : 'Na'
  return `${article} ${weekday}`
}

export function buildExistingCustomerBookingResponse(input: {
  bookings: ExistingCustomerBookingItem[]
  requestedDateIso?: string | null
  queryScope?: ExistingCustomerBookingQueryScope
  timezone: string
  hasSchedulingContext: boolean
  referenceDateIso?: string | null
}) {
  const timezone = resolveBusinessTimezone(input.timezone)
  const queryScope = input.queryScope ?? (input.requestedDateIso ? 'DAY' : 'NEXT')
  const referenceDateIso = input.referenceDateIso ?? getTodayIsoInTimezone(timezone)
  const continuationMessage = input.hasSchedulingContext
    ? ' Quer manter esse e marcar outro tambem, ou prefere ajustar esse?'
    : ''

  if (input.bookings.length === 0) {
    if (queryScope === 'WEEK') {
      return `Voce nao tem nenhum horario confirmado essa semana.${input.hasSchedulingContext ? ' Se quiser, continuo o novo agendamento por aqui.' : ''}`
    }

    if (input.requestedDateIso) {
      return `${buildDaySentenceLead(input.requestedDateIso, timezone, referenceDateIso)} voce nao tem nenhum horario confirmado.${input.hasSchedulingContext ? ' Se quiser, continuo o novo agendamento por aqui.' : ''}`
    }

    return `No momento voce nao tem nenhum horario confirmado.${input.hasSchedulingContext ? ' Se quiser, continuo o novo agendamento por aqui.' : ''}`
  }

  if (input.bookings.length === 1) {
    const booking = input.bookings[0]
    if (queryScope === 'WEEK') {
      return `Voce tem um horario na ${describeWeekday(booking.dateIso, timezone)} as ${booking.timeLabel} com ${booking.professionalName} para ${booking.serviceName}.${continuationMessage}`.trim()
    }

    const dayDescription = input.requestedDateIso
      ? describeQueryDay(booking.dateIso, timezone, referenceDateIso)
      : `para ${describeQueryDay(booking.dateIso, timezone, referenceDateIso)}`

    const leadIn = input.requestedDateIso
      ? `${dayDescription.charAt(0).toUpperCase() + dayDescription.slice(1)} voce esta marcado as ${booking.timeLabel}`
      : `Seu proximo horario e ${dayDescription} as ${booking.timeLabel}`

    return `${leadIn}\npara ${booking.serviceName} com ${booking.professionalName}.${continuationMessage}`.trim()
  }

  const header = queryScope === 'WEEK'
    ? 'Essa semana voce tem estes horarios confirmados:'
    : input.requestedDateIso
    ? `${buildDaySentenceLead(input.requestedDateIso, timezone, referenceDateIso)} voce tem estes horarios confirmados:`
    : 'Seus proximos horarios sao:'
  const lines = input.bookings
    .map((booking) => {
      const heading = queryScope === 'WEEK'
        ? `${capitalizeLabel(describeWeekday(booking.dateIso, timezone))} - ${booking.timeLabel}`
        : input.requestedDateIso
          ? `${booking.timeLabel}`
          : `${capitalizeLabel(describeQueryDay(booking.dateIso, timezone, referenceDateIso))} - ${booking.timeLabel}`
      return `- ${heading}\n  ${booking.serviceName} com ${booking.professionalName}`
    })
    .join('\n\n')

  return continuationMessage
    ? `${header}\n\n${lines}\n\n${continuationMessage.trim()}`
    : `${header}\n\n${lines}`
}

export const __testing = {
  serializeExistingCustomerBooking,
}
