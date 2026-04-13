import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  SCHEDULE_END_HOUR,
  SCHEDULE_SLOT_STEP_MINUTES,
  SCHEDULE_START_HOUR,
  buildLocalDate,
  describeTimePreferenceWindow,
  formatLocalDate,
  formatTimeLabel,
  getNowRoundedToStep,
  getOperationalBufferMinutes,
  hasBufferedConflict,
  listBlockingAppointmentsForDay,
  matchesTimePreference,
} from '@/lib/agendamentos/availability'

export interface WhatsAppBookingSlot {
  key: string
  professionalId: string
  professionalName: string
  dateIso: string
  timeLabel: string
  startAtIso: string
  endAtIso: string
}

export interface WhatsAppAvailabilityDiagnostics {
  professionalId: string | null
  professionalName: string | null
  date: string
  period: string
  periodWindow: string
  serviceDuration: number | null
  bufferMinutes: number
  busyAppointmentsFound: number
  freeSlotsReturned: number
  finalReason:
    | 'success'
    | 'service_not_found'
    | 'professional_not_found'
    | 'no_active_professionals'
    | 'no_slots_available'
    | 'no_slots_in_requested_period'
    | 'exact_time_unavailable'
}

interface SchedulingServiceOption {
  id: string
  name: string
  duration: number
  price: number
}

export interface WhatsAppAvailabilityResult {
  service: SchedulingServiceOption | null
  slots: WhatsAppBookingSlot[]
  diagnostics: WhatsAppAvailabilityDiagnostics
}

function getSlotKey(professionalId: string, startAt: Date) {
  return `${professionalId}:${startAt.toISOString()}`
}

function normalizeTimePreference(value?: string | null) {
  const normalized = value?.trim().toUpperCase()
  return normalized && normalized !== 'NONE' ? normalized : 'NONE'
}

function buildDiagnostics(input: {
  professionalId?: string | null
  professionalName?: string | null
  date: string
  period?: string | null
  serviceDuration?: number | null
  bufferMinutes: number
  busyAppointmentsFound?: number
  freeSlotsReturned?: number
  finalReason: WhatsAppAvailabilityDiagnostics['finalReason']
}): WhatsAppAvailabilityDiagnostics {
  const period = normalizeTimePreference(input.period)

  return {
    professionalId: input.professionalId ?? null,
    professionalName: input.professionalName ?? null,
    date: input.date,
    period,
    periodWindow: describeTimePreferenceWindow(period),
    serviceDuration: input.serviceDuration ?? null,
    bufferMinutes: input.bufferMinutes,
    busyAppointmentsFound: input.busyAppointmentsFound ?? 0,
    freeSlotsReturned: input.freeSlotsReturned ?? 0,
    finalReason: input.finalReason,
  }
}

function logAvailabilityLookup(input: {
  barbershopId: string
  serviceId: string
  diagnostics: WhatsAppAvailabilityDiagnostics
  slots: WhatsAppBookingSlot[]
}) {
  console.info('[whatsapp-booking] availability computed', {
    barbershopId: input.barbershopId,
    serviceId: input.serviceId,
    professionalId: input.diagnostics.professionalId,
    professionalName: input.diagnostics.professionalName,
    date: input.diagnostics.date,
    period: input.diagnostics.period,
    periodWindow: input.diagnostics.periodWindow,
    serviceDuration: input.diagnostics.serviceDuration,
    bufferMinutes: input.diagnostics.bufferMinutes,
    busyAppointmentsFound: input.diagnostics.busyAppointmentsFound,
    freeSlotsReturned: input.diagnostics.freeSlotsReturned,
    finalReason: input.diagnostics.finalReason,
    slotsReturned: input.slots.map((slot) => slot.timeLabel),
  })
}

export async function loadBarbershopSchedulingOptions(barbershopId: string) {
  const [services, professionals] = await Promise.all([
    prisma.service.findMany({
      where: {
        barbershopId,
        active: true,
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        duration: true,
        price: true,
      },
    }),
    prisma.professional.findMany({
      where: {
        barbershopId,
        active: true,
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
      },
    }),
  ])

  return {
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      duration: service.duration,
      price: Number(service.price),
    })),
    professionals,
  }
}

