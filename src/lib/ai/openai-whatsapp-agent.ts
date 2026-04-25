import 'server-only'

import { MessagingProvider, type Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  type WhatsAppBookingSlot,
  findExactAvailableWhatsAppSlot,
  getAvailableWhatsAppSlots,
} from '@/lib/agendamentos/whatsapp-booking'
import { AvailabilityInfrastructureError } from '@/lib/agendamentos/availability'
import {
  detectRelativeDateExpression,
  detectShortPeriodPhrase,
  extractExplicitTimeFromMessage,
  interpretWhatsAppMessage,
} from '@/lib/ai/openai-whatsapp-interpreter'
import {
  formatDayLabelFromIsoDate,
  getAvailableBusinessPeriodsForDate,
  getCurrentBusinessPeriod,
  type BusinessPeriod,
} from '@/lib/timezone'

const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini'
const DEFAULT_TIMEOUT_MS = 20000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 30000
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const MAX_TOOL_ROUNDS = 6

export type WhatsAppAgentConversationState =
  | 'IDLE'
  | 'WAITING_SERVICE'
  | 'WAITING_PROFESSIONAL'
  | 'WAITING_DATE'
  | 'WAITING_TIME'
  | 'WAITING_CONFIRMATION'

export type WhatsAppAgentFlow =
  | 'greeting'
  | 'booking_status'
  | 'collect_service'
  | 'collect_professional'
  | 'collect_date'
  | 'collect_period'
  | 'offer_slots'
  | 'await_confirmation'
  | 'appointment_created'
  | 'reschedule'

export type WhatsAppAgentNextAction =
  | 'GREET'
  | 'ASK_SERVICE'
  | 'ASK_PROFESSIONAL'
  | 'ASK_PERIOD'
  | 'ASK_DATE'
  | 'OFFER_SLOTS'
  | 'ASK_CONFIRMATION'
  | 'CONFIRM_BOOKING'
  | 'RESET_CONTEXT'
  | 'ASK_CLARIFICATION'

interface OpenAIConfig {
  apiKey: string
  model: string
  timeoutMs: number
}

interface RecentMessage {
  direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM'
  text: string
  createdAt: string
}

interface ConversationCorrection {
  target: string
  value: string | null
  createdAt: string
}

interface WorkingMemory {
  state: WhatsAppAgentConversationState
  selectedServiceId: string | null
  selectedServiceName: string | null
  selectedProfessionalId: string | null
  selectedProfessionalName: string | null
  allowAnyProfessional: boolean
  requestedDateIso: string | null
  requestedTimeLabel: string | null
  offeredSlots: WhatsAppBookingSlot[]
  selectedSlot: WhatsAppBookingSlot | null
  conversationSummary: string | null
  recentCorrections: ConversationCorrection[]
}

interface ToolTraceEntry {
  name: string
  arguments: Record<string, unknown>
  result: Record<string, unknown>
}

interface AgentStructuredOutput {
  intent: 'BOOK_APPOINTMENT' | 'CHECK_EXISTING_BOOKING' | 'ACKNOWLEDGEMENT' | 'CONFIRM' | 'DECLINE' | 'CHANGE_REQUEST' | 'UNKNOWN'
  correctionTarget: 'NONE' | 'SERVICE' | 'PROFESSIONAL' | 'DATE' | 'PERIOD' | 'TIME' | 'FLOW'
  mentionedName: string | null
  preferredPeriod: 'MORNING' | 'AFTERNOON' | 'EVENING' | null
  requestedDate: string | null
  requestedTime: string | null
  confidence: number
  nextAction: WhatsAppAgentNextAction
  replyText: string
  summary: string
}

interface MissingFieldsValidation {
  missingFields: Array<'service' | 'professional' | 'period' | 'date'>
  availablePeriods: Array<Exclude<BusinessPeriod, 'CLOSED'>>
  currentBusinessPeriod: BusinessPeriod
  shouldAskDateInsteadOfPeriod: boolean
}

interface PromotedSchedulingSnapshot {
  requestedDateIso: string | null
  requestedTimeLabel: string | null
}

export interface WhatsAppAgentResult {
  responseText: string
  flow: WhatsAppAgentFlow
  conversationState: WhatsAppAgentConversationState
  shouldCreateAppointment: boolean
  memory: WorkingMemory
  structured: AgentStructuredOutput
  toolTrace: ToolTraceEntry[]
  usedAI: boolean
}

export interface WhatsAppAgentInput {
  barbershop: {
    id: string
    name: string
    slug: string
    timezone: string
  }
  customer: {
    id: string
    name: string
    created: boolean
    phone?: string | null
    preferredProfessionalId?: string | null
    preferredProfessionalName?: string | null
  }
  inboundText: string
  rawMessages?: string[]
  conversation: {
    id: string
    state: string
    updatedAt: Date
    selectedServiceId: string | null
    selectedServiceName: string | null
    selectedProfessionalId: string | null
    selectedProfessionalName: string | null
    allowAnyProfessional: boolean
    requestedDate: Date | null
    requestedTimeLabel: string | null
    slotOptions: Prisma.JsonValue | null
    selectedSlot: Prisma.JsonValue | null
    conversationSummary: string | null
    bookingDraft: Prisma.JsonValue | null
    recentCorrections: Prisma.JsonValue | null
    lastInboundText: string | null
    lastAssistantText: string | null
  }
  services: Array<{
    id: string
    name: string
    duration: number
    price: number
  }>
  professionals: Array<{
    id: string
    name: string
  }>
  nowContext: {
    dateIso: string
    dateTimeLabel: string
    hour?: number
    minute?: number
  }
}

type ToolCallRecord = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

type ResponsePayload = {
  id?: string
  output_text?: string
  output?: Array<{
    type?: string
    id?: string
    call_id?: string
    name?: string
    arguments?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

const AGENT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: ['BOOK_APPOINTMENT', 'CHECK_EXISTING_BOOKING', 'ACKNOWLEDGEMENT', 'CONFIRM', 'DECLINE', 'CHANGE_REQUEST', 'UNKNOWN'],
    },
    correctionTarget: {
      type: 'string',
      enum: ['NONE', 'SERVICE', 'PROFESSIONAL', 'DATE', 'PERIOD', 'TIME', 'FLOW'],
    },
    mentionedName: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    preferredPeriod: {
      anyOf: [{ type: 'string', enum: ['MORNING', 'AFTERNOON', 'EVENING'] }, { type: 'null' }],
    },
    requestedDate: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    requestedTime: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    nextAction: {
      type: 'string',
      enum: ['GREET', 'ASK_SERVICE', 'ASK_PROFESSIONAL', 'ASK_PERIOD', 'ASK_DATE', 'OFFER_SLOTS', 'ASK_CONFIRMATION', 'CONFIRM_BOOKING', 'RESET_CONTEXT', 'ASK_CLARIFICATION'],
    },
    replyText: { type: 'string' },
    summary: { type: 'string' },
  },
  required: [
    'intent',
    'correctionTarget',
    'mentionedName',
    'preferredPeriod',
    'requestedDate',
    'requestedTime',
    'confidence',
    'nextAction',
    'replyText',
    'summary',
  ],
} as const

const CONTEXTUAL_CONFIRMATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: ['CONFIRM', 'REJECT', 'TIME_CORRECTION', 'DATE_CORRECTION', 'PROFESSIONAL_CORRECTION', 'UNKNOWN'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    shouldClose: { type: 'boolean' },
    shouldConfirm: { type: 'boolean' },
  },
  required: ['intent', 'confidence', 'shouldClose', 'shouldConfirm'],
} as const

type ContextualConfirmationClassification = {
  intent: 'CONFIRM' | 'REJECT' | 'TIME_CORRECTION' | 'DATE_CORRECTION' | 'PROFESSIONAL_CORRECTION' | 'UNKNOWN'
  confidence: number
  shouldClose: boolean
  shouldConfirm: boolean
}

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'get_conversation_summary',
    description: 'Retorna o resumo atual da conversa, estado persistido, ultimas mensagens e draft em andamento.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: 'function',
    name: 'list_services',
    description: 'Lista os servicos ativos da barbearia para ajudar a identificar o servico pedido pelo cliente. So use preco quando o cliente pedir valor explicitamente.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'resolve_professional_name',
    description: 'Valida se um nome citado corresponde a barbeiro, cliente ou caso ambiguo antes de usar no fluxo.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    type: 'function',
    name: 'search_availability',
    description: 'Consulta disponibilidade real no backend usando servico, barbeiro, data e horario exato. Periodo so entra como filtro auxiliar quando o cliente pedir dessa forma.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        serviceId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        serviceName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        professionalId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        professionalName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        allowAnyProfessional: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
        dateIso: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        preferredPeriod: {
          anyOf: [{ type: 'string', enum: ['MORNING', 'AFTERNOON', 'EVENING', 'LATE_AFTERNOON', 'EXACT'] }, { type: 'null' }],
        },
        exactTime: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['serviceId', 'serviceName', 'professionalId', 'professionalName', 'allowAnyProfessional', 'dateIso', 'preferredPeriod', 'exactTime'],
    },
  },
  {
    type: 'function',
    name: 'create_booking_draft',
    description: 'Atualiza ou prepara um draft de agendamento com servico, data, barbeiro, horario escolhido ou periodo quando o cliente trouxer esse filtro.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        serviceId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        serviceName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        professionalId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        professionalName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        allowAnyProfessional: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
        requestedDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        preferredPeriod: {
          anyOf: [{ type: 'string', enum: ['MORNING', 'AFTERNOON', 'EVENING', 'LATE_AFTERNOON', 'EXACT'] }, { type: 'null' }],
        },
        requestedTime: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        selectedOptionNumber: { anyOf: [{ type: 'integer', minimum: 1, maximum: 4 }, { type: 'null' }] },
      },
      required: ['serviceId', 'serviceName', 'professionalId', 'professionalName', 'allowAnyProfessional', 'requestedDate', 'preferredPeriod', 'requestedTime', 'selectedOptionNumber'],
    },
  },
  {
    type: 'function',
    name: 'confirm_booking',
    description: 'Valida se ja existe um draft completo e se a mensagem do cliente permite confirmar com seguranca.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        selectedOptionNumber: { anyOf: [{ type: 'integer', minimum: 1, maximum: 4 }, { type: 'null' }] },
        requestedTime: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['selectedOptionNumber', 'requestedTime'],
    },
  },
  {
    type: 'function',
    name: 'reset_conversation_context',
    description: 'Limpa o contexto atual quando o cliente quiser recomecar ou quando o contexto estiver inconsistente.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['reason'],
    },
  },
] as const

function readEnv(name: 'OPENAI_API_KEY' | 'OPENAI_MODEL' | 'OPENAI_TIMEOUT_MS') {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTimeoutMs(rawTimeout: string) {
  if (!rawTimeout) {
    return DEFAULT_TIMEOUT_MS
  }

  const parsed = Number(rawTimeout)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMEOUT_MS
  }

  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(parsed)))
}

function getOpenAIConfig(): OpenAIConfig | null {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) {
    return null
  }

  return {
    apiKey,
    model: readEnv('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL,
    timeoutMs: normalizeTimeoutMs(readEnv('OPENAI_TIMEOUT_MS')),
  }
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function formatDateIso(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseConversationSlots(raw: Prisma.JsonValue | null): WhatsAppBookingSlot[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null
      }

      const slot = item as Record<string, unknown>
      if (
        typeof slot.key !== 'string'
        || typeof slot.professionalId !== 'string'
        || typeof slot.professionalName !== 'string'
        || typeof slot.dateIso !== 'string'
        || typeof slot.timeLabel !== 'string'
        || typeof slot.startAtIso !== 'string'
        || typeof slot.endAtIso !== 'string'
      ) {
        return null
      }

      return {
        key: slot.key,
        professionalId: slot.professionalId,
        professionalName: slot.professionalName,
        dateIso: slot.dateIso,
        timeLabel: slot.timeLabel,
        startAtIso: slot.startAtIso,
        endAtIso: slot.endAtIso,
      } satisfies WhatsAppBookingSlot
    })
    .filter((slot): slot is WhatsAppBookingSlot => Boolean(slot))
}

function parseSelectedSlot(raw: Prisma.JsonValue | null) {
  return parseConversationSlots(raw ? [raw] : null)[0] ?? null
}

function parseRecentCorrections(raw: Prisma.JsonValue | null): ConversationCorrection[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null
      }

      const correction = item as Record<string, unknown>
      if (typeof correction.target !== 'string' || typeof correction.createdAt !== 'string') {
        return null
      }

      return {
        target: correction.target,
        value: typeof correction.value === 'string' ? correction.value : null,
        createdAt: correction.createdAt,
      } satisfies ConversationCorrection
    })
    .filter((entry): entry is ConversationCorrection => Boolean(entry))
    .slice(-5)
}

function buildInitialMemory(input: WhatsAppAgentInput): WorkingMemory {
  return {
    state: normalizeConversationState(input.conversation.state),
    selectedServiceId: input.conversation.selectedServiceId,
    selectedServiceName: input.conversation.selectedServiceName,
    selectedProfessionalId: input.conversation.selectedProfessionalId,
    selectedProfessionalName: input.conversation.selectedProfessionalName,
    allowAnyProfessional: input.conversation.allowAnyProfessional,
    requestedDateIso: input.conversation.requestedDate ? formatDateIso(input.conversation.requestedDate) : null,
    requestedTimeLabel: input.conversation.requestedTimeLabel,
    offeredSlots: parseConversationSlots(input.conversation.slotOptions),
    selectedSlot: parseSelectedSlot(input.conversation.selectedSlot),
    conversationSummary: input.conversation.conversationSummary,
    recentCorrections: parseRecentCorrections(input.conversation.recentCorrections),
  }
}

