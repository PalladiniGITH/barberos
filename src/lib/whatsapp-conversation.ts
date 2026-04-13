import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { interpretWhatsAppMessage } from '@/lib/ai/openai-whatsapp-interpreter'
import { processWhatsAppConversationWithAgent } from '@/lib/ai/openai-whatsapp-agent'
import {
  createAppointmentFromWhatsApp,
  findExactAvailableWhatsAppSlot,
  getAvailableWhatsAppSlots,
  loadBarbershopSchedulingOptions,
  type WhatsAppBookingSlot,
} from '@/lib/agendamentos/whatsapp-booking'
import {
  getCurrentDateTimeInTimezone,
  getTodayIsoInTimezone,
  resolveBusinessTimezone,
} from '@/lib/timezone'

type ConversationState =
  | 'IDLE'
  | 'WAITING_SERVICE'
  | 'WAITING_PROFESSIONAL'
  | 'WAITING_DATE'
  | 'WAITING_TIME'
  | 'WAITING_CONFIRMATION'

interface ConversationServiceInput {
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
  eventId: string
}

interface ConversationServiceResult {
  responseText: string
  flow:
    | 'greeting'
    | 'collect_service'
    | 'collect_professional'
    | 'collect_date'
    | 'collect_period'
    | 'offer_slots'
    | 'await_confirmation'
    | 'appointment_created'
    | 'reschedule'
  conversationId: string
  conversationState: ConversationState
  appointmentId?: string
  usedAI: boolean
}

interface NameMatch {
  id: string
  name: string
}

interface CustomerNameMatch extends NameMatch {
  nextAppointmentAt: Date | null
  nextAppointmentProfessionalName: string | null
}

interface NameResolutionResult {
  receivedName: string | null
  professionalMatches: NameMatch[]
  customerMatches: CustomerNameMatch[]
  action: 'none' | 'professional' | 'customer_reference' | 'ambiguous' | 'not_found'
  resolvedProfessional: NameMatch | null
}

interface ConversationDraft {
  selectedServiceId: string | null
  selectedServiceName: string | null
  selectedProfessionalId: string | null
  selectedProfessionalName: string | null
  allowAnyProfessional: boolean
  requestedDateIso: string | null
  requestedTimeLabel: string | null
  offeredSlots: ConversationSlot[]
  selectedStoredSlot: ConversationSlot | null
}

interface ConversationBaseUpdate {
  lastInboundText: string
  lastIntent: Prisma.InputJsonValue
  selectedServiceId: string | null
  selectedServiceName: string | null
  selectedProfessionalId: string | null
  selectedProfessionalName: string | null
  allowAnyProfessional: boolean
  requestedDate: Date | null
  requestedTimeLabel: string | null
}

type ConversationSlot = WhatsAppBookingSlot

const JSON_NULL = Prisma.JsonNull
const CONVERSATION_CONTEXT_TTL_MS = 45 * 60_000
const SHORT_GREETING_PATTERN = /^(oi+|ola+|ol[aá]|bom dia|boa tarde|boa noite)[!.,\s]*$/

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normalizeOptionalText(value?: string | null) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function isShortGreetingMessage(value: string) {
  return SHORT_GREETING_PATTERN.test(normalizeText(value))
}

function buildEmptyConversationDraft(): ConversationDraft {
  return {
    selectedServiceId: null,
    selectedServiceName: null,
    selectedProfessionalId: null,
    selectedProfessionalName: null,
    allowAnyProfessional: false,
    requestedDateIso: null,
    requestedTimeLabel: null,
    offeredSlots: [],
    selectedStoredSlot: null,
  }
}

function nameTokens(value: string) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2)
}

