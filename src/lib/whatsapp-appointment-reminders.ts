import 'server-only'

import { timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { getEvolutionInstanceName, normalizeEvolutionPhoneNumber, sendTextMessage } from '@/lib/integrations/evolution'
import { prisma } from '@/lib/prisma'
import {
  formatDayLabelFromIsoDate,
  formatIsoDateInTimezone,
  formatTimeInTimezone,
  resolveBusinessTimezone,
} from '@/lib/timezone'

export const WHATSAPP_APPOINTMENT_CONFIRMATION_ROUTE_PATH = '/api/internal/whatsapp-appointment-confirmations/run'
export const WHATSAPP_APPOINTMENT_CONFIRMATION_SECRET_HEADER = 'x-automation-secret'
export const DEFAULT_WHATSAPP_APPOINTMENT_CONFIRMATION_LEAD_MINUTES = 120
export const DEFAULT_WHATSAPP_APPOINTMENT_CONFIRMATION_TOLERANCE_MINUTES = 10
const CONVERSATION_CONTEXT_TTL_MS = 45 * 60_000

export interface AppointmentReminderSummary {
  scannedAppointments: number
  dueAppointmentsFound: number
  sent: number
  skipped: number
  failed: number
}

export interface ReminderAppointmentContext {
  id: string
  barbershopId: string
  customerId: string
  customerPhone: string | null
  customerName: string
  barbershopName: string
  timezone: string
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string
  status: 'PENDING' | 'CONFIRMED'
  startAt: Date
  endAt: Date
  dateIso: string
  dateLabel: string
  timeLabel: string
}

function getAutomationRunnerSecret() {
  const explicitSecret = process.env.AUTOMATION_RUNNER_SECRET?.trim()
  if (explicitSecret) {
    return explicitSecret
  }

  const fallbackSecret = process.env.NEXTAUTH_SECRET?.trim()
  return fallbackSecret || null
}

function safeCompare(left: string | null, right: string | null) {
  if (!left || !right) {
    return false
  }

  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function buildJsonValue(value: unknown) {
  return value as Prisma.InputJsonValue
}

function normalizeLeadMinutes(rawValue: string | undefined, fallback: number) {
  const parsed = Number.parseInt(rawValue?.trim() ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

function serializeReminderAppointment(input: {
  appointment: {
    id: string
    barbershopId: string
    customerId: string
    status: 'PENDING' | 'CONFIRMED'
    startAt: Date
    endAt: Date
    customer: { name: string, phone: string | null }
    barbershop: { name: string, timezone: string | null }
    professional: { id: string, name: string }
    service: { id: string, name: string }
  }
}) {
  const timezone = resolveBusinessTimezone(input.appointment.barbershop.timezone)
  const dateIso = formatIsoDateInTimezone(input.appointment.startAt, timezone)

  return {
    id: input.appointment.id,
    barbershopId: input.appointment.barbershopId,
    customerId: input.appointment.customerId,
    customerPhone: input.appointment.customer.phone,
    customerName: input.appointment.customer.name,
    barbershopName: input.appointment.barbershop.name,
    timezone,
    serviceId: input.appointment.service.id,
    serviceName: input.appointment.service.name,
    professionalId: input.appointment.professional.id,
    professionalName: input.appointment.professional.name,
    status: input.appointment.status,
    startAt: input.appointment.startAt,
    endAt: input.appointment.endAt,
    dateIso,
    dateLabel: formatDayLabelFromIsoDate(dateIso, timezone),
    timeLabel: formatTimeInTimezone(input.appointment.startAt, timezone),
  } satisfies ReminderAppointmentContext
}

export function getWhatsAppAppointmentConfirmationLeadMinutes() {
  return normalizeLeadMinutes(
    process.env.WHATSAPP_APPOINTMENT_CONFIRMATION_LEAD_MINUTES,
    DEFAULT_WHATSAPP_APPOINTMENT_CONFIRMATION_LEAD_MINUTES,
  )
}

export function getWhatsAppAppointmentConfirmationToleranceMinutes() {
  return normalizeLeadMinutes(
    process.env.WHATSAPP_APPOINTMENT_CONFIRMATION_TOLERANCE_MINUTES,
    DEFAULT_WHATSAPP_APPOINTMENT_CONFIRMATION_TOLERANCE_MINUTES,
  )
}

export function buildAppointmentConfirmationReminderMessage(input: {
  appointment: ReminderAppointmentContext
}) {
  return [
    `Oi, passando para confirmar seu horario na ${input.appointment.barbershopName}:`,
    '',
    `Data: ${input.appointment.dateLabel}`,
    `Horario: ${input.appointment.timeLabel}`,
    `Servico: ${input.appointment.serviceName}`,
    `Barbeiro: ${input.appointment.professionalName}`,
    '',
    'Voce confirma sua presenca?',
    '',
    'Responda:',
    '1 - Confirmo',
    '2 - Quero remarcar',
    '3 - Quero cancelar',
  ].join('\n')
}

export function buildAppointmentReminderDedupeKey(input: {
  appointmentId: string
  leadMinutes: number
}) {
  return `appointment-reminder:${input.appointmentId}:${input.leadMinutes}`
}

export function isWhatsAppAppointmentConfirmationRequestAuthorized(request: Request) {
  const sharedSecret = getAutomationRunnerSecret()
  const providedSecret =
    request.headers.get(WHATSAPP_APPOINTMENT_CONFIRMATION_SECRET_HEADER)
    ?? request.headers.get('x-internal-secret')

  return safeCompare(sharedSecret, providedSecret)
}

async function loadDueAppointmentsForReminder(input: {
  now: Date
  leadMinutes: number
  toleranceMinutes: number
}) {
  const windowStart = new Date(
    input.now.getTime() + Math.max(input.leadMinutes - input.toleranceMinutes, 0) * 60_000
  )
  const windowEnd = new Date(
    input.now.getTime() + (input.leadMinutes + input.toleranceMinutes) * 60_000
  )

  const appointments = await prisma.appointment.findMany({
    where: {
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: {
        gte: windowStart,
        lte: windowEnd,
      },
      confirmationReminderSentAt: null,
      customer: {
        phone: { not: null },
        active: true,
      },
      barbershop: {
        active: true,
      },
    },
    orderBy: { startAt: 'asc' },
    select: {
      id: true,
      barbershopId: true,
      customerId: true,
      status: true,
      startAt: true,
      endAt: true,
      customer: {
        select: {
          name: true,
          phone: true,
        },
      },
      barbershop: {
        select: {
          name: true,
          timezone: true,
        },
      },
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
    serializeReminderAppointment({
      appointment: {
        id: appointment.id,
        barbershopId: appointment.barbershopId,
        customerId: appointment.customerId,
        status: appointment.status as 'PENDING' | 'CONFIRMED',
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        customer: appointment.customer,
        barbershop: appointment.barbershop,
        professional: appointment.professional,
        service: appointment.service,
      },
    })
  )
}

async function primeReminderConversationContext(input: {
  appointment: ReminderAppointmentContext
  reminderMessage: string
  now: Date
}) {
  const conversation = await prisma.whatsappConversation.findUnique({
    where: {
      barbershopId_customerId: {
        barbershopId: input.appointment.barbershopId,
        customerId: input.appointment.customerId,
      },
    },
    select: {
      id: true,
      state: true,
      updatedAt: true,
    },
  })

  const shouldEnterReminderState =
    !conversation
    || conversation.state === 'IDLE'
    || input.now.getTime() - conversation.updatedAt.getTime() > CONVERSATION_CONTEXT_TTL_MS

  if (!shouldEnterReminderState) {
    return
  }

  await prisma.whatsappConversation.upsert({
    where: {
      barbershopId_customerId: {
        barbershopId: input.appointment.barbershopId,
        customerId: input.appointment.customerId,
      },
    },
    update: {
      phone: input.appointment.customerPhone,
      state: 'WAITING_REMINDER_RESPONSE',
      bookingDraft: buildJsonValue({
        kind: 'reminder',
        appointments: [
          {
            id: input.appointment.id,
            barbershopId: input.appointment.barbershopId,
            customerId: input.appointment.customerId,
            serviceId: input.appointment.serviceId,
            serviceName: input.appointment.serviceName,
            professionalId: input.appointment.professionalId,
            professionalName: input.appointment.professionalName,
            status: input.appointment.status,
            startAtIso: input.appointment.startAt.toISOString(),
            endAtIso: input.appointment.endAt.toISOString(),
            dateIso: input.appointment.dateIso,
            dateLabel: input.appointment.dateLabel,
            timeLabel: input.appointment.timeLabel,
          },
        ],
        selectedAppointmentId: input.appointment.id,
        triggeredByReminder: true,
        reminderPromptedAtIso: input.now.toISOString(),
      }),
      lastAssistantText: input.reminderMessage,
    },
    create: {
      barbershopId: input.appointment.barbershopId,
      customerId: input.appointment.customerId,
      phone: input.appointment.customerPhone,
      state: 'WAITING_REMINDER_RESPONSE',
      bookingDraft: buildJsonValue({
        kind: 'reminder',
        appointments: [
          {
            id: input.appointment.id,
            barbershopId: input.appointment.barbershopId,
            customerId: input.appointment.customerId,
            serviceId: input.appointment.serviceId,
            serviceName: input.appointment.serviceName,
            professionalId: input.appointment.professionalId,
            professionalName: input.appointment.professionalName,
            status: input.appointment.status,
            startAtIso: input.appointment.startAt.toISOString(),
            endAtIso: input.appointment.endAt.toISOString(),
            dateIso: input.appointment.dateIso,
            dateLabel: input.appointment.dateLabel,
            timeLabel: input.appointment.timeLabel,
          },
        ],
        selectedAppointmentId: input.appointment.id,
        triggeredByReminder: true,
        reminderPromptedAtIso: input.now.toISOString(),
      }),
      lastAssistantText: input.reminderMessage,
    },
  })
}

async function createReminderMessagingEvent(input: {
  appointment: ReminderAppointmentContext
  dedupeKey: string
  reminderMessage: string
}) {
  return prisma.messagingEvent.create({
    data: {
      barbershopId: input.appointment.barbershopId,
      customerId: input.appointment.customerId,
      provider: 'EVOLUTION',
      direction: 'OUTBOUND',
      status: 'PENDING',
      eventType: 'APPOINTMENT_CONFIRMATION_REMINDER',
      instanceName: getEvolutionInstanceName(),
      dedupeKey: input.dedupeKey,
      remotePhone: input.appointment.customerPhone,
      bodyText: input.reminderMessage,
      responseText: input.reminderMessage,
      payload: buildJsonValue({
        source: 'whatsapp-appointment-reminder',
        appointmentId: input.appointment.id,
        leadMinutes: getWhatsAppAppointmentConfirmationLeadMinutes(),
      }),
    },
    select: {
      id: true,
    },
  })
}

function isDuplicateError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === 'P2002'
  )
}

export async function runDueWhatsAppAppointmentConfirmations(input?: {
  now?: Date
  leadMinutes?: number
  toleranceMinutes?: number
}) {
  const now = input?.now ?? new Date()
  const leadMinutes = input?.leadMinutes ?? getWhatsAppAppointmentConfirmationLeadMinutes()
  const toleranceMinutes = input?.toleranceMinutes ?? getWhatsAppAppointmentConfirmationToleranceMinutes()

  console.info('[whatsapp-reminder] scan started', {
    leadMinutes,
    toleranceMinutes,
    now: now.toISOString(),
  })

  const dueAppointments = await loadDueAppointmentsForReminder({
    now,
    leadMinutes,
    toleranceMinutes,
  })

  console.info('[whatsapp-reminder] due appointments found', {
    count: dueAppointments.length,
  })

  const summary: AppointmentReminderSummary = {
    scannedAppointments: dueAppointments.length,
    dueAppointmentsFound: dueAppointments.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  }

  for (const appointment of dueAppointments) {
    const normalizedPhone = normalizeEvolutionPhoneNumber(appointment.customerPhone)

    if (!normalizedPhone) {
      summary.skipped += 1

      await prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          confirmationReminderStatus: 'FAILED',
          confirmationReminderError: 'invalid_phone',
        },
      })

      console.info('[whatsapp-reminder] skipped', {
        appointmentId: appointment.id,
        reason: 'invalid_phone',
      })
      continue
    }

    const reminderMessage = buildAppointmentConfirmationReminderMessage({
      appointment,
    })
    const dedupeKey = buildAppointmentReminderDedupeKey({
      appointmentId: appointment.id,
      leadMinutes,
    })

    let eventId: string | null = null

    try {
      const event = await createReminderMessagingEvent({
        appointment,
        dedupeKey,
        reminderMessage,
      })
      eventId = event.id
    } catch (error) {
      if (isDuplicateError(error)) {
        summary.skipped += 1
        console.info('[whatsapp-reminder] skipped', {
          appointmentId: appointment.id,
          reason: 'duplicate_event',
        })
        continue
      }

      throw error
    }

    try {
      const providerPayload = await sendTextMessage({
        number: normalizedPhone,
        text: reminderMessage,
      })

      await prisma.messagingEvent.update({
        where: { id: eventId! },
        data: {
          status: 'PROCESSED',
          providerMessageId: typeof providerPayload === 'object' && providerPayload && 'key' in providerPayload
            ? String((providerPayload as { key?: { id?: string } }).key?.id ?? '')
            : null,
          processedAt: new Date(),
        },
      })

      await prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          confirmationReminderSentAt: new Date(),
          confirmationReminderStatus: 'SENT',
          confirmationReminderError: null,
          confirmationRequestedAt: new Date(),
        },
      })

      await primeReminderConversationContext({
        appointment,
        reminderMessage,
        now,
      })

      summary.sent += 1
      console.info('[whatsapp-reminder] sent', {
        appointmentId: appointment.id,
        barbershopId: appointment.barbershopId,
      })
    } catch (error) {
      summary.failed += 1
      const message = error instanceof Error ? error.message : String(error)

      await prisma.messagingEvent.update({
        where: { id: eventId! },
        data: {
          status: 'FAILED',
          lastError: message,
        },
      })

      await prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          confirmationReminderStatus: 'FAILED',
          confirmationReminderError: message,
        },
      })

      console.error('[whatsapp-reminder] failed', {
        appointmentId: appointment.id,
        message,
      })
    }
  }

  return summary
}