function normalizeConversationState(state: string): WhatsAppAgentConversationState {
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

function inferFlow(nextAction: WhatsAppAgentNextAction): WhatsAppAgentFlow {
  if (nextAction === 'ASK_SERVICE') return 'collect_service'
  if (nextAction === 'ASK_PROFESSIONAL') return 'collect_professional'
  if (nextAction === 'ASK_DATE') return 'collect_date'
  if (nextAction === 'ASK_PERIOD') return 'collect_period'
  if (nextAction === 'OFFER_SLOTS') return 'offer_slots'
  if (nextAction === 'ASK_CONFIRMATION') return 'await_confirmation'
  if (nextAction === 'CONFIRM_BOOKING') return 'appointment_created'
  if (nextAction === 'RESET_CONTEXT') return 'reschedule'
  return 'greeting'
}

function hasUsefulProgressInMemory(memory: WorkingMemory) {
  return Boolean(
    memory.selectedServiceId
    || memory.selectedProfessionalId
    || memory.allowAnyProfessional
    || memory.requestedDateIso
    || memory.requestedTimeLabel
    || memory.offeredSlots.length > 0
    || memory.selectedSlot
  )
}

function hasExactTimeSelection(memory: WorkingMemory) {
  return Boolean(
    memory.selectedSlot?.timeLabel
    || (memory.requestedTimeLabel && memory.requestedTimeLabel.includes(':'))
  )
}

function hasResolvedProfessionalSelection(memory: WorkingMemory) {
  return Boolean(
    memory.selectedSlot?.professionalId
    || memory.selectedProfessionalId
    || memory.allowAnyProfessional
  )
}

function canAskForBookingConfirmation(memory: WorkingMemory) {
  return Boolean(
    memory.selectedServiceId
    && memory.selectedSlot
    && memory.selectedSlot.dateIso
    && memory.selectedSlot.timeLabel
    && hasResolvedProfessionalSelection(memory)
  )
}

function deriveConversationStateFromMemory(
  memory: WorkingMemory,
  nowContext: WhatsAppAgentInput['nowContext']
): WhatsAppAgentConversationState {
  const validation = validateMissingFields({
    memory,
    nowContext,
  })

  if (memory.selectedSlot) {
    return 'WAITING_CONFIRMATION'
  }

  if (validation.missingFields.includes('service')) {
    return 'WAITING_SERVICE'
  }

  if (validation.shouldAskDateInsteadOfPeriod || validation.missingFields.includes('date')) {
    return 'WAITING_DATE'
  }

  if (validation.missingFields.includes('professional')) {
    return 'WAITING_PROFESSIONAL'
  }

  return 'WAITING_TIME'
}

function inferConversationState(
  nextAction: WhatsAppAgentNextAction,
  memory: WorkingMemory,
  nowContext: WhatsAppAgentInput['nowContext']
): WhatsAppAgentConversationState {
  if (nextAction === 'ASK_SERVICE') return 'WAITING_SERVICE'
  if (nextAction === 'ASK_PROFESSIONAL') return 'WAITING_PROFESSIONAL'
  if (nextAction === 'ASK_DATE') return 'WAITING_DATE'
  if (nextAction === 'ASK_PERIOD' || nextAction === 'OFFER_SLOTS') return 'WAITING_TIME'
  if (nextAction === 'ASK_CONFIRMATION') return 'WAITING_CONFIRMATION'
  if (nextAction === 'CONFIRM_BOOKING') return 'WAITING_CONFIRMATION'
  if (hasUsefulProgressInMemory(memory)) {
    return deriveConversationStateFromMemory(memory, nowContext)
  }
  return 'IDLE'
}

function getNormalizedNowContext(input: WhatsAppAgentInput['nowContext']) {
  const [datePart, timePart = '00:00'] = input.dateTimeLabel.split(' ')
  const [parsedHour = 0, parsedMinute = 0] = timePart.split(':').map((value) => Number(value))

  return {
    dateIso: input.dateIso || datePart,
    hour: typeof input.hour === 'number' ? input.hour : parsedHour,
    minute: typeof input.minute === 'number' ? input.minute : parsedMinute,
  }
}

function validateMissingFields(input: {
  memory: WorkingMemory
  nowContext: WhatsAppAgentInput['nowContext']
}) {
  const normalizedNow = getNormalizedNowContext(input.nowContext)
  const availablePeriods = getAvailableBusinessPeriodsForDate({
    selectedDateIso: input.memory.requestedDateIso,
    nowContext: normalizedNow,
  })
  const currentBusinessPeriod = getCurrentBusinessPeriod(normalizedNow)

  const missingFields: MissingFieldsValidation['missingFields'] = []

  if (!input.memory.selectedServiceId) {
    missingFields.push('service')
  }

  if (!input.memory.requestedDateIso) {
    missingFields.push('date')
  }

  if (!input.memory.selectedProfessionalId && !input.memory.allowAnyProfessional) {
    missingFields.push('professional')
  }

  if (!input.memory.requestedTimeLabel) {
    if (input.memory.requestedDateIso && availablePeriods.length === 0) {
      missingFields.push('date')
    } else {
      missingFields.push('period')
    }
  }

  return {
    missingFields,
    availablePeriods,
    currentBusinessPeriod,
    shouldAskDateInsteadOfPeriod: Boolean(
      input.memory.requestedDateIso
      && !input.memory.requestedTimeLabel
      && availablePeriods.length === 0
    ),
  } satisfies MissingFieldsValidation
}

function enforceNextActionFromMemory(
  requestedAction: WhatsAppAgentNextAction,
  memory: WorkingMemory,
  shouldCreateAppointment: boolean,
  nowContext: WhatsAppAgentInput['nowContext']
) {
  const validation = validateMissingFields({
    memory,
    nowContext,
  })
  const canConfirmBooking = canAskForBookingConfirmation(memory)

  if (requestedAction === 'RESET_CONTEXT' || requestedAction === 'GREET') {
    if (hasUsefulProgressInMemory(memory)) {
      if (shouldCreateAppointment && canConfirmBooking) {
        return 'CONFIRM_BOOKING'
      }

      if (canConfirmBooking) {
        return 'ASK_CONFIRMATION'
      }

      if (memory.offeredSlots.length > 0) {
        return 'OFFER_SLOTS'
      }

      if (validation.missingFields.includes('service')) {
        return 'ASK_SERVICE'
      }

      if (validation.shouldAskDateInsteadOfPeriod || validation.missingFields.includes('date')) {
        return 'ASK_DATE'
      }

      if (validation.missingFields.includes('professional')) {
        return 'ASK_PROFESSIONAL'
      }

      if (validation.missingFields.includes('period')) {
        return 'ASK_PERIOD'
      }

      return 'ASK_CLARIFICATION'
    }

    return requestedAction
  }

  if (memory.requestedDateIso && requestedAction === 'ASK_DATE') {
    if (validation.missingFields.includes('service')) {
      return 'ASK_SERVICE'
    }

    if (validation.missingFields.includes('professional')) {
      return 'ASK_PROFESSIONAL'
    }

    if (validation.missingFields.includes('period')) {
      return 'ASK_PERIOD'
    }

    if (!validation.missingFields.includes('date')) {
      return canConfirmBooking ? 'ASK_CONFIRMATION' : memory.offeredSlots.length > 0 ? 'OFFER_SLOTS' : requestedAction
    }
  }

  if (validation.missingFields.includes('service')) {
    return 'ASK_SERVICE'
  }

  if (validation.shouldAskDateInsteadOfPeriod) {
    return 'ASK_DATE'
  }

  if (validation.missingFields.includes('date')) {
    return 'ASK_DATE'
  }

  if (validation.missingFields.includes('professional')) {
    return 'ASK_PROFESSIONAL'
  }

  if (validation.missingFields.includes('period')) {
    return 'ASK_PERIOD'
  }

  if (shouldCreateAppointment && canConfirmBooking) {
    return 'CONFIRM_BOOKING'
  }

  if (requestedAction === 'ASK_CONFIRMATION' && !canConfirmBooking) {
    if (memory.offeredSlots.length > 0) {
      return 'OFFER_SLOTS'
    }

    if (!hasExactTimeSelection(memory)) {
      return 'ASK_PERIOD'
    }

    return 'ASK_CLARIFICATION'
  }

  if (requestedAction === 'CONFIRM_BOOKING' && !canConfirmBooking) {
    if (memory.offeredSlots.length > 0) {
      return 'OFFER_SLOTS'
    }

    if (!hasExactTimeSelection(memory)) {
      return 'ASK_PERIOD'
    }

    return 'ASK_CLARIFICATION'
  }

  if (
    hasExactTimeSelection(memory)
    && !memory.selectedSlot
    && memory.offeredSlots.length === 0
  ) {
    return 'ASK_CLARIFICATION'
  }

  if (canConfirmBooking) {
    return 'ASK_CONFIRMATION'
  }

  if (memory.offeredSlots.length > 0) {
    return 'OFFER_SLOTS'
  }

  return requestedAction
}

function isExplicitConfirmation(message: string) {
  const normalized = normalizeIntentPhrase(message)
  const explicitPhrases = [
    'confirmo',
    'confirmar',
    'confirma',
    'confirmado',
    'fechar',
    'fechado',
    'pode confirmar',
    'pode marcar',
    'pode agendar',
    'pode fechar',
    'sim pode confirmar',
    'sim pode marcar',
    'sim pode agendar',
    'sim pode fechar',
    'quero confirmar',
    'quero marcar',
    'quero agendar',
    'desejo confirmar',
    'desejo marcar',
    'desejo agendar',
  ]

  return explicitPhrases.some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `))
}

function isContextualPositiveConfirmation(message: string) {
  const normalized = normalizeIntentPhrase(message)
  const exactContextualPhrases = [
    'sim',
    's',
    'pode',
    'pode sim',
    'quero',
    'isso',
    'esse',
    'esse mesmo',
  ]
  const actionContextualPhrases = [
    'confirmo',
    'confirmar',
    'confirma',
    'confirmado',
    'pode confirmar',
    'pode marcar',
    'pode agendar',
    'pode fechar',
    'sim pode confirmar',
    'sim pode marcar',
    'sim pode agendar',
    'sim pode fechar',
    'quero confirmar',
    'quero marcar',
    'quero agendar',
    'desejo confirmar',
    'desejo marcar',
    'desejo agendar',
    'fechar',
    'fechado',
  ]

  return exactContextualPhrases.includes(normalized)
    || actionContextualPhrases.some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `))
}

function hasExplicitConfirmationCorrectionCue(message: string) {
  const normalized = normalizeText(message)

  return Boolean(
    extractExplicitTimeFromMessage(message)
    || /\b(hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|\d{1,2}[\/-]\d{1,2})\b/.test(normalized)
    || /\bcom(?:\s+o|\s+a)?\s+[a-zà-ÿ]{3,}\b/.test(normalized)
  )
}

function resolveContextualConfirmationHeuristic(input: {
  memory: WorkingMemory
  inboundText: string
  lastAssistantText?: string | null
}) {
  const normalized = normalizeIntentPhrase(input.inboundText)
  const matchedToken = [
    'esse mesmo',
    'sim pode confirmar',
    'sim pode marcar',
    'sim pode agendar',
    'sim pode fechar',
    'pode sim',
    'pode confirmar',
    'pode marcar',
    'pode agendar',
    'pode fechar',
    'quero',
    'quero confirmar',
    'quero marcar',
    'quero agendar',
    'desejo confirmar',
    'desejo marcar',
    'desejo agendar',
    'confirmo',
    'confirmar',
    'confirma',
    'confirmado',
    'fechar',
    'fechado',
  ].find((token) => normalized.includes(token))

  const hasRequiredContext =
    input.memory.state === 'WAITING_CONFIRMATION'
    && Boolean(input.memory.selectedSlot)
    && Boolean(input.memory.selectedServiceId)
    && (Boolean(input.memory.selectedProfessionalId) || input.memory.allowAnyProfessional)
    && Boolean(input.memory.requestedDateIso)
    && Boolean(input.memory.requestedTimeLabel)
    && wasSelectedSlotPresentedToCustomer({
      lastAssistantText: input.lastAssistantText,
      memory: input.memory,
    })

  const hasCorrectionCue = hasExplicitConfirmationCorrectionCue(input.inboundText)
  const isAffirmative = isContextualPositiveConfirmation(input.inboundText)

  const accepted = hasRequiredContext && isAffirmative && !hasCorrectionCue

  return {
    accepted,
    matchedToken: matchedToken ?? null,
    hasRequiredContext,
    hasCorrectionCue,
    isAffirmative,
  }
}

function isPureExplicitConfirmation(message: string) {
  return isExplicitConfirmation(message) && !hasExplicitConfirmationCorrectionCue(message)
}

function normalizeIntentPhrase(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function hasPresentedSelectedSlotText(
  text: string | null | undefined,
  memory: WorkingMemory
) {
  if (!text || !memory.selectedSlot) {
    return false
  }

  const normalizedText = normalizeText(text)
  const hasTime = normalizedText.includes(normalizeText(memory.selectedSlot.timeLabel))
  const hasProfessional = normalizedText.includes(normalizeText(memory.selectedSlot.professionalName))
  const hasService = !memory.selectedServiceName
    || normalizedText.includes(normalizeText(memory.selectedServiceName))

  return hasTime && hasProfessional && hasService
}

function lastAssistantOfferedSlotChoices(lastAssistantText?: string | null) {
  if (!lastAssistantText) {
    return false
  }

  const normalized = normalizeText(lastAssistantText)
  return (
    /\b(qual voce prefere|qual você prefere|qual horario voce prefere|qual horário você prefere|qual deles voce prefere)\b/.test(normalized)
    || /\b(tenho estes horarios disponiveis|tenho estas opcoes|tenho essas opcoes|posso te passar os mais proximos)\b/.test(normalized)
  )
}

function wasSelectedSlotPresentedToCustomer(input: {
  lastAssistantText?: string | null
  memory: WorkingMemory
}) {
  return Boolean(
    input.lastAssistantText
    && containsConfirmationPromptLanguage(input.lastAssistantText)
    && hasPresentedSelectedSlotText(input.lastAssistantText, input.memory)
  )
}

function extractResponseText(payload: ResponsePayload) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text
  }

  const chunks: string[] = []
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        chunks.push(part.text)
      }
    }
  }

  return chunks.join('\n').trim()
}

