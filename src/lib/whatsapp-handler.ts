import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendTextMessage } from '@/lib/integrations/evolution'
import { processWhatsAppConversation } from '@/lib/whatsapp-conversation'
import {
  markWhatsAppInboundReceived,
  markWhatsAppIntegrationError,
  markWhatsAppOutboundDelivered,
  resolveWhatsAppOutboundIntegration,
  resolveWhatsAppTenantFromEvolutionPayload,
  type WhatsAppTenantResolutionResult,
} from '@/lib/whatsapp-tenant'
import { safeLog } from '@/lib/security/safe-logger'

export interface IncomingWhatsAppMessage {
  provider: 'EVOLUTION'
  event: string
  instanceName: string | null
  routeBarbershopSlug?: string | null
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

interface TenantResolutionLogContext {
  barbershopId: string | null
  barbershopSlug: string | null
  barbershopName: string | null
  instanceName: string | null
  instanceNameReceived: string | null
  routeSlug: string | null
  matchedBy: WhatsAppTenantResolutionResult['matchedBy']
  reason: string
  status: WhatsAppTenantResolutionResult['status']
}

interface AggregatedInboundMessage {
  shouldProcess: boolean
  conversationId: string
  rawMessages: string[]
  concatenatedMessage: string
  reason: 'immediate' | 'aggregated' | 'awaiting_more_messages'
}

const MESSAGE_AGGREGATION_WINDOW_MS = 3000
const FRAGMENTED_MESSAGE_AGGREGATION_WINDOW_MS = 5500
const SENSITIVE_MESSAGE_AGGREGATION_WINDOW_MS = 6000
const FORMING_BOOKING_TURN_IDLE_WINDOW_MS = 6200
const FORMING_BOOKING_TURN_SENSITIVE_WINDOW_MS = 6800
const FAST_COMPLETE_MESSAGE_DEBOUNCE_MS = 1800
const ONGOING_TURN_CONTEXT_WINDOW_MS = 30_000
const IMMEDIATE_MESSAGE_PATTERN =
  /^(oi+|ola+|ol[aá]|bom dia|boa tarde|boa noite|quero agendar|quero marcar|agendar|marcar horario)[!.,\s]*$/i

const COMPLEMENTARY_SHORT_MESSAGE_PATTERN =
  /^(?:\d{1,2}(?::\d{2})?\s*(?:h|hr|hrs|hora|horas)?|com\s+.+|qualquer um|qualquer barbeiro|com o mesmo|com meu barbeiro|com o de sempre|sim|ok|beleza|fechado|pode ser)$/i

const STRONGLY_AGGREGATED_MESSAGE_PATTERN =
  /^(?:!+|\?+|oi+|ola+|ol[aÃ¡]|bom dia|boa tarde|boa noite|hoje|amanha|amanhÃ£|de manha|manha|manhÃ£|a tarde|tarde|a noite|de noite|noite|mais tarde(?: de noite)?|periodo da noite|no periodo da noite|fim da tarde|depois de amanha|depois de amanhÃ£|depois das \d{1,2}(?::\d{2})?|\d{1,2}(?::\d{2})?\s*(?:h|hr|hrs|hora|horas)?|as \d{1,2}(?::\d{2})?|Ã s \d{1,2}(?::\d{2})?|com\s+.+|qualquer um|qualquer barbeiro|sem preferencia|sem preferÃªncia|com o mesmo|com meu barbeiro|com o de sempre|sim|ok|beleza|fechado|pode ser|barba|corte|barba terapia)$/i

const COMPLETE_MESSAGE_INTENT_PATTERN =
  /\b(?:quero|preciso|gostaria|pode|quero marcar|quero agendar|marcar|agendar)\b/i

const COMPLETE_MESSAGE_CONTEXT_PATTERN =
  /\b(?:hoje|amanha|amanhÃ£|depois de amanha|depois de amanhÃ£|de manha|manha|manhÃ£|tarde|noite|fim da tarde|com\s+[a-zÃ -Ã¿]+|corte|barba|\d{1,2}(?::\d{2})?\s*(?:h|hr|hrs|hora|horas)?)\b/i

const SCHEDULING_GREETING_FRAGMENT_PATTERN =
  /^(?:oi+|ola+|ol[aÃ¡]|bom dia|boa tarde|boa noite|opa|e ai|eai|oie|hey)[!.,\s]*$/i

const SCHEDULING_INTENT_FRAGMENT_PATTERN =
  /(?:quero marcar(?:\s+um)?\s+horario|quero agendar(?:\s+um)?\s+horario|quero marcar|quero agendar|marcar horario|agendar horario|marcar um horario|agendar um horario|preciso marcar|preciso agendar)/i

const SCHEDULING_DATE_FRAGMENT_PATTERN =
  /(?:hoje|amanha|amanhÃƒÂ£|depois de amanha|depois de amanhÃƒÂ£|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo|semana que vem|proxima semana|pr[oó]xima semana|(?:na\s+)?sexta que vem|(?:na\s+)?quinta que vem|(?:na\s+)?quarta que vem|(?:na\s+)?terca que vem|(?:na\s+)?terça que vem|(?:na\s+)?segunda que vem|(?:no\s+)?sabado que vem|(?:no\s+)?sábado que vem|(?:no\s+)?domingo que vem)/i

const SCHEDULING_SERVICE_FRAGMENT_PATTERN =
  /^(?:barba|barba terapia|corte|corte classic|corte \+ barba premium|degrade|degrad[eê] signature|hidratacao|hidrata[cç][aã]o capilar|pigmentacao|pigmenta[cç][aã]o natural)$/i

const SCHEDULING_PROFESSIONAL_FRAGMENT_PATTERN =
  /^(?:com\s+.+|com o mesmo|com meu barbeiro|com o de sempre)$/i

const SCHEDULING_TIME_FRAGMENT_PATTERN =
  /^(?:\d{1,2}(?::\d{2})?\s*(?:h|hr|hrs|hora|horas)?|as\s+\d{1,2}(?::\d{2})?|de manha|manha|manhÃƒÂ£|a tarde|tarde|a noite|de noite|noite|mais tarde(?: de noite)?|periodo da noite|no periodo da noite|fim da tarde)$/i

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

function classifySchedulingFragment(message: string) {
  const normalized = normalizeAggregationText(message)

  return {
    normalized,
    greeting: SCHEDULING_GREETING_FRAGMENT_PATTERN.test(normalized),
    intent: SCHEDULING_INTENT_FRAGMENT_PATTERN.test(normalized),
    date: SCHEDULING_DATE_FRAGMENT_PATTERN.test(normalized),
    service: SCHEDULING_SERVICE_FRAGMENT_PATTERN.test(normalized),
    professional: SCHEDULING_PROFESSIONAL_FRAGMENT_PATTERN.test(normalized),
    time: SCHEDULING_TIME_FRAGMENT_PATTERN.test(normalized),
    short: normalized.length > 0 && normalized.length <= 60,
  }
}

function detectFragmentedBookingTurn(input: {
  state: string
  currentMessage: string
  previousMessages: string[]
}) {
  const fragments = [...input.previousMessages, input.currentMessage]
    .map(classifySchedulingFragment)
    .filter((fragment) => fragment.normalized.length > 0)

  const summary = fragments.reduce((accumulator, fragment) => ({
    greeting: accumulator.greeting || fragment.greeting,
    intent: accumulator.intent || fragment.intent,
    date: accumulator.date || fragment.date,
    service: accumulator.service || fragment.service,
    professional: accumulator.professional || fragment.professional,
    time: accumulator.time || fragment.time,
    shortOnly: accumulator.shortOnly && fragment.short,
  }), {
    greeting: false,
    intent: false,
    date: false,
    service: false,
    professional: false,
    time: false,
    shortOnly: true,
  })

  const hasSchedulingContext =
    summary.intent
    || summary.date
    || summary.service
    || summary.professional
    || summary.time

  const meaningfulCombination =
    (summary.greeting && hasSchedulingContext)
    || (summary.intent && (summary.date || summary.service || summary.professional || summary.time))
    || (summary.service && (summary.date || summary.professional || summary.time))
    || (summary.date && (summary.professional || summary.time))
    || (summary.professional && summary.time)
    || (fragments.length >= 3 && hasSchedulingContext)

  return {
    active:
      fragments.length >= 2
      && summary.shortOnly
      && meaningfulCombination,
    fragments: fragments.map((fragment) => fragment.normalized),
    summary,
  }
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
  const currentFragment = classifySchedulingFragment(input.currentMessage)
  const fragmentedBookingTurn = detectFragmentedBookingTurn({
    state,
    currentMessage: input.currentMessage,
    previousMessages: input.previousMessages,
  })
  const hasFragmentedSignal =
    isComplementaryShortMessage(input.currentMessage)
    || input.previousMessages.some((message) => isComplementaryShortMessage(message))
    || currentFragment.short && (
      currentFragment.greeting
      || currentFragment.intent
      || currentFragment.date
      || currentFragment.service
      || currentFragment.professional
      || currentFragment.time
    )
  const usesConservativeState =
    state === 'WAITING_SERVICE'
    || state === 'WAITING_PROFESSIONAL'
    || state === 'WAITING_DATE'
    || state === 'WAITING_TIME'
    || state === 'WAITING_CONFIRMATION'

  if (fragmentedBookingTurn.active) {
    return usesConservativeState
      ? FORMING_BOOKING_TURN_SENSITIVE_WINDOW_MS
      : FORMING_BOOKING_TURN_IDLE_WINDOW_MS
  }

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

function hasOngoingTurnContext(input: {
  state: string
  updatedAt: Date | null
  referenceTime: number
}) {
  const normalizedState = normalizeConversationStateForAggregation(input.state)

  return Boolean(
    normalizedState !== 'IDLE'
    && input.updatedAt
    && input.referenceTime - input.updatedAt.getTime() <= ONGOING_TURN_CONTEXT_WINDOW_MS
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

function buildTenantLogContext(result: WhatsAppTenantResolutionResult): TenantResolutionLogContext {
  return {
    barbershopId: result.barbershopId,
    barbershopSlug: result.barbershopSlug,
    barbershopName: result.barbershopName,
    instanceName: result.instanceName,
    instanceNameReceived: result.instanceNameReceived,
    routeSlug: result.routeSlug,
    matchedBy: result.matchedBy,
    reason: result.reason,
    status: result.status,
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
      updatedAt: true,
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
  const now = new Date()
  const ongoingTurnContext = hasOngoingTurnContext({
    state: aggregationState,
    updatedAt: conversation.updatedAt,
    referenceTime: now.getTime(),
  })
  const fragmentedBookingTurn = detectFragmentedBookingTurn({
    state: aggregationState,
    currentMessage: normalizedMessage,
    previousMessages,
  })
  let activeWindowMs = resolveAggregationWindowMs({
    state: aggregationState,
    currentMessage: normalizedMessage,
    previousMessages,
  })
  let previousBuffer = hasPendingBufferedMessages({
    bufferedMessages: previousMessages,
    lastMessageTimestamp: conversation.lastMessageTimestamp,
    activeWindowMs,
    referenceTime: now.getTime(),
  })
    ? previousMessages
    : []
  const currentFragment = classifySchedulingFragment(normalizedMessage)

  if (
    ongoingTurnContext
    && previousBuffer.length === 0
    && currentFragment.short
    && (
      currentFragment.greeting
      || currentFragment.intent
      || currentFragment.date
      || currentFragment.service
      || currentFragment.professional
      || currentFragment.time
    )
  ) {
    activeWindowMs = Math.max(activeWindowMs, FORMING_BOOKING_TURN_SENSITIVE_WINDOW_MS)

    safeLog('info', '[handler] ongoing turn preserved context', {
      conversationId: conversation.id,
      state: aggregationState,
      updatedAt: conversation.updatedAt.toISOString(),
      message: normalizedMessage,
      windowMs: activeWindowMs,
    })
  }

  safeLog('info', '[whatsapp-agent] aggregation window used', {
    conversationId: conversation.id,
    state: aggregationState,
    windowMs: activeWindowMs,
    message: normalizedMessage,
    bufferedMessages: previousBuffer,
    fragmentedBookingTurn: fragmentedBookingTurn.active,
  })

  if (fragmentedBookingTurn.active) {
    safeLog('info', '[whatsapp-agent] fragmented turn state', {
      conversationId: conversation.id,
      state: aggregationState,
      rawMessages: [...previousBuffer, normalizedMessage],
      fragments: fragmentedBookingTurn.summary,
      windowMs: activeWindowMs,
    })
  }

  if (previousBuffer.length > 0 && aggregationState === 'IDLE') {
    safeLog(
      'info',
      fragmentedBookingTurn.active
        ? '[whatsapp-agent] blocked immediate processing due to in-progress turn'
        : '[whatsapp-agent] blocked immediate processing due to pending buffer',
      {
        conversationId: conversation.id,
        state: aggregationState,
        message: normalizedMessage,
        bufferedMessages: previousBuffer,
      }
    )
  }

  if (fragmentedBookingTurn.active) {
    safeLog('info', '[whatsapp-agent] turn still forming', {
      conversationId: conversation.id,
      state: aggregationState,
      rawMessages: [...previousBuffer, normalizedMessage],
      fragments: fragmentedBookingTurn.summary,
    })

    safeLog('info', '[whatsapp-agent] delayed due to fragmented scheduling intent', {
      conversationId: conversation.id,
      state: aggregationState,
      windowMs: activeWindowMs,
      rawMessages: [...previousBuffer, normalizedMessage],
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
    safeLog('info', '[whatsapp-agent] buffer carried across sequential messages', {
      conversationId: conversation.id,
      state: aggregationState,
      bufferedMessages: previousBuffer,
      incomingMessage: normalizedMessage,
    })

    safeLog('info', '[whatsapp-agent] merged into existing pending buffer', {
      conversationId: conversation.id,
      state: aggregationState,
      rawMessages: nextBuffer,
      concatenatedMessage: buildConcatenatedMessage(nextBuffer),
    })

    if (fragmentedBookingTurn.active) {
      safeLog('info', '[whatsapp-agent] merged fragmented booking turn', {
        conversationId: conversation.id,
        state: aggregationState,
        rawMessages: nextBuffer,
        concatenatedMessage: buildConcatenatedMessage(nextBuffer),
      })
    }
  }

  safeLog('info', '[whatsapp-agent] buffered message', {
    conversationId: conversation.id,
    state: aggregationState,
    windowMs: activeWindowMs,
    message: normalizedMessage,
    previousBufferedCount: previousBuffer.length,
    nextBufferedCount: nextBuffer.length,
  })

  safeLog('info', '[whatsapp-agent] waiting for aggregation window', {
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
    safeLog('info', '[whatsapp-agent] debounce timer restarted', {
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

  safeLog('info', '[whatsapp-agent] message aggregation', {
    state: aggregationState,
    windowMs: activeWindowMs,
    rawMessages,
    concatenatedMessage,
  })

  safeLog('info', '[whatsapp-agent] final merged turn emitted', {
    conversationId: conversation.id,
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
  instanceName: string
  normalized: IncomingWhatsAppMessage
}) {
  return prisma.messagingEvent.create({
    data: {
      barbershopId: input.barbershopId,
      provider: input.normalized.provider,
      direction: input.normalized.shouldProcessInboundMessage ? 'INBOUND' : 'SYSTEM',
      status: input.normalized.shouldProcessInboundMessage ? 'PENDING' : 'IGNORED',
      eventType: input.normalized.event,
      instanceName: input.instanceName,
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
  instanceName: string
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
        instanceName: input.instanceName,
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
  const tenantResolution = await resolveWhatsAppTenantFromEvolutionPayload({
    instanceName: input.instanceName,
    routeBarbershopSlug: input.routeBarbershopSlug ?? null,
  })
  const tenantResolutionLog = buildTenantLogContext(tenantResolution)

  if (tenantResolution.status === 'resolved' && tenantResolution.barbershop) {
    safeLog('info', '[whatsapp-handler] tenant resolved', tenantResolutionLog)
  } else {
    safeLog('warn', '[whatsapp-handler] tenant resolution failed', tenantResolutionLog)
  }

  const barbershop = tenantResolution.barbershop

  if (tenantResolution.status !== 'resolved' || !barbershop || !tenantResolution.instanceName) {
    return {
      ok: tenantResolution.status === 'ignored',
      code: tenantResolution.status === 'error' ? 409 : 202,
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
        instanceName: tenantResolution.instanceName,
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

  await markWhatsAppInboundReceived(barbershop.id)

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
      instanceName: tenantResolution.instanceName,
    })
    const responseText = conversation.responseText
    const outboundIntegration = await resolveWhatsAppOutboundIntegration({
      barbershopId: barbershop.id,
    })

    if (outboundIntegration.status !== 'resolved' || !outboundIntegration.instanceName) {
      throw new Error('Integracao WhatsApp nao configurada para esta barbearia.')
    }

    await sendTextMessage({
      number: input.phone,
      text: responseText,
      instance: outboundIntegration.instanceName,
    })

    await createOutboundMessagingEvent({
      barbershopId: barbershop.id,
      customerId: customer.id,
      phone: input.phone,
      responseText,
      inboundEventId: existingEvent.id,
      instanceName: outboundIntegration.instanceName,
    })

    await markWhatsAppOutboundDelivered(barbershop.id)

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

    await markWhatsAppIntegrationError({
      barbershopId: barbershop.id,
      message,
    })

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
  classifySchedulingFragment,
  detectFragmentedBookingTurn,
  buildConcatenatedMessage,
  hasPendingBufferedMessages,
  hasOngoingTurnContext,
  shouldFinalizeDebouncedTurn,
  resolveAggregationWindowMs,
  shouldProcessImmediately,
  findOrCreateCustomerFromInbound,
  getOrCreateWhatsappConversation,
}