export async function getAvailableWhatsAppSlots(input: {
  barbershopId: string
  serviceId: string
  dateIso: string
  professionalId?: string | null
  timePreference?: string | null
  exactTime?: string | null
  limit?: number
}): Promise<WhatsAppAvailabilityResult> {
  const operationalBufferMinutes = getOperationalBufferMinutes()
  const normalizedPeriod = normalizeTimePreference(input.timePreference)

  const service = await prisma.service.findFirst({
    where: {
      id: input.serviceId,
      barbershopId: input.barbershopId,
      active: true,
    },
    select: {
      id: true,
      name: true,
      duration: true,
      price: true,
    },
  })

  if (!service) {
    const diagnostics = buildDiagnostics({
      professionalId: input.professionalId,
      date: input.dateIso,
      period: normalizedPeriod,
      serviceDuration: null,
      bufferMinutes: operationalBufferMinutes,
      finalReason: 'service_not_found',
    })

    logAvailabilityLookup({
      barbershopId: input.barbershopId,
      serviceId: input.serviceId,
      diagnostics,
      slots: [],
    })

    return {
      service: null,
      slots: [],
      diagnostics,
    }
  }

  const professionals = await prisma.professional.findMany({
    where: {
      barbershopId: input.barbershopId,
      active: true,
      id: input.professionalId ? input.professionalId : undefined,
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
    },
  })

  if (professionals.length === 0) {
    const diagnostics = buildDiagnostics({
      professionalId: input.professionalId,
      date: input.dateIso,
      period: normalizedPeriod,
      serviceDuration: service.duration,
      bufferMinutes: operationalBufferMinutes,
      finalReason: input.professionalId ? 'professional_not_found' : 'no_active_professionals',
    })

    logAvailabilityLookup({
      barbershopId: input.barbershopId,
      serviceId: input.serviceId,
      diagnostics,
      slots: [],
    })

    return {
      service: {
        id: service.id,
        name: service.name,
        duration: service.duration,
        price: Number(service.price),
      },
      slots: [],
      diagnostics,
    }
  }

  const dayOpen = buildLocalDate(input.dateIso, SCHEDULE_START_HOUR, 0)
  const dayClose = buildLocalDate(input.dateIso, SCHEDULE_END_HOUR, 0)
  const currentRoundedTime = getNowRoundedToStep()
  const isToday = input.dateIso === formatLocalDate(new Date())
  const blockingAppointments = await listBlockingAppointmentsForDay({
    barbershopId: input.barbershopId,
    dateIso: input.dateIso,
    professionalIds: professionals.map((professional) => professional.id),
  })

  const appointmentsByProfessional = new Map<string, typeof blockingAppointments>()
  professionals.forEach((professional) => {
    appointmentsByProfessional.set(
      professional.id,
      blockingAppointments.filter((appointment) => appointment.professionalId === professional.id)
    )
  })

  const openSlotsBeforePeriodFilter: WhatsAppBookingSlot[] = []
  const openSlotsAfterPeriodFilter: WhatsAppBookingSlot[] = []

  for (const professional of professionals) {
    const blockedSlots = appointmentsByProfessional.get(professional.id) ?? []

    for (
      let candidate = new Date(dayOpen);
      candidate.getTime() + service.duration * 60_000 <= dayClose.getTime();
      candidate = new Date(candidate.getTime() + SCHEDULE_SLOT_STEP_MINUTES * 60_000)
    ) {
      const slotEnd = new Date(candidate.getTime() + service.duration * 60_000)
      const bufferedEnd = new Date(slotEnd.getTime() + operationalBufferMinutes * 60_000)

      if (isToday && candidate < currentRoundedTime) {
        continue
      }

      if (bufferedEnd > dayClose) {
        continue
      }

      const conflict = blockedSlots.some((appointment) =>
        hasBufferedConflict({
          candidateStart: candidate,
          candidateEnd: slotEnd,
          blockedStart: appointment.startAt,
          blockedEnd: appointment.endAt,
          bufferMinutes: operationalBufferMinutes,
        })
      )

      if (conflict) {
        continue
      }

      const slot = {
        key: getSlotKey(professional.id, candidate),
        professionalId: professional.id,
        professionalName: professional.name,
        dateIso: input.dateIso,
        timeLabel: formatTimeLabel(candidate),
        startAtIso: candidate.toISOString(),
        endAtIso: slotEnd.toISOString(),
      } satisfies WhatsAppBookingSlot

      openSlotsBeforePeriodFilter.push(slot)

      if (
        matchesTimePreference({
          startAt: candidate,
          preference: normalizedPeriod,
          exactTime: input.exactTime,
        })
      ) {
        openSlotsAfterPeriodFilter.push(slot)
      }
    }
  }

  const slots = openSlotsAfterPeriodFilter
    .sort((left, right) => new Date(left.startAtIso).getTime() - new Date(right.startAtIso).getTime())
    .slice(0, input.limit ?? 4)

  let finalReason: WhatsAppAvailabilityDiagnostics['finalReason'] = 'success'
  if (slots.length === 0) {
    if (normalizedPeriod === 'EXACT' && input.exactTime) {
      finalReason = 'exact_time_unavailable'
    } else if (openSlotsBeforePeriodFilter.length === 0) {
      finalReason = 'no_slots_available'
    } else {
      finalReason = 'no_slots_in_requested_period'
    }
  }

  const diagnostics = buildDiagnostics({
    professionalId: professionals.length === 1 ? professionals[0].id : input.professionalId ?? null,
    professionalName: professionals.length === 1 ? professionals[0].name : null,
    date: input.dateIso,
    period: normalizedPeriod,
    serviceDuration: service.duration,
    bufferMinutes: operationalBufferMinutes,
    busyAppointmentsFound: blockingAppointments.length,
    freeSlotsReturned: slots.length,
    finalReason,
  })

  logAvailabilityLookup({
    barbershopId: input.barbershopId,
    serviceId: input.serviceId,
    diagnostics,
    slots,
  })

  return {
    service: {
      id: service.id,
      name: service.name,
      duration: service.duration,
      price: Number(service.price),
    },
    slots,
    diagnostics,
  }
}

