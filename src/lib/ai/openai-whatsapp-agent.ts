import 'server-only'

import { MessagingProvider, type Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  type WhatsAppBookingSlot,
  findExactAvailableWhatsAppSlot,
  getAvailableWhatsAppSlots,
} from '@/lib/agendamentos/whatsapp-booking'
import { interpretWhatsAppMessage } from '@/lib/ai/openai-whatsapp-interpreter'

const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini'
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
  intent: 'BOOK_APPOINTMENT' | 'CONFIRM' | 'DECLINE' | 'CHANGE_REQUEST' | 'UNKNOWN'
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
  }
  inboundText: string
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
      enum: ['BOOK_APPOINTMENT', 'CONFIRM', 'DECLINE', 'CHANGE_REQUEST', 'UNKNOWN'],
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
    strict: true,
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
    strict: true,
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
    strict: true,
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
    strict: true,
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
    strict: true,
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
    strict: true,
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
    strict: true,
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

function inferConversationState(nextAction: WhatsAppAgentNextAction): WhatsAppAgentConversationState {
  if (nextAction === 'ASK_SERVICE') return 'WAITING_SERVICE'
  if (nextAction === 'ASK_PROFESSIONAL') return 'WAITING_PROFESSIONAL'
  if (nextAction === 'ASK_DATE') return 'WAITING_DATE'
  if (nextAction === 'ASK_PERIOD' || nextAction === 'OFFER_SLOTS') return 'WAITING_TIME'
  if (nextAction === 'ASK_CONFIRMATION') return 'WAITING_CONFIRMATION'
  return 'IDLE'
}

function enforceNextActionFromMemory(
  requestedAction: WhatsAppAgentNextAction,
  memory: WorkingMemory,
  shouldCreateAppointment: boolean
) {
  if (requestedAction === 'RESET_CONTEXT' || requestedAction === 'GREET') {
    return requestedAction
  }

  if (!memory.selectedServiceId) {
    return 'ASK_SERVICE'
  }

  if (!memory.selectedProfessionalId && !memory.allowAnyProfessional) {
    return 'ASK_PROFESSIONAL'
  }

  if (!memory.requestedTimeLabel) {
    return 'ASK_PERIOD'
  }

  if (!memory.requestedDateIso) {
    return 'ASK_DATE'
  }

  if (shouldCreateAppointment) {
    return 'CONFIRM_BOOKING'
  }

  if (memory.selectedSlot) {
    return 'ASK_CONFIRMATION'
  }

  if (memory.offeredSlots.length > 0) {
    return 'OFFER_SLOTS'
  }

  return requestedAction
}

