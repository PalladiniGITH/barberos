import 'server-only'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import {
  AvailabilityInfrastructureError,
  SCHEDULE_END_HOUR,
  SCHEDULE_SLOT_STEP_MINUTES,
  SCHEDULE_START_HOUR,
  buildLocalDate,
  describeTimePreferenceWindow,
  formatLocalDate,
  formatTimeLabel,
  getEarliestCustomerSlotStart,
  getMinimumLeadTimeMinutes,
  getOperationalBufferMinutes,
  hasBufferedConflict,
  isTransientAvailabilityDbError,
  listBlockingAppointmentsForDay,
  matchesTimePreference,
  runAvailabilityDbQueryWithRetry,
} from '@/lib/agendamentos/availability'
import {
  formatDateTimeInTimezone,
  formatIsoDateInTimezone,
  getTodayIsoInTimezone,
  localDateTimeToUtc,
  resolveBusinessTimezone,
} from '@/lib/timezone'
import {
  canProfessionalHandleCustomerType,
  normalizeProfessionalOperationalConfig,
  resolveProfessionalServicePrice,
} from '@/lib/professionals/operational-config'

function safeRevalidateSchedulePath(path: string) {
  try {
    revalidatePath(path)
  } catch (error) {
    if (
      error instanceof Error
      && error.message.includes('static generation store missing')
    ) {
      console.info('[whatsapp-booking] revalidate skipped', {
        path,
        reason: 'static_generation_store_missing',
      })
      return
    }

    throw error
  }
}

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
  leadTimeMinutes: number
  firstEligibleSlotTime: string | null
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
    | 'infrastructure_error'
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

function dedupeWhatsAppSlots(slots: WhatsAppBookingSlot[]) {
  return slots.filter((slot, index, collection) =>
    collection.findIndex((candidate) =>
      candidate.professionalId === slot.professionalId
      && candidate.dateIso === slot.dateIso
      && candidate.timeLabel === slot.timeLabel
    ) === index
  )
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
  leadTimeMinutes: number
  firstEligibleSlotTime?: string | null
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
    leadTimeMinutes: input.leadTimeMinutes,
    firstEligibleSlotTime: input.firstEligibleSlotTime ?? null,
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
    leadTimeMinutes: input.diagnostics.leadTimeMinutes,
    firstEligibleSlotTime: input.diagnostics.firstEligibleSlotTime,
    busyAppointmentsFound: input.diagnostics.busyAppointmentsFound,
    freeSlotsReturned: input.diagnostics.freeSlotsReturned,
    finalReason: input.diagnostics.finalReason,
    slotsReturned: input.slots.map((slot) => `${slot.timeLabel} com ${slot.professionalName}`),
  })
}