function formatDateIso(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isToday(dateIso: string, timezone: string) {
  return dateIso === getTodayIsoInTimezone(timezone)
}

function formatDayLabel(dateIso: string, timezone: string) {
  if (isToday(dateIso, timezone)) {
    return 'Hoje'
  }

  const [year, month, day] = dateIso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return date.toLocaleDateString('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  })
}

function buildGreeting(barbershopName: string, customerName?: string | null) {
  const firstName = customerName?.trim()?.split(' ')[0]
  const greeting = firstName ? `Oi, ${firstName}!` : 'Oi!'
  return `${greeting} Posso te ajudar a marcar um horario na ${barbershopName}.`
}

function buildServiceQuestion(serviceNames: string[]) {
  const preview = serviceNames.slice(0, 6).join(', ')
  return `Perfeito. Voce quer corte, barba ou outro servico? ${preview ? `Hoje temos: ${preview}.` : ''}`.trim()
}

function buildProfessionalQuestion(professionalNames: string[]) {
  return `Tem preferencia de barbeiro? Posso buscar com ${professionalNames.slice(0, 6).join(', ')}. Se preferir, tambem posso ver com qualquer um.`
}

function buildDateQuestion() {
  return 'Qual dia voce prefere? Pode me falar algo como hoje, amanha, sexta ou uma data.'
}

function buildPeriodQuestion() {
  return 'Perfeito. Voce prefere de manha, a tarde ou a noite?'
}

function buildNoAvailabilityMessage(dateIso: string, timezone: string) {
  return `Nao encontrei horario livre em ${formatDayLabel(dateIso, timezone).toLowerCase()} com essa combinacao. Me fala outro dia ou outro periodo que eu procuro de novo.`
}

function buildSpecificProfessionalNoAvailabilityMessage(
  dateIso: string,
  professionalName: string,
  timezone: string
) {
  const dayLabel = formatDayLabel(dateIso, timezone)
  return `${dayLabel} o ${professionalName} nao tem mais horarios disponiveis. Quer que eu veja com outro barbeiro?`
}

function describeHumanPeriodLabel(timePreference?: string | null) {
  if (timePreference === 'MORNING') return 'de manha'
  if (timePreference === 'AFTERNOON') return 'a tarde'
  if (timePreference === 'LATE_AFTERNOON') return 'no fim da tarde'
  if (timePreference === 'EVENING') return 'a noite'
  return null
}

function buildHumanSlotOfferMessage(
  slots: ConversationSlot[],
  serviceName: string,
  timezone: string,
  timePreference?: string | null
) {
  const sameDay = slots.every((slot) => slot.dateIso === slots[0]?.dateIso)
  const sameProfessional = slots.every((slot) => slot.professionalId === slots[0]?.professionalId)
  const periodLabel = describeHumanPeriodLabel(timePreference)

  let header = `Encontrei estes horarios disponiveis para ${serviceName}:`
  if (sameDay && sameProfessional) {
    header = periodLabel
      ? `${formatDayLabel(slots[0].dateIso, timezone)} ${periodLabel} com ${slots[0].professionalName} eu tenho estes horarios livres para ${serviceName}:`
      : `${formatDayLabel(slots[0].dateIso, timezone)} com ${slots[0].professionalName} eu tenho estes horarios livres para ${serviceName}:`
  } else if (sameDay) {
    header = periodLabel
      ? `${formatDayLabel(slots[0].dateIso, timezone)} ${periodLabel} encontrei estes horarios disponiveis para ${serviceName}:`
      : `${formatDayLabel(slots[0].dateIso, timezone)} encontrei estes horarios disponiveis para ${serviceName}:`
  }

  const lines = slots.map((slot) => {
    if (sameDay && sameProfessional) {
      return `- ${slot.timeLabel}`
    }

    if (sameDay) {
      return `- ${slot.timeLabel} com ${slot.professionalName}`
    }

    return `- ${formatDayLabel(slot.dateIso, timezone)} as ${slot.timeLabel} com ${slot.professionalName}`
  })

  return `${header}\n\n${lines.join('\n')}\n\nPode me dizer qual prefere ou pedir outro horario.`
}

function buildConfirmationMessage(slot: ConversationSlot, serviceName: string, timezone: string) {
  return `Posso confirmar ${serviceName} para ${formatDayLabel(slot.dateIso, timezone).toLowerCase()} as ${slot.timeLabel} com ${slot.professionalName}? Se estiver certo, me responde com sim.`
}

function buildSuccessMessage(slot: ConversationSlot, serviceName: string, timezone: string) {
  return `Agendamento confirmado: ${serviceName} em ${formatDayLabel(slot.dateIso, timezone).toLowerCase()} as ${slot.timeLabel} com ${slot.professionalName}. Se quiser ajustar depois, me chama por aqui.`
}

function buildRescheduleMessage() {
  return 'Sem problema. Me fala outro horario, outro periodo ou outro dia que eu busco novas opcoes.'
}

function buildCustomerReferenceMessage(match: CustomerNameMatch, professionals: NameMatch[]) {
  const appointmentHint = match.nextAppointmentAt
    ? ` que ja tem horario marcado com ${match.nextAppointmentProfessionalName ?? 'a equipe'}`
    : ''

  return `Voce quis dizer o cliente ${match.name}${appointmentHint}? Se estiver procurando um barbeiro, posso te mostrar horarios com ${professionals.map((professional) => professional.name).join(', ')}.`
}

function buildAmbiguousNameMessage(name: string, professionals: NameMatch[]) {
  return `Encontrei "${name}" tanto como barbeiro quanto como cliente. Voce esta procurando um barbeiro ou o cliente? Se quiser, posso te mostrar os barbeiros disponiveis: ${professionals.map((professional) => professional.name).join(', ')}.`
}

function buildProfessionalNotFoundMessage(name: string, professionals: NameMatch[]) {
  return `Nao encontrei barbeiro com o nome ${name}. Posso te mostrar horarios com ${professionals.map((professional) => professional.name).join(', ')}.`
}

function buildResumeMessage(input: {
  state: ConversationState
  timezone: string
  draft: ConversationDraft
  professionals: NameMatch[]
}) {
  if (input.state === 'WAITING_SERVICE') {
    return `Oi! Posso continuar por aqui. ${buildServiceQuestion([])}`
  }

  if (input.state === 'WAITING_PROFESSIONAL') {
    return `Oi! Posso continuar por aqui. ${buildProfessionalQuestion(input.professionals.map((professional) => professional.name))}`
  }

  if (input.state === 'WAITING_DATE') {
    return `Oi! Posso continuar por aqui. ${buildDateQuestion()}`
  }

  if (input.state === 'WAITING_TIME' && input.draft.offeredSlots.length > 0 && input.draft.selectedServiceName) {
    return `Oi! Posso continuar por aqui.\n\n${buildHumanSlotOfferMessage(
      input.draft.offeredSlots,
      input.draft.selectedServiceName,
      input.timezone,
      input.draft.requestedTimeLabel
    )}`
  }

  if (input.state === 'WAITING_CONFIRMATION' && input.draft.selectedStoredSlot && input.draft.selectedServiceName) {
    return `Oi! Posso continuar por aqui. ${buildConfirmationMessage(
      input.draft.selectedStoredSlot,
      input.draft.selectedServiceName,
      input.timezone
    )}`
  }

  return `Oi! Posso continuar por aqui. ${buildPeriodQuestion()}`
}

function buildCorrectionLeadIn(target: string) {
  if (target === 'DATE') return 'Entendi - corrigi o dia aqui.'
  if (target === 'PERIOD' || target === 'TIME') return 'Boa - ajustei o horario.'
  if (target === 'PROFESSIONAL') return 'Perfeito - ajustei o barbeiro.'
  if (target === 'SERVICE') return 'Boa - ajustei o servico.'
  if (target === 'FLOW') return 'Sem problema - vamos recomecar por aqui.'
  return null
}

function withLeadIn(message: string, leadIn?: string | null) {
  if (!leadIn) {
    return message
  }

  return `${leadIn}\n\n${message}`
}

function buildJsonValue(value: unknown) {
  return value as Prisma.InputJsonValue
}

function parseConversationSlots(raw: Prisma.JsonValue | null): ConversationSlot[] {
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
      }
    })
    .filter((slot): slot is ConversationSlot => Boolean(slot))
}

function parseSelectedSlot(raw: Prisma.JsonValue | null): ConversationSlot | null {
  return parseConversationSlots(raw ? [raw] : null)[0] ?? null
}

function resolveRequestedTimeLabel(input: {
  exactTime: string | null
  timePreference: string
  preferredPeriod: 'MORNING' | 'AFTERNOON' | 'EVENING' | null
  existingValue: string | null
}) {
  if (input.exactTime) {
    return input.exactTime
  }

  if (input.timePreference && input.timePreference !== 'NONE') {
    return input.timePreference
  }

  if (input.preferredPeriod) {
    return input.preferredPeriod
  }

  return input.existingValue
}

function hasResolvedTimePreference(value: string | null) {
  if (!value) {
    return false
  }

  return ['MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING'].includes(value) || value.includes(':')
}

function isBookingEntryPoint(state: ConversationState, intent: string) {
  return intent === 'BOOK_APPOINTMENT' || (state === 'IDLE' && intent === 'CONFIRM')
}

