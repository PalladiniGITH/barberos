import 'server-only'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import {
  SCHEDULE_END_HOUR,
  SCHEDULE_START_HOUR,
  buildLocalDate,
  formatTimeLabel,
  getOperationalBufferMinutes,
  hasBufferedConflict,
} from '@/lib/agendamentos/availability'
import {
  formatDayLabelFromIsoDate,
  formatIsoDateInTimezone,
  formatTimeInTimezone,
  resolveBusinessTimezone,
} from '@/lib/timezone'
import {
  canProfessionalHandleCustomerType,
  normalizeProfessionalOperationalConfig,
  resolveProfessionalServicePrice,
} from '@/lib/professionals/operational-config'

export interface WhatsAppManagedAppointment {
  id: string
  barbershopId: string
  customerId: string
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED'
  startAtIso: string
  endAtIso: string
  dateIso: string
  dateLabel: string
  timeLabel: string
}

export interface RescheduleWhatsAppAppointmentResult {
  ok: boolean
  reason: 'success' | 'appointment_not_found' | 'slot_unavailable' | 'professional_mismatch'
  appointment: WhatsAppManagedAppointment | null
}

function safeRevalidateSchedulePath(path: string) {
  try {
    revalidatePath(path)
  } catch (error) {
    if (
      error instanceof Error
      && error.message.includes('static generation store missing')
    ) {
      console.info('[whatsapp-appointment-ops] revalidate skipped', {
        path,
        reason: 'static_generation_store_missing',
      })
      return
    }

    throw error
  }
}

function serializeManagedAppointment(input: {
  appointment: {
    id: string
    barbershopId: string
    customerId: string
    serviceId: string
    status: 'PENDING' | 'CONFIRMED' | 'CANCELLED'
    startAt: Date
    endAt: Date
    professional: { id: string, name: string }
    service: { id: string, name: string }
  }
  timezone: string
}) {
  return {
    id: input.appointment.id,
    barbershopId: input.appointment.barbershopId,
    customerId: input.appointment.customerId,
    serviceId: input.appointment.service.id,
    serviceName: input.appointment.service.name,
    professionalId: input.appointment.professional.id,
    professionalName: input.appointment.professional.name,
    status: input.appointment.status,
    startAtIso: input.appointment.startAt.toISOString(),
    endAtIso: input.appointment.endAt.toISOString(),
    dateIso: formatIsoDateInTimezone(input.appointment.startAt, input.timezone),
    dateLabel: formatDayLabelFromIsoDate(
      formatIsoDateInTimezone(input.appointment.startAt, input.timezone),
      input.timezone,
    ),
    timeLabel: formatTimeInTimezone(input.appointment.startAt, input.timezone),
  } satisfies WhatsAppManagedAppointment
}

export async function listFutureCustomerAppointmentsForWhatsApp(input: {
  barbershopId: string
  customerId: string
  timezone: string
  now?: Date
  limit?: number
}) {
  const timezone = resolveBusinessTimezone(input.timezone)
  const now = input.now ?? new Date()

  const appointments = await prisma.appointment.findMany({
    where: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { gte: now },
    },
    orderBy: { startAt: 'asc' },
    take: input.limit ?? 6,
    select: {
      id: true,
      barbershopId: true,
      customerId: true,
      serviceId: true,
      status: true,
      startAt: true,
      endAt: true,
      professional: {
        select: {
          id: true,
          name: true,
        },
      },
      service: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })

  return appointments.map((appointment) =>
    serializeManagedAppointment({
      appointment: {
        id: appointment.id,
        barbershopId: appointment.barbershopId,
        customerId: appointment.customerId,
        serviceId: appointment.serviceId,
        status: appointment.status as 'PENDING' | 'CONFIRMED',
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        professional: appointment.professional,
        service: appointment.service,
      },
      timezone,
    })
  )
}

export async function cancelAppointmentFromWhatsApp(input: {
  appointmentId: string
  barbershopId: string
  timezone: string
}) {
  const timezone = resolveBusinessTimezone(input.timezone)

  const updatedAppointment = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: {
        id: input.appointmentId,
        barbershopId: input.barbershopId,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      select: {
        id: true,
        barbershopId: true,
        customerId: true,
        serviceId: true,
        startAt: true,
        endAt: true,
        professional: {
          select: {
            id: true,
            name: true,
          },
        },
        service: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (!appointment) {
      return null
    }

    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: 'CANCELLED',
        confirmedAt: null,
        cancelledAt: new Date(),
      },
      select: {
        id: true,
        barbershopId: true,
        customerId: true,
        serviceId: true,
        status: true,
        startAt: true,
        endAt: true,
        professional: {
          select: {
            id: true,
            name: true,
          },
        },
        service: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    return updated
  })

  if (!updatedAppointment) {
    return null
  }

  safeRevalidateSchedulePath('/agendamentos')

  return serializeManagedAppointment({
    appointment: {
      id: updatedAppointment.id,
      barbershopId: updatedAppointment.barbershopId,
      customerId: updatedAppointment.customerId,
      serviceId: updatedAppointment.serviceId,
      status: updatedAppointment.status as 'PENDING' | 'CONFIRMED' | 'CANCELLED',
      startAt: updatedAppointment.startAt,
      endAt: updatedAppointment.endAt,
      professional: updatedAppointment.professional,
      service: updatedAppointment.service,
    },
    timezone,
  })
}

