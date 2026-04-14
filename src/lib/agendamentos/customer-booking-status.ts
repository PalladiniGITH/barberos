import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  formatDateInTimezone,
  formatIsoDateInTimezone,
  formatTimeInTimezone,
  getTodayIsoInTimezone,
  localDateTimeToUtc,
  resolveBusinessTimezone,
  shiftIsoDate,
} from '@/lib/timezone'

export interface ExistingCustomerBookingItem {
  id: string
  status: 'PENDING' | 'CONFIRMED'
  dateIso: string
  dateLabel: string
  timeLabel: string
  professionalName: string
  serviceName: string
}

export async function getExistingCustomerBookings(input: {
  barbershopId: string
  customerId: string
  timezone: string
  requestedDateIso?: string | null
  limit?: number
}) {
  const timezone = resolveBusinessTimezone(input.timezone)
  const limit = input.limit ?? 3

  const startAtFilter = input.requestedDateIso
    ? (() => {
        const startOfDay = localDateTimeToUtc({
          dateIso: input.requestedDateIso,
          timeLabel: '00:00',
          timezone,
        }).startAtUtc
        const startOfNextDay = localDateTimeToUtc({
          dateIso: shiftIsoDate(input.requestedDateIso, 1),
          timeLabel: '00:00',
          timezone,
        }).startAtUtc

        return {
          gte: startOfDay,
          lt: startOfNextDay,
        }
      })()
    : {
        gte: new Date(),
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

  return appointments.map((appointment) => ({
    id: appointment.id,
    status: appointment.status as ExistingCustomerBookingItem['status'],
    dateIso: formatIsoDateInTimezone(appointment.startAt, timezone),
    dateLabel: formatDateInTimezone(appointment.startAt, timezone),
    timeLabel: formatTimeInTimezone(appointment.startAt, timezone),
    professionalName: appointment.professional.name,
    serviceName: appointment.service.name,
  })) satisfies ExistingCustomerBookingItem[]
}

function describeQueryDay(dateIso: string, timezone: string) {
  const todayIso = getTodayIsoInTimezone(timezone)
  if (dateIso === todayIso) {
    return 'hoje'
  }

  if (dateIso === shiftIsoDate(todayIso, 1)) {
    return 'amanha'
  }

  return `em ${dateIso.split('-').reverse().join('/')}`
}

export function buildExistingCustomerBookingResponse(input: {
  bookings: ExistingCustomerBookingItem[]
  requestedDateIso?: string | null
  timezone: string
  hasSchedulingContext: boolean
}) {
  const timezone = resolveBusinessTimezone(input.timezone)
  const continuationMessage = input.hasSchedulingContext
    ? ' Quer manter esse e marcar outro tambem, ou prefere ajustar esse?'
    : ' Se quiser, eu tambem posso te ajudar a marcar outro horario.'

  if (input.bookings.length === 0) {
    if (input.requestedDateIso) {
      return `${describeQueryDay(input.requestedDateIso, timezone)} voce nao tem nenhum horario confirmado.${input.hasSchedulingContext ? ' Se quiser, continuo o novo agendamento por aqui.' : ''}`
    }

    return `No momento voce nao tem nenhum horario confirmado.${input.hasSchedulingContext ? ' Se quiser, continuo o novo agendamento por aqui.' : ''}`
  }

  if (input.bookings.length === 1) {
    const booking = input.bookings[0]
    const dayDescription = input.requestedDateIso
      ? describeQueryDay(booking.dateIso, timezone)
      : `para ${describeQueryDay(booking.dateIso, timezone)}`

    const leadIn = input.requestedDateIso
      ? `${dayDescription.charAt(0).toUpperCase() + dayDescription.slice(1)} voce esta marcado as ${booking.timeLabel}`
      : `Seu proximo horario e ${dayDescription} as ${booking.timeLabel}`

    return `${leadIn} com ${booking.professionalName} para ${booking.serviceName}.${continuationMessage}`
  }

  const header = input.requestedDateIso
    ? `${describeQueryDay(input.requestedDateIso, timezone).charAt(0).toUpperCase() + describeQueryDay(input.requestedDateIso, timezone).slice(1)} voce tem estes horarios confirmados:`
    : 'Seus proximos horarios sao:'
  const lines = input.bookings
    .slice(0, 3)
    .map((booking) => {
      const datePrefix = input.requestedDateIso ? '' : `${describeQueryDay(booking.dateIso, timezone)} as `
      return `- ${datePrefix}${booking.timeLabel} com ${booking.professionalName} para ${booking.serviceName}`
    })
    .join('\n')

  return `${header}\n\n${lines}\n\n${continuationMessage.trim()}`
}