function normalizeConversationState(state: string): ConversationState {
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

function getFlowForState(state: ConversationState): ConversationServiceResult['flow'] {
  if (state === 'WAITING_SERVICE') return 'collect_service'
  if (state === 'WAITING_PROFESSIONAL') return 'collect_professional'
  if (state === 'WAITING_DATE') return 'collect_date'
  if (state === 'WAITING_TIME') return 'collect_period'
  if (state === 'WAITING_CONFIRMATION') return 'await_confirmation'
  return 'greeting'
}

function hasSchedulingSignal(interpreted: Awaited<ReturnType<typeof interpretWhatsAppMessage>>) {
  return Boolean(
    interpreted.serviceName
    || interpreted.mentionedName
    || interpreted.allowAnyProfessional
    || interpreted.requestedDateIso
    || interpreted.selectedOptionNumber
    || interpreted.exactTime
    || interpreted.preferredPeriod
    || interpreted.timePreference !== 'NONE'
    || interpreted.correctionTarget !== 'NONE'
  )
}

function findEntityMatches<T extends NameMatch>(items: T[], rawName: string) {
  const rawTokens = nameTokens(rawName)
  if (rawTokens.length === 0) {
    return [] as T[]
  }

  return items.filter((item) => {
    const itemTokens = nameTokens(item.name)
    return rawTokens.every((rawToken) =>
      itemTokens.some((itemToken) => itemToken === rawToken || itemToken.startsWith(rawToken))
    )
  })
}

async function findCustomerMatches(input: {
  barbershopId: string
  rawName: string
  requestedDateIso: string | null
}) {
  const tokens = nameTokens(input.rawName)
  if (tokens.length === 0) {
    return []
  }

  const customerCandidates = await prisma.customer.findMany({
    where: {
      barbershopId: input.barbershopId,
      active: true,
      OR: tokens.map((token) => ({
        name: {
          contains: token,
          mode: 'insensitive' as const,
        },
      })),
    },
    take: 8,
    select: {
      id: true,
      name: true,
      appointments: {
        where: {
          status: { in: ['PENDING', 'CONFIRMED'] },
          startAt: input.requestedDateIso
            ? {
                gte: new Date(`${input.requestedDateIso}T00:00:00`),
                lt: new Date(`${input.requestedDateIso}T23:59:59`),
              }
            : {
                gte: new Date(),
              },
        },
        orderBy: { startAt: 'asc' },
        take: 1,
        select: {
          startAt: true,
          professional: {
            select: { name: true },
          },
        },
      },
    },
  })

  return findEntityMatches(customerCandidates, input.rawName).map((customer) => ({
    id: customer.id,
    name: customer.name,
    nextAppointmentAt: customer.appointments[0]?.startAt ?? null,
    nextAppointmentProfessionalName: customer.appointments[0]?.professional.name ?? null,
  }))
}

async function resolveMentionedName(input: {
  rawName: string | null
  barbershopId: string
  requestedDateIso: string | null
  professionals: NameMatch[]
}) {
  if (!input.rawName) {
    return {
      receivedName: null,
      professionalMatches: [],
      customerMatches: [],
      action: 'none',
      resolvedProfessional: null,
    } satisfies NameResolutionResult
  }

  const professionalMatches = findEntityMatches(input.professionals, input.rawName)
  const customerMatches = await findCustomerMatches({
    barbershopId: input.barbershopId,
    rawName: input.rawName,
    requestedDateIso: input.requestedDateIso,
  })

  let action: NameResolutionResult['action'] = 'not_found'
  let resolvedProfessional: NameMatch | null = null

  if (professionalMatches.length === 1 && customerMatches.length === 0) {
    action = 'professional'
    resolvedProfessional = professionalMatches[0]
  } else if (professionalMatches.length === 0 && customerMatches.length > 0) {
    action = 'customer_reference'
  } else if (professionalMatches.length > 0 && customerMatches.length > 0) {
    action = 'ambiguous'
  } else if (professionalMatches.length > 1) {
    action = 'ambiguous'
  }

  const result = {
    receivedName: input.rawName,
    professionalMatches,
    customerMatches,
    action,
    resolvedProfessional,
  } satisfies NameResolutionResult

  console.info('[whatsapp-conversation] name resolution', {
    nameReceived: result.receivedName,
    interpretedAsProfessional: result.professionalMatches.map((item) => item.name),
    interpretedAsCustomer: result.customerMatches.map((item) => item.name),
    actionTaken: result.action,
  })

  return result
}

async function getOrCreateConversation(input: {
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
  })
}

async function resetConversation(input: {
  conversationId: string
  inboundText: string
  interpreted: Awaited<ReturnType<typeof interpretWhatsAppMessage>>
  responseText: string
}) {
  await prisma.whatsappConversation.update({
    where: { id: input.conversationId },
    data: {
      state: 'IDLE',
      selectedServiceId: null,
      selectedServiceName: null,
      selectedProfessionalId: null,
      selectedProfessionalName: null,
      allowAnyProfessional: false,
      requestedDate: null,
      requestedTimeLabel: null,
      slotOptions: JSON_NULL,
      selectedSlot: JSON_NULL,
      conversationSummary: null,
      bookingDraft: JSON_NULL,
      recentCorrections: JSON_NULL,
      lastInboundText: input.inboundText,
      lastIntent: buildJsonValue(input.interpreted),
      lastAssistantText: input.responseText,
    },
  })
}

function pickOfferedSlot(input: {
  offeredSlots: ConversationSlot[]
  selectedOptionNumber: number | null
  exactTime: string | null
  message: string
}) {
  if (input.selectedOptionNumber) {
    return input.offeredSlots[input.selectedOptionNumber - 1] ?? null
  }

  if (input.exactTime) {
    return input.offeredSlots.find((slot) => slot.timeLabel === input.exactTime) ?? null
  }

  const normalizedMessage = normalizeText(input.message)
  return input.offeredSlots.find((slot) => normalizeText(slot.timeLabel) === normalizedMessage) ?? null
}

function clearDraftAvailability(draft: ConversationDraft) {
  draft.offeredSlots = []
  draft.selectedStoredSlot = null
}

