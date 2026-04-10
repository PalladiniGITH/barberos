import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getEvolutionInstanceName, sendTextMessage } from '@/lib/integrations/evolution'

export interface IncomingWhatsAppMessage {
  provider: 'EVOLUTION'
  event: string
  instanceName: string | null
  phone: string | null
  message: string | null
  contactName?: string | null
  remoteJid?: string | null
  messageId?: string | null
  dedupeKey: string
  payload: unknown
  shouldProcessInboundMessage: boolean
  ignoreReason?: string | null
}

function normalizePhoneDigits(value?: string | null) {
  if (!value) {
    return null
  }

  const digits = value.replace(/\D/g, '')
  return digits || null
}

function buildFallbackCustomerName(phone: string) {
  return `Cliente ${phone.slice(-4)}`
}

function chooseCustomerName(input: {
  existingName?: string | null
  inboundName?: string | null
  phone: string
}) {
  if (input.existingName?.trim()) {
    return input.existingName.trim()
  }

  if (input.inboundName?.trim()) {
    return input.inboundName.trim()
  }

  return buildFallbackCustomerName(input.phone)
}

function buildAutoReply(input: {
  barbershopName: string
  customerName?: string | null
}) {
  const firstName = input.customerName?.trim()?.split(' ')[0]
  const greeting = firstName ? `Oi, ${firstName}!` : 'Oi!'

  return `${greeting} Recebi sua mensagem na ${input.barbershopName}. Ja registrei seu contato por aqui e vamos seguir com seu agendamento pelo WhatsApp em seguida.`
}

async function resolveTenantBarbershop(instanceName: string | null) {
  const configuredInstance = getEvolutionInstanceName()
  const resolvedInstance = instanceName ?? configuredInstance

  if (resolvedInstance !== configuredInstance) {
    return null
  }

  return prisma.barbershop.findUnique({
    where: { slug: configuredInstance },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  })
}

async function findOrCreateCustomerFromInbound(input: {
  barbershopId: string
  phone: string
  contactName?: string | null
}) {
  const normalizedPhone = normalizePhoneDigits(input.phone)

  if (!normalizedPhone) {
    throw new Error('Telefone invalido no payload recebido.')
  }

  const customers = await prisma.customer.findMany({
    where: {
      barbershopId: input.barbershopId,
      active: true,
      phone: { not: null },
    },
    select: {
      id: true,
      name: true,
      phone: true,
    },
  })

  const existingCustomer = customers.find((customer) =>
    normalizePhoneDigits(customer.phone) === normalizedPhone
  )

  if (existingCustomer) {
    const updatedName = chooseCustomerName({
      existingName: existingCustomer.name,
      inboundName: input.contactName,
      phone: normalizedPhone,
    })

    if (updatedName !== existingCustomer.name) {
      await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: { name: updatedName },
      })
    }

    return {
      id: existingCustomer.id,
      name: updatedName,
      created: false,
    }
  }

  const createdCustomer = await prisma.customer.create({
    data: {
      barbershopId: input.barbershopId,
      name: chooseCustomerName({
        inboundName: input.contactName,
        phone: normalizedPhone,
      }),
      phone: normalizedPhone,
      type: 'WALK_IN',
      active: true,
    },
    select: {
      id: true,
      name: true,
    },
  })

  return {
    id: createdCustomer.id,
    name: createdCustomer.name,
    created: true,
  }
}

async function findExistingMessagingEvent(dedupeKey: string) {
  return prisma.messagingEvent.findUnique({
    where: { dedupeKey },
    select: {
      id: true,
      customerId: true,
      responseText: true,
      status: true,
    },
  })
}