export async function loadBarbershopSchedulingOptions(barbershopId: string) {
  const [services, professionals] = await Promise.all([
    runAvailabilityDbQueryWithRetry({
      label: 'load_scheduling_services',
      operation: () => prisma.service.findMany({
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
    }),
    runAvailabilityDbQueryWithRetry({
      label: 'load_scheduling_professionals',
      operation: () => prisma.professional.findMany({
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
  timezone?: string | null
  professionalId?: string | null
  timePreference?: string | null
  exactTime?: string | null
  limit?: number
}): Promise<WhatsAppAvailabilityResult> {
  const resolvedTimezone = resolveBusinessTimezone(input.timezone)
  const operationalBufferMinutes = getOperationalBufferMinutes()
  const minimumLeadTimeMinutes = getMinimumLeadTimeMinutes()
  const normalizedPeriod = normalizeTimePreference(input.timePreference)

  const service = await runAvailabilityDbQueryWithRetry({
    label: 'availability_service_lookup',
    operation: () => prisma.service.findFirst({
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
    }),
  })

  if (!service) {
    const diagnostics = buildDiagnostics({
      professionalId: input.professionalId,
      date: input.dateIso,
      period: normalizedPeriod,
      serviceDuration: null,
      bufferMinutes: operationalBufferMinutes,
      leadTimeMinutes: minimumLeadTimeMinutes,
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

  const professionals = await runAvailabilityDbQueryWithRetry({
    label: 'availability_professionals_lookup',
    operation: () => prisma.professional.findMany({
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
    }),
  })

  if (professionals.length === 0) {
    const diagnostics = buildDiagnostics({
      professionalId: input.professionalId,
      date: input.dateIso,
      period: normalizedPeriod,
      serviceDuration: service.duration,
      bufferMinutes: operationalBufferMinutes,
      leadTimeMinutes: minimumLeadTimeMinutes,
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

  const dayOpen = buildLocalDate(input.dateIso, SCHEDULE_START_HOUR, 0, resolvedTimezone)
  const dayClose = buildLocalDate(input.dateIso, SCHEDULE_END_HOUR, 0, resolvedTimezone)
  const isToday = input.dateIso === getTodayIsoInTimezone(resolvedTimezone)
  const firstEligibleStartAt = isToday
    ? getEarliestCustomerSlotStart({
        timezone: resolvedTimezone,
        leadTimeMinutes: minimumLeadTimeMinutes,
      })
    : dayOpen
  const firstEligibleSlotTime = isToday
    ? formatTimeLabel(firstEligibleStartAt, resolvedTimezone)
    : formatTimeLabel(dayOpen, resolvedTimezone)
  if (normalizedPeriod !== 'NONE' && normalizedPeriod !== 'EXACT') {
    console.info('[availability] period filter applied', {
      barbershopId: input.barbershopId,
      serviceId: input.serviceId,
      dateIso: input.dateIso,
      period: normalizedPeriod,
      timezone: resolvedTimezone,
    })
  }
  const blockingAppointments = await listBlockingAppointmentsForDay({
    barbershopId: input.barbershopId,
    dateIso: input.dateIso,
    professionalIds: professionals.map((professional) => professional.id),
    timezone: resolvedTimezone,
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

      if (isToday && candidate < firstEligibleStartAt) {
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
        timeLabel: formatTimeLabel(candidate, resolvedTimezone),
        startAtIso: candidate.toISOString(),
        endAtIso: slotEnd.toISOString(),
      } satisfies WhatsAppBookingSlot

      openSlotsBeforePeriodFilter.push(slot)

      if (
        matchesTimePreference({
          startAt: candidate,
          preference: normalizedPeriod,
          exactTime: input.exactTime,
          timezone: resolvedTimezone,
        })
      ) {
        openSlotsAfterPeriodFilter.push(slot)
      }
    }
  }

  const dedupedSlots = dedupeWhatsAppSlots(openSlotsAfterPeriodFilter)
  console.info('[availability] slots after period filter', {
    barbershopId: input.barbershopId,
    serviceId: input.serviceId,
    dateIso: input.dateIso,
    period: normalizedPeriod,
    count: dedupedSlots.length,
  })
  const slots = dedupedSlots
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
    leadTimeMinutes: minimumLeadTimeMinutes,
    firstEligibleSlotTime,
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

  if (dedupedSlots.length !== openSlotsAfterPeriodFilter.length) {
    console.info('[whatsapp-booking] offeredSlots deduplicated', {
      barbershopId: input.barbershopId,
      serviceId: input.serviceId,
      before: openSlotsAfterPeriodFilter.length,
      after: dedupedSlots.length,
      period: normalizedPeriod,
      dateIso: input.dateIso,
    })
  }

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
  timezone?: string | null
}) {
  try {
    const availability = await getAvailableWhatsAppSlots({
      barbershopId: input.barbershopId,
      serviceId: input.serviceId,
      professionalId: input.professionalId,
      dateIso: input.dateIso,
      timezone: input.timezone,
      timePreference: 'EXACT',
      exactTime: input.timeLabel,
      limit: 8,
    })

    return availability.slots.find((slot) => (
      slot.professionalId === input.professionalId
      && slot.dateIso === input.dateIso
      && slot.timeLabel === input.timeLabel
    )) ?? null
  } catch (error) {
    if (isTransientAvailabilityDbError(error)) {
      throw new AvailabilityInfrastructureError('find_exact_available_whatsapp_slot', error)
    }

    throw error
  }
}

export async function createAppointmentFromWhatsApp(input: {
  barbershopId: string
  customerId: string
  serviceId: string
  professionalId: string
  startAtIso?: string
  dateIso?: string
  timeLabel?: string
  timezone?: string | null
  sourceReference: string
  notes?: string | null
}) {
  const resolvedTimezone = resolveBusinessTimezone(input.timezone)
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
        name: true,
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
        name: true,
        haircutPrice: true,
        beardPrice: true,
        comboPrice: true,
        acceptsWalkIn: true,
        acceptsSubscription: true,
      },
    }),
  ])

  if (!customer || !service || !professional) {
    throw new Error('Dados de agendamento indisponiveis para o fluxo do WhatsApp.')
  }

  if (!canProfessionalHandleCustomerType({
    customerType: customer.type,
    professional,
  })) {
    throw new Error(
      customer.type === 'SUBSCRIPTION'
        ? `${professional.name} nao atende clientes de assinatura.`
        : `${professional.name} nao atende clientes avulsos.`
    )
  }

  const { chosenLocalDateTime, startAt } = resolveWhatsAppAppointmentStartAt({
    dateIso: input.dateIso ?? null,
    timeLabel: input.timeLabel ?? null,
    timezone: resolvedTimezone,
    fallbackStartAtIso: input.startAtIso ?? null,
  })
  const endAt = new Date(startAt.getTime() + service.duration * 60_000)
  const operationalBufferMinutes = getOperationalBufferMinutes()
  const bufferedEndAt = new Date(endAt.getTime() + operationalBufferMinutes * 60_000)
  const dateIso = input.dateIso ?? formatLocalDate(startAt, resolvedTimezone)
  const openAt = buildLocalDate(dateIso, SCHEDULE_START_HOUR, 0, resolvedTimezone)
  const closeAt = buildLocalDate(dateIso, SCHEDULE_END_HOUR, 0, resolvedTimezone)

  console.info('[whatsapp-booking] appointment datetime resolved', {
    barbershopId: input.barbershopId,
    customerId: input.customerId,
    professionalId: input.professionalId,
    serviceId: input.serviceId,
    chosenClientTime: input.timeLabel ?? null,
    chosenClientDate: dateIso,
    timezone: resolvedTimezone,
    chosenLocalDateTime,
    localDateTimeBuilt: formatDateTimeInTimezone(startAt, resolvedTimezone),
    startAtIsoSource: input.startAtIso ?? null,
    datetimePersistCandidateUtc: startAt.toISOString(),
  })

  console.info('[whatsapp-booking] final create datetime', {
    barbershopId: input.barbershopId,
    customerId: input.customerId,
    serviceId: input.serviceId,
    professionalId: input.professionalId,
    timezone: resolvedTimezone,
    selectedLocalDate: dateIso,
    selectedLocalTime: input.timeLabel ?? formatTimeLabel(startAt, resolvedTimezone),
    datetimePersistedUtc: startAt.toISOString(),
    datetimeConvertedBack: formatDateTimeInTimezone(startAt, resolvedTimezone),
  })

  if (startAt < openAt || bufferedEndAt > closeAt) {
    throw new Error('O horario selecionado esta fora da janela de atendimento.')
  }

  const blockingAppointments = await listBlockingAppointmentsForDay({
    barbershopId: input.barbershopId,
    dateIso,
    professionalIds: [input.professionalId],
    timezone: resolvedTimezone,
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

  const resolvedPrice = resolveProfessionalServicePrice({
    serviceName: service.name,
    basePrice: Number(service.price),
    professional: normalizeProfessionalOperationalConfig(professional),
  })

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
      priceSnapshot: resolvedPrice.price,
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

  console.info('[whatsapp-booking] appointment persisted', {
    appointmentId: appointment.id,
    timezone: resolvedTimezone,
    chosenLocalDateTime,
    localDateTimePersisted: formatDateTimeInTimezone(appointment.startAt, resolvedTimezone),
    datetimePersistedUtc: appointment.startAt.toISOString(),
    datetimeReturnedToAgendaUtc: appointment.startAt.toISOString(),
    datetimeReturnedToAgendaLocal: formatDateTimeInTimezone(appointment.startAt, resolvedTimezone),
    datetimeReturnedToQueueLocal: `${formatIsoDateInTimezone(appointment.startAt, resolvedTimezone)} ${formatTimeLabel(appointment.startAt, resolvedTimezone)}`,
  })

  safeRevalidateSchedulePath('/agendamentos')

  return {
    id: appointment.id,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
  }
}

export function resolveWhatsAppAppointmentStartAt(input: {
  dateIso?: string | null
  timeLabel?: string | null
  timezone?: string | null
  fallbackStartAtIso?: string | null
}) {
  const resolvedTimezone = resolveBusinessTimezone(input.timezone)
  const chosenLocalDateTime = input.dateIso && input.timeLabel
    ? `${input.dateIso} ${input.timeLabel}`
    : null
  const startAt = chosenLocalDateTime
    ? localDateTimeToUtc({
        dateIso: input.dateIso as string,
        timeLabel: input.timeLabel as string,
        timezone: resolvedTimezone,
      }).startAtUtc
    : new Date(input.fallbackStartAtIso as string)

  return {
    timezone: resolvedTimezone,
    chosenLocalDateTime,
    startAt,
  }
}

export const __testing = {
  dedupeWhatsAppSlots,
  resolveWhatsAppAppointmentStartAt,
}