function isExplicitConfirmation(message: string) {
  return /\b(sim|confirmo|confirmar|fechado|pode confirmar|pode marcar|pode agendar|pode ser)\b/.test(normalizeText(message))
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

async function callResponsesApi(config: OpenAIConfig, payload: Record<string, unknown>, signal: AbortSignal) {
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
  const data = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(`OpenAI Responses API ${response.status}`)
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
    take: 6,
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
    memory.requestedDateIso = null
    memory.requestedTimeLabel = null
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

  if (serviceChanged || professionalChanged || dateChanged || timeChanged || intent.correctionTarget !== 'NONE') {
    clearPromotedAvailability(memory)
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
  return [
    'Voce e uma secretaria virtual de barbearia e deve usar ferramentas do backend antes de responder.',
    'Objetivo: entender a mensagem do cliente, corrigir contexto quando necessario e decidir qual ferramenta chamar.',
    'Voce nunca inventa horario, nunca cria appointment diretamente e nunca assume barbeiro sem validacao.',
    `Barbearia: ${input.agentInput.barbershop.name}.`,
    `Timezone: ${input.agentInput.barbershop.timezone}.`,
    `Agora local: ${input.agentInput.nowContext.dateTimeLabel}.`,
    `Mensagem recebida: """${input.agentInput.inboundText}""".`,
    `Estado atual: ${input.memory.state}.`,
    `Resumo persistido: ${input.memory.conversationSummary ?? 'nenhum'}.`,
    `Resumo do draft atual: ${buildRuntimeSummary(input.memory)}.`,
    `Correcoes recentes: ${input.memory.recentCorrections.map((item) => `${item.target}:${item.value ?? 'null'}`).join(' | ') || 'nenhuma'}.`,
    `Ultimas mensagens: ${input.recentMessages.map((message) => `${message.direction}:${message.text}`).join(' | ') || 'nenhuma'}.`,
    'Use as ferramentas para validar servico, barbeiro, disponibilidade e rascunho antes de responder.',
    'Quando faltar contexto, prefira perguntar em vez de assumir.',
  ].join('\n')
}

function buildFinalPrompt(input: {
  agentInput: WhatsAppAgentInput
  memory: WorkingMemory
  toolTrace: ToolTraceEntry[]
  recentMessages: RecentMessage[]
}) {
  return [
    'Voce acabou de usar ferramentas do backend para atender um cliente no WhatsApp.',
    'Responda com JSON estruturado e linguagem humana curta, como uma secretaria virtual de barbearia.',
    'A resposta final deve ser natural, clara, educada e profissional.',
    'Nunca prometa horarios que nao vieram das ferramentas.',
    'Se houver duvida, use nextAction=ASK_CLARIFICATION.',
    `Mensagem atual do cliente: """${input.agentInput.inboundText}""".`,
    `Barbearia: ${input.agentInput.barbershop.name}.`,
    `Data/hora local: ${input.agentInput.nowContext.dateTimeLabel}.`,
    `Resumo atualizado do contexto: ${buildRuntimeSummary(input.memory)}.`,
    `Correcoes recentes: ${input.memory.recentCorrections.map((item) => `${item.target}:${item.value ?? 'null'}`).join(' | ') || 'nenhuma'}.`,
    `Ferramentas chamadas nesta rodada: ${input.toolTrace.map((trace) => `${trace.name}:${JSON.stringify(trace.result)}`).join(' | ') || 'nenhuma'}.`,
    `Ultimas mensagens: ${input.recentMessages.map((message) => `${message.direction}:${message.text}`).join(' | ') || 'nenhuma'}.`,
    'Escolha nextAction coerente com o estado do backend.',
  ].join('\n')
}

function buildFallbackStructuredOutput(input: {
  fallbackIntent: Awaited<ReturnType<typeof interpretWhatsAppMessage>>
  memory: WorkingMemory
  customerName: string
  barbershopName: string
}) {
  const firstName = input.customerName.trim().split(' ')[0]
  const replyText = input.fallbackIntent.greetingOnly || input.fallbackIntent.restartConversation
    ? `Oi, ${firstName}! Posso te ajudar a marcar um horario na ${input.barbershopName} 🙂`
    : (!input.memory.selectedServiceId
      ? 'Perfeito. Qual servico voce quer fazer?'
      : (!input.memory.selectedProfessionalId && !input.memory.allowAnyProfessional
        ? 'Tem preferencia de barbeiro?'
        : (!input.memory.requestedTimeLabel
          ? 'Voce prefere manha, tarde ou noite?'
          : (!input.memory.requestedDateIso
            ? 'Qual dia voce prefere?'
            : 'Me confirma rapidinho como voce quer seguir por aqui.'))))

  const nextAction: WhatsAppAgentNextAction =
    input.fallbackIntent.restartConversation
      ? 'RESET_CONTEXT'
      : (!input.memory.selectedServiceId
        ? 'ASK_SERVICE'
        : (!input.memory.selectedProfessionalId && !input.memory.allowAnyProfessional
          ? 'ASK_PROFESSIONAL'
          : (!input.memory.requestedTimeLabel
            ? 'ASK_PERIOD'
            : (!input.memory.requestedDateIso ? 'ASK_DATE' : 'ASK_CLARIFICATION'))))

  return {
    intent: input.fallbackIntent.intent,
    correctionTarget: input.fallbackIntent.correctionTarget,
    mentionedName: input.fallbackIntent.mentionedName,
    preferredPeriod: input.fallbackIntent.preferredPeriod,
    requestedDate: input.fallbackIntent.requestedDateIso,
    requestedTime: input.fallbackIntent.exactTime ?? input.memory.requestedTimeLabel,
    confidence: input.fallbackIntent.confidence,
    nextAction,
    replyText,
    summary: buildRuntimeSummary(input.memory),
  } satisfies AgentStructuredOutput
}

function buildGuardrailReplyText(input: {
  nextAction: WhatsAppAgentNextAction
  memory: WorkingMemory
  customerName: string
  barbershopName: string
}) {
  const firstName = input.customerName.trim().split(' ')[0]

  if (input.nextAction === 'GREET' || input.nextAction === 'RESET_CONTEXT') {
    return `Oi, ${firstName}! Posso te ajudar a marcar um horario na ${input.barbershopName}?`
  }

  if (input.nextAction === 'ASK_SERVICE') {
    return 'Perfeito. Qual servico voce quer fazer?'
  }

  if (input.nextAction === 'ASK_PROFESSIONAL') {
    return 'Tem preferencia de barbeiro?'
  }

  if (input.nextAction === 'ASK_PERIOD') {
    return 'Voce prefere manha, tarde ou noite?'
  }

  if (input.nextAction === 'ASK_DATE') {
    return 'Qual dia voce prefere? Pode ser hoje, amanha ou a data que quiser.'
  }

  if (input.nextAction === 'ASK_CONFIRMATION' && input.memory.selectedSlot && input.memory.selectedServiceName) {
    return `Posso confirmar ${input.memory.selectedServiceName} para ${input.memory.selectedSlot.dateIso} as ${input.memory.selectedSlot.timeLabel} com ${input.memory.selectedSlot.professionalName}?`
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
    }
  }

  if (toolName === 'list_services') {
    const query = typeof args.query === 'string' ? args.query : null
    const services = query
      ? agentInput.services.filter((service) => normalizeText(service.name).includes(normalizeText(query)))
      : agentInput.services

    return {
      status: 'ok',
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
    const allowAnyProfessional = typeof args.allowAnyProfessional === 'boolean'
      ? args.allowAnyProfessional
      : memory.allowAnyProfessional

    if (!professionalId && professionalName) {
      const candidates = findProfessionalCandidates(agentInput.professionals, professionalName)
      if (candidates.length === 1) {
        professionalId = candidates[0].id
        professionalName = candidates[0].name
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

    const allowAnyProfessional = typeof args.allowAnyProfessional === 'boolean'
      ? args.allowAnyProfessional
      : memory.allowAnyProfessional

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
      && memory.selectedServiceId
      && memory.selectedProfessionalId
      && memory.requestedDateIso
    ) {
      memory.selectedSlot = await findExactAvailableWhatsAppSlot({
        barbershopId: agentInput.barbershop.id,
        serviceId: memory.selectedServiceId,
        professionalId: memory.selectedProfessionalId,
        dateIso: memory.requestedDateIso,
        timeLabel: args.requestedTime,
        timezone: agentInput.barbershop.timezone,
      })
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

    if (selectedOptionNumber && selectedOptionNumber >= 1 && selectedOptionNumber <= memory.offeredSlots.length) {
      memory.selectedSlot = memory.offeredSlots[selectedOptionNumber - 1] ?? null
    }

    if (!memory.selectedSlot && requestedTime && memory.selectedServiceId && memory.selectedProfessionalId && memory.requestedDateIso) {
      memory.selectedSlot = await findExactAvailableWhatsAppSlot({
        barbershopId: agentInput.barbershop.id,
        serviceId: memory.selectedServiceId,
        professionalId: memory.selectedProfessionalId,
        dateIso: memory.requestedDateIso,
        timeLabel: requestedTime,
        timezone: agentInput.barbershop.timezone,
      })
    }

    return {
      status: 'ok',
      readyToConfirm: Boolean(memory.selectedServiceId && memory.selectedSlot && isExplicitConfirmation(agentInput.inboundText)),
      selectedSlot: memory.selectedSlot,
      explicitConfirmationDetected: isExplicitConfirmation(agentInput.inboundText),
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

  const fallbackStructured = buildFallbackStructuredOutput({
    fallbackIntent,
    memory,
    customerName: input.customer.name,
    barbershopName: input.barbershop.name,
  })

  console.info('[whatsapp-agent] turn received', {
    customerId: input.customer.id,
    conversationId: input.conversation.id,
    inboundText: input.inboundText,
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
        store: false,
        max_output_tokens: 500,
        tools: TOOL_DEFINITIONS,
        input: [
          {
            role: 'user',
            content: buildToolPhasePrompt({
              agentInput: input,
              memory,
              recentMessages,
            }),
          },
        ],
      },
      controller.signal
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
          store: false,
          max_output_tokens: 500,
          tools: TOOL_DEFINITIONS,
          previous_response_id: response.id,
          input: toolOutputs,
        },
        controller.signal
      )
    }

    const finalResponse = await callResponsesApi(
      config,
      {
        model: config.model,
        store: false,
        max_output_tokens: 400,
        input: [
          {
            role: 'user',
            content: buildFinalPrompt({
              agentInput: input,
              memory,
              toolTrace,
              recentMessages,
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'barberos_whatsapp_agent_turn',
            strict: true,
            schema: AGENT_OUTPUT_SCHEMA,
          },
        },
      },
      controller.signal
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

    if (structuredDraft.correctionTarget !== 'NONE') {
      appendCorrection(
        memory,
        structuredDraft.correctionTarget,
        structuredDraft.mentionedName ?? structuredDraft.requestedDate ?? structuredDraft.requestedTime
      )
    }

    const shouldCreateAppointment =
      structuredDraft.nextAction === 'CONFIRM_BOOKING'
      && Boolean(memory.selectedServiceId)
      && Boolean(memory.selectedSlot)
      && isExplicitConfirmation(input.inboundText)

    const normalizedNextAction = enforceNextActionFromMemory(
      structuredDraft.nextAction,
      memory,
      shouldCreateAppointment
    )
    const guardedReplyText = normalizedNextAction !== structuredDraft.nextAction
      ? buildGuardrailReplyText({
          nextAction: normalizedNextAction,
          memory,
          customerName: input.customer.name,
          barbershopName: input.barbershop.name,
        })
      : null
    const structured = {
      ...structuredDraft,
      nextAction: normalizedNextAction,
      replyText: guardedReplyText ?? structuredDraft.replyText,
    } satisfies AgentStructuredOutput

    memory.state = inferConversationState(structured.nextAction)
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
