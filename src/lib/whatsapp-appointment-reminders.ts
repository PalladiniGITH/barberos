import 'server-only'

import { timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { normalizeEvolutionPhoneNumber, sendTextMessage } from '@/lib/integrations/evolution'
import { prisma } from '@/lib/prisma'
import {
  formatDayLabelFromIsoDate,
  formatIsoDateInTimezone,
  formatTimeInTimezone,
  resolveBusinessTimezone,
} from '@/lib/timezone'
import {
  markWhatsAppIntegrationError,
  markWhatsAppOutboundDelivered,
  resolveWhatsAppOutboundIntegration,
} from '@/lib/whatsapp-tenant'

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
  expiredAppointmentsFound: number
  expired: number
  expiredOutboundSent: number
  expiredOutboundSkipped: number
  expiredOutboundFailed: number
}

export interface ReminderAppointmentContext {
  id: string
  barbershopId: string
  barbershopSlug: string | null
  customerId: string
  customerPhone: string | null
  customerName: string
  barbershopName: string
  timezone: string
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string
  source: 'WHATSAPP' | 'MANUAL'
  status: 'PENDING' | 'CONFIRMED'
  startAt: Date
  endAt: Date
  dateIso: string
  dateLabel: string
  timeLabel: string
  confirmationReminderSentAt: Date | null
  confirmationRequestedAt: Date | null
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

function getReminderConfirmationExpirationThreshold(now: Date) {
  return new Date(
    now.getTime() - getWhatsAppAppointmentConfirmationToleranceMinutes() * 60_000
  )
}

function serializeReminderAppointment(input: {
  appointment: {
    id: string
    barbershopId: string
    customerId: string
    source: 'WHATSAPP' | 'MANUAL'
    status: 'PENDING' | 'CONFIRMED'
    startAt: Date
    endAt: Date
    customer: { name: string, phone: string | null }
    barbershop: { name: string, slug?: string | null, timezone: string | null }
    professional: { id: string, name: string }
    service: { id: string, name: string }
    confirmationReminderSentAt: Date | null
    confirmationRequestedAt: Date | null
  }
}) {
  const timezone = resolveBusinessTimezone(input.appointment.barbershop.timezone)
  const dateIso = formatIsoDateInTimezone(input.appointment.startAt, timezone)

  return {
    id: input.appointment.id,
    barbershopId: input.appointment.barbershopId,
    barbershopSlug: input.appointment.barbershop.slug ?? null,
    customerId: input.appointment.customerId,
    customerPhone: input.appointment.customer.phone,
    customerName: input.appointment.customer.name,
    barbershopName: input.appointment.barbershop.name,
    timezone,
    serviceId: input.appointment.service.id,
    serviceName: input.appointment.service.name,
    professionalId: input.appointment.professional.id,
    professionalName: input.appointment.professional.name,
    source: input.appointment.source,
    status: input.appointment.status,
    startAt: input.appointment.startAt,
    endAt: input.appointment.endAt,
    dateIso,
    dateLabel: formatDayLabelFromIsoDate(dateIso, timezone),
    timeLabel: formatTimeInTimezone(input.appointment.startAt, timezone),
    confirmationReminderSentAt: input.appointment.confirmationReminderSentAt,
    confirmationRequestedAt: input.appointment.confirmationRequestedAt,
  } satisfies ReminderAppointmentContext
}

const REMINDER_APPOINTMENT_SELECT = {
  id: true,
  barbershopId: true,
  customerId: true,
  source: true,
  status: true,
  startAt: true,
  endAt: true,
  confirmationReminderSentAt: true,
  confirmationRequestedAt: true,
  customer: {
    select: {
      name: true,
      phone: true,
    },
  },
  barbershop: {
    select: {
      name: true,
      slug: true,
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
} satisfies Prisma.AppointmentSelect

export function getWhatsAppAppointmentConfirmationLeadMinutes() {
  return normalizeLeadMinutes(
    process.env.WHATSAPP_APPOINTMENT_CONFIRMATION_LEAD_MINUTES,
    DEFAULT_WHATSAPP_APPOINTMENT_CONFIRMATION_LEAD_MINUTES,
  )
}

export function getWhatsAppAppointmentConfirmationToleranceMinutes() {
  return normalizeLeadMinutes(
    process.env.WHATSAPP_CONFIRMATION_EXPIRE_AFTER_START_MINUTES,
    normalizeLeadMinutes(
      process.env.WHATSAPP_APPOINTMENT_CONFIRMATION_TOLERANCE_MINUTES,
      DEFAULT_WHATSAPP_APPOINTMENT_CONFIRMATION_TOLERANCE_MINUTES,
    ),
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

export function buildAppointmentConfirmationExpiredMessage(input: {
  appointment: ReminderAppointmentContext
}) {
  return [
    `Oi, ${input.appointment.customerName.split(' ')[0]}!`,
    '',
    'Nao recebemos sua confirmacao a tempo, entao esse horario nao ficou confirmado.',
    'Se quiser, posso te ajudar a marcar um novo horario.',
  ].join('\n')
}

function buildExpiredAppointmentDedupeKey(input: {
  appointmentId: string
}) {
  return `appointment-confirmation-expired:${input.appointmentId}`
}

function buildConfirmationLogPayload(input: {
  appointment: Pick<ReminderAppointmentContext, 'id' | 'barbershopId' | 'barbershopSlug' | 'customerId' | 'startAt' | 'source'>
  statusBefore: string | null
  statusAfter: string | null
  confirmationStatus: string | null
  instanceName: string | null
}) {
  return {
    appointmentId: input.appointment.id,
    barbershopId: input.appointment.barbershopId,
    barbershopSlug: input.appointment.barbershopSlug,
    customerId: input.appointment.customerId,
    startAt: input.appointment.startAt.toISOString(),
    statusBefore: input.statusBefore,
    statusAfter: input.statusAfter,
    confirmationStatus: input.confirmationStatus,
    source: input.appointment.source,
    instanceName: input.instanceName,
  }
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
      source: 'WHATSAPP',
      status: 'PENDING',
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
      source: true,
      status: true,
      startAt: true,
      endAt: true,
      confirmationReminderSentAt: true,
      confirmationRequestedAt: true,
      customer: {
        select: {
          name: true,
          phone: true,
        },
      },
      barbershop: {
        select: {
          name: true,
          slug: true,
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
        source: appointment.source as 'WHATSAPP' | 'MANUAL',
        status: appointment.status as 'PENDING' | 'CONFIRMED',
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        customer: appointment.customer,
        barbershop: appointment.barbershop,
        professional: appointment.professional,
        service: appointment.service,
        confirmationReminderSentAt: appointment.confirmationReminderSentAt,
        confirmationRequestedAt: appointment.confirmationRequestedAt,
      },
    })
  )
}

async function loadExpiredPendingAppointments(input: {
  now: Date
  toleranceMinutes: number
}) {
  const expirationThreshold = new Date(
    input.now.getTime() - Math.max(input.toleranceMinutes, 0) * 60_000
  )

  const appointments = await prisma.appointment.findMany({
    where: {
      source: 'WHATSAPP',
      status: 'PENDING',
      startAt: {
        lte: expirationThreshold,
      },
      confirmationReminderSentAt: { not: null },
      confirmationRequestedAt: { not: null },
      confirmationResponseAt: null,
      customer: {
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
      source: true,
      status: true,
      startAt: true,
      endAt: true,
      confirmationReminderSentAt: true,
      confirmationRequestedAt: true,
      customer: {
        select: {
          name: true,
          phone: true,
        },
      },
      barbershop: {
        select: {
          name: true,
          slug: true,
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
        source: appointment.source as 'WHATSAPP' | 'MANUAL',
        status: appointment.status as 'PENDING' | 'CONFIRMED',
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        customer: appointment.customer,
        barbershop: appointment.barbershop,
        professional: appointment.professional,
        service: appointment.service,
        confirmationReminderSentAt: appointment.confirmationReminderSentAt,
        confirmationRequestedAt: appointment.confirmationRequestedAt,
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
  instanceName: string
}) {
  return prisma.messagingEvent.create({
    data: {
      barbershopId: input.appointment.barbershopId,
      customerId: input.appointment.customerId,
      provider: 'EVOLUTION',
      direction: 'OUTBOUND',
      status: 'PENDING',
      eventType: 'APPOINTMENT_CONFIRMATION_REMINDER',
      instanceName: input.instanceName,
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

async function createExpirationMessagingEvent(input: {
  appointment: ReminderAppointmentContext
  dedupeKey: string
  message: string
  instanceName: string
}) {
  return prisma.messagingEvent.create({
    data: {
      barbershopId: input.appointment.barbershopId,
      customerId: input.appointment.customerId,
      provider: 'EVOLUTION',
      direction: 'OUTBOUND',
      status: 'PENDING',
      eventType: 'APPOINTMENT_CONFIRMATION_EXPIRED',
      instanceName: input.instanceName,
      dedupeKey: input.dedupeKey,
      remotePhone: input.appointment.customerPhone,
      bodyText: input.message,
      responseText: input.message,
      payload: buildJsonValue({
        source: 'whatsapp-appointment-confirmation-expired',
        appointmentId: input.appointment.id,
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

export async function expirePendingAppointmentConfirmation(input: {
  appointmentId: string
  barbershopId: string
}) {
  return prisma.appointment.updateMany({
    where: {
      id: input.appointmentId,
      barbershopId: input.barbershopId,
      source: 'WHATSAPP',
      status: 'PENDING',
      confirmationReminderSentAt: { not: null },
      confirmationRequestedAt: { not: null },
      confirmationResponseAt: null,
    },
    data: {
      status: 'NO_SHOW',
      confirmedAt: null,
      cancelledAt: null,
    },
  })
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
    expiredAppointmentsFound: 0,
    expired: 0,
    expiredOutboundSent: 0,
    expiredOutboundSkipped: 0,
    expiredOutboundFailed: 0,
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
      console.warn('[whatsapp-confirmation] outbound_failed', {
        ...buildConfirmationLogPayload({
          appointment,
          statusBefore: appointment.status,
          statusAfter: appointment.status,
          confirmationStatus: null,
          instanceName: null,
        }),
        reason: 'invalid_phone',
      })
      continue
    }

    const outboundIntegration = await resolveWhatsAppOutboundIntegration({
      barbershopId: appointment.barbershopId,
    })

    if (outboundIntegration.status !== 'resolved' || !outboundIntegration.instanceName) {
      summary.failed += 1

      await prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          confirmationReminderStatus: 'FAILED',
          confirmationReminderError: 'outbound_integration_missing',
        },
      })

      await markWhatsAppIntegrationError({
        barbershopId: appointment.barbershopId,
        message: 'Integracao WhatsApp nao configurada para envio de lembrete.',
      })

      console.warn('[whatsapp-reminder] failed', {
        appointmentId: appointment.id,
        barbershopId: appointment.barbershopId,
        reason: 'outbound_integration_missing',
      })
      console.warn('[whatsapp-confirmation] outbound_failed', {
        ...buildConfirmationLogPayload({
          appointment,
          statusBefore: appointment.status,
          statusAfter: appointment.status,
          confirmationStatus: null,
          instanceName: null,
        }),
        reason: 'outbound_integration_missing',
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
        instanceName: outboundIntegration.instanceName,
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
        instance: outboundIntegration.instanceName,
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

      await markWhatsAppOutboundDelivered(appointment.barbershopId)

      summary.sent += 1
      console.info('[whatsapp-reminder] sent', {
        appointmentId: appointment.id,
        barbershopId: appointment.barbershopId,
      })
      console.info('[whatsapp-confirmation] reminder_sent', buildConfirmationLogPayload({
        appointment,
        statusBefore: appointment.status,
        statusAfter: appointment.status,
        confirmationStatus: null,
        instanceName: outboundIntegration.instanceName,
      }))
      console.info('[whatsapp-confirmation] outbound_sent', buildConfirmationLogPayload({
        appointment,
        statusBefore: appointment.status,
        statusAfter: appointment.status,
        confirmationStatus: null,
        instanceName: outboundIntegration.instanceName,
      }))
    } catch (error) {
      summary.failed += 1
      const message = error instanceof Error ? error.message : String(error)

      await markWhatsAppIntegrationError({
        barbershopId: appointment.barbershopId,
        message,
      })

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
      console.error('[whatsapp-confirmation] outbound_failed', {
        ...buildConfirmationLogPayload({
          appointment,
          statusBefore: appointment.status,
          statusAfter: appointment.status,
          confirmationStatus: null,
          instanceName: outboundIntegration.instanceName,
        }),
        reason: message,
      })
    }
  }

  const expiredAppointments = await loadExpiredPendingAppointments({
    now,
    toleranceMinutes,
  })

  summary.expiredAppointmentsFound = expiredAppointments.length

  for (const appointment of expiredAppointments) {
    const expiration = await expirePendingAppointmentConfirmation({
      appointmentId: appointment.id,
      barbershopId: appointment.barbershopId,
    })

    if (expiration.count === 0) {
      summary.expiredOutboundSkipped += 1
      continue
    }

    summary.expired += 1
    console.info('[whatsapp-confirmation] expired_without_response', buildConfirmationLogPayload({
      appointment,
      statusBefore: appointment.status,
      statusAfter: 'NO_SHOW',
      confirmationStatus: null,
      instanceName: null,
    }))

    const normalizedPhone = normalizeEvolutionPhoneNumber(appointment.customerPhone)
    if (!normalizedPhone) {
      summary.expiredOutboundSkipped += 1
      console.warn('[whatsapp-confirmation] outbound_failed', {
        ...buildConfirmationLogPayload({
          appointment,
          statusBefore: appointment.status,
          statusAfter: 'NO_SHOW',
          confirmationStatus: null,
          instanceName: null,
        }),
        reason: 'invalid_phone',
      })
      continue
    }

    const outboundIntegration = await resolveWhatsAppOutboundIntegration({
      barbershopId: appointment.barbershopId,
    })

    if (outboundIntegration.status !== 'resolved' || !outboundIntegration.instanceName) {
      summary.expiredOutboundFailed += 1

      await markWhatsAppIntegrationError({
        barbershopId: appointment.barbershopId,
        message: 'Integracao WhatsApp nao configurada para aviso de confirmacao expirada.',
      })

      console.warn('[whatsapp-confirmation] outbound_failed', {
        ...buildConfirmationLogPayload({
          appointment,
          statusBefore: appointment.status,
          statusAfter: 'NO_SHOW',
          confirmationStatus: null,
          instanceName: null,
        }),
        reason: 'outbound_integration_missing',
      })
      continue
    }

    const expiredMessage = buildAppointmentConfirmationExpiredMessage({
      appointment,
    })
    const dedupeKey = buildExpiredAppointmentDedupeKey({
      appointmentId: appointment.id,
    })

    let eventId: string | null = null

    try {
      const event = await createExpirationMessagingEvent({
        appointment,
        dedupeKey,
        message: expiredMessage,
        instanceName: outboundIntegration.instanceName,
      })
      eventId = event.id
    } catch (error) {
      if (isDuplicateError(error)) {
        summary.expiredOutboundSkipped += 1
        continue
      }

      throw error
    }

    try {
      const providerPayload = await sendTextMessage({
        number: normalizedPhone,
        text: expiredMessage,
        instance: outboundIntegration.instanceName,
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

      await markWhatsAppOutboundDelivered(appointment.barbershopId)

      summary.expiredOutboundSent += 1
      console.info('[whatsapp-confirmation] outbound_sent', buildConfirmationLogPayload({
        appointment,
        statusBefore: appointment.status,
        statusAfter: 'NO_SHOW',
        confirmationStatus: null,
        instanceName: outboundIntegration.instanceName,
      }))
    } catch (error) {
      summary.expiredOutboundFailed += 1
      const message = error instanceof Error ? error.message : String(error)

      await markWhatsAppIntegrationError({
        barbershopId: appointment.barbershopId,
        message,
      })

      await prisma.messagingEvent.update({
        where: { id: eventId! },
        data: {
          status: 'FAILED',
          lastError: message,
        },
      })

      console.error('[whatsapp-confirmation] outbound_failed', {
        ...buildConfirmationLogPayload({
          appointment,
          statusBefore: appointment.status,
          statusAfter: 'NO_SHOW',
          confirmationStatus: null,
          instanceName: outboundIntegration.instanceName,
        }),
        reason: message,
      })
    }
  }

  return summary
}

async function loadReminderAppointmentsForCustomer(input: {
  barbershopId: string
  customerId: string
  now: Date
  window: 'pending' | 'expired'
}) {
  const expirationThreshold = getReminderConfirmationExpirationThreshold(input.now)

  const appointments = await prisma.appointment.findMany({
    where: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      source: 'WHATSAPP',
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: input.window === 'pending'
        ? { gte: expirationThreshold }
        : { lt: expirationThreshold },
      confirmationReminderSentAt: { not: null },
      confirmationRequestedAt: { not: null },
      confirmationResponseAt: null,
    },
    orderBy: [
      { startAt: 'asc' },
      { confirmationRequestedAt: 'desc' },
    ],
    take: 6,
    select: REMINDER_APPOINTMENT_SELECT,
  })

  return appointments.map((appointment) =>
    serializeReminderAppointment({
      appointment: {
        id: appointment.id,
        barbershopId: appointment.barbershopId,
        customerId: appointment.customerId,
        source: appointment.source as 'WHATSAPP' | 'MANUAL',
        status: appointment.status as 'PENDING' | 'CONFIRMED',
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        customer: appointment.customer,
        barbershop: appointment.barbershop,
        professional: appointment.professional,
        service: appointment.service,
        confirmationReminderSentAt: appointment.confirmationReminderSentAt,
        confirmationRequestedAt: appointment.confirmationRequestedAt,
      },
    })
  )
}

export async function findPendingReminderAppointmentsForCustomer(input: {
  barbershopId: string
  customerId: string
  now?: Date
}) {
  return loadReminderAppointmentsForCustomer({
    barbershopId: input.barbershopId,
    customerId: input.customerId,
    now: input.now ?? new Date(),
    window: 'pending',
  })
}

export async function findPendingReminderAppointmentForCustomer(input: {
  barbershopId: string
  customerId: string
  now?: Date
}) {
  const appointments = await findPendingReminderAppointmentsForCustomer(input)
  return appointments[0] ?? null
}

export async function findExpiredReminderAppointmentsForCustomer(input: {
  barbershopId: string
  customerId: string
  now?: Date
}) {
  return loadReminderAppointmentsForCustomer({
    barbershopId: input.barbershopId,
    customerId: input.customerId,
    now: input.now ?? new Date(),
    window: 'expired',
  })
}

export async function confirmAppointmentPresenceFromReminder(input: {
  appointmentId: string
  barbershopId: string
  now?: Date
}) {
  const now = input.now ?? new Date()

  return prisma.appointment.updateMany({
    where: {
      id: input.appointmentId,
      barbershopId: input.barbershopId,
      source: 'WHATSAPP',
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { gte: getReminderConfirmationExpirationThreshold(now) },
      confirmationReminderSentAt: { not: null },
      confirmationRequestedAt: { not: null },
      confirmationResponseAt: null,
    },
    data: {
      status: 'CONFIRMED',
      confirmedAt: now,
      confirmationResponseAt: now,
      confirmationResponseStatus: 'CONFIRMED',
    },
  })
}

export async function markAppointmentReminderResponse(input: {
  appointmentId: string
  barbershopId: string
  responseStatus: 'RESCHEDULE_REQUESTED' | 'CANCELLATION_REQUESTED'
  now?: Date
}) {
  const now = input.now ?? new Date()

  return prisma.appointment.updateMany({
    where: {
      id: input.appointmentId,
      barbershopId: input.barbershopId,
      source: 'WHATSAPP',
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { gte: getReminderConfirmationExpirationThreshold(now) },
      confirmationReminderSentAt: { not: null },
      confirmationRequestedAt: { not: null },
      confirmationResponseAt: null,
    },
    data: {
      confirmationResponseAt: now,
      confirmationResponseStatus: input.responseStatus,
    },
  })
}

export const __testing = {
  buildAppointmentConfirmationReminderMessage,
  buildAppointmentConfirmationExpiredMessage,
  buildAppointmentReminderDedupeKey,
  buildExpiredAppointmentDedupeKey,
}
