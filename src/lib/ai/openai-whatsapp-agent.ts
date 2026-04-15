import 'server-only'

import { MessagingProvider, type Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  type WhatsAppBookingSlot,
  findExactAvailableWhatsAppSlot,
  getAvailableWhatsAppSlots,
} from '@/lib/agendamentos/whatsapp-booking'
import {
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
    description: 'Lista os servicos ativos da barbearia para ajudar a identificar o servico pedido pelo cliente.',
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
    description: 'Consulta disponibilidade real no backend usando servico, barbeiro, data e periodo.',
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
    description: 'Atualiza ou prepara um draft de agendamento com servico, barbeiro, data, periodo ou horario escolhido.',
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

  if (validation.missingFields.includes('professional')) {
    return 'WAITING_PROFESSIONAL'
  }

  if (validation.shouldAskDateInsteadOfPeriod || validation.missingFields.includes('date')) {
    return 'WAITING_DATE'
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

  if (!input.memory.selectedProfessionalId && !input.memory.allowAnyProfessional) {
    missingFields.push('professional')
  }

  if (!input.memory.requestedDateIso) {
    missingFields.push('date')
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

      if (validation.missingFields.includes('professional')) {
        return 'ASK_PROFESSIONAL'
      }

      if (validation.shouldAskDateInsteadOfPeriod || validation.missingFields.includes('date')) {
        return 'ASK_DATE'
      }

      if (validation.missingFields.includes('period')) {
        return 'ASK_PERIOD'
      }

      return 'ASK_CLARIFICATION'
    }

    return requestedAction
  }

  if (memory.requestedDateIso && requestedAction === 'ASK_DATE') {
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

  if (validation.missingFields.includes('professional')) {
    return 'ASK_PROFESSIONAL'
  }

  if (validation.shouldAskDateInsteadOfPeriod) {
    return 'ASK_DATE'
  }

  if (validation.missingFields.includes('date')) {
    return 'ASK_DATE'
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
  return /\b(sim|desejo|quero|confirmo|confirmar|confirmado|confirma|fechado|ok|beleza|pode|pode confirmar|pode marcar|pode agendar|pode ser)\b/.test(normalizeText(message))
}

function isPureExplicitConfirmation(message: string) {
  return isExplicitConfirmation(message) && !extractExplicitTimeFromMessage(message)
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

function buildServiceQuestionFromNames(serviceNames: string[]) {
  const preview = serviceNames.slice(0, 6).join(', ')
  return `Perfeito. Qual servico voce quer fazer? ${preview ? `Hoje temos: ${preview}.` : ''}`.trim()
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

function shouldUseDeterministicConfirmationShortcut(input: {
  memory: WorkingMemory
  inboundText: string
  lastAssistantText?: string | null
}) {
  if (
    input.memory.state !== 'WAITING_CONFIRMATION'
    || !input.memory.selectedServiceId
    || !input.memory.selectedSlot
    || !isPureExplicitConfirmation(input.inboundText)
  ) {
    return false
  }

  if (!input.lastAssistantText) {
    return true
  }

  return /(posso confirmar|me confirma|quer que eu confirme|pode confirmar)/i.test(
    normalizeText(input.lastAssistantText)
  )
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
  return /\b(posso confirmar|quer que eu confirme|me confirma|posso fechar|posso agendar)\b/i.test(
    normalizeText(replyText)
  )
}

function sanitizePrematureConfirmationReply(input: {
  replyText: string
  nextAction: WhatsAppAgentNextAction
  shouldCreateAppointment: boolean
  memory: WorkingMemory
  customerName: string
  barbershopName: string
  preferredProfessionalName?: string | null
  serviceNames: string[]
  nowContext: WhatsAppAgentInput['nowContext']
}) {
  if (input.shouldCreateAppointment) {
    return input.replyText
  }

  const hasFinalConfirmationLanguage = containsFinalConfirmationLanguage(input.replyText)
  const hasConfirmationPromptLanguage = containsConfirmationPromptLanguage(input.replyText)

  if (!hasFinalConfirmationLanguage && !hasConfirmationPromptLanguage) {
    return input.replyText
  }

  if (
    !hasFinalConfirmationLanguage
    && input.nextAction === 'ASK_CONFIRMATION'
    && canAskForBookingConfirmation(input.memory)
  ) {
    return input.replyText
  }

  return buildGuardrailReplyText({
    nextAction: input.nextAction,
    memory: input.memory,
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
    memory.requestedTimeLabel = null
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
    'Se o servico ainda nao estiver definido, use list_services para trazer a lista real completa da barbearia.',
    'Pergunte o horario especifico antes de perguntar periodo. Use manha/tarde/noite so como fallback quando o cliente nao tiver horario especifico.',
    'Nao busque horarios nem confirme slot antes de existir barbeiro definido, barbeiro preferencial valido ou allowAnyProfessional explicito.',
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
    'Se faltar servico, responda mostrando a lista real de servicos disponiveis.',
    'Pergunte o horario especifico antes de sugerir periodo sempre que o cliente ainda nao tiver dado um horario claro.',
    'Se faltar definicao de barbeiro, pergunte preferencia antes de confirmar horario.',
    'Se o cliente respondeu afirmativamente depois de um "Posso confirmar?", finalize o agendamento; nao repita a pre-confirmacao.',
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
      : (!input.memory.selectedProfessionalId && !input.memory.allowAnyProfessional
        ? 'Tem preferencia de barbeiro?'
        : (!input.memory.requestedDateIso
          ? 'Qual dia voce prefere?'
          : (!input.memory.requestedTimeLabel
            ? 'Qual horario voce gostaria? Se preferir, tambem posso procurar por periodo.'
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
    if (input.preferredProfessionalName) {
      return `Quer marcar com ${input.preferredProfessionalName} de novo ou prefere outro barbeiro?`
    }

    if (input.memory.selectedProfessionalName) {
      return `Posso buscar com ${input.memory.selectedProfessionalName} ou, se preferir, vejo outro barbeiro.`
    }

    return 'Tem preferencia de barbeiro ou posso procurar com qualquer um?'
  }

  if (input.nextAction === 'ASK_PERIOD') {
    if (validation?.availablePeriods.length === 0) {
      return 'Hoje ja passou do horario de atendimento. Quer que eu veja para amanha ou outro dia?'
    }

    if (validation?.availablePeriods.length === 1) {
      return validation.availablePeriods[0] === 'EVENING'
        ? 'Perfeito. Para esse dia eu consigo te atender na noite. Qual horario voce gostaria?'
        : validation.availablePeriods[0] === 'AFTERNOON'
          ? 'Perfeito. Para esse dia eu consigo te atender na tarde. Qual horario voce gostaria?'
          : 'Perfeito. Para esse dia eu consigo te atender na manha. Qual horario voce gostaria?'
    }

    if (validation?.availablePeriods.length) {
      return 'Qual horario voce gostaria? Se preferir, tambem posso procurar por periodo.'
    }
  }

  if (input.nextAction === 'ASK_DATE') {
    return 'Qual dia voce prefere? Pode ser hoje, amanha ou a data que quiser.'
  }

  if (input.nextAction === 'ASK_CONFIRMATION' && input.memory.selectedSlot && input.memory.selectedServiceName) {
    return `Posso confirmar ${input.memory.selectedServiceName} para ${formatDayLabelFromIsoDate(input.memory.selectedSlot.dateIso).toLowerCase()} as ${input.memory.selectedSlot.timeLabel} com ${input.memory.selectedSlot.professionalName}?`
  }

  if (input.nextAction === 'OFFER_SLOTS' && input.memory.offeredSlots.length > 0) {
    const header = input.memory.selectedProfessionalName
      ? `${input.memory.requestedDateIso ?? 'Nesse dia'} com ${input.memory.selectedProfessionalName} eu tenho estes horarios:`
      : `${input.memory.requestedDateIso ?? 'Nesse dia'} eu tenho estes horarios:`
    const lines = input.memory.offeredSlots.slice(0, 4).map((slot) => `- ${slot.timeLabel}`)
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
    ? `Os horarios mais proximos que encontrei sao: ${labels.join(', ')}.`
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
      }) ?? 'Tem preferencia de barbeiro ou posso procurar com qualquer um?',
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
    return {
      nextAction: 'ASK_CLARIFICATION' as const,
      replyText: 'Nao consegui verificar os horarios agora, vou tentar novamente.',
    }
  }

  return {
    nextAction: 'ASK_CLARIFICATION' as const,
    replyText: 'Nao consegui verificar os horarios agora, vou tentar novamente.',
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

    return {
      status: 'ok',
      mode: filteredServices.length > 0 ? 'filtered' : 'all_services_fallback',
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        duration: service.duration,
        price: service.price,
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

    const preferredPeriod = typeof args.preferredPeriod === 'string' && args.preferredPeriod
      ? args.preferredPeriod
      : memory.requestedTimeLabel
    const exactTime = typeof args.exactTime === 'string' && args.exactTime ? args.exactTime : null

    const availability = await getAvailableWhatsAppSlots({
      barbershopId: agentInput.barbershop.id,
      serviceId: service.id,
      dateIso,
      timezone: agentInput.barbershop.timezone,
      professionalId: allowAnyProfessional ? null : professionalId,
      timePreference: preferredPeriod,
      exactTime,
      limit: 4,
    })

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
    if (selectedOptionNumber && selectedOptionNumber >= 1 && selectedOptionNumber <= memory.offeredSlots.length) {
      memory.selectedSlot = memory.offeredSlots[selectedOptionNumber - 1] ?? null
    } else if (
      typeof args.requestedTime === 'string'
      && args.requestedTime
      && memory.requestedDateIso
    ) {
      if (!memory.selectedServiceId) {
        return {
          status: 'error',
          reason: 'service_not_found',
        }
      }

      if (memory.selectedProfessionalId) {
        memory.selectedSlot = await findExactAvailableWhatsAppSlot({
          barbershopId: agentInput.barbershop.id,
          serviceId: memory.selectedServiceId,
          professionalId: memory.selectedProfessionalId,
          dateIso: memory.requestedDateIso,
          timeLabel: args.requestedTime,
          timezone: agentInput.barbershop.timezone,
        })
      } else if (memory.allowAnyProfessional) {
        const exactAvailability = await getAvailableWhatsAppSlots({
          barbershopId: agentInput.barbershop.id,
          serviceId: memory.selectedServiceId,
          dateIso: memory.requestedDateIso,
          timezone: agentInput.barbershop.timezone,
          professionalId: null,
          timePreference: 'EXACT',
          exactTime: args.requestedTime,
          limit: 4,
        })

        if (exactAvailability.slots.length === 1) {
          memory.selectedSlot = exactAvailability.slots[0]
        } else if (exactAvailability.slots.length > 1) {
          return {
            status: 'error',
            reason: 'multiple_professionals_for_exact_time',
            slots: exactAvailability.slots,
          }
        }
      } else if (memory.offeredSlots.length === 0) {
        return {
          status: 'error',
          reason: 'offered_slots_missing',
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

    if (selectedOptionNumber && selectedOptionNumber >= 1 && selectedOptionNumber <= memory.offeredSlots.length) {
      memory.selectedSlot = memory.offeredSlots[selectedOptionNumber - 1] ?? null
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
        memory.selectedSlot = await findExactAvailableWhatsAppSlot({
          barbershopId: agentInput.barbershop.id,
          serviceId: memory.selectedServiceId,
          professionalId: memory.selectedProfessionalId,
          dateIso: memory.requestedDateIso,
          timeLabel: requestedTime,
          timezone: agentInput.barbershop.timezone,
        })
      } else if (memory.allowAnyProfessional) {
        const exactAvailability = await getAvailableWhatsAppSlots({
          barbershopId: agentInput.barbershop.id,
          serviceId: memory.selectedServiceId,
          dateIso: memory.requestedDateIso,
          timezone: agentInput.barbershop.timezone,
          professionalId: null,
          timePreference: 'EXACT',
          exactTime: requestedTime,
          limit: 4,
        })

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
      } else if (memory.offeredSlots.length === 0) {
        return {
          status: 'error',
          reason: 'offered_slots_missing',
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

  if (shouldUseDeterministicConfirmationShortcut({
    memory,
    inboundText: input.inboundText,
    lastAssistantText: input.conversation.lastAssistantText,
  })) {
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
            name: 'barberos_whatsapp_agent_turn',
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

    if (
      !memory.selectedSlot
      && memory.selectedServiceId
      && memory.selectedProfessionalId
      && memory.requestedDateIso
      && requestedConfirmationTime
    ) {
      memory.selectedSlot = await findExactAvailableWhatsAppSlot({
        barbershopId: input.barbershop.id,
        serviceId: memory.selectedServiceId,
        professionalId: memory.selectedProfessionalId,
        dateIso: memory.requestedDateIso,
        timeLabel: requestedConfirmationTime,
        timezone: input.barbershop.timezone,
      })

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

    const explicitConfirmation = isPureExplicitConfirmation(input.inboundText)
    const shouldCreateAppointment =
      explicitConfirmation
      && memory.state === 'WAITING_CONFIRMATION'
      && Boolean(memory.selectedServiceId)
      && Boolean(memory.selectedSlot)

    const toolFailureOverride = resolveToolFailureOverride({
      toolTrace,
      memory,
      customerName: input.customer.name,
      barbershopName: input.barbershop.name,
      preferredProfessionalName: input.customer.preferredProfessionalName ?? null,
      serviceNames: input.services.map((service) => service.name),
      nowContext: input.nowContext,
    })

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
    const guardedReplyText = !toolFailureOverride && normalizedNextAction !== structuredDraft.nextAction
      ? buildGuardrailReplyText({
          nextAction: normalizedNextAction,
          memory,
          customerName: input.customer.name,
          barbershopName: input.barbershop.name,
          preferredProfessionalName: input.customer.preferredProfessionalName ?? null,
          serviceNames: input.services.map((service) => service.name),
          nowContext: input.nowContext,
        })
      : null
    const sanitizedReplyText = sanitizeReplyTextAgainstProfessionalVocative({
      replyText: toolFailureOverride?.replyText ?? guardedReplyText ?? structuredDraft.replyText,
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
  referencesPreferredProfessional,
  isExplicitConfirmation,
  isPureExplicitConfirmation,
  hasExplicitAnyProfessionalConsent,
  sanitizeReplyTextAgainstProfessionalVocative,
  sanitizePrematureConfirmationReply,
  shouldUseDeterministicConfirmationShortcut,
}