export async function findExactAvailableWhatsAppSlot(input: {
  barbershopId: string
  serviceId: string
  professionalId: string
  dateIso: string
  timeLabel: string
}) {
  const availability = await getAvailableWhatsAppSlots({
    barbershopId: input.barbershopId,
    serviceId: input.serviceId,
    professionalId: input.professionalId,
    dateIso: input.dateIso,
    timePreference: 'EXACT',
    exactTime: input.timeLabel,
    limit: 8,
  })

  return availability.slots.find((slot) => (
    slot.professionalId === input.professionalId
    && slot.dateIso === input.dateIso
    && slot.timeLabel === input.timeLabel
  )) ?? null
}

export async function createAppointmentFromWhatsApp(input: {
  barbershopId: string
  customerId: string
  serviceId: string
  professionalId: string
  startAtIso: string
  sourceReference: string
  notes?: string | null
}) {
  const [customer, service, professional] = await Promise.all([
    prisma.customer.findFirst({
      where: {
        id: input.customerId,
        barbershopId: input.barbershopId,
      },
      select: {
        id: true,
        type: true,
      },
    }),
    prisma.service.findFirst({
      where: {
        id: input.serviceId,
        barbershopId: input.barbershopId,
        active: true,
      },
      select: {
        id: true,
        duration: true,
        price: true,
      },
    }),
    prisma.professional.findFirst({
      where: {
        id: input.professionalId,
        barbershopId: input.barbershopId,
        active: true,
      },
      select: {
        id: true,
      },
    }),
  ])

  if (!customer || !service || !professional) {
    throw new Error('Dados de agendamento indisponiveis para o fluxo do WhatsApp.')
  }

  const startAt = new Date(input.startAtIso)
  const endAt = new Date(startAt.getTime() + service.duration * 60_000)
  const operationalBufferMinutes = getOperationalBufferMinutes()
  const bufferedEndAt = new Date(endAt.getTime() + operationalBufferMinutes * 60_000)
  const dateIso = formatLocalDate(startAt)
  const openAt = buildLocalDate(dateIso, SCHEDULE_START_HOUR, 0)
  const closeAt = buildLocalDate(dateIso, SCHEDULE_END_HOUR, 0)

  if (startAt < openAt || bufferedEndAt > closeAt) {
    throw new Error('O horario selecionado esta fora da janela de atendimento.')
  }

  const blockingAppointments = await listBlockingAppointmentsForDay({
    barbershopId: input.barbershopId,
    dateIso,
    professionalIds: [input.professionalId],
  })

  const conflictingAppointment = blockingAppointments.find((appointment) =>
    hasBufferedConflict({
      candidateStart: startAt,
      candidateEnd: endAt,
      blockedStart: appointment.startAt,
      blockedEnd: appointment.endAt,
      bufferMinutes: operationalBufferMinutes,
    })
  )

  if (conflictingAppointment) {
    throw new Error('O horario selecionado nao esta mais disponivel.')
  }

  const appointment = await prisma.appointment.create({
    data: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      professionalId: input.professionalId,
      serviceId: input.serviceId,
      status: 'CONFIRMED',
      source: 'WHATSAPP',
      billingModel: customer.type === 'SUBSCRIPTION' ? 'SUBSCRIPTION_INCLUDED' : 'AVULSO',
      startAt,
      endAt,
      durationMinutes: service.duration,
      priceSnapshot: service.price,
      notes: input.notes?.trim() || null,
      sourceReference: input.sourceReference,
      confirmedAt: new Date(),
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
    },
  })

  return {
    id: appointment.id,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
  }
}
