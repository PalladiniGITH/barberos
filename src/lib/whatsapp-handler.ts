import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getEvolutionInstanceName, sendTextMessage } from '@/lib/integrations/evolution'
import { processWhatsAppConversation } from '@/lib/whatsapp-conversation'

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

interface TenantCandidate {
  id: string
  name: string
  slug: string
  timezone: string
}

interface TenantResolutionResult {
  barbershop: TenantCandidate | null
  instanceNameReceived: string | null
  configuredInstance: string
  explicitBarbershopSlug: string | null
  matchedBy: 'explicit_slug' | 'slug_exact' | 'slug_normalized' | 'name_normalized' | 'slug_in_instance' | 'single_tenant_fallback' | null
  reason: string
}

interface TenantResolutionLogContext {
  instanceNameReceived: string | null
  configuredInstance: string
  explicitBarbershopSlug: string | null
  foundBarbershopSlug: string | null
  foundBarbershopName: string | null
  matchedBy: TenantResolutionResult['matchedBy']
  finalReason: string
}

interface AggregatedInboundMessage {
  shouldProcess: boolean
  conversationId: string
  rawMessages: string[]
  concatenatedMessage: string
  reason: 'immediate' | 'aggregated' | 'awaiting_more_messages'
}

const MESSAGE_AGGREGATION_WINDOW_MS = 3000
const FRAGMENTED_MESSAGE_AGGREGATION_WINDOW_MS = 4500
const SENSITIVE_MESSAGE_AGGREGATION_WINDOW_MS = 5500
const FAST_COMPLETE_MESSAGE_DEBOUNCE_MS = 1800
const IMMEDIATE_MESSAGE_PATTERN =
  /^(oi+|ola+|ol[aá]|bom dia|boa tarde|boa noite|quero agendar|quero marcar|agendar|marcar horario)[!.,\s]*$/i

const COMPLEMENTARY_SHORT_MESSAGE_PATTERN =
  /^(?:\d{1,2}(?::\d{2})?\s*(?:h|hr|hrs|hora|horas)?|com\s+.+|qualquer um|qualquer barbeiro|com o mesmo|com meu barbeiro|com o de sempre|sim|ok|beleza|fechado|pode ser)$/i

const STRONGLY_AGGREGATED_MESSAGE_PATTERN =
  /^(?:!+|\?+|oi+|ola+|ol[aÃ¡]|bom dia|boa tarde|boa noite|hoje|amanha|amanhÃ£|de manha|manha|manhÃ£|a tarde|tarde|a noite|noite|fim da tarde|depois de amanha|depois de amanhÃ£|depois das \d{1,2}(?::\d{2})?|\d{1,2}(?::\d{2})?\s*(?:h|hr|hrs|hora|horas)?|as \d{1,2}(?::\d{2})?|Ã s \d{1,2}(?::\d{2})?|com\s+.+|qualquer um|qualquer barbeiro|sem preferencia|sem preferÃªncia|com o mesmo|com meu barbeiro|com o de sempre|sim|ok|beleza|fechado|pode ser|barba|corte|barba terapia)$/i

const COMPLETE_MESSAGE_INTENT_PATTERN =
  /\b(?:quero|preciso|gostaria|pode|quero marcar|quero agendar|marcar|agendar)\b/i

const COMPLETE_MESSAGE_CONTEXT_PATTERN =
  /\b(?:hoje|amanha|amanhÃ£|depois de amanha|depois de amanhÃ£|de manha|manha|manhÃ£|tarde|noite|fim da tarde|com\s+[a-zÃ -Ã¿]+|corte|barba|\d{1,2}(?::\d{2})?\s*(?:h|hr|hrs|hora|horas)?)\b/i

function normalizePhoneDigits(value?: string | null) {
  if (!value) {
    return null
  }

  const digits = value.replace(/\D/g, '')
  return digits || null
}

function normalizeMessageText(value?: string | null) {
  return value?.trim() ?? ''
}

