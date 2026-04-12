import 'server-only'

import { prisma } from '@/lib/prisma'

const BUSINESS_OPEN_HOUR = 8
const BUSINESS_CLOSE_HOUR = 21
const SLOT_STEP_MINUTES = 15

export interface WhatsAppBookingSlot {
  key: string
  professionalId: string
  professionalName: string
  dateIso: string
  timeLabel: string
  startAtIso: string
  endAtIso: string
}

function buildLocalDate(baseDateIso: string, hours = 0, minutes = 0) {
  const [year, month, day] = baseDateIso.split('-').map(Number)
  return new Date(year, month - 1, day, hours, minutes, 0, 0)
}

function formatTimeLabel(date: Date) {
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getNowRoundedToStep() {
  const now = new Date()
  now.setSeconds(0, 0)

  const roundedMinutes = Math.ceil(now.getMinutes() / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES
  if (roundedMinutes >= 60) {
    now.setHours(now.getHours() + 1, 0, 0, 0)
  } else {
    now.setMinutes(roundedMinutes, 0, 0)
  }

  return now
}

function getSlotKey(professionalId: string, startAt: Date) {
  return `${professionalId}:${startAt.toISOString()}`
}

function overlaps(startAt: Date, endAt: Date, blockedStart: Date, blockedEnd: Date) {
  return startAt < blockedEnd && endAt > blockedStart
}

function normalizeTimeLabel(value?: string | null) {
  if (!value) {
    return null
  }

  const normalized = value.trim().toUpperCase()
  return normalized || null
}

function filterSlotsByTimePreference(input: {
  slots: WhatsAppBookingSlot[]
  timePreference?: string | null
  exactTime?: string | null
}) {
  const timePreference = normalizeTimeLabel(input.timePreference)

  if (timePreference === 'EXACT' && input.exactTime) {
    return input.slots.filter((slot) => slot.timeLabel === input.exactTime)
  }

  if (!timePreference || timePreference === 'NONE') {
    return input.slots
  }

  return input.slots.filter((slot) => {
    const [hours] = slot.timeLabel.split(':').map(Number)

    if (timePreference === 'MORNING') {
      return hours >= 8 && hours < 12
    }

    if (timePreference === 'AFTERNOON') {
      return hours >= 12 && hours < 17
    }

    if (timePreference === 'LATE_AFTERNOON') {
      return hours >= 17 && hours < 19
    }

    if (timePreference === 'EVENING') {
      return hours >= 18 && hours < BUSINESS_CLOSE_HOUR
    }

    return true
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
}) {
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
    return {
      service: null,
      slots: [],
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
    return {
      service: {
        id: service.id,
        name: service.name,
        duration: service.duration,
        price: Number(service.price),
      },
      slots: [],
    }
  }

  const dayOpen = buildLocalDate(input.dateIso, BUSINESS_OPEN_HOUR, 0)
  const dayClose = buildLocalDate(input.dateIso, BUSINESS_CLOSE_HOUR, 0)
  const currentRoundedTime = getNowRoundedToStep()
  const isToday = input.dateIso === formatLocalDate(new Date())

  const appointments = await prisma.appointment.findMany({
    where: {
      barbershopId: input.barbershopId,
      professionalId: {
        in: professionals.map((professional) => professional.id),
      },
      status: {
        in: ['PENDING', 'CONFIRMED'],
      },
      startAt: { lt: dayClose },
      endAt: { gt: dayOpen },
    },
    orderBy: { startAt: 'asc' },
    select: {
      professionalId: true,
      startAt: true,
      endAt: true,
    },
  })

  const appointmentsByProfessional = new Map<string, typeof appointments>()
  professionals.forEach((professional) => {
    appointmentsByProfessional.set(
      professional.id,
      appointments.filter((appointment) => appointment.professionalId === professional.id)
    )
  })

  const slots: WhatsAppBookingSlot[] = []

  for (const professional of professionals) {
    const blockedSlots = appointmentsByProfessional.get(professional.id) ?? []

    for (
      let candidate = new Date(dayOpen);
      candidate.getTime() + service.duration * 60_000 <= dayClose.getTime();
      candidate = new Date(candidate.getTime() + SLOT_STEP_MINUTES * 60_000)
    ) {
      const slotEnd = new Date(candidate.getTime() + service.duration * 60_000)
      if (isToday && candidate < currentRoundedTime) {
        continue
      }

      const conflict = blockedSlots.some((appointment) =>
        overlaps(candidate, slotEnd, appointment.startAt, appointment.endAt)
      )

      if (conflict) {
        continue
      }

      slots.push({
        key: getSlotKey(professional.id, candidate),
        professionalId: professional.id,
        professionalName: professional.name,
        dateIso: input.dateIso,
        timeLabel: formatTimeLabel(candidate),
        startAtIso: candidate.toISOString(),
        endAtIso: slotEnd.toISOString(),
      })
    }
  }

  const filtered = filterSlotsByTimePreference({
    slots,
    timePreference: input.timePreference,
    exactTime: input.exactTime,
  })

  return {
    service: {
      id: service.id,
      name: service.name,
      duration: service.duration,
      price: Number(service.price),
    },
    slots: filtered
      .sort((left, right) => new Date(left.startAtIso).getTime() - new Date(right.startAtIso).getTime())
      .slice(0, input.limit ?? 4),
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
  const dateIso = input.startAtIso.slice(0, 10)
  const openAt = buildLocalDate(dateIso, BUSINESS_OPEN_HOUR, 0)
  const closeAt = buildLocalDate(dateIso, BUSINESS_CLOSE_HOUR, 0)

  if (startAt < openAt || endAt > closeAt) {
    throw new Error('O horario selecionado esta fora da janela de atendimento.')
  }

  const conflictingAppointment = await prisma.appointment.findFirst({
    where: {
      barbershopId: input.barbershopId,
      professionalId: input.professionalId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: {
      id: true,
    },
  })

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