function parseJsonObject(value: string | undefined) {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return {}
  }

  return {}
}

function extractFunctionCalls(payload: ResponsePayload): ToolCallRecord[] {
  return (Array.isArray(payload.output) ? payload.output : [])
    .filter((item) => item?.type === 'function_call' && typeof item.call_id === 'string' && typeof item.name === 'string')
    .map((item) => ({
      id: item.call_id as string,
      name: item.name as string,
      arguments: parseJsonObject(item.arguments),
    }))
}

function buildOpenAiPayloadLog(payload: Record<string, unknown>) {
  return {
    model: payload.model,
    store: payload.store ?? 'default',
    hasTools: Array.isArray(payload.tools),
    toolNames: Array.isArray(payload.tools)
      ? payload.tools
          .map((tool) => (
            tool && typeof tool === 'object' && !Array.isArray(tool) && typeof tool.name === 'string'
              ? tool.name
              : null
          ))
          .filter(Boolean)
      : [],
    hasPreviousResponseId: typeof payload.previous_response_id === 'string',
    inputPreview: typeof payload.input === 'string'
      ? payload.input.slice(0, 500)
      : Array.isArray(payload.input)
        ? JSON.stringify(payload.input).slice(0, 500)
        : null,
    hasTextFormat: Boolean(
      payload.text
      && typeof payload.text === 'object'
      && !Array.isArray(payload.text)
      && 'format' in payload.text
    ),
  }
}

function extractOpenAiErrorMessage(data: unknown, fallbackText: string) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const errorValue = (data as Record<string, unknown>).error
    if (errorValue && typeof errorValue === 'object' && !Array.isArray(errorValue)) {
      const messageValue = (errorValue as Record<string, unknown>).message
      if (typeof messageValue === 'string' && messageValue.trim()) {
        return messageValue.trim()
      }
    }
  }

  return fallbackText.slice(0, 500) || 'unknown_error'
}

async function callResponsesApi(
  config: OpenAIConfig,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  requestName: string
) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal,
  })

  const text = await response.text()
  let data: unknown = {}

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }

  if (!response.ok) {
    const errorMessage = extractOpenAiErrorMessage(data, text)

    console.error('[whatsapp-agent] openai error', {
      requestName,
      status: response.status,
      message: errorMessage,
      payloadSent: buildOpenAiPayloadLog(payload),
    })

    throw new Error(`OpenAI Responses API ${response.status}: ${errorMessage}`)
  }

  return data as ResponsePayload
}

async function loadRecentMessages(input: {
  barbershopId: string
  customerId: string
}) {
  const events = await prisma.messagingEvent.findMany({
    where: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      provider: MessagingProvider.EVOLUTION,
      direction: { in: ['INBOUND', 'OUTBOUND'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      direction: true,
      bodyText: true,
      responseText: true,
      createdAt: true,
    },
  })

  return events
    .map((event) => ({
      direction: event.direction,
      text: event.direction === 'OUTBOUND' ? (event.responseText ?? event.bodyText ?? '') : (event.bodyText ?? ''),
      createdAt: event.createdAt.toISOString(),
    }))
    .filter((event) => event.text.trim())
    .reverse()
}

function buildRuntimeSummary(memory: WorkingMemory) {
  const barber = memory.selectedProfessionalName ?? (memory.allowAnyProfessional ? 'qualquer barbeiro' : 'nao definido')
  const service = memory.selectedServiceName ?? 'nao definido'
  const date = memory.requestedDateIso ?? 'nao definida'
  const time = memory.requestedTimeLabel ?? 'nao definido'
  const slot = memory.selectedSlot
    ? `${memory.selectedSlot.dateIso} ${memory.selectedSlot.timeLabel} com ${memory.selectedSlot.professionalName}`
    : 'nao selecionado'

  return `Estado=${memory.state}; servico=${service}; barbeiro=${barber}; data=${date}; horario_ou_periodo=${time}; slot=${slot}.`
}

function buildContextualConfirmationClassifierPrompt(input: {
  inboundText: string
  lastAssistantText?: string | null
  memory: WorkingMemory
}) {
  return [
    'Voce classifica respostas curtas de WhatsApp dentro de um contexto de confirmacao de agendamento.',
    'Nao cria regras de negocio e nao inventa dados.',
    'Decida apenas entre CONFIRM, REJECT, TIME_CORRECTION, DATE_CORRECTION, PROFESSIONAL_CORRECTION ou UNKNOWN.',
    `Estado atual: ${input.memory.state}.`,
    `Resumo do agendamento: ${buildRuntimeSummary(input.memory)}`,
    `Ultima pergunta do sistema: ${input.lastAssistantText ?? 'none'}.`,
    `Mensagem atual do cliente: """${input.inboundText}"""`,
    'Regras:',
    '- Se a mensagem trouxer novo horario explicito, retorne TIME_CORRECTION.',
    '- Se trouxer nova data ou dia, retorne DATE_CORRECTION.',
    '- Se trouxer novo barbeiro, retorne PROFESSIONAL_CORRECTION.',
    '- Se for uma concordancia curta e contextual com o resumo atual, retorne CONFIRM.',
    '- Se indicar recusa, retorne REJECT.',
    '- Se ainda estiver ambiguo, retorne UNKNOWN.',
  ].join('\n')
}

function shouldUseContextualConfirmationClassifier(input: {
  memory: WorkingMemory
  inboundText: string
  lastAssistantText?: string | null
}) {
  const normalized = normalizeIntentPhrase(input.inboundText)
  if (
    input.memory.state !== 'WAITING_CONFIRMATION'
    || !input.memory.selectedSlot
    || !input.memory.selectedServiceId
    || (!input.memory.selectedProfessionalId && !input.memory.allowAnyProfessional)
    || hasExplicitConfirmationCorrectionCue(input.inboundText)
    || !wasSelectedSlotPresentedToCustomer({
      lastAssistantText: input.lastAssistantText,
      memory: input.memory,
    })
  ) {
    return false
  }

  return normalized.length <= 32 && isContextualPositiveConfirmation(input.inboundText)
}

function sanitizeContextualConfirmationPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }

  const candidate = payload as Record<string, unknown>

  return {
    intent: typeof candidate.intent === 'string' ? candidate.intent.trim() : candidate.intent,
    confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0,
    shouldClose: Boolean(candidate.shouldClose),
    shouldConfirm: Boolean(candidate.shouldConfirm),
  }
}

async function classifyContextualConfirmationWithOpenAI(input: {
  config: OpenAIConfig
  memory: WorkingMemory
  inboundText: string
  lastAssistantText?: string | null
  signal: AbortSignal
}) {
  const response = await callResponsesApi(
    input.config,
    {
      model: input.config.model,
      max_output_tokens: 120,
      input: [
        {
          role: 'user',
          content: buildContextualConfirmationClassifierPrompt({
            inboundText: input.inboundText,
            lastAssistantText: input.lastAssistantText,
            memory: input.memory,
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'barberex_contextual_confirmation',
          strict: true,
          schema: CONTEXTUAL_CONFIRMATION_SCHEMA,
        },
      },
    },
    input.signal,
    'contextual_confirmation'
  )

  const outputText = extractResponseText(response)
  if (!outputText) {
    return null
  }

  const parsed = sanitizeContextualConfirmationPayload(JSON.parse(outputText)) as ContextualConfirmationClassification | null
  if (
    !parsed
    || typeof parsed.intent !== 'string'
    || typeof parsed.confidence !== 'number'
    || typeof parsed.shouldClose !== 'boolean'
    || typeof parsed.shouldConfirm !== 'boolean'
  ) {
    return null
  }

  return parsed
}

function buildServiceQuestionFromNames(serviceNames: string[]) {
  if (serviceNames.length === 0) {
    return 'Perfeito! Qual servico voce gostaria de agendar?'
  }

  const preview = serviceNames
    .slice(0, 6)
    .map((serviceName) => `- ${serviceName}`)
    .join('\n')

  return `Perfeito! Temos estes servicos disponiveis:\n\n${preview}\n\nQual voce gostaria de agendar?`
}

function buildPresentedSlotConfirmationMessage(input: {
  serviceName: string | null
  slot: WhatsAppBookingSlot
  mode?: 'found' | 'selection'
}) {
  const serviceLabel = input.serviceName ?? 'o servico solicitado'
  const header = input.mode === 'selection'
    ? 'Perfeito, vou deixar assim para confirmacao:'
    : `Encontrei este horario para ${serviceLabel}:`

  return [
    header,
    '',
    `- Servico: ${serviceLabel}`,
    `- Data: ${formatDayLabelFromIsoDate(input.slot.dateIso)}`,
    `- Horario: ${input.slot.timeLabel}`,
    `- Barbeiro: ${input.slot.professionalName}`,
    '',
    'Quer confirmar esse agendamento?',
  ].join('\n')
}

function hasExplicitPriceQuestion(message: string) {
  return /\b(quanto custa|qual o preco|qual o valor|valor\b|preco\b|preço\b|quanto sai)\b/.test(
    normalizeText(message)
  )
}

function referencesPreferredProfessional(message: string) {
  const normalized = normalizeText(message)
  return /\b(meu barbeiro|o de sempre|de sempre|mesmo de sempre|meu de sempre|manter com o meu barbeiro|com o mesmo)\b/.test(normalized)
}

function hasExplicitAnyProfessionalConsent(message: string) {
  return /\b(qualquer um|qualquer barbeiro|tanto faz|sem preferencia|sem preferência)\b/.test(
    normalizeText(message)
  )
}

function hasExplicitFlexibleTimeRequest(message: string) {
  return /\b(qualquer horario|qualquer hora|qualquer horario serve|nao tenho preferencia de horario|sem preferencia de horario|me mostra os horarios|me mostra as opcoes|me passa os horarios|quero ver as opcoes|quais horarios voce tem)\b/.test(
    normalizeText(message)
  )
}

function hasBroadPeriodSchedulingFilter(value?: string | null) {
  return Boolean(value && ['MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING'].includes(value))
}

function shouldAllowAvailabilitySearch(input: {
  exactTime?: string | null
  preferredPeriod?: string | null
  inboundText: string
}) {
  return Boolean(
    input.exactTime
    || hasBroadPeriodSchedulingFilter(input.preferredPeriod)
    || hasExplicitFlexibleTimeRequest(input.inboundText)
  )
}

function shouldBlockConfirmationWithoutSlot(memory: WorkingMemory) {
  return !memory.selectedSlot && memory.offeredSlots.length === 0
}

function shouldUseDeterministicConfirmationShortcut(input: {
  memory: WorkingMemory
  inboundText: string
  lastAssistantText?: string | null
}) {
  const hasResolvedTime = Boolean(input.memory.requestedTimeLabel || input.memory.selectedSlot?.timeLabel)

  if (
    input.memory.state !== 'WAITING_CONFIRMATION'
    || !input.memory.selectedServiceId
    || !input.memory.selectedSlot
    || (!input.memory.selectedProfessionalId && !input.memory.allowAnyProfessional)
    || !input.memory.requestedDateIso
    || !hasResolvedTime
    || !isContextualPositiveConfirmation(input.inboundText)
    || hasExplicitConfirmationCorrectionCue(input.inboundText)
  ) {
    return false
  }

  return wasSelectedSlotPresentedToCustomer({
    lastAssistantText: input.lastAssistantText,
    memory: input.memory,
  })
}

function buildConfirmationReminderMessage() {
  return 'Para confirmar, me responda: pode marcar.'
}

function sanitizeReplyTextAgainstProfessionalVocative(input: {
  replyText: string
  customerName: string
  selectedProfessionalName?: string | null
  mentionedName?: string | null
  professionals: WhatsAppAgentInput['professionals']
}) {
  const match = input.replyText.match(/^(Oi|Perfeito|Certo|Beleza|Boa|Show|Fechado),\s+([A-Za-zÀ-ÿ]+)([!,.]?\s*)/i)
  if (!match) {
    return input.replyText
  }

  const leadIn = match[1]
  const vocativeName = normalizeText(match[2])
  const customerFirstName = normalizeText(input.customerName.trim().split(/\s+/)[0] ?? '')
  const professionalNames = new Set<string>()

  if (input.selectedProfessionalName) {
    professionalNames.add(normalizeText(input.selectedProfessionalName))
    professionalNames.add(normalizeText(input.selectedProfessionalName.split(/\s+/)[0] ?? ''))
  }

  if (input.mentionedName) {
    professionalNames.add(normalizeText(input.mentionedName))
    professionalNames.add(normalizeText(input.mentionedName.split(/\s+/)[0] ?? ''))
  }

  input.professionals.forEach((professional) => {
    professionalNames.add(normalizeText(professional.name))
    professionalNames.add(normalizeText(professional.name.split(/\s+/)[0] ?? ''))
  })

  if (vocativeName === customerFirstName || !professionalNames.has(vocativeName)) {
    return input.replyText
  }

  const punctuation = leadIn.toLowerCase() === 'oi' ? '! ' : '. '
  return input.replyText.replace(match[0], `${leadIn}${punctuation}`)
}

function containsFinalConfirmationLanguage(replyText: string) {
  return /\b(ficou marcado|agendamento confirmado|seu horario esta confirmado|horario confirmado|seu horário está confirmado|horário confirmado)\b/i.test(
    normalizeText(replyText)
  )
}

function containsConfirmationPromptLanguage(replyText: string) {
  return /\b(posso confirmar|quer que eu confirme|me confirma|posso fechar|posso agendar|quer confirmar esse agendamento)\b/i.test(
    normalizeText(replyText)
  )
}

function containsPrematureAvailabilityPromiseLanguage(replyText: string) {
  return /\b(ja tenho|consegui|reservei|ja deixei|seu horario esta separado|seu horário está separado|pronto para|ficou marcado|confirmado)\b/i.test(
    normalizeText(replyText)
  )
}

function sanitizePrematureConfirmationReply(input: {
  replyText: string
  nextAction: WhatsAppAgentNextAction
  shouldCreateAppointment: boolean
  memory: WorkingMemory
  lastAssistantText?: string | null
  customerName: string
  barbershopName: string
  preferredProfessionalName?: string | null
  serviceNames: string[]
  nowContext: WhatsAppAgentInput['nowContext']
}) {
  if (input.shouldCreateAppointment) {
    return input.replyText
  }

  const shouldUseSelectionSummaryCopy =
    input.nextAction === 'ASK_CONFIRMATION'
    && Boolean(input.memory.selectedSlot)
    && lastAssistantOfferedSlotChoices(input.lastAssistantText)
  const hasFinalConfirmationLanguage = containsFinalConfirmationLanguage(input.replyText)
  const hasConfirmationPromptLanguage = containsConfirmationPromptLanguage(input.replyText)
  const hasPrematureAvailabilityPromise = containsPrematureAvailabilityPromiseLanguage(input.replyText)
  const shouldAvoidAvailabilityPromise =
    input.nextAction !== 'ASK_CONFIRMATION'
    && input.nextAction !== 'OFFER_SLOTS'
    && !input.memory.selectedSlot
    && input.memory.offeredSlots.length === 0
  const shouldRebuildConfirmationPrompt =
    input.nextAction === 'ASK_CONFIRMATION'
    && input.memory.selectedSlot
    && !hasPresentedSelectedSlotText(input.replyText, input.memory)

  if (
    !hasFinalConfirmationLanguage
    && !hasConfirmationPromptLanguage
    && !(hasPrematureAvailabilityPromise && shouldAvoidAvailabilityPromise)
    && !shouldRebuildConfirmationPrompt
    && !shouldUseSelectionSummaryCopy
  ) {
    return input.replyText
  }

  if (
    !hasFinalConfirmationLanguage
    && input.nextAction === 'ASK_CONFIRMATION'
    && canAskForBookingConfirmation(input.memory)
    && !shouldRebuildConfirmationPrompt
    && !wasSelectedSlotPresentedToCustomer({
      lastAssistantText: input.lastAssistantText,
      memory: input.memory,
    })
  ) {
    return input.replyText
  }

  return buildGuardrailReplyText({
    nextAction: input.nextAction,
    memory: input.memory,
    lastAssistantText: input.lastAssistantText,
    customerName: input.customerName,
    barbershopName: input.barbershopName,
    preferredProfessionalName: input.preferredProfessionalName ?? null,
    serviceNames: input.serviceNames,
    nowContext: input.nowContext,
  }) ?? input.replyText
}

function assignPreferredProfessionalToMemory(input: {
  memory: WorkingMemory
  preferredProfessionalId: string
  preferredProfessionalName: string
}) {
  input.memory.allowAnyProfessional = false
  input.memory.selectedProfessionalId = input.preferredProfessionalId
  input.memory.selectedProfessionalName = input.preferredProfessionalName
  clearPromotedAvailability(input.memory)
}

function buildBookingDraft(memory: WorkingMemory) {
  return {
    selectedServiceId: memory.selectedServiceId,
    selectedServiceName: memory.selectedServiceName,
    selectedProfessionalId: memory.selectedProfessionalId,
    selectedProfessionalName: memory.selectedProfessionalName,
    allowAnyProfessional: memory.allowAnyProfessional,
    requestedDateIso: memory.requestedDateIso,
    requestedTimeLabel: memory.requestedTimeLabel,
    offeredSlots: memory.offeredSlots,
    selectedSlot: memory.selectedSlot,
  }
}

function appendCorrection(memory: WorkingMemory, target: string, value: string | null) {
  memory.recentCorrections = [
    ...memory.recentCorrections,
    {
      target,
      value,
      createdAt: new Date().toISOString(),
    },
  ].slice(-5)
}

function clearPromotedAvailability(memory: WorkingMemory) {
  memory.offeredSlots = []
  memory.selectedSlot = null
}

function selectedSlotMatchesCurrentContext(memory: WorkingMemory, slot: WhatsAppBookingSlot | null) {
  if (!slot) {
    return false
  }

  const matchesProfessional = !memory.selectedProfessionalId || memory.selectedProfessionalId === slot.professionalId
  const matchesDate = !memory.requestedDateIso || memory.requestedDateIso === slot.dateIso
  const matchesTime = !memory.requestedTimeLabel || memory.requestedTimeLabel === slot.timeLabel

  return Boolean(memory.selectedServiceId) && matchesProfessional && matchesDate && matchesTime
}

function resetWorkingMemory(memory: WorkingMemory) {
  memory.state = 'IDLE'
  memory.selectedServiceId = null
  memory.selectedServiceName = null
  memory.selectedProfessionalId = null
  memory.selectedProfessionalName = null
  memory.allowAnyProfessional = false
  memory.requestedDateIso = null
  memory.requestedTimeLabel = null
  clearPromotedAvailability(memory)
}

function findServiceByIdOrName(input: {
  serviceId?: string | null
  serviceName?: string | null
  services: WhatsAppAgentInput['services']
}) {
  if (input.serviceId) {
    const byId = input.services.find((service) => service.id === input.serviceId)
    if (byId) {
      return byId
    }
  }

  if (!input.serviceName) {
    return null
  }

  const normalizedQuery = normalizeText(input.serviceName)
  return input.services.find((service) => normalizeText(service.name) === normalizedQuery)
    ?? input.services.find((service) => normalizeText(service.name).includes(normalizedQuery))
    ?? null
}

function nameTokens(value: string) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2)
}