async function createMessagingEvent(input: {
  barbershopId: string
  normalized: IncomingWhatsAppMessage
}) {
  return prisma.messagingEvent.create({
    data: {
      barbershopId: input.barbershopId,
      provider: input.normalized.provider,
      direction: input.normalized.shouldProcessInboundMessage ? 'INBOUND' : 'SYSTEM',
      status: input.normalized.shouldProcessInboundMessage ? 'PENDING' : 'IGNORED',
      eventType: input.normalized.event,
      instanceName: input.normalized.instanceName ?? getEvolutionInstanceName(),
      dedupeKey: input.normalized.dedupeKey,
      providerMessageId: input.normalized.messageId ?? null,
      remoteJid: input.normalized.remoteJid ?? null,
      remotePhone: input.normalized.phone ?? null,
      contactName: input.normalized.contactName ?? null,
      bodyText: input.normalized.message ?? null,
      responseText: null,
      lastError: input.normalized.ignoreReason ?? null,
      payload: input.normalized.payload as Prisma.InputJsonValue,
      processedAt: input.normalized.shouldProcessInboundMessage ? null : new Date(),
    },
    select: {
      id: true,
      customerId: true,
      responseText: true,
      status: true,
    },
  })
}

async function claimMessagingEventForProcessing(eventId: string) {
  const claimed = await prisma.messagingEvent.updateMany({
    where: {
      id: eventId,
      status: { in: ['PENDING', 'FAILED'] },
    },
    data: {
      status: 'PROCESSING',
      lastError: null,
    },
  })

  return claimed.count > 0
}

export async function handleIncomingWhatsAppMessage(input: IncomingWhatsAppMessage) {
  const barbershop = await resolveTenantBarbershop(input.instanceName)

  if (!barbershop) {
    return {
      ok: false,
      code: 409,
      reason: 'tenant_not_configured',
      replySent: false,
    }
  }

  let existingEvent = await findExistingMessagingEvent(input.dedupeKey)

  if (!existingEvent) {
    try {
      existingEvent = await createMessagingEvent({
        barbershopId: barbershop.id,
        normalized: input,
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        existingEvent = await findExistingMessagingEvent(input.dedupeKey)
      } else {
        throw error
      }
    }
  }

  if (!existingEvent) {
    throw new Error('Nao foi possivel registrar o evento do WhatsApp.')
  }

  if (!input.shouldProcessInboundMessage || !input.phone) {
    return {
      ok: true,
      code: 200,
      reason: input.ignoreReason ?? 'ignored',
      eventId: existingEvent.id,
      phone: input.phone,
      message: input.message,
      replySent: false,
    }
  }

  if (existingEvent.status === 'PROCESSED' || existingEvent.status === 'PROCESSING') {
    return {
      ok: true,
      code: 200,
      reason: existingEvent.status === 'PROCESSED' ? 'already_processed' : 'processing',
      eventId: existingEvent.id,
      customerId: existingEvent.customerId ?? undefined,
      phone: input.phone,
      message: input.message,
      replySent: Boolean(existingEvent.responseText),
    }
  }

  const claimed = await claimMessagingEventForProcessing(existingEvent.id)
  if (!claimed) {
    return {
      ok: true,
      code: 200,
      reason: 'processing',
      eventId: existingEvent.id,
      phone: input.phone,
      message: input.message,
      replySent: false,
    }
  }

  try {
    const customer = await findOrCreateCustomerFromInbound({
      barbershopId: barbershop.id,
      phone: input.phone,
      contactName: input.contactName,
    })

    const responseText = buildAutoReply({
      barbershopName: barbershop.name,
      customerName: customer.name,
    })

    await sendTextMessage({
      number: input.phone,
      text: responseText,
    })

    await prisma.messagingEvent.update({
      where: { id: existingEvent.id },
      data: {
        customerId: customer.id,
        status: 'PROCESSED',
        responseText,
        processedAt: new Date(),
      },
    })

    return {
      ok: true,
      code: 200,
      reason: 'processed',
      flow: 'initial_confirmation',
      eventId: existingEvent.id,
      customerId: customer.id,
      customerCreated: customer.created,
      phone: input.phone,
      message: input.message,
      replySent: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao processar mensagem do WhatsApp.'

    await prisma.messagingEvent.update({
      where: { id: existingEvent.id },
      data: {
        status: 'FAILED',
        lastError: message,
      },
    })

    return {
      ok: false,
      code: 500,
      reason: 'processing_failed',
      eventId: existingEvent.id,
      phone: input.phone,
      message: input.message,
      replySent: false,
      error: message,
    }
  }
}