function applyCorrectionTarget(draft: ConversationDraft, target: string) {
  if (target === 'FLOW') {
    draft.selectedServiceId = null
    draft.selectedServiceName = null
    draft.selectedProfessionalId = null
    draft.selectedProfessionalName = null
    draft.allowAnyProfessional = false
    draft.requestedDateIso = null
    draft.requestedTimeLabel = null
    clearDraftAvailability(draft)
    return
  }

  if (target === 'SERVICE') {
    draft.selectedServiceId = null
    draft.selectedServiceName = null
    draft.requestedTimeLabel = null
    clearDraftAvailability(draft)
    return
  }

  if (target === 'PROFESSIONAL') {
    draft.selectedProfessionalId = null
    draft.selectedProfessionalName = null
    draft.allowAnyProfessional = false
    draft.requestedTimeLabel = null
    clearDraftAvailability(draft)
    return
  }

  if (target === 'DATE') {
    draft.requestedDateIso = null
    draft.requestedTimeLabel = null
    clearDraftAvailability(draft)
    return
  }

  if (target === 'PERIOD' || target === 'TIME') {
    draft.requestedTimeLabel = null
    clearDraftAvailability(draft)
  }
}

function isConversationContextReliable(input: {
  state: ConversationState
  updatedAt: Date
  draft: ConversationDraft
}) {
  if (input.state === 'IDLE') {
    return false
  }

  if (Date.now() - input.updatedAt.getTime() > CONVERSATION_CONTEXT_TTL_MS) {
    return false
  }

  const hasProfessionalContext = Boolean(input.draft.selectedProfessionalId) || input.draft.allowAnyProfessional
  const hasTimeSelection = hasResolvedTimePreference(input.draft.requestedTimeLabel)
  const hasOfferedSlots = input.draft.offeredSlots.length > 0
  const hasSelectedSlot = Boolean(input.draft.selectedStoredSlot)

  if (hasSelectedSlot && input.state !== 'WAITING_CONFIRMATION') {
    return false
  }

  if (hasOfferedSlots && input.state !== 'WAITING_TIME') {
    return false
  }

  if (input.state === 'WAITING_SERVICE') {
    return !input.draft.selectedServiceId
      && !hasProfessionalContext
      && !input.draft.requestedDateIso
      && !input.draft.requestedTimeLabel
      && !hasOfferedSlots
      && !hasSelectedSlot
  }

  if (input.state === 'WAITING_PROFESSIONAL') {
    return Boolean(input.draft.selectedServiceId)
      && !hasProfessionalContext
      && !input.draft.requestedDateIso
      && !input.draft.requestedTimeLabel
      && !hasOfferedSlots
      && !hasSelectedSlot
  }

  if (input.state === 'WAITING_DATE') {
    return Boolean(input.draft.selectedServiceId)
      && hasProfessionalContext
      && hasTimeSelection
      && !hasOfferedSlots
      && !hasSelectedSlot
  }

  if (input.state === 'WAITING_TIME') {
    if (!input.draft.selectedServiceId || !hasProfessionalContext || hasSelectedSlot) {
      return false
    }

    if (hasOfferedSlots) {
      return Boolean(input.draft.requestedDateIso) && hasTimeSelection
    }

    return true
  }

  if (input.state === 'WAITING_CONFIRMATION') {
    return Boolean(input.draft.selectedServiceId) && hasSelectedSlot
  }

  return false
}