function findProfessionalCandidates(professionals: WhatsAppAgentInput['professionals'], name: string) {
  const tokens = nameTokens(name)
  if (tokens.length === 0) {
    return []
  }

  return professionals.filter((professional) => {
    const professionalTokens = nameTokens(professional.name)
    return tokens.every((token) =>
      professionalTokens.some((professionalToken) => professionalToken === token || professionalToken.startsWith(token))
    )
  })
}

function matchesOfferedSlotProfessionalSelection(input: {
  slot: WhatsAppBookingSlot
  message: string
  professionalName?: string | null
}) {
  const normalizedMessage = normalizeIntentPhrase(input.message)
  const normalizedProfessionalName = input.professionalName ? normalizeIntentPhrase(input.professionalName) : ''

  if (normalizedProfessionalName && normalizeIntentPhrase(input.slot.professionalName).includes(normalizedProfessionalName)) {
    return true
  }

  return nameTokens(input.slot.professionalName).some((token) =>
    normalizedMessage === token
    || normalizedMessage.startsWith(`${token} `)
    || normalizedMessage.includes(` ${token}`)
  )
}

function pickPresentedOfferedSlot(input: {
  offeredSlots: WhatsAppBookingSlot[]
  selectedOptionNumber: number | null
  requestedTime?: string | null
  professionalName?: string | null
  message: string
}) {
  if (input.selectedOptionNumber && input.selectedOptionNumber >= 1 && input.selectedOptionNumber <= input.offeredSlots.length) {
    return input.offeredSlots[input.selectedOptionNumber - 1] ?? null
  }

  if (input.requestedTime) {
    const requestedTimeMatch = input.offeredSlots.find((slot) => slot.timeLabel === input.requestedTime)
    if (requestedTimeMatch) {
      return requestedTimeMatch
    }
  }

  const normalizedMessage = normalizeIntentPhrase(input.message)
  const labelMatch = input.offeredSlots.find((slot) => normalizeIntentPhrase(slot.timeLabel) === normalizedMessage)
  if (labelMatch) {
    return labelMatch
  }

  return input.offeredSlots.find((slot) => matchesOfferedSlotProfessionalSelection({
    slot,
    message: input.message,
    professionalName: input.professionalName,
  })) ?? null
}

function applyCorrectionTargetToMemory(memory: WorkingMemory, correctionTarget: string) {
  if (correctionTarget === 'FLOW') {
    resetWorkingMemory(memory)
    return
  }

  if (correctionTarget === 'SERVICE') {
    memory.selectedServiceId = null
    memory.selectedServiceName = null
    clearPromotedAvailability(memory)
    return
  }

  if (correctionTarget === 'PROFESSIONAL') {
    memory.selectedProfessionalId = null
    memory.selectedProfessionalName = null
    memory.allowAnyProfessional = false
    clearPromotedAvailability(memory)
    return
  }

  if (correctionTarget === 'DATE') {
    memory.requestedDateIso = null
    clearPromotedAvailability(memory)
    return
  }

  if (correctionTarget === 'PERIOD' || correctionTarget === 'TIME') {
    memory.requestedTimeLabel = null
    clearPromotedAvailability(memory)
  }
}

function resolvePromotedTimeLabel(input: {
  preferredPeriod: 'MORNING' | 'AFTERNOON' | 'EVENING' | null
  timePreference: string
  exactTime: string | null
}) {
  if (input.exactTime) {
    return input.exactTime
  }

  if (input.timePreference && input.timePreference !== 'NONE') {
    return input.timePreference
  }

  return input.preferredPeriod
}

function promoteIntentContextToMemory(input: {
  memory: WorkingMemory
  intent: Awaited<ReturnType<typeof interpretWhatsAppMessage>>
  services: WhatsAppAgentInput['services']
  professionals: WhatsAppAgentInput['professionals']
}) {
  const { memory, intent, services, professionals } = input
  const previousSelectedSlot = memory.selectedSlot
  const previousOfferedSlots = memory.offeredSlots

  if (intent.restartConversation) {
    resetWorkingMemory(memory)
    return
  }

  const baseline = {
    selectedServiceId: memory.selectedServiceId,
    selectedProfessionalId: memory.selectedProfessionalId,
    allowAnyProfessional: memory.allowAnyProfessional,
    requestedDateIso: memory.requestedDateIso,
    requestedTimeLabel: memory.requestedTimeLabel,
  }

  if (intent.correctionTarget !== 'NONE') {
    applyCorrectionTargetToMemory(memory, intent.correctionTarget)
  }

  const service = findServiceByIdOrName({
    serviceName: intent.serviceName,
    services,
  })

  if (service) {
    memory.selectedServiceId = service.id
    memory.selectedServiceName = service.name
  }

  if (intent.allowAnyProfessional) {
    memory.allowAnyProfessional = true
    memory.selectedProfessionalId = null
    memory.selectedProfessionalName = null
  } else if (intent.mentionedName) {
    const professionalCandidates = findProfessionalCandidates(professionals, intent.mentionedName)
    if (professionalCandidates.length === 1) {
      memory.allowAnyProfessional = false
      memory.selectedProfessionalId = professionalCandidates[0].id
      memory.selectedProfessionalName = professionalCandidates[0].name
    }
  }

  if (intent.requestedDateIso) {
    memory.requestedDateIso = intent.requestedDateIso
  }

  const promotedTimeLabel = resolvePromotedTimeLabel({
    preferredPeriod: intent.preferredPeriod,
    timePreference: intent.timePreference,
    exactTime: intent.exactTime,
  })

  if (promotedTimeLabel) {
    memory.requestedTimeLabel = promotedTimeLabel
  }

  const serviceChanged = memory.selectedServiceId !== baseline.selectedServiceId
  const professionalChanged =
    memory.selectedProfessionalId !== baseline.selectedProfessionalId
    || memory.allowAnyProfessional !== baseline.allowAnyProfessional
  const dateChanged = memory.requestedDateIso !== baseline.requestedDateIso
  const timeChanged = memory.requestedTimeLabel !== baseline.requestedTimeLabel

  if (
    previousSelectedSlot
    && !serviceChanged
    && !professionalChanged
    && !dateChanged
    && timeChanged
    && selectedSlotMatchesCurrentContext(memory, previousSelectedSlot)
  ) {
    memory.selectedSlot = previousSelectedSlot
    memory.offeredSlots = previousOfferedSlots
    return
  }

  if (serviceChanged || professionalChanged || dateChanged || timeChanged || intent.correctionTarget !== 'NONE') {
    clearPromotedAvailability(memory)
  }
}

function preservePromotedSchedulingContext(input: {
  memory: WorkingMemory
  snapshot: PromotedSchedulingSnapshot
  correctionTarget: string
}) {
  const shouldRestoreDate =
    input.snapshot.requestedDateIso
    && input.correctionTarget !== 'DATE'
    && input.correctionTarget !== 'FLOW'

  const shouldRestoreTime =
    input.snapshot.requestedTimeLabel
    && input.correctionTarget !== 'TIME'
    && input.correctionTarget !== 'PERIOD'
    && input.correctionTarget !== 'DATE'
    && input.correctionTarget !== 'FLOW'

  if (shouldRestoreDate && !input.memory.requestedDateIso) {
    input.memory.requestedDateIso = input.snapshot.requestedDateIso
  }

  if (shouldRestoreTime && !input.memory.requestedTimeLabel) {
    input.memory.requestedTimeLabel = input.snapshot.requestedTimeLabel
  }
}

async function findCustomerCandidates(input: {
  barbershopId: string
  name: string
}) {
  const tokens = nameTokens(input.name)
  if (tokens.length === 0) {
    return []
  }

  return prisma.customer.findMany({
    where: {
      barbershopId: input.barbershopId,
      active: true,
      OR: tokens.map((token) => ({
        name: {
          contains: token,
          mode: 'insensitive',
        },
      })),
    },
    take: 5,
    select: {
      id: true,
      name: true,
    },
  })
}