export async function findPendingReminderAppointmentForCustomer(input: {
  barbershopId: string
  customerId: string
  now?: Date
}) {
  const now = input.now ?? new Date()

  const appointment = await prisma.appointment.findFirst({
    where: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { gt: now },
      confirmationRequestedAt: { not: null },
      confirmationResponseAt: null,
    },
    orderBy: [
      { confirmationRequestedAt: 'desc' },
      { startAt: 'asc' },
    ],
    select: {
      id: true,
      barbershopId: true,
      customerId: true,
      status: true,
      startAt: true,
      endAt: true,
      customer: {
        select: {
          name: true,
          phone: true,
        },
      },
      barbershop: {
        select: {
          name: true,
          timezone: true,
        },
      },
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

  return serializeReminderAppointment({
    appointment: {
      id: appointment.id,
      barbershopId: appointment.barbershopId,
      customerId: appointment.customerId,
      status: appointment.status as 'PENDING' | 'CONFIRMED',
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      customer: appointment.customer,
      barbershop: appointment.barbershop,
      professional: appointment.professional,
      service: appointment.service,
    },
  })
}

export async function confirmAppointmentPresenceFromReminder(input: {
  appointmentId: string
  barbershopId: string
}) {
  return prisma.appointment.updateMany({
    where: {
      id: input.appointmentId,
      barbershopId: input.barbershopId,
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    data: {
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      confirmationResponseAt: new Date(),
      confirmationResponseStatus: 'CONFIRMED',
    },
  })
}

export async function markAppointmentReminderResponse(input: {
  appointmentId: string
  barbershopId: string
  responseStatus: 'RESCHEDULE_REQUESTED' | 'CANCELLATION_REQUESTED'
}) {
  return prisma.appointment.updateMany({
    where: {
      id: input.appointmentId,
      barbershopId: input.barbershopId,
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    data: {
      confirmationResponseAt: new Date(),
      confirmationResponseStatus: input.responseStatus,
    },
  })
}

export const __testing = {
  buildAppointmentConfirmationReminderMessage,
  buildAppointmentReminderDedupeKey,
}
