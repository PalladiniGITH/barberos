import 'server-only'

import { MessagingProvider, Prisma } from '@prisma/client'
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
  buildDateAnchorUtc,
  getAvailableBusinessPeriodsForDate,
  getCurrentBusinessPeriod,
  getCurrentDateTimeInTimezone,
  getTodayIsoInTimezone,
  resolveBusinessTimezone,
} from '@/lib/timezone'
import { resolveCustomerPreferredProfessional } from '@/lib/customers/preferred-professional'

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
  rawMessages?: string[]
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

interface RecentConversationMessage {
  direction: 'INBOUND' | 'OUTBOUND'
  text: string
  createdAt: string
}

interface RecentConfirmedBookingMemory {
  serviceName: string
  professionalName: string
  dateIso: string
  timeLabel: string
}

const JSON_NULL = Prisma.JsonNull
const CONVERSATION_CONTEXT_TTL_MS = 45 * 60_000
const RECENT_COMPLETED_BOOKING_CONTEXT_MS = 20 * 60_000
const RECENT_MESSAGE_CONTEXT_LIMIT = 8
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

function shouldResetConversationOnGreeting(input: {
  shortGreeting: boolean
  contextReliable: boolean
  restartConversation: boolean
}) {
  return input.restartConversation || (input.shortGreeting && !input.contextReliable)
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
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
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

function buildRecentConfirmedBookingSummary(
  slot: ConversationSlot,
  serviceName: string | null,
  timezone: string
) {
  return `Agendamento confirmado: ${formatDayLabel(slot.dateIso, timezone).toLowerCase()} as ${slot.timeLabel} com ${slot.professionalName} para ${serviceName ?? 'o servico solicitado'}.`
}

function buildRecentConfirmedGreeting(
  booking: RecentConfirmedBookingMemory,
  timezone: string
) {
  return `Oi! Seu horario ja ficou marcado para ${formatDayLabel(booking.dateIso, timezone).toLowerCase()} as ${booking.timeLabel} com ${booking.professionalName} para ${booking.serviceName}. Precisa de mais alguma coisa?`
}

function buildServiceQuestion(serviceNames: string[]) {
  const preview = serviceNames.slice(0, 6).join(', ')
  return `Perfeito. Voce quer corte, barba ou outro servico? ${preview ? `Hoje temos: ${preview}.` : ''}`.trim()
}

function buildProfessionalQuestion(
  professionalNames: string[],
  preferredProfessionalName?: string | null
) {
  if (preferredProfessionalName) {
    return `Quer marcar com ${preferredProfessionalName} de novo ou prefere outro barbeiro?`
  }

  return `Tem preferencia de barbeiro? Posso buscar com ${professionalNames.slice(0, 6).join(', ')}. Se preferir, tambem posso ver com qualquer um.`
}

function referencesPreferredProfessional(message: string) {
  const normalized = normalizeText(message)
  return /\b(meu barbeiro|o de sempre|de sempre|mesmo de sempre|meu de sempre|manter com o meu barbeiro|com o mesmo)\b/.test(normalized)
}

function buildDateQuestion() {
  return 'Qual dia voce prefere? Pode me falar algo como hoje, amanha, sexta ou uma data.'
}

function buildPeriodQuestion(input?: {
  requestedDateIso?: string | null
  nowContext?: {
    dateIso: string
    hour: number
    minute: number
  }
}) {
  if (!input?.requestedDateIso || !input.nowContext) {
    return 'Perfeito. Voce prefere de manha, a tarde ou a noite?'
  }

  const availablePeriods = getAvailableBusinessPeriodsForDate({
    selectedDateIso: input.requestedDateIso,
    nowContext: input.nowContext,
  })

  if (availablePeriods.length === 0) {
    return 'Hoje ja passou do horario de atendimento. Quer que eu veja para amanha ou outro dia?'
  }

  if (availablePeriods.length === 1) {
    return availablePeriods[0] === 'EVENING'
      ? 'Perfeito. Para esse dia eu consigo te atender na noite. Quer que eu te mostre os horarios?'
      : availablePeriods[0] === 'AFTERNOON'
        ? 'Perfeito. Para esse dia eu consigo te atender na tarde. Quer que eu te mostre os horarios?'
        : 'Perfeito. Para esse dia eu consigo te atender na manha. Quer que eu te mostre os horarios?'
  }

  if (getCurrentBusinessPeriod(input.nowContext) !== 'MORNING' && availablePeriods.length === 2) {
    return 'Perfeito. Voce prefere tarde ou noite?'
  }

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
  const uniqueSlots = slots.filter((slot, index, collection) =>
    collection.findIndex((candidate) =>
      candidate.dateIso === slot.dateIso
      && candidate.timeLabel === slot.timeLabel
      && candidate.professionalId === slot.professionalId
    ) === index
  )

  const sameDay = uniqueSlots.every((slot) => slot.dateIso === uniqueSlots[0]?.dateIso)
  const sameProfessional = uniqueSlots.every((slot) => slot.professionalId === uniqueSlots[0]?.professionalId)
  const periodLabel = describeHumanPeriodLabel(timePreference)

  let header = `Encontrei estes horarios disponiveis para ${serviceName}:`
  if (sameDay && sameProfessional) {
    header = periodLabel
      ? `${formatDayLabel(uniqueSlots[0].dateIso, timezone)} ${periodLabel} com ${uniqueSlots[0].professionalName} eu tenho estes horarios livres para ${serviceName}:`
      : `${formatDayLabel(uniqueSlots[0].dateIso, timezone)} com ${uniqueSlots[0].professionalName} eu tenho estes horarios livres para ${serviceName}:`
  } else if (sameDay) {
    header = periodLabel
      ? `${formatDayLabel(uniqueSlots[0].dateIso, timezone)} ${periodLabel} encontrei estes horarios disponiveis para ${serviceName}:`
      : `${formatDayLabel(uniqueSlots[0].dateIso, timezone)} encontrei estes horarios disponiveis para ${serviceName}:`
  }

  const lines = uniqueSlots.map((slot) => {
    if (sameDay && sameProfessional) {
      return `- ${slot.timeLabel}`
    }

    if (sameDay) {
      return `- ${slot.timeLabel} com ${slot.professionalName}`
    }

    return `- ${formatDayLabel(slot.dateIso, timezone)} as ${slot.timeLabel} com ${slot.professionalName}`
  }).filter(Boolean)

  return [header, lines.join('\n'), 'Pode me dizer qual prefere ou pedir outro horario.']
    .filter((line) => line.trim().length > 0)
    .join('\n\n')
}

function buildConfirmationMessage(slot: ConversationSlot, serviceName: string, timezone: string) {
  return `Posso confirmar ${serviceName} para ${formatDayLabel(slot.dateIso, timezone).toLowerCase()} as ${slot.timeLabel} com ${slot.professionalName}?`
}

function buildSuccessMessage(slot: ConversationSlot, serviceName: string, timezone: string) {
  return `Perfeito, ficou marcado.\n\nSeu horario esta confirmado para ${formatDayLabel(slot.dateIso, timezone).toLowerCase()} as ${slot.timeLabel} com ${slot.professionalName} para ${serviceName}.\n\nSe quiser remarcar ou cancelar depois, e so me chamar aqui.`
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
  nowContext: {
    dateIso: string
    hour: number
    minute: number
  }
  draft: ConversationDraft
  professionals: NameMatch[]
  preferredProfessionalName?: string | null
}) {
  if (input.state === 'WAITING_SERVICE') {
    return `Oi! Posso continuar por aqui. ${buildServiceQuestion([])}`
  }

  if (input.state === 'WAITING_PROFESSIONAL') {
    return `Oi! Posso continuar por aqui. ${buildProfessionalQuestion(
      input.professionals.map((professional) => professional.name),
      input.preferredProfessionalName
    )}`
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

  return `Oi! Posso continuar por aqui. ${buildPeriodQuestion({
    requestedDateIso: input.draft.requestedDateIso,
    nowContext: input.nowContext,
  })}`
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

function parseRecentConfirmedBookingMemory(raw: Prisma.JsonValue | null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const candidate = raw as Record<string, unknown>
  const recentBooking =
    candidate.recentBooking && typeof candidate.recentBooking === 'object' && !Array.isArray(candidate.recentBooking)
      ? candidate.recentBooking as Record<string, unknown>
      : null

  if (
    !recentBooking
    || typeof recentBooking.serviceName !== 'string'
    || typeof recentBooking.professionalName !== 'string'
    || typeof recentBooking.dateIso !== 'string'
    || typeof recentBooking.timeLabel !== 'string'
  ) {
    return null
  }

  return {
    serviceName: recentBooking.serviceName,
    professionalName: recentBooking.professionalName,
    dateIso: recentBooking.dateIso,
    timeLabel: recentBooking.timeLabel,
  } satisfies RecentConfirmedBookingMemory
}

function hasRecentCompletedBookingContext(input: {
  state: ConversationState
  completedAt?: Date | null
  recentBooking: RecentConfirmedBookingMemory | null
}) {
  if (input.state !== 'IDLE' || !input.completedAt || !input.recentBooking) {
    return false
  }

  return Date.now() - input.completedAt.getTime() <= RECENT_COMPLETED_BOOKING_CONTEXT_MS
}

async function loadRecentConversationMessages(input: {
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
    take: RECENT_MESSAGE_CONTEXT_LIMIT,
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
      text: event.direction === 'OUTBOUND'
        ? (event.responseText ?? event.bodyText ?? '')
        : (event.bodyText ?? ''),
      createdAt: event.createdAt.toISOString(),
    }))
    .filter((event): event is RecentConversationMessage => event.text.trim().length > 0)
    .reverse()
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
    leadTimeMinutes: availability.diagnostics.leadTimeMinutes,
    firstEligibleSlotTime: availability.diagnostics.firstEligibleSlotTime,
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
  const recentMessages = await loadRecentConversationMessages({
    barbershopId: input.barbershop.id,
    customerId: input.customer.id,
  })
  const recentConfirmedBooking = parseRecentConfirmedBookingMemory(conversation.lastIntent)
  const preferredProfessional = await resolveCustomerPreferredProfessional({
    barbershopId: input.barbershop.id,
    customerId: input.customer.id,
  })

  console.info('[whatsapp-conversation] preferred professional', {
    customerId: input.customer.id,
    preferredProfessionalId: preferredProfessional.professionalId,
    preferredProfessionalName: preferredProfessional.professionalName,
    reason: preferredProfessional.reason,
    completedAppointmentsCount: preferredProfessional.completedAppointmentsCount,
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
  const contextReliable = isConversationContextReliable({
    state: currentState,
    updatedAt: conversation.updatedAt,
    draft: conversationDraft,
  })
  const effectiveState = contextReliable ? currentState : 'IDLE'
  const draftForInterpreter = contextReliable ? conversationDraft : buildEmptyConversationDraft()
  const hasRecentConfirmedBooking = hasRecentCompletedBookingContext({
    state: effectiveState,
    completedAt: conversation.completedAt,
    recentBooking: recentConfirmedBooking,
  })

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

  const agentResult = await processWhatsAppConversationWithAgent({
    barbershop: input.barbershop,
    customer: {
      ...input.customer,
      preferredProfessionalId: preferredProfessional.professionalId,
      preferredProfessionalName: preferredProfessional.professionalName,
    },
    inboundText,
    rawMessages: input.rawMessages,
    conversation: {
      id: conversation.id,
      state: effectiveState,
      updatedAt: contextReliable ? conversation.updatedAt : new Date(),
      selectedServiceId: draftForInterpreter.selectedServiceId,
      selectedServiceName: draftForInterpreter.selectedServiceName,
      selectedProfessionalId: draftForInterpreter.selectedProfessionalId,
      selectedProfessionalName: draftForInterpreter.selectedProfessionalName,
      allowAnyProfessional: draftForInterpreter.allowAnyProfessional,
      requestedDate: draftForInterpreter.requestedDateIso
        ? buildDateAnchorUtc(draftForInterpreter.requestedDateIso)
        : null,
      requestedTimeLabel: draftForInterpreter.requestedTimeLabel,
      slotOptions: draftForInterpreter.offeredSlots.length
        ? (buildJsonValue(draftForInterpreter.offeredSlots) as Prisma.JsonValue)
        : null,
      selectedSlot: draftForInterpreter.selectedStoredSlot
        ? (buildJsonValue(draftForInterpreter.selectedStoredSlot) as Prisma.JsonValue)
        : null,
      conversationSummary: contextReliable ? conversation.conversationSummary ?? null : null,
      bookingDraft: contextReliable ? conversation.bookingDraft : null,
      recentCorrections: contextReliable ? conversation.recentCorrections : null,
      lastInboundText: contextReliable ? conversation.lastInboundText ?? null : null,
      lastAssistantText: contextReliable ? conversation.lastAssistantText ?? null : null,
    },
    services,
    professionals,
    nowContext,
  })

  if (agentResult) {
    const shouldResetPersistedContext =
      agentResult.structured.nextAction === 'RESET_CONTEXT'
      || agentResult.structured.nextAction === 'GREET'

    if (agentResult.conversationState === 'WAITING_CONFIRMATION') {
      console.info('[whatsapp-conversation] confirmation state transition', {
        mode: 'agent',
        conversationId: conversation.id,
        stateBefore: effectiveState,
        stateAfter: agentResult.conversationState,
        inboundText,
        selectedServiceId: agentResult.memory.selectedServiceId,
        requestedDateIso: agentResult.memory.requestedDateIso,
        requestedTimeLabel: agentResult.memory.requestedTimeLabel,
        selectedSlot: agentResult.memory.selectedSlot,
      })
    }

    if (agentResult.shouldCreateAppointment && agentResult.memory.selectedSlot && agentResult.memory.selectedServiceId) {
      console.info('[whatsapp-conversation] confirmation received', {
        mode: 'agent',
        conversationId: conversation.id,
        stateBefore: effectiveState,
        inboundText,
        selectedSlot: agentResult.memory.selectedSlot,
        selectedServiceId: agentResult.memory.selectedServiceId,
      })

      try {
        const appointment = await createAppointmentFromWhatsApp({
          barbershopId: input.barbershop.id,
          customerId: input.customer.id,
          serviceId: agentResult.memory.selectedServiceId,
          professionalId: agentResult.memory.selectedSlot.professionalId,
          startAtIso: agentResult.memory.selectedSlot.startAtIso,
          dateIso: agentResult.memory.selectedSlot.dateIso,
          timeLabel: agentResult.memory.selectedSlot.timeLabel,
          timezone,
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
            conversationSummary: buildRecentConfirmedBookingSummary(
              agentResult.memory.selectedSlot,
              agentResult.memory.selectedServiceName,
              timezone
            ),
            bookingDraft: JSON_NULL,
            recentCorrections: agentResult.memory.recentCorrections.length
              ? buildJsonValue(agentResult.memory.recentCorrections)
              : JSON_NULL,
            lastInboundText: inboundText,
            lastIntent: buildJsonValue({
              source: 'agent',
              structured: agentResult.structured,
              toolTrace: agentResult.toolTrace,
              recentBooking: {
                serviceName: agentResult.memory.selectedServiceName,
                professionalName: agentResult.memory.selectedSlot.professionalName,
                dateIso: agentResult.memory.selectedSlot.dateIso,
                timeLabel: agentResult.memory.selectedSlot.timeLabel,
              },
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
        const errorMessage = error instanceof Error ? error.message : 'unknown_error'

        console.warn('[whatsapp-conversation] agent booking failed', {
          error: errorMessage,
          conversationId: conversation.id,
        })

        const responseText =
          'Tive um problema para concluir esse agendamento no sistema agora e nao vou te confirmar antes de salvar de verdade. Se quiser, eu posso buscar esse horario de novo para voce.'

        await prisma.whatsappConversation.update({
          where: { id: conversation.id },
          data: {
            state: 'WAITING_CONFIRMATION',
            selectedServiceId: agentResult.memory.selectedServiceId,
            selectedServiceName: agentResult.memory.selectedServiceName,
            selectedProfessionalId: agentResult.memory.selectedProfessionalId,
            selectedProfessionalName: agentResult.memory.selectedProfessionalName,
            allowAnyProfessional: agentResult.memory.allowAnyProfessional,
            requestedDate: agentResult.memory.requestedDateIso
              ? buildDateAnchorUtc(agentResult.memory.requestedDateIso)
              : null,
            requestedTimeLabel: agentResult.memory.requestedTimeLabel,
            slotOptions: agentResult.memory.offeredSlots.length
              ? buildJsonValue(agentResult.memory.offeredSlots)
              : JSON_NULL,
            selectedSlot: agentResult.memory.selectedSlot
              ? buildJsonValue(agentResult.memory.selectedSlot)
              : JSON_NULL,
            conversationSummary: agentResult.memory.conversationSummary,
            bookingDraft: buildJsonValue({
              selectedServiceId: agentResult.memory.selectedServiceId,
              selectedServiceName: agentResult.memory.selectedServiceName,
              selectedProfessionalId: agentResult.memory.selectedProfessionalId,
              selectedProfessionalName: agentResult.memory.selectedProfessionalName,
              allowAnyProfessional: agentResult.memory.allowAnyProfessional,
              requestedDateIso: agentResult.memory.requestedDateIso,
              requestedTimeLabel: agentResult.memory.requestedTimeLabel,
              selectedSlot: agentResult.memory.selectedSlot,
            }),
            recentCorrections: agentResult.memory.recentCorrections.length
              ? buildJsonValue(agentResult.memory.recentCorrections)
              : JSON_NULL,
            lastInboundText: inboundText,
            lastIntent: buildJsonValue({
              source: 'agent',
              structured: agentResult.structured,
              toolTrace: agentResult.toolTrace,
              bookingFailure: errorMessage,
            }),
            lastAssistantText: responseText,
          },
        })

        return {
          responseText,
          flow: 'await_confirmation',
          conversationId: conversation.id,
          conversationState: 'WAITING_CONFIRMATION',
          usedAI: true,
        }
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
            ? buildDateAnchorUtc(agentResult.memory.requestedDateIso)
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

  console.info('[whatsapp-conversation] recent memory context', {
    customerId: input.customer.id,
    recentMessagesUsed: recentMessages.length,
    recentMessages: recentMessages.map((message) => `${message.direction}:${message.text}`),
    hadRecentConfirmedBooking: hasRecentConfirmedBooking,
    responseStrategy: shortGreeting && !contextReliable && hasRecentConfirmedBooking
      ? 'contextual_recent_booking_greeting'
      : 'default_flow',
  })

  if (shortGreeting && !contextReliable && hasRecentConfirmedBooking && recentConfirmedBooking) {
    const responseText = buildRecentConfirmedGreeting(recentConfirmedBooking, timezone)

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
      flow: 'greeting',
      conversationId: conversation.id,
      conversationState: 'IDLE',
      usedAI,
    }
  }

  if (shouldResetConversationOnGreeting({
    shortGreeting,
    contextReliable,
    restartConversation: interpreted.restartConversation,
  })) {
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
      nowContext,
      draft: draftForInterpreter,
      professionals: professionals.map((professional) => ({ id: professional.id, name: professional.name })),
      preferredProfessionalName: preferredProfessional.professionalName,
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
  const acceptedPreferredProfessional =
    Boolean(
      preferredProfessional.professionalId
      && preferredProfessional.professionalName
      && !baselineDraft.selectedProfessionalId
      && !baselineDraft.allowAnyProfessional
      && (
        referencesPreferredProfessional(inboundText)
        || (
          effectiveState === 'WAITING_PROFESSIONAL'
          && Boolean(conversation.lastAssistantText?.includes(preferredProfessional.professionalName ?? ''))
          && interpreted.intent === 'CONFIRM'
        )
      )
    )

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

  if (
    acceptedPreferredProfessional
    && preferredProfessional.professionalId
    && preferredProfessional.professionalName
  ) {
    draft.selectedProfessionalId = preferredProfessional.professionalId
    draft.selectedProfessionalName = preferredProfessional.professionalName
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

  const availablePeriodsForDraft = getAvailableBusinessPeriodsForDate({
    selectedDateIso: draft.requestedDateIso,
    nowContext,
  })

  if (
    draft.requestedDateIso
    && !draft.requestedTimeLabel
    && availablePeriodsForDraft.length === 1
  ) {
    draft.requestedTimeLabel = availablePeriodsForDraft[0]
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
    requestedDate: draft.requestedDateIso ? buildDateAnchorUtc(draft.requestedDateIso) : null,
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
      ? withLeadIn(
          `Perfeito. Vou buscar com ${professionals[0].name}. ${buildPeriodQuestion({
            requestedDateIso: draft.requestedDateIso,
            nowContext,
          })}`,
          responseLeadIn
        )
      : withLeadIn(
          buildProfessionalQuestion(
            professionals.map((professional) => professional.name),
            preferredProfessional.professionalName
          ),
          responseLeadIn
        )

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
    const responseText = withLeadIn(buildPeriodQuestion({
      requestedDateIso: draft.requestedDateIso,
      nowContext,
    }), responseLeadIn)

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

    console.info('[whatsapp-conversation] confirmation state transition', {
      mode: 'legacy',
      conversationId: conversation.id,
      stateBefore: effectiveState,
      stateAfter: 'WAITING_CONFIRMATION',
      inboundText,
      selectedServiceId: draft.selectedServiceId,
      requestedDateIso: draft.requestedDateIso,
      requestedTimeLabel: draft.requestedTimeLabel,
      selectedSlot: slotForConfirmation,
    })

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
    console.info('[whatsapp-conversation] confirmation received', {
      mode: 'legacy',
      conversationId: conversation.id,
      stateBefore: effectiveState,
      inboundText,
      selectedSlot: slotForConfirmation,
      selectedServiceId: draft.selectedServiceId,
    })

    const appointment = await createAppointmentFromWhatsApp({
      barbershopId: input.barbershop.id,
      customerId: input.customer.id,
      serviceId: draft.selectedServiceId,
      professionalId: slotForConfirmation.professionalId,
      startAtIso: slotForConfirmation.startAtIso,
      dateIso: slotForConfirmation.dateIso,
      timeLabel: slotForConfirmation.timeLabel,
      timezone,
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
        conversationSummary: buildRecentConfirmedBookingSummary(
          slotForConfirmation,
          draft.selectedServiceName,
          timezone
        ),
        bookingDraft: JSON_NULL,
        recentCorrections: JSON_NULL,
        lastInboundText: inboundText,
        lastIntent: buildJsonValue({
          ...interpreted,
          recentBooking: {
            serviceName: draft.selectedServiceName,
            professionalName: slotForConfirmation.professionalName,
            dateIso: slotForConfirmation.dateIso,
            timeLabel: slotForConfirmation.timeLabel,
          },
        }),
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

export const __testing = {
  buildEmptyConversationDraft,
  buildRecentConfirmedGreeting,
  buildProfessionalQuestion,
  buildHumanSlotOfferMessage,
  hasRecentCompletedBookingContext,
  isConversationContextReliable,
  isShortGreetingMessage,
  referencesPreferredProfessional,
  shouldResetConversationOnGreeting,
}