async function offerFreshSlots(input: {
  conversationId: string
  customerId: string
  conversationStep: ConversationState
  baseUpdate: ConversationBaseUpdate
  barbershopId: string
  timezone: string
  requestedDateIso: string
  serviceId: string
  serviceName: string
  professionalId: string | null
  professionalName: string | null
  timePreference: string | null
  exactTime: string | null
  usedAI: boolean
  responseLeadIn?: string | null
}): Promise<ConversationServiceResult> {
  const availability = await getAvailableWhatsAppSlots({
    barbershopId: input.barbershopId,
    serviceId: input.serviceId,
    dateIso: input.requestedDateIso,
    timezone: input.timezone,
    professionalId: input.professionalId,
    timePreference: input.timePreference,
    exactTime: input.exactTime,
    limit: 4,
  })

  console.info('[whatsapp-conversation] availability lookup', {
    customerId: input.customerId,
    conversationStep: input.conversationStep,
    selectedProfessionalId: input.professionalId,
    selectedProfessional: input.professionalName,
    selectedDate: input.requestedDateIso,
    selectedPeriod: input.timePreference ?? 'NONE',
    selectedService: input.serviceName,
    serviceDuration: availability.diagnostics.serviceDuration,
    bufferMinutes: availability.diagnostics.bufferMinutes,
    busyAppointmentsFound: availability.diagnostics.busyAppointmentsFound,
    freeSlotsReturned: availability.diagnostics.freeSlotsReturned,
    finalReason: availability.diagnostics.finalReason,
  })

  if (availability.slots.length === 0) {
    const message = input.professionalId && input.professionalName
      ? buildSpecificProfessionalNoAvailabilityMessage(input.requestedDateIso, input.professionalName, input.timezone)
      : buildNoAvailabilityMessage(input.requestedDateIso, input.timezone)
    const responseText = withLeadIn(message, input.responseLeadIn)

    await prisma.whatsappConversation.update({
      where: { id: input.conversationId },
      data: {
        ...input.baseUpdate,
        state: input.professionalId ? 'WAITING_PROFESSIONAL' : 'WAITING_DATE',
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: input.professionalId ? 'collect_professional' : 'collect_date',
      conversationId: input.conversationId,
      conversationState: input.professionalId ? 'WAITING_PROFESSIONAL' : 'WAITING_DATE',
      usedAI: input.usedAI,
    }
  }

  const responseText = withLeadIn(
    buildHumanSlotOfferMessage(availability.slots, input.serviceName, input.timezone, input.timePreference),
    input.responseLeadIn
  )

  await prisma.whatsappConversation.update({
    where: { id: input.conversationId },
    data: {
      ...input.baseUpdate,
      state: 'WAITING_TIME',
      slotOptions: buildJsonValue(availability.slots),
      selectedSlot: JSON_NULL,
      lastAssistantText: responseText,
    },
  })

  return {
    responseText,
    flow: 'offer_slots',
    conversationId: input.conversationId,
    conversationState: 'WAITING_TIME',
    usedAI: input.usedAI,
  }
}

export async function processWhatsAppConversation(input: ConversationServiceInput): Promise<ConversationServiceResult> {
  const inboundText = input.inboundText.trim()
  const timezone = resolveBusinessTimezone(input.barbershop.timezone)
  const nowContext = getCurrentDateTimeInTimezone(timezone)
  const { services, professionals } = await loadBarbershopSchedulingOptions(input.barbershop.id)
  const conversation = await getOrCreateConversation({
    barbershopId: input.barbershop.id,
    customerId: input.customer.id,
    phone: input.customer.phone ?? null,
  })

  if (services.length === 0 || professionals.length === 0) {
    const responseText = 'Ainda nao consigo fechar agendamento por aqui porque a agenda da barbearia ainda esta sem servicos ou profissionais ativos.'

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        state: 'IDLE',
        lastInboundText: inboundText,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: 'greeting',
      conversationId: conversation.id,
      conversationState: 'IDLE',
      usedAI: false,
    }
  }

  const currentState = normalizeConversationState(conversation.state)
  const conversationRequestedDateIso = conversation.requestedDate
    ? formatDateIso(conversation.requestedDate)
    : null
  const conversationDraft: ConversationDraft = {
    selectedServiceId: conversation.selectedServiceId ?? null,
    selectedServiceName: conversation.selectedServiceName ?? null,
    selectedProfessionalId: conversation.selectedProfessionalId ?? null,
    selectedProfessionalName: conversation.selectedProfessionalName ?? null,
    allowAnyProfessional: conversation.allowAnyProfessional,
    requestedDateIso: conversationRequestedDateIso,
    requestedTimeLabel: conversation.requestedTimeLabel ?? null,
    offeredSlots: parseConversationSlots(conversation.slotOptions),
    selectedStoredSlot: parseSelectedSlot(conversation.selectedSlot),
  }

  const agentResult = await processWhatsAppConversationWithAgent({
    barbershop: input.barbershop,
    customer: input.customer,
    inboundText,
    conversation: {
      id: conversation.id,
      state: conversation.state,
      updatedAt: conversation.updatedAt,
      selectedServiceId: conversation.selectedServiceId ?? null,
      selectedServiceName: conversation.selectedServiceName ?? null,
      selectedProfessionalId: conversation.selectedProfessionalId ?? null,
      selectedProfessionalName: conversation.selectedProfessionalName ?? null,
      allowAnyProfessional: conversation.allowAnyProfessional,
      requestedDate: conversation.requestedDate,
      requestedTimeLabel: conversation.requestedTimeLabel ?? null,
      slotOptions: conversation.slotOptions,
      selectedSlot: conversation.selectedSlot,
      conversationSummary: conversation.conversationSummary ?? null,
      bookingDraft: conversation.bookingDraft,
      recentCorrections: conversation.recentCorrections,
      lastInboundText: conversation.lastInboundText ?? null,
      lastAssistantText: conversation.lastAssistantText ?? null,
    },
    services,
    professionals,
    nowContext,
  })

  if (agentResult) {
    const shouldResetPersistedContext =
      agentResult.structured.nextAction === 'RESET_CONTEXT'
      || agentResult.structured.nextAction === 'GREET'

    if (agentResult.shouldCreateAppointment && agentResult.memory.selectedSlot && agentResult.memory.selectedServiceId) {
      try {
        const appointment = await createAppointmentFromWhatsApp({
          barbershopId: input.barbershop.id,
          customerId: input.customer.id,
          serviceId: agentResult.memory.selectedServiceId,
          professionalId: agentResult.memory.selectedSlot.professionalId,
          startAtIso: agentResult.memory.selectedSlot.startAtIso,
          sourceReference: `whatsapp:${conversation.id}:${input.eventId}`,
          notes: 'Agendamento criado via agente conversacional do WhatsApp.',
        })

        await prisma.whatsappConversation.update({
          where: { id: conversation.id },
          data: {
            state: 'IDLE',
            selectedServiceId: null,
            selectedServiceName: null,
            selectedProfessionalId: null,
            selectedProfessionalName: null,
            allowAnyProfessional: false,
            requestedDate: null,
            requestedTimeLabel: null,
            slotOptions: JSON_NULL,
            selectedSlot: JSON_NULL,
            conversationSummary: agentResult.memory.conversationSummary,
            bookingDraft: JSON_NULL,
            recentCorrections: agentResult.memory.recentCorrections.length
              ? buildJsonValue(agentResult.memory.recentCorrections)
              : JSON_NULL,
            lastInboundText: inboundText,
            lastIntent: buildJsonValue({
              source: 'agent',
              structured: agentResult.structured,
              toolTrace: agentResult.toolTrace,
            }),
            lastAssistantText: agentResult.responseText,
            completedAt: new Date(),
          },
        })

        console.info('[whatsapp-conversation] backend action', {
          mode: 'agent',
          action: 'appointment_created',
          conversationId: conversation.id,
          appointmentId: appointment.id,
        })

        return {
          responseText: agentResult.responseText,
          flow: 'appointment_created',
          conversationId: conversation.id,
          conversationState: 'IDLE',
          appointmentId: appointment.id,
          usedAI: true,
        }
      } catch (error) {
        console.warn('[whatsapp-conversation] agent booking fallback_to_legacy', {
          error: error instanceof Error ? error.message : 'unknown_error',
          conversationId: conversation.id,
        })
      }
    } else {
      await prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: {
          state: agentResult.conversationState,
          selectedServiceId: shouldResetPersistedContext ? null : agentResult.memory.selectedServiceId,
          selectedServiceName: shouldResetPersistedContext ? null : agentResult.memory.selectedServiceName,
          selectedProfessionalId: shouldResetPersistedContext ? null : agentResult.memory.selectedProfessionalId,
          selectedProfessionalName: shouldResetPersistedContext ? null : agentResult.memory.selectedProfessionalName,
          allowAnyProfessional: shouldResetPersistedContext ? false : agentResult.memory.allowAnyProfessional,
          requestedDate: !shouldResetPersistedContext && agentResult.memory.requestedDateIso
            ? new Date(`${agentResult.memory.requestedDateIso}T12:00:00`)
            : null,
          requestedTimeLabel: shouldResetPersistedContext ? null : agentResult.memory.requestedTimeLabel,
          slotOptions: !shouldResetPersistedContext && agentResult.memory.offeredSlots.length
            ? buildJsonValue(agentResult.memory.offeredSlots)
            : JSON_NULL,
          selectedSlot: !shouldResetPersistedContext && agentResult.memory.selectedSlot
            ? buildJsonValue(agentResult.memory.selectedSlot)
            : JSON_NULL,
          conversationSummary: agentResult.memory.conversationSummary,
          bookingDraft: !shouldResetPersistedContext
            ? buildJsonValue({
                selectedServiceId: agentResult.memory.selectedServiceId,
                selectedServiceName: agentResult.memory.selectedServiceName,
                selectedProfessionalId: agentResult.memory.selectedProfessionalId,
                selectedProfessionalName: agentResult.memory.selectedProfessionalName,
                allowAnyProfessional: agentResult.memory.allowAnyProfessional,
                requestedDateIso: agentResult.memory.requestedDateIso,
                requestedTimeLabel: agentResult.memory.requestedTimeLabel,
                selectedSlot: agentResult.memory.selectedSlot,
              })
            : JSON_NULL,
          recentCorrections: agentResult.memory.recentCorrections.length
            ? buildJsonValue(agentResult.memory.recentCorrections)
            : JSON_NULL,
          lastInboundText: inboundText,
          lastIntent: buildJsonValue({
            source: 'agent',
            structured: agentResult.structured,
            toolTrace: agentResult.toolTrace,
          }),
          lastAssistantText: agentResult.responseText,
          completedAt: shouldResetPersistedContext ? new Date() : null,
        },
      })

      console.info('[whatsapp-conversation] backend action', {
        mode: 'agent',
        action: agentResult.structured.nextAction,
        conversationId: conversation.id,
        conversationState: agentResult.conversationState,
      })

      return {
        responseText: agentResult.responseText,
        flow: agentResult.flow,
        conversationId: conversation.id,
        conversationState: agentResult.conversationState,
        usedAI: true,
      }
    }
  }

  const contextReliable = isConversationContextReliable({
    state: currentState,
    updatedAt: conversation.updatedAt,
    draft: conversationDraft,
  })
  const effectiveState = contextReliable ? currentState : 'IDLE'
  const draftForInterpreter = contextReliable ? conversationDraft : buildEmptyConversationDraft()

  if (!contextReliable && currentState !== 'IDLE') {
    console.info('[whatsapp-conversation] discarded unreliable context', {
      customerId: input.customer.id,
      previousState: currentState,
      updatedAt: conversation.updatedAt.toISOString(),
      requestedDateIso: conversationDraft.requestedDateIso,
      requestedTimeLabel: conversationDraft.requestedTimeLabel,
      offeredSlots: conversationDraft.offeredSlots.length,
      hasSelectedSlot: Boolean(conversationDraft.selectedStoredSlot),
    })
  }

  const interpreted = await interpretWhatsAppMessage({
    message: inboundText,
    barbershopName: input.barbershop.name,
    barbershopTimezone: timezone,
    conversationState: effectiveState,
    offeredSlotCount: draftForInterpreter.offeredSlots.length,
    services: services.map((service) => ({ name: service.name })),
    professionals: professionals.map((professional) => ({ name: professional.name })),
    todayIsoDate: nowContext.dateIso,
    currentLocalDateTime: nowContext.dateTimeLabel,
    conversationSummary: {
      selectedServiceName: draftForInterpreter.selectedServiceName,
      selectedProfessionalName: draftForInterpreter.selectedProfessionalName,
      requestedDateIso: draftForInterpreter.requestedDateIso,
      requestedTimeLabel: draftForInterpreter.requestedTimeLabel,
      allowAnyProfessional: draftForInterpreter.allowAnyProfessional,
      lastCustomerMessage: contextReliable ? conversation.lastInboundText : null,
      lastAssistantMessage: contextReliable ? conversation.lastAssistantText : null,
    },
  })

  console.info('[whatsapp-conversation] interpreted message', {
    customerId: input.customer.id,
    state: effectiveState,
    previousState: currentState,
    contextReliable,
    intent: interpreted.intent,
    correctionTarget: interpreted.correctionTarget,
    requestedDateIso: interpreted.requestedDateIso,
    preferredPeriod: interpreted.preferredPeriod,
    timePreference: interpreted.timePreference,
    exactTime: interpreted.exactTime,
    mentionedName: interpreted.mentionedName,
    greetingOnly: interpreted.greetingOnly,
    restartConversation: interpreted.restartConversation,
    source: interpreted.source,
  })

  const usedAI = interpreted.source === 'openai'
  const shortGreeting = interpreted.greetingOnly || isShortGreetingMessage(inboundText)

  if (interpreted.restartConversation || (shortGreeting && !contextReliable)) {
    const responseText = buildGreeting(input.barbershop.name, input.customer.created ? null : input.customer.name)

    await resetConversation({
      conversationId: conversation.id,
      inboundText,
      interpreted,
      responseText,
    })

    return {
      responseText,
      flow: 'greeting',
      conversationId: conversation.id,
      conversationState: 'IDLE',
      usedAI,
    }
  }

  if (shortGreeting && contextReliable) {
    const responseText = buildResumeMessage({
      state: effectiveState,
      timezone,
      draft: draftForInterpreter,
      professionals: professionals.map((professional) => ({ id: professional.id, name: professional.name })),
    })

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        lastInboundText: inboundText,
        lastIntent: buildJsonValue(interpreted),
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: getFlowForState(effectiveState),
      conversationId: conversation.id,
      conversationState: effectiveState,
      usedAI,
    }
  }

  const bookingRequested = isBookingEntryPoint(effectiveState, interpreted.intent)
  const shouldProceedWithScheduling =
    bookingRequested
    || effectiveState !== 'IDLE'
    || hasSchedulingSignal(interpreted)

  if (!shouldProceedWithScheduling) {
    const responseText = buildGreeting(input.barbershop.name, input.customer.created ? null : input.customer.name)

    if (!contextReliable) {
      await resetConversation({
        conversationId: conversation.id,
        inboundText,
        interpreted,
        responseText,
      })
    } else {
      await prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: {
          lastInboundText: inboundText,
          lastIntent: buildJsonValue(interpreted),
          lastAssistantText: responseText,
        },
      })
    }

    return {
      responseText,
      flow: 'greeting',
      conversationId: conversation.id,
      conversationState: 'IDLE',
      usedAI,
    }
  }

  const matchedService = interpreted.serviceName
    ? services.find((service) => normalizeText(service.name) === normalizeText(interpreted.serviceName ?? ''))
      ?? services.find((service) => normalizeText(interpreted.serviceName ?? '').includes(normalizeText(service.name)))
      ?? null
    : null

  const baselineDraft = contextReliable ? conversationDraft : buildEmptyConversationDraft()
  const requestedDateForResolution = interpreted.requestedDateIso ?? baselineDraft.requestedDateIso
  const nameResolution = await resolveMentionedName({
    rawName: normalizeOptionalText(interpreted.mentionedName),
    barbershopId: input.barbershop.id,
    requestedDateIso: requestedDateForResolution,
    professionals: professionals.map((professional) => ({ id: professional.id, name: professional.name })),
  })

  const acceptedAlternativeProfessional =
    effectiveState === 'WAITING_PROFESSIONAL'
    && Boolean(baselineDraft.selectedProfessionalId)
    && Boolean(conversation.lastAssistantText?.includes('Quer que eu veja com outro barbeiro?'))
    && interpreted.intent === 'CONFIRM'
    && nameResolution.action === 'none'

  const responseLeadIn = buildCorrectionLeadIn(interpreted.correctionTarget)
  const draft: ConversationDraft = { ...baselineDraft }
  applyCorrectionTarget(draft, interpreted.correctionTarget)

  if (matchedService) {
    draft.selectedServiceId = matchedService.id
    draft.selectedServiceName = matchedService.name
  }

  if (nameResolution.action === 'professional' && nameResolution.resolvedProfessional) {
    draft.selectedProfessionalId = nameResolution.resolvedProfessional.id
    draft.selectedProfessionalName = nameResolution.resolvedProfessional.name
    draft.allowAnyProfessional = false
  }

  if (interpreted.allowAnyProfessional || acceptedAlternativeProfessional) {
    draft.selectedProfessionalId = null
    draft.selectedProfessionalName = null
    draft.allowAnyProfessional = true
  }

  if (interpreted.requestedDateIso) {
    draft.requestedDateIso = interpreted.requestedDateIso
  }

  const hasNewTimePreference =
    Boolean(interpreted.exactTime)
    || Boolean(interpreted.preferredPeriod)
    || Boolean(interpreted.timePreference && interpreted.timePreference !== 'NONE')
  const serviceChanged = draft.selectedServiceId !== baselineDraft.selectedServiceId
  const professionalChanged =
    draft.selectedProfessionalId !== baselineDraft.selectedProfessionalId
    || draft.allowAnyProfessional !== baselineDraft.allowAnyProfessional
  const dateChanged = draft.requestedDateIso !== baselineDraft.requestedDateIso

  if (!hasNewTimePreference && (serviceChanged || professionalChanged || dateChanged)) {
    draft.requestedTimeLabel = null
    clearDraftAvailability(draft)
  } else {
    draft.requestedTimeLabel = resolveRequestedTimeLabel({
      exactTime: interpreted.exactTime,
      timePreference: interpreted.timePreference,
      preferredPeriod: interpreted.preferredPeriod,
      existingValue: draft.requestedTimeLabel,
    })
  }

  if (serviceChanged || professionalChanged || dateChanged || interpreted.correctionTarget !== 'NONE') {
    clearDraftAvailability(draft)
    console.info('[whatsapp-conversation] cleared stale availability context', {
      customerId: input.customer.id,
      serviceChanged,
      professionalChanged,
      dateChanged,
      correctionTarget: interpreted.correctionTarget,
      previousRequestedTimeLabel: conversation.requestedTimeLabel,
      nextRequestedTimeLabel: draft.requestedTimeLabel,
    })
  }

  const baseUpdate: ConversationBaseUpdate = {
    lastInboundText: inboundText,
    lastIntent: buildJsonValue(interpreted),
    selectedServiceId: draft.selectedServiceId,
    selectedServiceName: draft.selectedServiceName,
    selectedProfessionalId: draft.selectedProfessionalId,
    selectedProfessionalName: draft.selectedProfessionalName,
    allowAnyProfessional: draft.allowAnyProfessional,
    requestedDate: draft.requestedDateIso ? new Date(`${draft.requestedDateIso}T12:00:00`) : null,
    requestedTimeLabel: draft.requestedTimeLabel,
  }

  if (nameResolution.action === 'customer_reference') {
    const responseText = withLeadIn(
      buildCustomerReferenceMessage(
        nameResolution.customerMatches[0],
        professionals.map((professional) => ({ id: professional.id, name: professional.name }))
      ),
      responseLeadIn
    )

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        selectedProfessionalId: null,
        selectedProfessionalName: null,
        allowAnyProfessional: false,
        state: 'WAITING_PROFESSIONAL',
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: 'collect_professional',
      conversationId: conversation.id,
      conversationState: 'WAITING_PROFESSIONAL',
      usedAI,
    }
  }

  if (nameResolution.action === 'ambiguous' && nameResolution.receivedName) {
    const responseText = withLeadIn(
      buildAmbiguousNameMessage(
        nameResolution.receivedName,
        nameResolution.professionalMatches
      ),
      responseLeadIn
    )

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        selectedProfessionalId: null,
        selectedProfessionalName: null,
        allowAnyProfessional: false,
        state: 'WAITING_PROFESSIONAL',
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: 'collect_professional',
      conversationId: conversation.id,
      conversationState: 'WAITING_PROFESSIONAL',
      usedAI,
    }
  }

  if (nameResolution.action === 'not_found' && nameResolution.receivedName) {
    const responseText = withLeadIn(
      buildProfessionalNotFoundMessage(
        nameResolution.receivedName,
        professionals.map((professional) => ({ id: professional.id, name: professional.name }))
      ),
      responseLeadIn
    )

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        selectedProfessionalId: null,
        selectedProfessionalName: null,
        allowAnyProfessional: false,
        state: 'WAITING_PROFESSIONAL',
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: 'collect_professional',
      conversationId: conversation.id,
      conversationState: 'WAITING_PROFESSIONAL',
      usedAI,
    }
  }

  if (!draft.selectedServiceId || !draft.selectedServiceName) {
    const responseText = withLeadIn(buildServiceQuestion(services.map((service) => service.name)), responseLeadIn)

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: 'WAITING_SERVICE',
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: 'collect_service',
      conversationId: conversation.id,
      conversationState: 'WAITING_SERVICE',
      usedAI,
    }
  }

  if (!draft.allowAnyProfessional && !draft.selectedProfessionalId) {
    const responseText = professionals.length === 1
      ? withLeadIn(`Perfeito. Vou buscar com ${professionals[0].name}. ${buildPeriodQuestion()}`, responseLeadIn)
      : withLeadIn(buildProfessionalQuestion(professionals.map((professional) => professional.name)), responseLeadIn)

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: professionals.length === 1 ? 'WAITING_TIME' : 'WAITING_PROFESSIONAL',
        selectedProfessionalId: professionals.length === 1 ? professionals[0].id : null,
        selectedProfessionalName: professionals.length === 1 ? professionals[0].name : null,
        allowAnyProfessional: draft.allowAnyProfessional,
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: professionals.length === 1 ? 'collect_period' : 'collect_professional',
      conversationId: conversation.id,
      conversationState: professionals.length === 1 ? 'WAITING_TIME' : 'WAITING_PROFESSIONAL',
      usedAI,
    }
  }

  if (!hasResolvedTimePreference(draft.requestedTimeLabel)) {
    const responseText = withLeadIn(buildPeriodQuestion(), responseLeadIn)

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: 'WAITING_TIME',
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: 'collect_period',
      conversationId: conversation.id,
      conversationState: 'WAITING_TIME',
      usedAI,
    }
  }

  if (effectiveState === 'WAITING_CONFIRMATION' && interpreted.intent === 'DECLINE') {
    const responseText = withLeadIn(buildRescheduleMessage(), responseLeadIn)

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: 'WAITING_TIME',
        selectedSlot: JSON_NULL,
        slotOptions: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: 'reschedule',
      conversationId: conversation.id,
      conversationState: 'WAITING_TIME',
      usedAI,
    }
  }

  if (!draft.requestedDateIso) {
    const responseText = withLeadIn(buildDateQuestion(), responseLeadIn)

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: 'WAITING_DATE',
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: 'collect_date',
      conversationId: conversation.id,
      conversationState: 'WAITING_DATE',
      usedAI,
    }
  }

  const selectedOfferedSlot = pickOfferedSlot({
    offeredSlots: draft.offeredSlots,
    selectedOptionNumber: interpreted.selectedOptionNumber,
    exactTime: interpreted.exactTime,
    message: inboundText,
  })

  let slotForConfirmation: ConversationSlot | null = null

  if (selectedOfferedSlot) {
    slotForConfirmation = await findExactAvailableWhatsAppSlot({
      barbershopId: input.barbershop.id,
      serviceId: draft.selectedServiceId,
      professionalId: selectedOfferedSlot.professionalId,
      dateIso: selectedOfferedSlot.dateIso,
      timeLabel: selectedOfferedSlot.timeLabel,
      timezone,
    })
  }

  if (!slotForConfirmation && interpreted.exactTime && draft.selectedProfessionalId) {
    slotForConfirmation = await findExactAvailableWhatsAppSlot({
      barbershopId: input.barbershop.id,
      serviceId: draft.selectedServiceId,
      professionalId: draft.selectedProfessionalId,
      dateIso: draft.requestedDateIso,
      timeLabel: interpreted.exactTime,
      timezone,
    })
  }

  if (!slotForConfirmation && effectiveState === 'WAITING_CONFIRMATION' && draft.selectedStoredSlot) {
    slotForConfirmation = await findExactAvailableWhatsAppSlot({
      barbershopId: input.barbershop.id,
      serviceId: draft.selectedServiceId,
      professionalId: draft.selectedStoredSlot.professionalId,
      dateIso: draft.selectedStoredSlot.dateIso,
      timeLabel: draft.selectedStoredSlot.timeLabel,
      timezone,
    })
  }

  if (!slotForConfirmation) {
    return offerFreshSlots({
      conversationId: conversation.id,
      customerId: input.customer.id,
      conversationStep: effectiveState,
      baseUpdate,
      barbershopId: input.barbershop.id,
      timezone,
      requestedDateIso: draft.requestedDateIso,
      serviceId: draft.selectedServiceId,
      serviceName: draft.selectedServiceName,
      professionalId: draft.allowAnyProfessional ? null : draft.selectedProfessionalId,
      professionalName: draft.allowAnyProfessional ? null : draft.selectedProfessionalName,
      timePreference: interpreted.timePreference !== 'NONE' ? interpreted.timePreference : draft.requestedTimeLabel,
      exactTime: interpreted.exactTime ?? (draft.requestedTimeLabel?.includes(':') ? draft.requestedTimeLabel : null),
      usedAI,
      responseLeadIn,
    })
  }

  if (effectiveState !== 'WAITING_CONFIRMATION' || interpreted.intent !== 'CONFIRM') {
    const responseText = withLeadIn(
      buildConfirmationMessage(slotForConfirmation, draft.selectedServiceName, timezone),
      responseLeadIn
    )

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: 'WAITING_CONFIRMATION',
        selectedProfessionalId: slotForConfirmation.professionalId,
        selectedProfessionalName: slotForConfirmation.professionalName,
        allowAnyProfessional: false,
        slotOptions: JSON_NULL,
        selectedSlot: buildJsonValue(slotForConfirmation),
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: 'await_confirmation',
      conversationId: conversation.id,
      conversationState: 'WAITING_CONFIRMATION',
      usedAI,
    }
  }

  try {
    const appointment = await createAppointmentFromWhatsApp({
      barbershopId: input.barbershop.id,
      customerId: input.customer.id,
      serviceId: draft.selectedServiceId,
      professionalId: slotForConfirmation.professionalId,
      startAtIso: slotForConfirmation.startAtIso,
      sourceReference: `whatsapp:${conversation.id}:${input.eventId}`,
      notes: 'Agendamento criado via fluxo conversacional do WhatsApp.',
    })

    const responseText = buildSuccessMessage(slotForConfirmation, draft.selectedServiceName, timezone)

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        state: 'IDLE',
        selectedServiceId: null,
        selectedServiceName: null,
        selectedProfessionalId: null,
        selectedProfessionalName: null,
        allowAnyProfessional: false,
        requestedDate: null,
        requestedTimeLabel: null,
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        conversationSummary: null,
        bookingDraft: JSON_NULL,
        recentCorrections: JSON_NULL,
        lastInboundText: inboundText,
        lastIntent: buildJsonValue(interpreted),
        lastAssistantText: responseText,
        completedAt: new Date(),
      },
    })

    return {
      responseText,
      flow: 'appointment_created',
      conversationId: conversation.id,
      conversationState: 'IDLE',
      appointmentId: appointment.id,
      usedAI,
    }
  } catch (error) {
    console.warn('[whatsapp-conversation] appointment creation aborted', {
      error: error instanceof Error ? error.message : 'unknown_error',
      serviceId: draft.selectedServiceId,
      professionalId: slotForConfirmation.professionalId,
      startAtIso: slotForConfirmation.startAtIso,
    })

    return offerFreshSlots({
      conversationId: conversation.id,
      customerId: input.customer.id,
      conversationStep: effectiveState,
      baseUpdate,
      barbershopId: input.barbershop.id,
      timezone,
      requestedDateIso: draft.requestedDateIso,
      serviceId: draft.selectedServiceId,
      serviceName: draft.selectedServiceName,
      professionalId: draft.allowAnyProfessional ? null : draft.selectedProfessionalId,
      professionalName: draft.allowAnyProfessional ? null : draft.selectedProfessionalName,
      timePreference: draft.requestedTimeLabel,
      exactTime: draft.requestedTimeLabel?.includes(':') ? draft.requestedTimeLabel : null,
      usedAI,
      responseLeadIn: 'Esse horario nao estava mais livre no momento de confirmar. Vou te mostrar opcoes atualizadas.',
    })
  }
}