function buildToolPhasePrompt(input: {
  agentInput: WhatsAppAgentInput
  memory: WorkingMemory
  recentMessages: RecentMessage[]
}) {
  const validation = validateMissingFields({
    memory: input.memory,
    nowContext: input.agentInput.nowContext,
  })
  return [
    'Voce e uma secretaria virtual de barbearia e deve usar ferramentas do backend antes de responder.',
    'Objetivo: entender a mensagem do cliente, corrigir contexto quando necessario e decidir qual ferramenta chamar.',
    'Voce nunca inventa horario, nunca cria appointment diretamente e nunca assume barbeiro sem validacao.',
    `Barbearia: ${input.agentInput.barbershop.name}.`,
    `Timezone: ${input.agentInput.barbershop.timezone}.`,
    `Agora local: ${input.agentInput.nowContext.dateTimeLabel}.`,
    `Mensagem recebida: """${input.agentInput.inboundText}""".`,
    `Mensagens brutas desta janela: ${input.agentInput.rawMessages?.join(' | ') || input.agentInput.inboundText}.`,
    `Estado atual: ${input.memory.state}.`,
    `Barbeiro preferencial real do cliente: ${input.agentInput.customer.preferredProfessionalName ?? 'nenhum'}.`,
    `Resumo persistido: ${input.memory.conversationSummary ?? 'nenhum'}.`,
    `Resumo do draft atual: ${buildRuntimeSummary(input.memory)}.`,
    `Campos faltantes reais no backend: ${validation.missingFields.join(', ') || 'nenhum'}.`,
    `Periodos validos agora: ${validation.availablePeriods.join(', ') || 'nenhum'}.`,
    `Correcoes recentes: ${input.memory.recentCorrections.map((item) => `${item.target}:${item.value ?? 'null'}`).join(' | ') || 'nenhuma'}.`,
    `Ultimas mensagens: ${input.recentMessages.map((message) => `${message.direction}:${message.text}`).join(' | ') || 'nenhuma'}.`,
    'Use as ferramentas para validar servico, barbeiro, disponibilidade e rascunho antes de responder.',
    'Quando faltar contexto, prefira perguntar em vez de assumir.',
    'Nunca pergunte novamente por um campo que o backend ja tem preenchido.',
    'Se o servico ainda nao estiver definido, use list_services para trazer a lista real completa da barbearia sem preco, a menos que o cliente pergunte valor explicitamente.',
    'Depois de identificar o servico, pergunte a data antes de falar de barbeiro e horario.',
    'Depois de identificar servico e data, pergunte a preferencia de barbeiro ou se pode ser qualquer um antes de buscar horarios.',
    'Pergunte o horario especifico como etapa principal. Use manha/tarde/noite so como fallback quando o cliente trouxer isso espontaneamente.',
    'Nao busque horarios nem confirme slot antes de existir barbeiro definido, barbeiro preferencial valido ou allowAnyProfessional explicito.',
    'Antes de consultar disponibilidade real, trate servico, barbeiro, data e horario como intencao do cliente. Use linguagem como "entendi" e "vou verificar", nunca "ja tenho", "reservei", "ficou marcado" ou "confirmado".',
    'Se o backend ja tiver requestedDateIso, use exatamente essa data e o dia da semana real correspondente. Nunca recalcule dia/data por texto livre.',
    'So considere confirmacao final depois de apresentar um slot claro ao cliente com data, horario e barbeiro e receber confirmacao explicita como "confirmo", "pode marcar", "pode confirmar" ou "pode agendar".',
    'Mensagens vagas como "ok", "blz", "beleza", "tenta ai", "pode tentar" ou emoji sozinho nunca sao confirmacao final.',
    'Se o cliente responder apenas com um nome de barbeiro, trate isso como escolha de profissional.',
    'Nao use o nome do barbeiro escolhido como vocativo do cliente na resposta.',
  ].join('\n')
}

function buildFinalPrompt(input: {
  agentInput: WhatsAppAgentInput
  memory: WorkingMemory
  toolTrace: ToolTraceEntry[]
  recentMessages: RecentMessage[]
}) {
  const validation = validateMissingFields({
    memory: input.memory,
    nowContext: input.agentInput.nowContext,
  })
  return [
    'Voce acabou de usar ferramentas do backend para atender um cliente no WhatsApp.',
    'Responda com JSON estruturado e linguagem humana curta, como uma secretaria virtual de barbearia.',
    'A resposta final deve ser natural, clara, educada e profissional.',
    'Nunca prometa horarios que nao vieram das ferramentas.',
    'Se houver duvida, use nextAction=ASK_CLARIFICATION.',
    `Mensagem atual do cliente: """${input.agentInput.inboundText}""".`,
    `Mensagens brutas desta janela: ${input.agentInput.rawMessages?.join(' | ') || input.agentInput.inboundText}.`,
    `Barbearia: ${input.agentInput.barbershop.name}.`,
    `Data/hora local: ${input.agentInput.nowContext.dateTimeLabel}.`,
    `Barbeiro preferencial real do cliente: ${input.agentInput.customer.preferredProfessionalName ?? 'nenhum'}.`,
    `Resumo atualizado do contexto: ${buildRuntimeSummary(input.memory)}.`,
    `Campos faltantes reais no backend: ${validation.missingFields.join(', ') || 'nenhum'}.`,
    `Periodos validos agora: ${validation.availablePeriods.join(', ') || 'nenhum'}.`,
    `Correcoes recentes: ${input.memory.recentCorrections.map((item) => `${item.target}:${item.value ?? 'null'}`).join(' | ') || 'nenhuma'}.`,
    `Ferramentas chamadas nesta rodada: ${input.toolTrace.map((trace) => `${trace.name}:${JSON.stringify(trace.result)}`).join(' | ') || 'nenhuma'}.`,
    `Ultimas mensagens: ${input.recentMessages.map((message) => `${message.direction}:${message.text}`).join(' | ') || 'nenhuma'}.`,
    'Escolha nextAction coerente com o estado do backend.',
    'Se faltar servico, responda mostrando a lista real de servicos disponiveis sem preco, a menos que o cliente tenha pedido valor explicitamente.',
    'Depois de servico e data, pergunte preferencia de barbeiro antes de falar de horarios.',
    'Pergunte o horario especifico como etapa principal e nao use periodo como pergunta padrao.',
    'Se faltar definicao de barbeiro, pergunte preferencia antes de buscar ou confirmar horario.',
    'Antes de consultar a agenda real, responda com linguagem de intencao como "entendi" e "vou verificar". Nunca diga "ja tenho", "reservei", "ficou marcado" ou "confirmado" antes da consulta real.',
    'Se o backend ja tiver requestedDateIso, use exatamente essa data e o dia da semana real correspondente. Nunca recalcule dia/data por texto livre.',
    'So finalize o agendamento depois de apresentar um slot claro com data, horario e barbeiro e receber confirmacao explicita como "confirmo", "pode marcar", "pode confirmar" ou "pode agendar".',
    'Nao trate "ok", "blz", "beleza", "tenta ai", "pode tentar" ou emoji sozinho como confirmacao final.',
    'Se o cliente responder apenas com um nome de barbeiro, trate isso como escolha de profissional e nao como vocativo.',
  ].join('\n')
}

function buildFallbackStructuredOutput(input: {
  fallbackIntent: Awaited<ReturnType<typeof interpretWhatsAppMessage>>
  memory: WorkingMemory
  customerName: string
  barbershopName: string
  preferredProfessionalName?: string | null
  services: WhatsAppAgentInput['services']
  nowContext: WhatsAppAgentInput['nowContext']
}) {
  const firstName = input.customerName.trim().split(' ')[0]
  const replyText = input.fallbackIntent.greetingOnly || input.fallbackIntent.restartConversation
    ? `Oi, ${firstName}! Posso te ajudar a marcar um horario na ${input.barbershopName} 🙂`
    : (!input.memory.selectedServiceId
      ? 'Perfeito. Qual servico voce quer fazer?'
      : (!input.memory.requestedDateIso
        ? 'Qual dia voce prefere?'
        : (!input.memory.selectedProfessionalId && !input.memory.allowAnyProfessional
          ? 'Voce tem algum barbeiro de preferencia ou pode ser qualquer um?'
          : (!input.memory.requestedTimeLabel
            ? 'Perfeito. Que horas voce gostaria?'
            : 'Me confirma rapidinho como voce quer seguir por aqui.'))))

  const nextAction: WhatsAppAgentNextAction =
    input.fallbackIntent.restartConversation
      ? 'RESET_CONTEXT'
      : enforceNextActionFromMemory('ASK_CLARIFICATION', input.memory, false, input.nowContext)
  const guardedReplyText =
    buildGuardrailReplyText({
      nextAction,
      memory: input.memory,
      customerName: input.customerName,
      barbershopName: input.barbershopName,
      preferredProfessionalName: input.preferredProfessionalName ?? null,
      serviceNames: input.services.map((service) => service.name),
      nowContext: input.nowContext,
    })
    ?? replyText

  return {
    intent: input.fallbackIntent.intent,
    correctionTarget: input.fallbackIntent.correctionTarget,
    mentionedName: input.fallbackIntent.mentionedName,
    preferredPeriod: input.fallbackIntent.preferredPeriod,
    requestedDate: input.fallbackIntent.requestedDateIso,
    requestedTime: input.fallbackIntent.exactTime ?? input.memory.requestedTimeLabel,
    confidence: input.fallbackIntent.confidence,
    nextAction,
    replyText: guardedReplyText,
    summary: buildRuntimeSummary(input.memory),
  } satisfies AgentStructuredOutput
}

function buildGuardrailReplyText(input: {
  nextAction: WhatsAppAgentNextAction
  memory: WorkingMemory
  lastAssistantText?: string | null
  customerName: string
  barbershopName: string
  preferredProfessionalName?: string | null
  serviceNames?: string[]
  nowContext?: WhatsAppAgentInput['nowContext']
}) {
  const firstName = input.customerName.trim().split(' ')[0]
  const validation = input.nowContext
    ? validateMissingFields({
        memory: input.memory,
        nowContext: input.nowContext,
      })
    : null

  if (input.nextAction === 'GREET' || input.nextAction === 'RESET_CONTEXT') {
    return `Oi, ${firstName}! Posso te ajudar a marcar um horario na ${input.barbershopName}?`
  }

  if (input.nextAction === 'ASK_SERVICE') {
    return buildServiceQuestionFromNames(input.serviceNames ?? [])
  }

  if (input.nextAction === 'ASK_PROFESSIONAL') {
    if (input.memory.selectedServiceName && input.memory.requestedDateIso) {
      const intentLead = `Entendi. Voce quer ${input.memory.selectedServiceName} para ${formatDayLabelFromIsoDate(input.memory.requestedDateIso).toLowerCase()}.`

      if (input.preferredProfessionalName) {
        return `${intentLead}\n\nQuer marcar com ${input.preferredProfessionalName} de novo ou prefere outro barbeiro?`
      }

      return `${intentLead}\n\nVoce tem algum barbeiro de preferencia ou pode ser qualquer um?`
    }

    if (input.preferredProfessionalName) {
      return `Quer marcar com ${input.preferredProfessionalName} de novo ou prefere outro barbeiro?`
    }

    if (input.memory.selectedProfessionalName) {
      return `Posso buscar com ${input.memory.selectedProfessionalName} ou, se preferir, vejo outro barbeiro.`
    }

    return 'Voce tem algum barbeiro de preferencia ou pode ser qualquer um?'
  }

  if (input.nextAction === 'ASK_PERIOD') {
    if (validation?.availablePeriods.length === 0) {
      return 'Hoje ja passou do horario de atendimento. Quer que eu veja para amanha ou outro dia?'
    }

    return 'Perfeito. Que horas voce gostaria? Me diz o horario que voce quer e eu verifico pra voce.'
  }

  if (input.nextAction === 'ASK_DATE') {
    return 'Qual dia voce prefere? Pode ser hoje, amanha ou a data que quiser.'
  }

  if (input.nextAction === 'ASK_CONFIRMATION' && input.memory.selectedSlot && input.memory.selectedServiceName) {
    if (wasSelectedSlotPresentedToCustomer({
      lastAssistantText: input.lastAssistantText,
      memory: input.memory,
    }) && !lastAssistantOfferedSlotChoices(input.lastAssistantText)) {
      return buildConfirmationReminderMessage()
    }

    return buildPresentedSlotConfirmationMessage({
      serviceName: input.memory.selectedServiceName,
      slot: input.memory.selectedSlot,
      mode: lastAssistantOfferedSlotChoices(input.lastAssistantText) ? 'selection' : 'found',
    })
  }

  if (input.nextAction === 'OFFER_SLOTS' && input.memory.offeredSlots.length > 0) {
    const header = input.memory.selectedProfessionalName
      ? `${input.memory.requestedDateIso ?? 'Nesse dia'} com ${input.memory.selectedProfessionalName} eu tenho estes horarios:`
      : `${input.memory.requestedDateIso ?? 'Nesse dia'} eu tenho estes horarios:`
    const lines = input.memory.offeredSlots
      .slice(0, 4)
      .map((slot) => `- ${slot.timeLabel} com ${slot.professionalName}`)
    return `${header}\n\n${lines.join('\n')}\n\nPode me dizer qual voce prefere?`
  }

  return null
}

function getLatestToolError(
  toolTrace: ToolTraceEntry[],
  toolName?: string
) {
  for (let index = toolTrace.length - 1; index >= 0; index -= 1) {
    const trace = toolTrace[index]
    if (toolName && trace.name !== toolName) {
      continue
    }

    if (
      trace.result
      && typeof trace.result === 'object'
      && !Array.isArray(trace.result)
      && trace.result.status === 'error'
      && typeof trace.result.reason === 'string'
    ) {
      return trace
    }
  }

  return null
}

function buildNearbySlotsMessage(slots: WhatsAppBookingSlot[]) {
  const labels = slots
    .slice(0, 4)
    .map((slot) => `${slot.timeLabel} com ${slot.professionalName}`)

  return labels.length > 0
    ? `Tenho estes horarios disponiveis:\n\n${labels.map((label) => `• ${label}`).join('\n')}\n\nQual voce prefere?`
    : null
}