function normalizeAggregationText(message: string) {
  return message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function isStronglyAggregatedMessage(message: string) {
  const normalized = normalizeAggregationText(message)
  return normalized.length > 0
    && normalized.length <= 60
    && STRONGLY_AGGREGATED_MESSAGE_PATTERN.test(normalized)
}

function isClearlyCompleteMessage(message: string) {
  const normalized = normalizeAggregationText(message)
  const wordCount = normalized.split(/\s+/).filter(Boolean).length

  if (normalized.length < 18 || wordCount < 4) {
    return false
  }

  if (isStronglyAggregatedMessage(normalized)) {
    return false
  }

  return COMPLETE_MESSAGE_INTENT_PATTERN.test(normalized)
    && COMPLETE_MESSAGE_CONTEXT_PATTERN.test(normalized)
}

function shouldProcessImmediately(input: {
  state: string
  message: string
  previousMessages: string[]
}) {
  void input
  return false
}

function normalizeConversationStateForAggregation(state?: string | null) {
  if (
    state === 'WAITING_SERVICE'
    || state === 'WAITING_PROFESSIONAL'
    || state === 'WAITING_DATE'
    || state === 'WAITING_TIME'
    || state === 'WAITING_CONFIRMATION'
  ) {
    return state
  }

  return 'IDLE'
}

function isComplementaryShortMessage(message: string) {
  const normalized = normalizeAggregationText(message)
  return normalized.length > 0
    && normalized.length <= 40
    && (
      COMPLEMENTARY_SHORT_MESSAGE_PATTERN.test(normalized)
      || isStronglyAggregatedMessage(normalized)
    )
}

function buildConcatenatedMessage(rawMessages: string[]) {
  return rawMessages
    .map((message) => normalizeMessageText(message))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveAggregationWindowMs(input: {
  state: string
  currentMessage: string
  previousMessages: string[]
}) {
  const state = normalizeConversationStateForAggregation(input.state)
  const hasFragmentedSignal =
    isComplementaryShortMessage(input.currentMessage)
    || input.previousMessages.some((message) => isComplementaryShortMessage(message))
  const usesConservativeState =
    state === 'WAITING_SERVICE'
    || state === 'WAITING_PROFESSIONAL'
    || state === 'WAITING_DATE'
    || state === 'WAITING_TIME'
    || state === 'WAITING_CONFIRMATION'

  if (usesConservativeState) {
    return SENSITIVE_MESSAGE_AGGREGATION_WINDOW_MS
  }

  if (input.previousMessages.length === 0 && isClearlyCompleteMessage(input.currentMessage)) {
    return FAST_COMPLETE_MESSAGE_DEBOUNCE_MS
  }

  if (hasFragmentedSignal) {
    return FRAGMENTED_MESSAGE_AGGREGATION_WINDOW_MS
  }

  return MESSAGE_AGGREGATION_WINDOW_MS
}

function parseMessageBuffer(raw: Prisma.JsonValue | null) {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function hasPendingBufferedMessages(input: {
  bufferedMessages: string[]
  lastMessageTimestamp: Date | null
  activeWindowMs: number
  referenceTime: number
}) {
  return Boolean(
    input.bufferedMessages.length > 0
    && input.lastMessageTimestamp
    && input.referenceTime - input.lastMessageTimestamp.getTime() <= input.activeWindowMs
  )
}

function shouldFinalizeDebouncedTurn(input: {
  waitStartedAt: Date
  lastMessageTimestamp: Date | null
}) {
  return Boolean(
    input.lastMessageTimestamp
    && input.lastMessageTimestamp.getTime() === input.waitStartedAt.getTime()
  )
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

function normalizeTenantKey(value?: string | null) {
  if (!value) {
    return null
  }

  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildTenantLogContext(result: TenantResolutionResult): TenantResolutionLogContext {
  return {
    instanceNameReceived: result.instanceNameReceived,
    configuredInstance: result.configuredInstance,
    explicitBarbershopSlug: result.explicitBarbershopSlug,
    foundBarbershopSlug: result.barbershop?.slug ?? null,
    foundBarbershopName: result.barbershop?.name ?? null,
    matchedBy: result.matchedBy,
    finalReason: result.reason,
  }
}

async function resolveTenantBarbershop(instanceName: string | null): Promise<TenantResolutionResult> {
  const configuredInstance = getEvolutionInstanceName()
  const explicitBarbershopSlug = process.env.EVOLUTION_BARBERSHOP_SLUG?.trim() || null
  const resolvedInstance = instanceName ?? configuredInstance
  const normalizedConfiguredInstance = normalizeTenantKey(configuredInstance)
  const normalizedResolvedInstance = normalizeTenantKey(resolvedInstance)

  if (
    normalizedResolvedInstance
    && normalizedConfiguredInstance
    && normalizedResolvedInstance !== normalizedConfiguredInstance
  ) {
    return {
      barbershop: null,
      instanceNameReceived: instanceName,
      configuredInstance,
      explicitBarbershopSlug,
      matchedBy: null,
      reason: 'instance_mismatch',
    }
  }

  if (explicitBarbershopSlug) {
    const explicitMatch = await prisma.barbershop.findFirst({
      where: {
        slug: explicitBarbershopSlug,
        active: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
      },
    })

    return {
      barbershop: explicitMatch,
      instanceNameReceived: instanceName,
      configuredInstance,
      explicitBarbershopSlug,
      matchedBy: explicitMatch ? 'explicit_slug' : null,
      reason: explicitMatch ? 'resolved' : 'explicit_slug_not_found',
    }
  }

  const barbershops = await prisma.barbershop.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
    },
  })

  const exactSlugMatch = barbershops.find((barbershop) => barbershop.slug === resolvedInstance)
  if (exactSlugMatch) {
    return {
      barbershop: exactSlugMatch,
      instanceNameReceived: instanceName,
      configuredInstance,
      explicitBarbershopSlug,
      matchedBy: 'slug_exact',
      reason: 'resolved',
    }
  }

  const normalizedSlugMatch = barbershops.find((barbershop) =>
    normalizeTenantKey(barbershop.slug) === normalizedResolvedInstance
  )
  if (normalizedSlugMatch) {
    return {
      barbershop: normalizedSlugMatch,
      instanceNameReceived: instanceName,
      configuredInstance,
      explicitBarbershopSlug,
      matchedBy: 'slug_normalized',
      reason: 'resolved',
    }
  }

  const normalizedNameMatch = barbershops.find((barbershop) =>
    normalizeTenantKey(barbershop.name) === normalizedResolvedInstance
  )
  if (normalizedNameMatch) {
    return {
      barbershop: normalizedNameMatch,
      instanceNameReceived: instanceName,
      configuredInstance,
      explicitBarbershopSlug,
      matchedBy: 'name_normalized',
      reason: 'resolved',
    }
  }

  const slugContainedMatches = normalizedResolvedInstance
    ? barbershops.filter((barbershop) => {
        const normalizedSlug = normalizeTenantKey(barbershop.slug)
        return Boolean(
          normalizedSlug
          && (
            normalizedResolvedInstance.includes(normalizedSlug)
            || normalizedSlug.includes(normalizedResolvedInstance)
          )
        )
      })
    : []

  if (slugContainedMatches.length === 1) {
    return {
      barbershop: slugContainedMatches[0],
      instanceNameReceived: instanceName,
      configuredInstance,
      explicitBarbershopSlug,
      matchedBy: 'slug_in_instance',
      reason: 'resolved',
    }
  }

  if (barbershops.length === 1) {
    return {
      barbershop: barbershops[0],
      instanceNameReceived: instanceName,
      configuredInstance,
      explicitBarbershopSlug,
      matchedBy: 'single_tenant_fallback',
      reason: 'resolved',
    }
  }

  return {
    barbershop: null,
    instanceNameReceived: instanceName,
    configuredInstance,
    explicitBarbershopSlug,
    matchedBy: null,
    reason: slugContainedMatches.length > 1 ? 'ambiguous_instance_match' : 'barbershop_not_found',
  }
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

async function getOrCreateWhatsappConversation(input: {
  barbershopId: string
  customerId: string
  phone?: string | null
}) {
  return prisma.whatsappConversation.upsert({
    where: {
      barbershopId_customerId: {
        barbershopId: input.barbershopId,
        customerId: input.customerId,
      },
    },
    update: {
      phone: input.phone ?? undefined,
    },
    create: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      phone: input.phone ?? null,
      state: 'IDLE',
    },
    select: {
      id: true,
      state: true,
      messageBuffer: true,
      lastMessageTimestamp: true,
    },
  })
}

async function aggregateInboundMessages(input: {
  barbershopId: string
  customerId: string
  phone?: string | null
  message: string
}) : Promise<AggregatedInboundMessage> {
  const normalizedMessage = normalizeMessageText(input.message)
  const conversation = await getOrCreateWhatsappConversation({
    barbershopId: input.barbershopId,
    customerId: input.customerId,
    phone: input.phone ?? null,
  })
  const aggregationState = normalizeConversationStateForAggregation(conversation.state)
  const previousMessages = parseMessageBuffer(conversation.messageBuffer)
  let activeWindowMs = resolveAggregationWindowMs({
    state: aggregationState,
    currentMessage: normalizedMessage,
    previousMessages,
  })
  const now = new Date()
  let previousBuffer = hasPendingBufferedMessages({
    bufferedMessages: previousMessages,
    lastMessageTimestamp: conversation.lastMessageTimestamp,
    activeWindowMs,
    referenceTime: now.getTime(),
  })
    ? previousMessages
    : []
  console.info('[whatsapp-agent] aggregation window used', {
    conversationId: conversation.id,
    state: aggregationState,
    windowMs: activeWindowMs,
    message: normalizedMessage,
    bufferedMessages: previousBuffer,
  })

  if (previousBuffer.length > 0 && aggregationState === 'IDLE') {
    console.info('[whatsapp-agent] blocked immediate processing due to pending buffer', {
      conversationId: conversation.id,
      state: aggregationState,
      message: normalizedMessage,
      bufferedMessages: previousBuffer,
    })
  }

  const nextBuffer = [...previousBuffer, normalizedMessage]

  await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: {
      phone: input.phone ?? null,
      messageBuffer: nextBuffer as Prisma.InputJsonValue,
      lastMessageTimestamp: now,
    },
  })

  if (previousBuffer.length > 0) {
    console.info('[whatsapp-agent] merged into existing pending buffer', {
      conversationId: conversation.id,
      state: aggregationState,
      rawMessages: nextBuffer,
      concatenatedMessage: buildConcatenatedMessage(nextBuffer),
    })
  }

  console.info('[whatsapp-agent] buffered message', {
    conversationId: conversation.id,
    state: aggregationState,
    windowMs: activeWindowMs,
    message: normalizedMessage,
    previousBufferedCount: previousBuffer.length,
    nextBufferedCount: nextBuffer.length,
  })

  console.info('[whatsapp-agent] waiting for aggregation window', {
    conversationId: conversation.id,
    state: aggregationState,
    windowMs: activeWindowMs,
    bufferedMessages: nextBuffer,
  })

  await wait(activeWindowMs)

  const latestConversation = await prisma.whatsappConversation.findUnique({
    where: { id: conversation.id },
    select: {
      id: true,
      messageBuffer: true,
      lastMessageTimestamp: true,
    },
  })

  if (!latestConversation || !shouldFinalizeDebouncedTurn({
    waitStartedAt: now,
    lastMessageTimestamp: latestConversation.lastMessageTimestamp,
  })) {
    console.info('[whatsapp-agent] debounce timer restarted', {
      conversationId: conversation.id,
      state: aggregationState,
      previousWaitStartedAt: now.toISOString(),
      latestBufferedAt: latestConversation?.lastMessageTimestamp?.toISOString() ?? null,
      bufferedMessages: parseMessageBuffer(latestConversation?.messageBuffer ?? null),
    })

    return {
      shouldProcess: false,
      conversationId: conversation.id,
      rawMessages: nextBuffer,
      concatenatedMessage: nextBuffer.join(' '),
      reason: 'awaiting_more_messages',
    }
  }

  const rawMessages = parseMessageBuffer(latestConversation.messageBuffer)
  const concatenatedMessage = buildConcatenatedMessage(rawMessages)

  await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: {
      messageBuffer: Prisma.JsonNull,
      lastMessageTimestamp: null,
    },
  })

  console.info('[whatsapp-agent] message aggregation', {
    state: aggregationState,
    windowMs: activeWindowMs,
    rawMessages,
    concatenatedMessage,
  })

  return {
    shouldProcess: true,
    conversationId: conversation.id,
    rawMessages,
    concatenatedMessage,
    reason: 'aggregated',
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

async function createOutboundMessagingEvent(input: {
  barbershopId: string
  customerId: string
  phone: string
  responseText: string
  inboundEventId: string
}) {
  try {
    await prisma.messagingEvent.create({
      data: {
        barbershopId: input.barbershopId,
        customerId: input.customerId,
        provider: 'EVOLUTION',
        direction: 'OUTBOUND',
        status: 'PROCESSED',
        eventType: 'WHATSAPP_REPLY',
        instanceName: getEvolutionInstanceName(),
        dedupeKey: `outbound:${input.inboundEventId}`,
        remotePhone: input.phone,
        bodyText: input.responseText,
        responseText: input.responseText,
        payload: {
          source: 'whatsapp-conversation',
          inboundEventId: input.inboundEventId,
        } as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002'
    ) {
      return
    }

    throw error
  }
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
  const tenantResolution = await resolveTenantBarbershop(input.instanceName)
  const tenantResolutionLog = buildTenantLogContext(tenantResolution)

  if (tenantResolution.barbershop) {
    console.info('[whatsapp-handler] tenant resolved', tenantResolutionLog)
  } else {
    console.warn('[whatsapp-handler] tenant resolution failed', tenantResolutionLog)
  }

  const barbershop = tenantResolution.barbershop

  if (!barbershop) {
    return {
      ok: false,
      code: 409,
      reason: `tenant_not_configured:${tenantResolution.reason}`,
      diagnostics: tenantResolutionLog,
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

    const aggregatedMessage = await aggregateInboundMessages({
      barbershopId: barbershop.id,
      customerId: customer.id,
      phone: input.phone,
      message: input.message ?? '',
    })

    if (!aggregatedMessage.shouldProcess) {
      await prisma.messagingEvent.update({
        where: { id: existingEvent.id },
        data: {
          customerId: customer.id,
          status: 'PROCESSED',
          lastError: `message_${aggregatedMessage.reason}`,
          processedAt: new Date(),
        },
      })

      return {
        ok: true,
        code: 200,
        reason: aggregatedMessage.reason,
        flow: 'awaiting_more_messages',
        eventId: existingEvent.id,
        customerId: customer.id,
        customerCreated: customer.created,
        conversationId: aggregatedMessage.conversationId,
        phone: input.phone,
        message: aggregatedMessage.concatenatedMessage,
        replySent: false,
      }
    }

    const conversation = await processWhatsAppConversation({
      barbershop,
      customer: {
        id: customer.id,
        name: customer.name,
        created: customer.created,
        phone: input.phone,
      },
      inboundText: aggregatedMessage.concatenatedMessage,
      rawMessages: aggregatedMessage.rawMessages,
      eventId: existingEvent.id,
    })
    const responseText = conversation.responseText

    await sendTextMessage({
      number: input.phone,
      text: responseText,
    })

    await createOutboundMessagingEvent({
      barbershopId: barbershop.id,
      customerId: customer.id,
      phone: input.phone,
      responseText,
      inboundEventId: existingEvent.id,
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
      flow: conversation.flow,
      eventId: existingEvent.id,
      customerId: customer.id,
      customerCreated: customer.created,
      appointmentId: conversation.appointmentId,
      conversationId: conversation.conversationId,
      conversationState: conversation.conversationState,
      usedAI: conversation.usedAI,
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

export const __testing = {
  isComplementaryShortMessage,
  isClearlyCompleteMessage,
  isStronglyAggregatedMessage,
  buildConcatenatedMessage,
  hasPendingBufferedMessages,
  shouldFinalizeDebouncedTurn,
  resolveAggregationWindowMs,
  shouldProcessImmediately,
}