export async function rescheduleAppointmentFromWhatsApp(input: {
  appointmentId: string
  barbershopId: string
  timezone: string
  professionalId: string
  dateIso: string
  timeLabel: string
  startAtIso: string
  endAtIso: string
}) {
  const timezone = resolveBusinessTimezone(input.timezone)
  const startAt = new Date(input.startAtIso)
  const endAt = new Date(input.endAtIso)
  const operationalBufferMinutes = getOperationalBufferMinutes()

  const result = await prisma.$transaction(async (tx): Promise<RescheduleWhatsAppAppointmentResult> => {
    const appointment = await tx.appointment.findFirst({
      where: {
        id: input.appointmentId,
        barbershopId: input.barbershopId,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      select: {
        id: true,
        barbershopId: true,
        customerId: true,
        serviceId: true,
        status: true,
        startAt: true,
        endAt: true,
        billingModel: true,
        notes: true,
        sourceReference: true,
        customer: {
          select: {
            id: true,
            type: true,
          },
        },
        service: {
          select: {
            id: true,
            name: true,
            duration: true,
            price: true,
          },
        },
        professional: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (!appointment) {
      return {
        ok: false,
        reason: 'appointment_not_found',
        appointment: null,
      }
    }

    const targetProfessional = await tx.professional.findFirst({
      where: {
        id: input.professionalId,
        barbershopId: input.barbershopId,
        active: true,
      },
      select: {
        id: true,
        name: true,
        haircutPrice: true,
        beardPrice: true,
        comboPrice: true,
        acceptsWalkIn: true,
        acceptsSubscription: true,
      },
    })

    if (!targetProfessional) {
      return {
        ok: false,
        reason: 'professional_mismatch',
        appointment: null,
      }
    }

    if (!canProfessionalHandleCustomerType({
      customerType: appointment.customer.type,
      professional: targetProfessional,
    })) {
      return {
        ok: false,
        reason: 'professional_mismatch',
        appointment: null,
      }
    }

    const dayOpen = buildLocalDate(input.dateIso, SCHEDULE_START_HOUR, 0, timezone)
    const dayClose = buildLocalDate(input.dateIso, SCHEDULE_END_HOUR, 0, timezone)
    const bufferedEndAt = new Date(endAt.getTime() + operationalBufferMinutes * 60_000)

    if (startAt < dayOpen || bufferedEndAt > dayClose) {
      return {
        ok: false,
        reason: 'slot_unavailable',
        appointment: null,
      }
    }

    const dayAppointments = await tx.appointment.findMany({
      where: {
        barbershopId: input.barbershopId,
        professionalId: input.professionalId,
        id: { not: appointment.id },
        status: { in: ['PENDING', 'CONFIRMED'] },
        startAt: { lt: dayClose },
        endAt: { gt: dayOpen },
      },
      select: {
        startAt: true,
        endAt: true,
      },
    })

    const hasConflict = dayAppointments.some((blockingAppointment) =>
      hasBufferedConflict({
        candidateStart: startAt,
        candidateEnd: endAt,
        blockedStart: blockingAppointment.startAt,
        blockedEnd: blockingAppointment.endAt,
        bufferMinutes: operationalBufferMinutes,
      })
    )

    if (hasConflict) {
      return {
        ok: false,
        reason: 'slot_unavailable',
        appointment: null,
      }
    }

    const resolvedPrice = resolveProfessionalServicePrice({
      serviceName: appointment.service.name,
      basePrice: Number(appointment.service.price),
      professional: normalizeProfessionalOperationalConfig(targetProfessional),
    })

    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        professionalId: targetProfessional.id,
        startAt,
        endAt,
        durationMinutes: appointment.service.duration,
        priceSnapshot: resolvedPrice.price,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        cancelledAt: null,
        confirmationReminderSentAt: null,
        confirmationReminderStatus: null,
        confirmationReminderError: null,
        confirmationRequestedAt: null,
        confirmationResponseAt: null,
        confirmationResponseStatus: null,
      },
      select: {
        id: true,
        barbershopId: true,
        customerId: true,
        serviceId: true,
        status: true,
        startAt: true,
        endAt: true,
        professional: {
          select: {
            id: true,
            name: true,
          },
        },
        service: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    return {
      ok: true,
      reason: 'success',
      appointment: serializeManagedAppointment({
        appointment: {
          id: updated.id,
          barbershopId: updated.barbershopId,
          customerId: updated.customerId,
          serviceId: updated.serviceId,
          status: updated.status as 'PENDING' | 'CONFIRMED' | 'CANCELLED',
          startAt: updated.startAt,
          endAt: updated.endAt,
          professional: updated.professional,
          service: updated.service,
        },
        timezone,
      }),
    }
  })

  if (result.ok) {
    safeRevalidateSchedulePath('/agendamentos')
  }

  return result
}

export function formatManagedAppointmentSummaryLine(appointment: WhatsAppManagedAppointment) {
  return `${appointment.dateLabel} as ${appointment.timeLabel} - ${appointment.serviceName} com ${appointment.professionalName}`
}

export const __testing = {
  formatManagedAppointmentSummaryLine,
}