function resolveToolFailureOverride(input: {
  toolTrace: ToolTraceEntry[]
  memory: WorkingMemory
  customerName: string
  barbershopName: string
  preferredProfessionalName?: string | null
  serviceNames: string[]
  nowContext: WhatsAppAgentInput['nowContext']
}) {
  const latestAvailabilityError =
    getLatestToolError(input.toolTrace, 'search_availability')
    ?? getLatestToolError(input.toolTrace, 'confirm_booking')
    ?? getLatestToolError(input.toolTrace, 'create_booking_draft')

  if (!latestAvailabilityError) {
    return null
  }

  const reason = String(latestAvailabilityError.result.reason)

  if (reason === 'service_not_found') {
    const nextAction = 'ASK_SERVICE' as const
    return {
      nextAction,
      replyText: buildGuardrailReplyText({
        nextAction,
        memory: input.memory,
        customerName: input.customerName,
        barbershopName: input.barbershopName,
        preferredProfessionalName: input.preferredProfessionalName ?? null,
        serviceNames: input.serviceNames,
        nowContext: input.nowContext,
      }) ?? buildServiceQuestionFromNames(input.serviceNames),
    }
  }

  if (reason === 'professional_choice_required') {
    const nextAction = 'ASK_PROFESSIONAL' as const
    return {
      nextAction,
      replyText: buildGuardrailReplyText({
        nextAction,
        memory: input.memory,
        customerName: input.customerName,
        barbershopName: input.barbershopName,
        preferredProfessionalName: input.preferredProfessionalName ?? null,
        serviceNames: input.serviceNames,
        nowContext: input.nowContext,
      }) ?? 'Voce tem algum barbeiro de preferencia ou pode ser qualquer um?',
    }
  }

  if (reason === 'date_required') {
    const nextAction = 'ASK_DATE' as const
    return {
      nextAction,
      replyText: buildGuardrailReplyText({
        nextAction,
        memory: input.memory,
        customerName: input.customerName,
        barbershopName: input.barbershopName,
        preferredProfessionalName: input.preferredProfessionalName ?? null,
        serviceNames: input.serviceNames,
        nowContext: input.nowContext,
      }) ?? 'Qual dia voce prefere?',
    }
  }

  if (reason === 'time_preference_required') {
    const nextAction = 'ASK_PERIOD' as const
    return {
      nextAction,
      replyText: buildGuardrailReplyText({
        nextAction,
        memory: input.memory,
        customerName: input.customerName,
        barbershopName: input.barbershopName,
        preferredProfessionalName: input.preferredProfessionalName ?? null,
        serviceNames: input.serviceNames,
        nowContext: input.nowContext,
      }) ?? 'Perfeito. Que horas voce gostaria?',
    }
  }

  if (reason === 'availability_infrastructure_error') {
    clearPromotedAvailability(input.memory)
    return {
      nextAction: 'ASK_CLARIFICATION' as const,
      replyText: 'Nao consegui verificar os horarios agora, pode tentar novamente daqui a pouco?',
    }
  }

  if (reason === 'multiple_professionals_for_exact_time') {
    const slots = Array.isArray(latestAvailabilityError.result.slots)
      ? latestAvailabilityError.result.slots as WhatsAppBookingSlot[]
      : []
    return {
      nextAction: 'OFFER_SLOTS' as const,
      replyText: buildNearbySlotsMessage(slots)
        ?? 'Tenho mais de um barbeiro disponivel nesse horario. Quer que eu te mostre as opcoes?',
    }
  }

  if (reason === 'slot_not_found') {
    const nearbySlots = Array.isArray(latestAvailabilityError.result.nearbySlots)
      ? latestAvailabilityError.result.nearbySlots as WhatsAppBookingSlot[]
      : input.memory.offeredSlots

    return {
      nextAction: nearbySlots.length > 0 ? 'OFFER_SLOTS' as const : 'ASK_CLARIFICATION' as const,
      replyText: buildNearbySlotsMessage(nearbySlots)
        ?? 'Nao encontrei esse horario nas opcoes atuais. Vou buscar de novo para voce.',
    }
  }

  if (reason === 'offered_slots_missing') {
    clearPromotedAvailability(input.memory)
    return {
      nextAction: 'ASK_CLARIFICATION' as const,
      replyText: 'Nao consegui verificar os horarios agora, pode tentar novamente daqui a pouco?',
    }
  }

  clearPromotedAvailability(input.memory)
  return {
    nextAction: 'ASK_CLARIFICATION' as const,
    replyText: 'Nao consegui verificar os horarios agora, pode tentar novamente daqui a pouco?',
  }
}

async function executeAgentTool(input: {
  toolName: string
  args: Record<string, unknown>
  agentInput: WhatsAppAgentInput
  memory: WorkingMemory
}) {
  const { toolName, args, agentInput, memory } = input

  if (toolName === 'get_conversation_summary') {
    return {
      status: 'ok',
      summary: memory.conversationSummary ?? buildRuntimeSummary(memory),
      state: memory.state,
      draft: buildBookingDraft(memory),
      recentCorrections: memory.recentCorrections,
      preferredProfessional: agentInput.customer.preferredProfessionalId
        ? {
            id: agentInput.customer.preferredProfessionalId,
            name: agentInput.customer.preferredProfessionalName,
          }
        : null,
    }
  }

  if (toolName === 'list_services') {
    const query = typeof args.query === 'string' ? args.query : null
    const filteredServices = query
      ? agentInput.services.filter((service) => normalizeText(service.name).includes(normalizeText(query)))
      : agentInput.services
    const services = filteredServices.length > 0 ? filteredServices : agentInput.services
    const includePrice = hasExplicitPriceQuestion(agentInput.inboundText)

    return {
      status: 'ok',
      mode: filteredServices.length > 0 ? 'filtered' : 'all_services_fallback',
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        duration: service.duration,
        price: includePrice ? service.price : null,
      })),
    }
  }

  if (toolName === 'resolve_professional_name') {
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    if (!name) {
      return { status: 'error', reason: 'missing_name' }
    }

    const professionalCandidates = findProfessionalCandidates(agentInput.professionals, name)
    const customerCandidates = await findCustomerCandidates({
      barbershopId: agentInput.barbershop.id,
      name,
    })

    const status =
      professionalCandidates.length === 1 && customerCandidates.length === 0
        ? 'matched'
        : professionalCandidates.length > 1 || (professionalCandidates.length > 0 && customerCandidates.length > 0)
          ? 'ambiguous'
          : customerCandidates.length > 0
            ? 'customer_reference'
            : 'not_found'

    return {
      status,
      professional: professionalCandidates[0] ?? null,
      professionalCandidates,
      customerCandidates,
    }
  }

  if (toolName === 'search_availability') {
    const service = findServiceByIdOrName({
      serviceId: typeof args.serviceId === 'string' ? args.serviceId : null,
      serviceName: typeof args.serviceName === 'string' ? args.serviceName : memory.selectedServiceName,
      services: agentInput.services,
    })

    if (!service) {
      return { status: 'error', reason: 'service_not_found' }
    }

    let professionalId = typeof args.professionalId === 'string' ? args.professionalId : memory.selectedProfessionalId
    let professionalName = typeof args.professionalName === 'string' ? args.professionalName : memory.selectedProfessionalName
    const allowAnyProfessional = Boolean(
      memory.allowAnyProfessional
      || (
        typeof args.allowAnyProfessional === 'boolean'
        && args.allowAnyProfessional
        && hasExplicitAnyProfessionalConsent(agentInput.inboundText)
      )
    )

    if (!professionalId && !allowAnyProfessional && agentInput.customer.preferredProfessionalId) {
      professionalId = agentInput.customer.preferredProfessionalId
      professionalName = agentInput.customer.preferredProfessionalName ?? null
    }

    if (!professionalId && professionalName) {
      const candidates = findProfessionalCandidates(agentInput.professionals, professionalName)
      if (candidates.length === 1) {
        professionalId = candidates[0].id
        professionalName = candidates[0].name
      }
    }

    if (!professionalId && !allowAnyProfessional) {
      return {
        status: 'error',
        reason: 'professional_choice_required',
        preferredProfessional: agentInput.customer.preferredProfessionalId
          ? {
              id: agentInput.customer.preferredProfessionalId,
              name: agentInput.customer.preferredProfessionalName,
            }
          : null,
      }
    }

    const dateIso = typeof args.dateIso === 'string' && args.dateIso ? args.dateIso : memory.requestedDateIso
    if (!dateIso) {
      return { status: 'error', reason: 'date_required' }
    }

    const requestedTimePreference = typeof args.preferredPeriod === 'string' && args.preferredPeriod
      ? args.preferredPeriod
      : memory.requestedTimeLabel
    const exactTime = typeof args.exactTime === 'string' && args.exactTime
      ? args.exactTime
      : (requestedTimePreference && /^\d{2}:\d{2}$/.test(requestedTimePreference) ? requestedTimePreference : null)
    const preferredPeriod = exactTime ? 'EXACT' : requestedTimePreference
    const hasPeriodFilter = hasBroadPeriodSchedulingFilter(preferredPeriod)

    if (hasPeriodFilter) {
      console.info('[whatsapp-agent] preferred period interpreted', {
        customerId: agentInput.customer.id,
        conversationId: agentInput.conversation.id,
        inboundText: agentInput.inboundText,
        preferredPeriod,
      })

      const shortPeriodPhrase = detectShortPeriodPhrase({
        message: agentInput.inboundText,
        conversationState: memory.state,
      })

      if (shortPeriodPhrase) {
        console.info('[availability] period filter applied from short phrase', {
          customerId: agentInput.customer.id,
          conversationId: agentInput.conversation.id,
          inboundText: agentInput.inboundText,
          preferredPeriod,
          requestedDateIso: dateIso,
          timezone: agentInput.barbershop.timezone,
        })
      }
    }

    const canListOptions = shouldAllowAvailabilitySearch({
      exactTime,
      preferredPeriod,
      inboundText: agentInput.inboundText,
    })
    if (!canListOptions) {
      return {
        status: 'error',
        reason: 'time_preference_required',
      }
    }

    let availability
    try {
      availability = await getAvailableWhatsAppSlots({
        barbershopId: agentInput.barbershop.id,
        serviceId: service.id,
        dateIso,
        timezone: agentInput.barbershop.timezone,
        professionalId: allowAnyProfessional ? null : professionalId,
        timePreference: preferredPeriod,
        exactTime,
        limit: 4,
      })
    } catch (error) {
      if (error instanceof AvailabilityInfrastructureError) {
        return {
          status: 'error',
          reason: 'availability_infrastructure_error',
        }
      }

      throw error
    }

    memory.selectedServiceId = service.id
    memory.selectedServiceName = service.name
    memory.requestedDateIso = dateIso
    memory.requestedTimeLabel = exactTime ?? preferredPeriod ?? memory.requestedTimeLabel
    memory.offeredSlots = availability.slots

    if (allowAnyProfessional) {
      memory.allowAnyProfessional = true
      memory.selectedProfessionalId = null
      memory.selectedProfessionalName = null
    } else if (professionalId) {
      memory.allowAnyProfessional = false
      memory.selectedProfessionalId = professionalId
      memory.selectedProfessionalName =
        professionalName
        ?? agentInput.professionals.find((professional) => professional.id === professionalId)?.name
        ?? null
    }

    return {
      status: 'ok',
      diagnostics: availability.diagnostics,
      slots: availability.slots,
    }
  }

  if (toolName === 'create_booking_draft') {
    const service = findServiceByIdOrName({
      serviceId: typeof args.serviceId === 'string' ? args.serviceId : memory.selectedServiceId,
      serviceName: typeof args.serviceName === 'string' ? args.serviceName : memory.selectedServiceName,
      services: agentInput.services,
    })

    if (service) {
      memory.selectedServiceId = service.id
      memory.selectedServiceName = service.name
    }

    const allowAnyProfessional = Boolean(
      memory.allowAnyProfessional
      || (
        typeof args.allowAnyProfessional === 'boolean'
        && args.allowAnyProfessional
        && hasExplicitAnyProfessionalConsent(agentInput.inboundText)
      )
    )

    if (allowAnyProfessional) {
      memory.allowAnyProfessional = true
      memory.selectedProfessionalId = null
      memory.selectedProfessionalName = null
    } else {
      const professionalId = typeof args.professionalId === 'string' ? args.professionalId : null
      const professionalName = typeof args.professionalName === 'string' ? args.professionalName : null
      const candidates = professionalId
        ? agentInput.professionals.filter((professional) => professional.id === professionalId)
        : (professionalName ? findProfessionalCandidates(agentInput.professionals, professionalName) : [])

      if (candidates.length === 1) {
        memory.allowAnyProfessional = false
        memory.selectedProfessionalId = candidates[0].id
        memory.selectedProfessionalName = candidates[0].name
      }
    }

    if (typeof args.requestedDate === 'string' && args.requestedDate) {
      memory.requestedDateIso = args.requestedDate
    }

    if (typeof args.preferredPeriod === 'string' && args.preferredPeriod) {
      memory.requestedTimeLabel = args.preferredPeriod
    }

    if (typeof args.requestedTime === 'string' && args.requestedTime) {
      memory.requestedTimeLabel = args.requestedTime
    }

    const selectedOptionNumber = typeof args.selectedOptionNumber === 'number' ? args.selectedOptionNumber : null
    const selectedPresentedSlot = pickPresentedOfferedSlot({
      offeredSlots: memory.offeredSlots,
      selectedOptionNumber,
      requestedTime: typeof args.requestedTime === 'string' ? args.requestedTime : null,
      professionalName: typeof args.professionalName === 'string' ? args.professionalName : null,
      message: agentInput.inboundText,
    })
    if (selectedPresentedSlot) {
      memory.selectedSlot = selectedPresentedSlot
    }

    if (!memory.selectedSlot && (
      typeof args.requestedTime === 'string'
      && args.requestedTime
      && memory.requestedDateIso
    )) {
      if (!memory.selectedServiceId) {
        return {
          status: 'error',
          reason: 'service_not_found',
        }
      }

      if (memory.selectedProfessionalId) {
        try {
          memory.selectedSlot = await findExactAvailableWhatsAppSlot({
            barbershopId: agentInput.barbershop.id,
            serviceId: memory.selectedServiceId,
            professionalId: memory.selectedProfessionalId,
            dateIso: memory.requestedDateIso,
            timeLabel: args.requestedTime,
            timezone: agentInput.barbershop.timezone,
          })
        } catch (error) {
          if (error instanceof AvailabilityInfrastructureError) {
            return {
              status: 'error',
              reason: 'availability_infrastructure_error',
            }
          }

          throw error
        }
      } else if (memory.allowAnyProfessional) {
        let exactAvailability
        try {
          exactAvailability = await getAvailableWhatsAppSlots({
            barbershopId: agentInput.barbershop.id,
            serviceId: memory.selectedServiceId,
            dateIso: memory.requestedDateIso,
            timezone: agentInput.barbershop.timezone,
            professionalId: null,
            timePreference: 'EXACT',
            exactTime: args.requestedTime,
            limit: 4,
          })
        } catch (error) {
          if (error instanceof AvailabilityInfrastructureError) {
            return {
              status: 'error',
              reason: 'availability_infrastructure_error',
            }
          }

          throw error
        }

        if (exactAvailability.slots.length === 1) {
          memory.selectedSlot = exactAvailability.slots[0]
        } else if (exactAvailability.slots.length > 1) {
          return {
            status: 'error',
            reason: 'multiple_professionals_for_exact_time',
            slots: exactAvailability.slots,
          }
        }
      } else {
        return {
          status: 'error',
          reason: 'professional_choice_required',
          preferredProfessional: agentInput.customer.preferredProfessionalId
            ? {
                id: agentInput.customer.preferredProfessionalId,
                name: agentInput.customer.preferredProfessionalName,
              }
            : null,
        }
      }

      if (!memory.selectedSlot) {
        return {
          status: 'error',
          reason: memory.offeredSlots.length === 0 ? 'offered_slots_missing' : 'slot_not_found',
          nearbySlots: memory.offeredSlots.slice(0, 4),
        }
      }
    }

    return {
      status: 'ok',
      draft: buildBookingDraft(memory),
      selectedSlot: memory.selectedSlot,
    }
  }

  if (toolName === 'confirm_booking') {
    const selectedOptionNumber = typeof args.selectedOptionNumber === 'number' ? args.selectedOptionNumber : null
    const requestedTime = typeof args.requestedTime === 'string' ? args.requestedTime : null
    const pureExplicitConfirmation = isPureExplicitConfirmation(agentInput.inboundText)

    if (shouldBlockConfirmationWithoutSlot(memory)) {
      console.info('[agent] confirmation blocked missing slot', {
        customerId: agentInput.customer.id,
        conversationId: agentInput.conversation.id,
        inboundText: agentInput.inboundText,
        offeredSlots: memory.offeredSlots.length,
        selectedSlot: memory.selectedSlot,
      })

      return {
        status: 'error',
        reason: 'offered_slots_missing',
        explicitConfirmationDetected: pureExplicitConfirmation,
      }
    }

    const selectedPresentedSlot = pickPresentedOfferedSlot({
      offeredSlots: memory.offeredSlots,
      selectedOptionNumber,
      requestedTime,
      message: agentInput.inboundText,
    })
    if (selectedPresentedSlot) {
      memory.selectedSlot = selectedPresentedSlot
    }

    if (!memory.selectedSlot && requestedTime && memory.requestedDateIso) {
      if (!memory.selectedServiceId) {
        return {
          status: 'error',
          reason: 'service_not_found',
          explicitConfirmationDetected: pureExplicitConfirmation,
        }
      }

      if (memory.selectedProfessionalId) {
        try {
          memory.selectedSlot = await findExactAvailableWhatsAppSlot({
            barbershopId: agentInput.barbershop.id,
            serviceId: memory.selectedServiceId,
            professionalId: memory.selectedProfessionalId,
            dateIso: memory.requestedDateIso,
            timeLabel: requestedTime,
            timezone: agentInput.barbershop.timezone,
          })
        } catch (error) {
          if (error instanceof AvailabilityInfrastructureError) {
            return {
              status: 'error',
              reason: 'availability_infrastructure_error',
              explicitConfirmationDetected: pureExplicitConfirmation,
            }
          }

          throw error
        }
      } else if (memory.allowAnyProfessional) {
        let exactAvailability
        try {
          exactAvailability = await getAvailableWhatsAppSlots({
            barbershopId: agentInput.barbershop.id,
            serviceId: memory.selectedServiceId,
            dateIso: memory.requestedDateIso,
            timezone: agentInput.barbershop.timezone,
            professionalId: null,
            timePreference: 'EXACT',
            exactTime: requestedTime,
            limit: 4,
          })
        } catch (error) {
          if (error instanceof AvailabilityInfrastructureError) {
            return {
              status: 'error',
              reason: 'availability_infrastructure_error',
              explicitConfirmationDetected: pureExplicitConfirmation,
            }
          }

          throw error
        }

        if (exactAvailability.slots.length === 1) {
          memory.selectedSlot = exactAvailability.slots[0]
        } else if (exactAvailability.slots.length > 1) {
          return {
            status: 'error',
            reason: 'multiple_professionals_for_exact_time',
            slots: exactAvailability.slots,
            explicitConfirmationDetected: pureExplicitConfirmation,
          }
        }
      } else {
        return {
          status: 'error',
          reason: 'professional_choice_required',
          preferredProfessional: agentInput.customer.preferredProfessionalId
            ? {
                id: agentInput.customer.preferredProfessionalId,
                name: agentInput.customer.preferredProfessionalName,
              }
            : null,
          explicitConfirmationDetected: pureExplicitConfirmation,
        }
      }
    }

    if (!memory.selectedSlot) {
      return {
        status: 'error',
        reason: memory.offeredSlots.length === 0 ? 'offered_slots_missing' : 'slot_not_found',
        nearbySlots: memory.offeredSlots.slice(0, 4),
        explicitConfirmationDetected: pureExplicitConfirmation,
      }
    }

    return {
      status: 'ok',
      readyToConfirm: Boolean(memory.selectedServiceId && memory.selectedSlot && pureExplicitConfirmation),
      selectedSlot: memory.selectedSlot,
      explicitConfirmationDetected: pureExplicitConfirmation,
    }
  }

  if (toolName === 'reset_conversation_context') {
    resetWorkingMemory(memory)
    appendCorrection(memory, 'FLOW', typeof args.reason === 'string' ? args.reason : null)
    return {
      status: 'ok',
      summary: buildRuntimeSummary(memory),
    }
  }

  return {
    status: 'error',
    reason: 'unknown_tool',
  }
}

function sanitizeStructuredOutput(raw: AgentStructuredOutput, fallback: AgentStructuredOutput) {
  return {
    intent: raw.intent ?? fallback.intent,
    correctionTarget: raw.correctionTarget ?? fallback.correctionTarget,
    mentionedName: raw.mentionedName ?? fallback.mentionedName,
    preferredPeriod: raw.preferredPeriod ?? fallback.preferredPeriod,
    requestedDate: raw.requestedDate ?? fallback.requestedDate,
    requestedTime: raw.requestedTime ?? fallback.requestedTime,
    confidence: Number.isFinite(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : fallback.confidence,
    nextAction: raw.nextAction ?? fallback.nextAction,
    replyText: raw.replyText?.trim() || fallback.replyText,
    summary: raw.summary?.trim() || fallback.summary,
  } satisfies AgentStructuredOutput
}

export async function processWhatsAppConversationWithAgent(input: WhatsAppAgentInput): Promise<WhatsAppAgentResult | null> {
  const config = getOpenAIConfig()
  if (!config) {
    return null
  }

  const memory = buildInitialMemory(input)
  const schedulingBeforeTurn = {
    requestedDateIso: memory.requestedDateIso,
    requestedTimeLabel: memory.requestedTimeLabel,
  } satisfies PromotedSchedulingSnapshot
  const recentMessages = await loadRecentMessages({
    barbershopId: input.barbershop.id,
    customerId: input.customer.id,
  })

  const canUseImmediateDeterministicConfirmation =
    shouldUseDeterministicConfirmationShortcut({
      memory,
      inboundText: input.inboundText,
      lastAssistantText: input.conversation.lastAssistantText,
    })

  if (canUseImmediateDeterministicConfirmation) {
    const responseText =
      'Perfeito. Vou concluir esse agendamento no sistema agora para voce.'

    memory.conversationSummary = buildRuntimeSummary(memory)

    console.info('[whatsapp-agent] immediate deterministic confirmation shortcut', {
      customerId: input.customer.id,
      conversationId: input.conversation.id,
      selectedServiceId: memory.selectedServiceId,
      selectedSlot: memory.selectedSlot,
      inboundText: input.inboundText,
    })

    return {
      responseText,
      flow: 'appointment_created',
      conversationState: 'WAITING_CONFIRMATION',
      shouldCreateAppointment: true,
      memory,
      structured: {
        intent: 'CONFIRM',
        correctionTarget: 'NONE',
        mentionedName: null,
        preferredPeriod: null,
        requestedDate: memory.requestedDateIso,
        requestedTime: memory.selectedSlot?.timeLabel ?? memory.requestedTimeLabel,
        confidence: 0.99,
        nextAction: 'CONFIRM_BOOKING',
        replyText: responseText,
        summary: memory.conversationSummary,
      },
      toolTrace: [],
      usedAI: false,
    }
  }

  const fallbackIntent = await interpretWhatsAppMessage({
    message: input.inboundText,
    barbershopName: input.barbershop.name,
    barbershopTimezone: input.barbershop.timezone,
    conversationState: memory.state,
    offeredSlotCount: memory.offeredSlots.length,
    services: input.services.map((service) => ({ name: service.name })),
    professionals: input.professionals.map((professional) => ({ name: professional.name })),
    todayIsoDate: input.nowContext.dateIso,
    currentLocalDateTime: input.nowContext.dateTimeLabel,
    conversationSummary: {
      selectedServiceName: memory.selectedServiceName,
      selectedProfessionalName: memory.selectedProfessionalName,
      requestedDateIso: memory.requestedDateIso,
      requestedTimeLabel: memory.requestedTimeLabel,
      allowAnyProfessional: memory.allowAnyProfessional,
      lastCustomerMessage: input.conversation.lastInboundText,
      lastAssistantMessage: input.conversation.lastAssistantText,
    },
  })

  promoteIntentContextToMemory({
    memory,
    intent: fallbackIntent,
    services: input.services,
    professionals: input.professionals,
  })

  console.info('[whatsapp-agent] scheduling context promotion', {
    customerId: input.customer.id,
    conversationId: input.conversation.id,
    requestedDateBeforeTurn: schedulingBeforeTurn.requestedDateIso,
    requestedDateAfterPromotion: memory.requestedDateIso,
    requestedTimeBeforeTurn: schedulingBeforeTurn.requestedTimeLabel,
    requestedTimeAfterPromotion: memory.requestedTimeLabel,
  })

  if (hasBroadPeriodSchedulingFilter(memory.requestedTimeLabel) && (
    fallbackIntent.preferredPeriod
    || (fallbackIntent.timePreference && fallbackIntent.timePreference !== 'NONE' && fallbackIntent.timePreference !== 'EXACT')
  )) {
    console.info('[whatsapp-agent] preferred period interpreted', {
      customerId: input.customer.id,
      conversationId: input.conversation.id,
      inboundText: input.inboundText,
      preferredPeriod: fallbackIntent.preferredPeriod,
      timePreference: fallbackIntent.timePreference,
      requestedTimeLabel: memory.requestedTimeLabel,
    })
  }

  const shouldUsePreferredProfessional =
    Boolean(
      input.customer.preferredProfessionalId
      && input.customer.preferredProfessionalName
      && !memory.selectedProfessionalId
      && !memory.allowAnyProfessional
      && (
        referencesPreferredProfessional(input.inboundText)
        || (
          memory.state === 'WAITING_PROFESSIONAL'
          && Boolean(input.conversation.lastAssistantText?.includes(input.customer.preferredProfessionalName ?? ''))
          && isPureExplicitConfirmation(input.inboundText)
        )
      )
    )

  if (
    shouldUsePreferredProfessional
    && input.customer.preferredProfessionalId
    && input.customer.preferredProfessionalName
  ) {
    assignPreferredProfessionalToMemory({
      memory,
      preferredProfessionalId: input.customer.preferredProfessionalId,
      preferredProfessionalName: input.customer.preferredProfessionalName,
    })
  }

  const contextualConfirmationHeuristic = resolveContextualConfirmationHeuristic({
    memory,
    inboundText: input.inboundText,
    lastAssistantText: input.conversation.lastAssistantText,
  })

  console.info('[whatsapp-agent] contextual confirmation heuristic', {
    customerId: input.customer.id,
    conversationId: input.conversation.id,
    inboundText: input.inboundText,
    matchedToken: contextualConfirmationHeuristic.matchedToken,
    accepted: contextualConfirmationHeuristic.accepted,
    hasRequiredContext: contextualConfirmationHeuristic.hasRequiredContext,
    hasCorrectionCue: contextualConfirmationHeuristic.hasCorrectionCue,
    isAffirmative: contextualConfirmationHeuristic.isAffirmative,
  })

  let llmContextualConfirmation: ContextualConfirmationClassification | null = null

  if (shouldUseContextualConfirmationClassifier({
    memory,
    inboundText: input.inboundText,
    lastAssistantText: input.conversation.lastAssistantText,
  })) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 8000))

    try {
      llmContextualConfirmation = await classifyContextualConfirmationWithOpenAI({
        config,
        memory,
        inboundText: input.inboundText,
        lastAssistantText: input.conversation.lastAssistantText,
        signal: controller.signal,
      })
    } catch (error) {
      console.warn('[whatsapp-agent] llm confirmation classification failed', {
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    } finally {
      clearTimeout(timeout)
    }

    console.info('[whatsapp-agent] llm confirmation classification', {
      customerId: input.customer.id,
      conversationId: input.conversation.id,
      inboundText: input.inboundText,
      classification: llmContextualConfirmation,
    })
  }

  const canUseDeterministicConfirmation =
    shouldUseDeterministicConfirmationShortcut({
      memory,
      inboundText: input.inboundText,
      lastAssistantText: input.conversation.lastAssistantText,
    })
    || Boolean(
      contextualConfirmationHeuristic.accepted
      && llmContextualConfirmation
      && llmContextualConfirmation.intent === 'CONFIRM'
      && llmContextualConfirmation.shouldConfirm
      && llmContextualConfirmation.confidence >= 0.7
    )

  if (canUseDeterministicConfirmation) {
    const responseText =
      'Perfeito. Vou concluir esse agendamento no sistema agora para voce.'

    memory.conversationSummary = buildRuntimeSummary(memory)

    console.info('[whatsapp-agent] deterministic confirmation shortcut', {
      customerId: input.customer.id,
      conversationId: input.conversation.id,
      selectedServiceId: memory.selectedServiceId,
      selectedSlot: memory.selectedSlot,
    })

    return {
      responseText,
      flow: 'appointment_created',
      conversationState: 'WAITING_CONFIRMATION',
      shouldCreateAppointment: true,
      memory,
      structured: {
        intent: 'CONFIRM',
        correctionTarget: 'NONE',
        mentionedName: fallbackIntent.mentionedName,
        preferredPeriod: fallbackIntent.preferredPeriod,
        requestedDate: memory.requestedDateIso,
        requestedTime: memory.selectedSlot?.timeLabel ?? memory.requestedTimeLabel,
        confidence: 0.99,
        nextAction: 'CONFIRM_BOOKING',
        replyText: responseText,
        summary: memory.conversationSummary,
      },
      toolTrace: [],
      usedAI: false,
    }
  }

  const fallbackStructured = buildFallbackStructuredOutput({
    fallbackIntent,
    memory,
    customerName: input.customer.name,
    barbershopName: input.barbershop.name,
    preferredProfessionalName: input.customer.preferredProfessionalName ?? null,
    services: input.services,
    nowContext: input.nowContext,
  })

  console.info('[whatsapp-agent] turn received', {
    customerId: input.customer.id,
    conversationId: input.conversation.id,
    inboundText: input.inboundText,
    rawMessages: input.rawMessages ?? [input.inboundText],
    promotedContext: {
      selectedServiceId: memory.selectedServiceId,
      selectedProfessionalId: memory.selectedProfessionalId,
      allowAnyProfessional: memory.allowAnyProfessional,
      requestedDateIso: memory.requestedDateIso,
      requestedTimeLabel: memory.requestedTimeLabel,
    },
    summarySent: buildRuntimeSummary(memory),
    recentMessages: recentMessages.map((message) => `${message.direction}:${message.text}`),
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const toolTrace: ToolTraceEntry[] = []

  try {
    let response = await callResponsesApi(
      config,
      {
        model: config.model,
        max_output_tokens: 500,
        tools: TOOL_DEFINITIONS,
        input: buildToolPhasePrompt({
          agentInput: input,
          memory,
          recentMessages,
        }),
      },
      controller.signal,
      'tool_phase'
    )

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const toolCalls = extractFunctionCalls(response)
      if (toolCalls.length === 0) {
        break
      }

      const toolOutputs = []

      for (const call of toolCalls) {
        console.info('[whatsapp-agent] tool called', {
          name: call.name,
          arguments: call.arguments,
        })

        const result = await executeAgentTool({
          toolName: call.name,
          args: call.arguments,
          agentInput: input,
          memory,
        })

        toolTrace.push({
          name: call.name,
          arguments: call.arguments,
          result,
        })

        console.info('[whatsapp-agent] tool result', {
          name: call.name,
          result,
        })

        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.id,
          output: JSON.stringify(result),
        })
      }

      response = await callResponsesApi(
        config,
        {
          model: config.model,
          max_output_tokens: 500,
          tools: TOOL_DEFINITIONS,
          previous_response_id: response.id,
          input: toolOutputs,
        },
        controller.signal,
        'tool_round'
      )
    }

    const finalResponse = await callResponsesApi(
      config,
      {
        model: config.model,
        max_output_tokens: 400,
        input: buildFinalPrompt({
          agentInput: input,
          memory,
          toolTrace,
          recentMessages,
        }),
        text: {
          format: {
            type: 'json_schema',
            name: 'barberex_whatsapp_agent_turn',
            strict: true,
            schema: AGENT_OUTPUT_SCHEMA,
          },
        },
      },
      controller.signal,
      'final_schema'
    )

    const finalText = extractResponseText(finalResponse)
    if (!finalText) {
      console.warn('[whatsapp-agent] empty_final_output')
      return null
    }

    const rawStructured = JSON.parse(finalText) as AgentStructuredOutput
    const structuredDraft = sanitizeStructuredOutput(rawStructured, fallbackStructured)

    promoteIntentContextToMemory({
      memory,
      intent: {
        ...fallbackIntent,
        mentionedName: structuredDraft.mentionedName,
        preferredPeriod: structuredDraft.preferredPeriod,
        requestedDateIso: structuredDraft.requestedDate,
        timePreference: structuredDraft.requestedTime && /^\d{2}:\d{2}$/.test(structuredDraft.requestedTime)
          ? 'EXACT'
          : (structuredDraft.preferredPeriod ?? fallbackIntent.timePreference),
        exactTime: structuredDraft.requestedTime && /^\d{2}:\d{2}$/.test(structuredDraft.requestedTime)
          ? structuredDraft.requestedTime
          : null,
        correctionTarget: structuredDraft.correctionTarget,
      },
      services: input.services,
      professionals: input.professionals,
    })

    preservePromotedSchedulingContext({
      memory,
      snapshot: {
        requestedDateIso: fallbackIntent.requestedDateIso ?? schedulingBeforeTurn.requestedDateIso,
        requestedTimeLabel:
          fallbackIntent.exactTime
          ?? resolvePromotedTimeLabel({
            preferredPeriod: fallbackIntent.preferredPeriod,
            timePreference: fallbackIntent.timePreference,
            exactTime: fallbackIntent.exactTime,
          })
          ?? schedulingBeforeTurn.requestedTimeLabel,
      },
      correctionTarget: structuredDraft.correctionTarget,
    })

    const requestedConfirmationTime =
      structuredDraft.requestedTime && /^\d{2}:\d{2}$/.test(structuredDraft.requestedTime)
        ? structuredDraft.requestedTime
        : (memory.requestedTimeLabel && /^\d{2}:\d{2}$/.test(memory.requestedTimeLabel)
          ? memory.requestedTimeLabel
          : null)

    let slotRestoreInfrastructureError = false

    if (
      !memory.selectedSlot
      && memory.selectedServiceId
      && memory.selectedProfessionalId
      && memory.requestedDateIso
      && requestedConfirmationTime
    ) {
      try {
        memory.selectedSlot = await findExactAvailableWhatsAppSlot({
          barbershopId: input.barbershop.id,
          serviceId: memory.selectedServiceId,
          professionalId: memory.selectedProfessionalId,
          dateIso: memory.requestedDateIso,
          timeLabel: requestedConfirmationTime,
          timezone: input.barbershop.timezone,
        })
      } catch (error) {
        if (error instanceof AvailabilityInfrastructureError) {
          slotRestoreInfrastructureError = true
          clearPromotedAvailability(memory)

          console.warn('[whatsapp-agent] confirmation slot restore failed', {
            customerId: input.customer.id,
            conversationId: input.conversation.id,
            requestedDateIso: memory.requestedDateIso,
            requestedTimeLabel: requestedConfirmationTime,
            error: error.message,
          })
        } else {
          throw error
        }
      }

      if (memory.selectedSlot) {
        console.info('[whatsapp-agent] confirmation slot restored', {
          customerId: input.customer.id,
          conversationId: input.conversation.id,
          restoredSlot: memory.selectedSlot,
        })
      }
    }

    if (structuredDraft.correctionTarget !== 'NONE') {
      appendCorrection(
        memory,
        structuredDraft.correctionTarget,
        structuredDraft.mentionedName ?? structuredDraft.requestedDate ?? structuredDraft.requestedTime
      )
    }

    const contextualPositiveConfirmation = isContextualPositiveConfirmation(input.inboundText)
    const slotWasPresentedForConfirmation = wasSelectedSlotPresentedToCustomer({
      lastAssistantText: input.conversation.lastAssistantText,
      memory,
    })
    const hasResolvedTime = Boolean(memory.requestedTimeLabel || memory.selectedSlot?.timeLabel)
    const shouldCreateAppointment =
      contextualPositiveConfirmation
      && !hasExplicitConfirmationCorrectionCue(input.inboundText)
      && memory.state === 'WAITING_CONFIRMATION'
      && Boolean(memory.selectedServiceId)
      && Boolean(memory.selectedSlot)
      && (Boolean(memory.selectedProfessionalId) || memory.allowAnyProfessional)
      && Boolean(memory.requestedDateIso)
      && hasResolvedTime
      && slotWasPresentedForConfirmation

    let toolFailureOverride = resolveToolFailureOverride({
      toolTrace,
      memory,
      customerName: input.customer.name,
      barbershopName: input.barbershop.name,
      preferredProfessionalName: input.customer.preferredProfessionalName ?? null,
      serviceNames: input.services.map((service) => service.name),
      nowContext: input.nowContext,
    })

    if (!toolFailureOverride && slotRestoreInfrastructureError) {
      toolFailureOverride = {
        nextAction: 'ASK_CLARIFICATION' as const,
        replyText: 'Nao consegui verificar os horarios agora, pode tentar novamente daqui a pouco?',
      }
    }

    if (toolFailureOverride) {
      console.info('[whatsapp-agent] tool failure guardrail', {
        customerId: input.customer.id,
        conversationId: input.conversation.id,
        nextAction: toolFailureOverride.nextAction,
        replyText: toolFailureOverride.replyText,
      })
    }

    const normalizedNextAction = enforceNextActionFromMemory(
      toolFailureOverride?.nextAction ?? structuredDraft.nextAction,
      memory,
      shouldCreateAppointment,
      input.nowContext
    )
    const deterministicDateGuardrailReply = !toolFailureOverride
      && memory.requestedDateIso
      && detectRelativeDateExpression(input.inboundText)
      ? buildGuardrailReplyText({
          nextAction: normalizedNextAction,
          memory,
          lastAssistantText: input.conversation.lastAssistantText,
          customerName: input.customer.name,
          barbershopName: input.barbershop.name,
          preferredProfessionalName: input.customer.preferredProfessionalName ?? null,
          serviceNames: input.services.map((service) => service.name),
          nowContext: input.nowContext,
        })
      : null
    const guardedReplyText = !toolFailureOverride && normalizedNextAction !== structuredDraft.nextAction
      ? buildGuardrailReplyText({
          nextAction: normalizedNextAction,
          memory,
          lastAssistantText: input.conversation.lastAssistantText,
          customerName: input.customer.name,
          barbershopName: input.barbershop.name,
          preferredProfessionalName: input.customer.preferredProfessionalName ?? null,
          serviceNames: input.services.map((service) => service.name),
          nowContext: input.nowContext,
        })
      : null
    const sanitizedReplyText = sanitizeReplyTextAgainstProfessionalVocative({
      replyText: toolFailureOverride?.replyText ?? deterministicDateGuardrailReply ?? guardedReplyText ?? structuredDraft.replyText,
      customerName: input.customer.name,
      selectedProfessionalName: memory.selectedProfessionalName,
      mentionedName: structuredDraft.mentionedName,
      professionals: input.professionals,
    })
    const safeReplyText = sanitizePrematureConfirmationReply({
      replyText: sanitizedReplyText,
      nextAction: normalizedNextAction,
      shouldCreateAppointment,
      memory,
      lastAssistantText: input.conversation.lastAssistantText,
      customerName: input.customer.name,
      barbershopName: input.barbershop.name,
      preferredProfessionalName: input.customer.preferredProfessionalName ?? null,
      serviceNames: input.services.map((service) => service.name),
      nowContext: input.nowContext,
    })
    const structured = {
      ...structuredDraft,
      nextAction: normalizedNextAction,
      replyText: safeReplyText,
    } satisfies AgentStructuredOutput

    memory.state = inferConversationState(structured.nextAction, memory, input.nowContext)
    memory.conversationSummary = structured.summary || buildRuntimeSummary(memory)

    console.info('[whatsapp-agent] structured output', {
      customerId: input.customer.id,
      structured,
      memorySummary: buildRuntimeSummary(memory),
      shouldCreateAppointment,
      slotWasPresentedForConfirmation,
    })

    return {
      responseText: structured.replyText,
      flow: inferFlow(structured.nextAction),
      conversationState: memory.state,
      shouldCreateAppointment,
      memory,
      structured,
      toolTrace,
      usedAI: true,
    }
  } catch (error) {
    console.warn('[whatsapp-agent] fallback_to_legacy', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export const __testing = {
  buildInitialMemory,
  canAskForBookingConfirmation,
  promoteIntentContextToMemory,
  validateMissingFields,
  enforceNextActionFromMemory,
  inferConversationState,
  hasUsefulProgressInMemory,
  resolveToolFailureOverride,
  buildGuardrailReplyText,
  buildServiceQuestionFromNames,
  referencesPreferredProfessional,
  hasExplicitPriceQuestion,
  isExplicitConfirmation,
  isPureExplicitConfirmation,
  hasExplicitAnyProfessionalConsent,
  hasExplicitFlexibleTimeRequest,
  shouldAllowAvailabilitySearch,
  shouldBlockConfirmationWithoutSlot,
  resolveContextualConfirmationHeuristic,
  shouldUseContextualConfirmationClassifier,
  sanitizeReplyTextAgainstProfessionalVocative,
  sanitizePrematureConfirmationReply,
  shouldUseDeterministicConfirmationShortcut,
  buildPresentedSlotConfirmationMessage,
  pickPresentedOfferedSlot,
}
