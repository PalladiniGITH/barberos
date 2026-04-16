import 'server-only'

import { MessagingProvider, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  detectRelativeDateExpression,
  detectAcknowledgementMessage,
  detectExistingBookingQuestion,
  extractExplicitTimeFromMessage,
  interpretWhatsAppMessage,
} from '@/lib/ai/openai-whatsapp-interpreter'
import { processWhatsAppConversationWithAgent } from '@/lib/ai/openai-whatsapp-agent'
import {
  createAppointmentFromWhatsApp,
  findExactAvailableWhatsAppSlot,
  getAvailableWhatsAppSlots,
  loadBarbershopSchedulingOptions,
  type WhatsAppBookingSlot,
} from '@/lib/agendamentos/whatsapp-booking'
import { AvailabilityInfrastructureError } from '@/lib/agendamentos/availability'
import {
  buildExistingCustomerBookingResponse,
  getExistingCustomerBookings,
  type ExistingCustomerBookingQueryScope,
  type ExistingCustomerBookingItem,
} from '@/lib/agendamentos/customer-booking-status'
import {
  buildDateAnchorUtc,
  formatDayLabelFromIsoDate,
  getAvailableBusinessPeriodsForDate,
  getCurrentDateTimeInTimezone,
  getTodayIsoInTimezone,
  nextWeekdayIsoDate,
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
    | 'acknowledgement'
    | 'booking_status'
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

interface ExistingBookingQuery {
  scope: ExistingCustomerBookingQueryScope
  requestedDateIso: string | null
  referenceDateIso: string | null
}

interface PreviousBookingStatusQueryMemory {
  scope: ExistingCustomerBookingQueryScope
  requestedDateIso: string | null
  referenceDateIso: string | null
}

interface ContextualProfessionalPreference {
  professionalId: string
  professionalName: string
  source: 'recent_booking' | 'preferred_history'
}

const JSON_NULL = Prisma.JsonNull
const CONVERSATION_CONTEXT_TTL_MS = 45 * 60_000
const RECENT_COMPLETED_BOOKING_CONTEXT_MS = 20 * 60_000
const RECENT_MESSAGE_CONTEXT_LIMIT = 8
const SHORT_GREETING_PATTERN = /^(oi+|ola+|ol[aá]|bom dia|boa tarde|boa noite)[!.,\s]*$/

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  'segunda-feira': 1,
  terca: 2,
  'terca-feira': 2,
  quarta: 3,
  'quarta-feira': 3,
  quinta: 4,
  'quinta-feira': 4,
  sexta: 5,
  'sexta-feira': 5,
  sabado: 6,
}

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

function isAffirmativeConfirmationMessage(message: string) {
  return /\b(sim|s|ss|isso|isso mesmo|pode|pode sim|pode confirmar|pode marcar|pode agendar|confirmo|confirmar|quero|desejo|fechado|ok|blz|beleza|certo|correto|bora|uhum|aham|isso ai|ta)\b/.test(
    normalizeText(message)
  )
}

function hasExplicitConfirmationCorrectionCue(message: string) {
  const normalized = normalizeText(message)

  return Boolean(
    extractExplicitTimeFromMessage(message)
    || /\b(hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|\d{1,2}[\/-]\d{1,2})\b/.test(normalized)
    || /\bcom(?:\s+o|\s+a)?\s+[a-zà-ÿ]{3,}\b/.test(normalized)
  )
}

function shouldTreatAsStoredSlotConfirmation(message: string) {
  return isAffirmativeConfirmationMessage(message) && !hasExplicitConfirmationCorrectionCue(message)
}

function isExactTimeLabel(value: string | null | undefined) {
  return Boolean(value && /^\d{2}:\d{2}$/.test(value))
}

function resolveExactTimeForSlotRevalidation(input: {
  interpretedExactTime: string | null
  requestedTimeLabel: string | null
  professionalChanged: boolean
}) {
  if (input.interpretedExactTime) {
    return input.interpretedExactTime
  }

  if (input.professionalChanged && isExactTimeLabel(input.requestedTimeLabel)) {
    return input.requestedTimeLabel
  }

  return null
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

function hasUsefulConversationProgress(draft: ConversationDraft) {
  return Boolean(
    draft.selectedServiceId
    || draft.selectedProfessionalId
    || draft.allowAnyProfessional
    || draft.requestedDateIso
    || draft.requestedTimeLabel
    || draft.offeredSlots.length > 0
    || draft.selectedStoredSlot
  )
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

function formatDayLabel(dateIso: string, timezone: string) {
  return formatDayLabelFromIsoDate(dateIso, timezone)
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

function shiftDateIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split('-').map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  anchor.setUTCDate(anchor.getUTCDate() + days)
  return formatDateIso(anchor)
}

function parsePreviousBookingStatusQuery(raw: Prisma.JsonValue | null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const candidate = raw as Record<string, unknown>
  if (candidate.source !== 'booking_status_query' || candidate.intent !== 'CHECK_EXISTING_BOOKING') {
    return null
  }

  const scope = candidate.queryScope
  return {
    scope: scope === 'DAY' || scope === 'WEEK' || scope === 'NEXT' ? scope : 'NEXT',
    requestedDateIso: typeof candidate.requestedDateIso === 'string' ? candidate.requestedDateIso : null,
    referenceDateIso: typeof candidate.referenceDateIso === 'string' ? candidate.referenceDateIso : null,
  } satisfies PreviousBookingStatusQueryMemory
}

function getWeekStartIso(dateIso: string) {
  const [year, month, day] = dateIso.split('-').map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const weekday = anchor.getUTCDay()
  const offsetToMonday = weekday === 0 ? -6 : 1 - weekday
  anchor.setUTCDate(anchor.getUTCDate() + offsetToMonday)
  return formatDateIso(anchor)
}

function getWeekdayIsoWithinWeek(referenceDateIso: string, weekdayIndex: number) {
  const weekStartIso = getWeekStartIso(referenceDateIso)

  if (weekdayIndex === 0) {
    return shiftDateIso(weekStartIso, 6)
  }

  return shiftDateIso(weekStartIso, weekdayIndex - 1)
}

function parseRequestedDateFromExistingBookingQuestion(input: {
  message: string
  previousQuery: PreviousBookingStatusQueryMemory | null
  timezone: string
}) {
  const normalized = normalizeText(input.message)
  const todayIso = getTodayIsoInTimezone(input.timezone)
  const referenceDateIso = input.previousQuery?.referenceDateIso ?? todayIso
  const followUpPattern =
    /^(que horas|qual horario|com quem|qual servico|o que ficou marcado|o que eu marquei|me lembra|me confirma)\??$/

  if (normalized.includes('depois de amanha')) {
    return shiftDateIso(todayIso, 2)
  }

  if (normalized.includes('amanha')) {
    return shiftDateIso(todayIso, 1)
  }

  if (normalized.includes('hoje')) {
    return todayIso
  }

  const weekdayName = Object.keys(WEEKDAY_INDEX).find((name) => normalized.includes(name))
  if (weekdayName) {
    const weekdayIndex = WEEKDAY_INDEX[weekdayName]

    if (input.previousQuery?.scope === 'WEEK') {
      return getWeekdayIsoWithinWeek(referenceDateIso, weekdayIndex)
    }

    return nextWeekdayIsoDate(todayIso, weekdayIndex)
  }

  if (followUpPattern.test(normalized) && input.previousQuery?.requestedDateIso) {
    return input.previousQuery.requestedDateIso
  }

  return input.previousQuery?.requestedDateIso ?? null
}

function parseExistingBookingQuery(input: {
  message: string
  previousQuery: PreviousBookingStatusQueryMemory | null
  timezone: string
}) {
  const normalized = normalizeText(input.message)
  const todayIso = getTodayIsoInTimezone(input.timezone)
  const nextWeekReferenceIso = shiftDateIso(getWeekStartIso(todayIso), 7)
  const requestedDateIso = parseRequestedDateFromExistingBookingQuestion(input)

  if (normalized.includes('semana que vem') || normalized.includes('proxima semana')) {
    return {
      scope: 'WEEK',
      requestedDateIso: null,
      referenceDateIso: nextWeekReferenceIso,
    } satisfies ExistingBookingQuery
  }

  if (
    normalized.includes('essa semana')
    || normalized.includes('dessa semana')
    || normalized.includes('meus horarios da semana')
    || normalized.includes('meus horarios dessa semana')
  ) {
    return {
      scope: 'WEEK',
      requestedDateIso: null,
      referenceDateIso: todayIso,
    } satisfies ExistingBookingQuery
  }

  return {
    scope: requestedDateIso ? 'DAY' : 'NEXT',
    requestedDateIso,
    referenceDateIso: input.previousQuery?.referenceDateIso ?? todayIso,
  } satisfies ExistingBookingQuery
}

function isAcknowledgementMessage(message: string) {
  return detectAcknowledgementMessage(message)
}

function buildAcknowledgementResponse(input: {
  recentBooking: RecentConfirmedBookingMemory | null
  timezone: string
  effectiveState: ConversationState
}) {
  if (input.recentBooking) {
    return 'Perfeito! Qualquer coisa e so me chamar 🙂'
  }

  if (input.effectiveState !== 'IDLE') {
    return 'Perfeito! Qualquer coisa e so me chamar 🙂'
  }

  return 'Tudo certo 🙂'
}

function isExistingBookingStatusQuestion(input: {
  message: string
  lastCustomerMessage?: string | null
  lastAssistantMessage?: string | null
}) {
  return detectExistingBookingQuestion({
    message: input.message,
    conversationSummary: {
      selectedServiceName: null,
      selectedProfessionalName: null,
      requestedDateIso: null,
      requestedTimeLabel: null,
      allowAnyProfessional: false,
      lastCustomerMessage: input.lastCustomerMessage ?? null,
      lastAssistantMessage: input.lastAssistantMessage ?? null,
    },
  })
}

function buildBookingStatusFollowUp(draft: ConversationDraft) {
  if (!hasUsefulConversationProgress(draft)) {
    return 'Se quiser, eu tambem posso te ajudar a marcar outro horario por aqui.'
  }

  if (draft.selectedServiceName) {
    return `Se quiser, eu continuo seu novo agendamento de ${draft.selectedServiceName} por aqui tambem.`
  }

  return 'Se quiser, eu continuo seu agendamento por aqui tambem.'
}

function buildExistingBookingStatusMessage(input: {
  queryScope: ExistingCustomerBookingQueryScope
  requestedDateIso: string | null
  bookings: ExistingCustomerBookingItem[]
  timezone: string
  draft: ConversationDraft
  referenceDateIso?: string | null
}) {
  const baseMessage = buildExistingCustomerBookingResponse({
    bookings: input.bookings,
    queryScope: input.queryScope,
    requestedDateIso: input.requestedDateIso,
    timezone: input.timezone,
    hasSchedulingContext: false,
    referenceDateIso: input.referenceDateIso,
  })

  if (!hasUsefulConversationProgress(input.draft)) {
    return baseMessage
  }

  return `${baseMessage}\n\n${buildBookingStatusFollowUp(input.draft)}`
}

async function loadExistingCustomerBookings(input: {
  barbershopId: string
  customerId: string
  timezone: string
  nowDateIso: string
  queryScope: ExistingCustomerBookingQueryScope
  requestedDateIso: string | null
  referenceDateIso: string | null
}) {
  return getExistingCustomerBookings({
    barbershopId: input.barbershopId,
    customerId: input.customerId,
    timezone: input.timezone,
    requestedDateIso: input.requestedDateIso,
    queryScope: input.queryScope,
    referenceDateIso: input.referenceDateIso ?? input.nowDateIso,
    limit: input.queryScope === 'WEEK' ? 6 : 8,
  })
}

async function handleExistingBookingStatusQuery(input: {
  conversationId: string
  customerId: string
  inboundText: string
  effectiveState: ConversationState
  draft: ConversationDraft
  barbershopId: string
  timezone: string
  nowDateIso: string
  previousQuery: PreviousBookingStatusQueryMemory | null
}) {
  const existingBookingQuery = parseExistingBookingQuery({
    message: input.inboundText,
    previousQuery: input.previousQuery,
    timezone: input.timezone,
  })

  const bookings = await loadExistingCustomerBookings({
    barbershopId: input.barbershopId,
    customerId: input.customerId,
    timezone: input.timezone,
    nowDateIso: input.nowDateIso,
    queryScope: existingBookingQuery.scope,
    requestedDateIso: existingBookingQuery.requestedDateIso,
    referenceDateIso: existingBookingQuery.referenceDateIso,
  })

  if (input.effectiveState !== 'IDLE' || hasUsefulConversationProgress(input.draft)) {
    console.info('[whatsapp-conversation] topic switch forced', {
      customerId: input.customerId,
      conversationId: input.conversationId,
      stateBefore: input.effectiveState,
      inboundText: input.inboundText,
      requestedDateIso: input.draft.requestedDateIso,
      selectedServiceId: input.draft.selectedServiceId,
    })
  }

  console.info('[whatsapp-conversation] booking status query', {
    customerId: input.customerId,
    conversationId: input.conversationId,
    inboundText: input.inboundText,
    requestedDateIso: existingBookingQuery.requestedDateIso,
    referenceDateIso: existingBookingQuery.referenceDateIso,
    totalUpcomingBookings: bookings.length,
  })

  console.info('[whatsapp-conversation] booking query source: database', {
    customerId: input.customerId,
    conversationId: input.conversationId,
    queryScope: existingBookingQuery.scope,
    requestedDateIso: existingBookingQuery.requestedDateIso,
    referenceDateIso: existingBookingQuery.referenceDateIso,
  })

  console.info('[whatsapp-conversation] appointments fetched: X', {
    customerId: input.customerId,
    conversationId: input.conversationId,
    appointmentsFetched: bookings.length,
  })

  console.info('[whatsapp-conversation] raw startAt from db', {
    customerId: input.customerId,
    conversationId: input.conversationId,
    rawStartAtValues: bookings.map((booking) => ({
      appointmentId: booking.id,
      startAtUtc: booking.startAtUtc ?? null,
    })),
  })

  console.info('[whatsapp-conversation] datetime local vs utc', {
    customerId: input.customerId,
    conversationId: input.conversationId,
    appointments: bookings.map((booking) => ({
      appointmentId: booking.id,
      datetimePersistedUtc: booking.startAtUtc ?? null,
      dateIsoLocal: booking.dateIso,
      timeLabelLocal: booking.timeLabel,
      professionalName: booking.professionalName,
      serviceName: booking.serviceName,
    })),
  })

  if (existingBookingQuery.scope === 'WEEK') {
    console.info('[whatsapp-conversation] weekly booking query', {
      customerId: input.customerId,
      conversationId: input.conversationId,
      totalUpcomingBookings: bookings.length,
    })
  }

  if (bookings.length > 0) {
    console.info('[whatsapp-conversation] existing booking found', {
      customerId: input.customerId,
      conversationId: input.conversationId,
      bookings: bookings.map((booking) => `${booking.dateIso} ${booking.timeLabel} com ${booking.professionalName} para ${booking.serviceName}`),
    })
  }

  const responseText = buildExistingBookingStatusMessage({
    queryScope: existingBookingQuery.scope,
    requestedDateIso: existingBookingQuery.requestedDateIso,
    referenceDateIso: existingBookingQuery.referenceDateIso,
    bookings,
    timezone: input.timezone,
    draft: input.draft,
  })

  console.info('[whatsapp-conversation] final booking status response', {
    customerId: input.customerId,
    conversationId: input.conversationId,
    responseText,
  })

  await prisma.whatsappConversation.update({
    where: { id: input.conversationId },
    data: {
      lastInboundText: input.inboundText,
      lastIntent: buildJsonValue({
        source: 'booking_status_query',
        intent: 'CHECK_EXISTING_BOOKING',
        queryScope: existingBookingQuery.scope,
        requestedDateIso: existingBookingQuery.requestedDateIso,
        referenceDateIso: existingBookingQuery.referenceDateIso,
        bookings: bookings.slice(0, 3),
      }),
      lastAssistantText: responseText,
    },
  })

  return {
    responseText,
    flow: 'booking_status' as const,
    conversationId: input.conversationId,
    conversationState: input.effectiveState,
    usedAI: false,
  }
}

function buildServiceQuestion(serviceNames: string[]) {
  if (serviceNames.length === 0) {
    return 'Perfeito! Qual servico voce gostaria de agendar?'
  }

  const preview = serviceNames
    .slice(0, 6)
    .map((serviceName) => `- ${serviceName}`)
    .join('\n')

  return `Perfeito! Temos estes servicos disponiveis:\n\n${preview}\n\nQual voce gostaria de agendar?`
}

function buildProfessionalQuestion(
  professionalNames: string[],
  preferredProfessionalName?: string | null
) {
  if (preferredProfessionalName) {
    return `Quer marcar com ${preferredProfessionalName} de novo ou prefere outro barbeiro?`
  }

  return professionalNames.length > 0
    ? 'Voce tem preferencia de barbeiro ou pode ser qualquer um?'
    : 'Tem algum barbeiro de preferencia?'
}

function resolveContextualProfessionalPreference(input: {
  professionals: NameMatch[]
  preferredProfessional: {
    professionalId: string | null
    professionalName: string | null
  }
  recentBooking: RecentConfirmedBookingMemory | null
  hasRecentConfirmedBooking: boolean
}) {
  if (input.hasRecentConfirmedBooking && input.recentBooking?.professionalName) {
    const recentProfessional = input.professionals.find((professional) =>
      normalizeText(professional.name) === normalizeText(input.recentBooking?.professionalName ?? '')
    )

    if (recentProfessional) {
      return {
        professionalId: recentProfessional.id,
        professionalName: recentProfessional.name,
        source: 'recent_booking',
      } satisfies ContextualProfessionalPreference
    }
  }

  if (input.preferredProfessional.professionalId && input.preferredProfessional.professionalName) {
    return {
      professionalId: input.preferredProfessional.professionalId,
      professionalName: input.preferredProfessional.professionalName,
      source: 'preferred_history',
    } satisfies ContextualProfessionalPreference
  }

  return null
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
    return 'Perfeito. Tem algum horario especifico que voce prefere? Se quiser, tambem posso procurar por periodo.'
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
      ? 'Perfeito. Para esse dia eu consigo te atender na noite. Qual horario voce gostaria?'
      : availablePeriods[0] === 'AFTERNOON'
        ? 'Perfeito. Para esse dia eu consigo te atender na tarde. Qual horario voce gostaria?'
        : 'Perfeito. Para esse dia eu consigo te atender na manha. Qual horario voce gostaria?'
  }

  return 'Qual horario voce gostaria? Se preferir, tambem posso procurar por periodo.'
}

function buildSpecificTimeQuestion(input: {
  requestedDateIso: string
  timezone: string
  professionalName?: string | null
}) {
  const dayLabel = formatDayLabel(input.requestedDateIso, input.timezone).toLowerCase()

  if (input.professionalName) {
    return `Perfeito. Para ${dayLabel} com ${input.professionalName}, qual horario voce prefere? Se quiser, tambem posso te passar as opcoes.`
  }

  return `Perfeito. Para ${dayLabel}, qual horario voce prefere? Se quiser, tambem posso te passar as opcoes.`
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
  const periodLabel = describeHumanPeriodLabel(timePreference)

  let header = `Tenho estas opcoes disponiveis para ${serviceName}:`
  if (sameDay && uniqueSlots.every((slot) => slot.professionalId === uniqueSlots[0]?.professionalId)) {
    header = periodLabel
      ? `Para ${formatDayLabel(uniqueSlots[0].dateIso, timezone).toLowerCase()} ${periodLabel} com ${uniqueSlots[0].professionalName}, tenho estas opcoes para ${serviceName}:`
      : `Para ${formatDayLabel(uniqueSlots[0].dateIso, timezone).toLowerCase()} com ${uniqueSlots[0].professionalName}, tenho estas opcoes para ${serviceName}:`
  } else if (sameDay) {
    header = periodLabel
      ? `Para ${formatDayLabel(uniqueSlots[0].dateIso, timezone).toLowerCase()} ${periodLabel}, encontrei estas opcoes para ${serviceName}:`
      : `Para ${formatDayLabel(uniqueSlots[0].dateIso, timezone).toLowerCase()}, encontrei estas opcoes para ${serviceName}:`
  }

  const lines = uniqueSlots.map((slot) => {
    if (sameDay) {
      return `• ${slot.timeLabel} com ${slot.professionalName}`
    }

    return `• ${formatDayLabel(slot.dateIso, timezone)} - ${slot.timeLabel} com ${slot.professionalName}`
  }).filter(Boolean)

  return [header, lines.join('\n'), 'Pode me dizer qual prefere ou pedir outro horario.']
    .filter((line) => line.trim().length > 0)
    .join('\n\n')
}

function hasExplicitFlexibleTimeRequest(message: string) {
  const normalized = normalizeText(message)

  return /\b(qualquer horario|qualquer horário|qualquer um serve|sem preferencia de horario|sem preferencia de horário|nao tenho preferencia de horario|não tenho preferência de horário|nao tenho preferencia|não tenho preferência|me mostra os horarios|me mostra os horários|me passa os horarios|me passa os horários|quais horarios|quais horários|pode me passar as opcoes|pode me passar as opções|quero ver as opcoes|quero ver as opções)\b/.test(normalized)
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

  return `Oi! Posso continuar por aqui. ${input.draft.requestedDateIso
    ? buildSpecificTimeQuestion({
        requestedDateIso: input.draft.requestedDateIso,
        timezone: input.timezone,
        professionalName: input.draft.selectedProfessionalName,
      })
    : buildPeriodQuestion({
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

async function emitAvailabilityInfrastructureFallback(input: {
  conversationId: string
  baseUpdate: ConversationBaseUpdate
  fallbackState: ConversationState
  fallbackFlow: ConversationServiceResult['flow']
  usedAI: boolean
  error: unknown
  source: string
}) {
  const responseText =
    'Tive uma instabilidade aqui para consultar os horarios. Vou tentar novamente.'

  console.warn('[availability] fallback emitted to customer', {
    conversationId: input.conversationId,
    source: input.source,
    state: input.fallbackState,
    error: input.error instanceof Error ? input.error.message : 'unknown_error',
  })

  await prisma.whatsappConversation.update({
    where: { id: input.conversationId },
    data: {
      ...input.baseUpdate,
      state: input.fallbackState,
      slotOptions: JSON_NULL,
      selectedSlot: JSON_NULL,
      lastAssistantText: responseText,
    },
  })

  return {
    responseText,
    flow: input.fallbackFlow,
    conversationId: input.conversationId,
    conversationState: input.fallbackState,
    usedAI: input.usedAI,
  } satisfies ConversationServiceResult
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

function hasBroadPeriodSchedulingFilter(value: string | null) {
  if (!value) {
    return false
  }

  return ['MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING'].includes(value)
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

function buildExactTimeUnavailableMessage(input: {
  exactTime: string
  timezone: string
  dateIso: string
  professionalName?: string | null
}) {
  const dayLabel = formatDayLabel(input.dateIso, input.timezone).toLowerCase()

  if (input.professionalName) {
    return `${input.exactTime} com ${input.professionalName} nao esta disponivel ${dayLabel}. Vou te mostrar as opcoes mais proximas.`
  }

  return `${input.exactTime} nao esta disponivel ${dayLabel}. Vou te mostrar as opcoes mais proximas.`
}

function buildCompactNearbySlotSummary(slots: ConversationSlot[]) {
  const uniqueLabels = slots
    .map((slot) => `${slot.timeLabel}${slots.some((candidate) =>
      candidate.timeLabel === slot.timeLabel
      && candidate.professionalId !== slot.professionalId
    ) ? ` com ${slot.professionalName}` : ''}`)
    .filter((label, index, collection) => collection.indexOf(label) === index)

  if (uniqueLabels.length === 0) {
    return null
  }

  return uniqueLabels
    .slice(0, 4)
    .map((label) => `• ${label}`)
    .join('\n')
}

function shouldAvoidSemanticallyRepeatedResponse(input: {
  previousAssistantText?: string | null
  nextResponseText: string
}) {
  const previous = normalizeText(input.previousAssistantText ?? '')
  const next = normalizeText(input.nextResponseText)

  if (!previous || !next) {
    return false
  }

  return previous === next
    || previous.includes(next)
    || next.includes(previous)
}

function buildExactTimeFallbackResponse(input: {
  exactTime: string
  timezone: string
  dateIso: string
  slots: ConversationSlot[]
  professionalName?: string | null
  allowAlternativeProfessionalSuggestion?: boolean
  previousAssistantText?: string | null
}) {
  const nearbySummary = buildCompactNearbySlotSummary(input.slots)
  const unavailableMessage = buildExactTimeUnavailableMessage({
    exactTime: input.exactTime,
    timezone: input.timezone,
    dateIso: input.dateIso,
    professionalName: input.professionalName,
  })

  const conciseFollowUp = nearbySummary
    ? input.professionalName
      ? `${unavailableMessage}\n\nTenho estas opcoes com ${input.professionalName}:\n\n${nearbySummary}\n\n${input.allowAlternativeProfessionalSuggestion ? 'Se preferir, eu tambem posso ver esse horario com outro barbeiro.' : 'Quer um deles ou prefere outro horario com ele?'}`
      : `${unavailableMessage}\n\nTenho estes horarios disponiveis:\n\n${nearbySummary}\n\nQual voce prefere?`
    : input.professionalName
      ? `${unavailableMessage} Se quiser, eu posso procurar outro horario com ${input.professionalName}${input.allowAlternativeProfessionalSuggestion ? ' ou ver esse horario com outro barbeiro' : ''}.`
      : `${unavailableMessage} Se quiser, eu posso procurar em outro periodo.`

  if (shouldAvoidSemanticallyRepeatedResponse({
    previousAssistantText: input.previousAssistantText,
    nextResponseText: conciseFollowUp,
  })) {
    return nearbySummary
      ? `Nao tenho ${input.exactTime}.\n\nTenho estas opcoes:\n\n${nearbySummary}\n\nQuer que eu siga com uma delas ou busque outro periodo?`
      : `Nao tenho ${input.exactTime}. Posso buscar em outro periodo para voce.`
  }

  return conciseFollowUp
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

function deriveStateFromDraftProgress(draft: ConversationDraft): ConversationState {
  if (!draft.selectedServiceId) {
    return 'WAITING_SERVICE'
  }

  if (!draft.selectedProfessionalId && !draft.allowAnyProfessional) {
    return 'WAITING_PROFESSIONAL'
  }

  if (draft.selectedStoredSlot) {
    return 'WAITING_CONFIRMATION'
  }

  if (!hasResolvedTimePreference(draft.requestedTimeLabel)) {
    return 'WAITING_TIME'
  }

  if (!draft.requestedDateIso) {
    return 'WAITING_DATE'
  }

  return 'WAITING_TIME'
}

function resolveConversationRuntimeContext(input: {
  state: ConversationState
  updatedAt: Date
  draft: ConversationDraft
}) {
  const contextReliable = isConversationContextReliable(input)
  const hasUsefulProgress = hasUsefulConversationProgress(input.draft)
  const shouldPreserveProgress =
    !contextReliable
    && hasUsefulProgress
  const effectiveState = shouldPreserveProgress
    ? deriveStateFromDraftProgress(input.draft)
    : contextReliable
      ? input.state
      : 'IDLE'

  return {
    contextReliable,
    hasUsefulProgress,
    shouldPreserveProgress,
    effectiveState,
    draftForContinuation: shouldPreserveProgress || contextReliable
      ? input.draft
      : buildEmptyConversationDraft(),
  }
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
  requestedExactTimeForFallback?: string | null
  usedAI: boolean
  responseLeadIn?: string | null
  previousAssistantText?: string | null
}): Promise<ConversationServiceResult> {
  let availability
  try {
    availability = await getAvailableWhatsAppSlots({
      barbershopId: input.barbershopId,
      serviceId: input.serviceId,
      dateIso: input.requestedDateIso,
      timezone: input.timezone,
      professionalId: input.professionalId,
      timePreference: input.timePreference,
      exactTime: input.exactTime,
      limit: 4,
    })
  } catch (error) {
    if (error instanceof AvailabilityInfrastructureError) {
      return emitAvailabilityInfrastructureFallback({
        conversationId: input.conversationId,
        baseUpdate: input.baseUpdate,
        fallbackState: input.conversationStep === 'WAITING_CONFIRMATION' ? 'WAITING_CONFIRMATION' : 'WAITING_TIME',
        fallbackFlow: input.conversationStep === 'WAITING_CONFIRMATION' ? 'await_confirmation' : 'collect_period',
        usedAI: input.usedAI,
        error,
        source: 'offer_fresh_slots',
      })
    }

    throw error
  }

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

  const slotOfferMessage = input.requestedExactTimeForFallback && !input.exactTime
    ? buildExactTimeFallbackResponse({
        exactTime: input.requestedExactTimeForFallback,
        timezone: input.timezone,
        dateIso: input.requestedDateIso,
        slots: availability.slots,
        professionalName: input.professionalName,
        previousAssistantText: input.previousAssistantText,
      })
    : buildHumanSlotOfferMessage(
        availability.slots,
        input.serviceName,
        input.timezone,
        input.timePreference
      )
  const responseText = withLeadIn(slotOfferMessage, input.responseLeadIn)

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
  const previousBookingStatusQuery = parsePreviousBookingStatusQuery(conversation.lastIntent)
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
  const runtimeContext = resolveConversationRuntimeContext({
    state: currentState,
    updatedAt: conversation.updatedAt,
    draft: conversationDraft,
  })
  const {
    contextReliable,
    hasUsefulProgress,
    shouldPreserveProgress,
    effectiveState,
    draftForContinuation,
  } = runtimeContext
  const canContinueFromContext = contextReliable || shouldPreserveProgress
  const draftForInterpreter = draftForContinuation
  const hasRecentConfirmedBooking = hasRecentCompletedBookingContext({
    state: effectiveState,
    completedAt: conversation.completedAt,
    recentBooking: recentConfirmedBooking,
  })
  const contextualProfessionalPreference = resolveContextualProfessionalPreference({
    professionals: professionals.map((professional) => ({
      id: professional.id,
      name: professional.name,
    })),
    preferredProfessional,
    recentBooking: recentConfirmedBooking,
    hasRecentConfirmedBooking,
  })

  console.info('[whatsapp-conversation] contextual professional preference', {
    customerId: input.customer.id,
    preferredProfessionalId: preferredProfessional.professionalId,
    preferredProfessionalName: preferredProfessional.professionalName,
    recentBookingProfessionalName: recentConfirmedBooking?.professionalName ?? null,
    inferredProfessionalId: contextualProfessionalPreference?.professionalId ?? null,
    inferredProfessionalName: contextualProfessionalPreference?.professionalName ?? null,
    source: contextualProfessionalPreference?.source ?? 'none',
  })

  if (!contextReliable && shouldPreserveProgress) {
    console.info('[whatsapp-conversation] preserving progress despite unreliable context', {
      customerId: input.customer.id,
      previousState: currentState,
      effectiveState,
      updatedAt: conversation.updatedAt.toISOString(),
      hasUsefulProgress,
      selectedServiceId: conversationDraft.selectedServiceId,
      selectedProfessionalId: conversationDraft.selectedProfessionalId,
      requestedDateIso: conversationDraft.requestedDateIso,
      requestedTimeLabel: conversationDraft.requestedTimeLabel,
      offeredSlots: conversationDraft.offeredSlots.length,
      hasSelectedSlot: Boolean(conversationDraft.selectedStoredSlot),
    })
  }

  if (!contextReliable && !shouldPreserveProgress && currentState !== 'IDLE') {
    console.info('[whatsapp-conversation] hard reset unreliable context', {
      customerId: input.customer.id,
      previousState: currentState,
      updatedAt: conversation.updatedAt.toISOString(),
      hasUsefulProgress,
      requestedDateIso: conversationDraft.requestedDateIso,
      requestedTimeLabel: conversationDraft.requestedTimeLabel,
      offeredSlots: conversationDraft.offeredSlots.length,
      hasSelectedSlot: Boolean(conversationDraft.selectedStoredSlot),
    })
  }

  const canUseDeterministicStoredSlotConfirmation =
    effectiveState === 'WAITING_CONFIRMATION'
    && Boolean(draftForInterpreter.selectedStoredSlot)
    && Boolean(draftForInterpreter.selectedServiceId)
    && (
      Boolean(draftForInterpreter.selectedProfessionalId)
      || draftForInterpreter.allowAnyProfessional
    )

  if (
    effectiveState === 'WAITING_CONFIRMATION'
    && draftForInterpreter.selectedStoredSlot
    && draftForInterpreter.selectedServiceId
    && !shouldTreatAsStoredSlotConfirmation(inboundText)
    && isAffirmativeConfirmationMessage(inboundText)
  ) {
    console.info('[whatsapp-conversation] deterministic confirmation blocked', {
      conversationId: conversation.id,
      customerId: input.customer.id,
      inboundText,
      selectedServiceId: draftForInterpreter.selectedServiceId,
      selectedProfessionalId: draftForInterpreter.selectedProfessionalId,
      allowAnyProfessional: draftForInterpreter.allowAnyProfessional,
      selectedSlot: draftForInterpreter.selectedStoredSlot,
      blockedReason: 'explicit_correction_detected',
    })
  }

  if (
    canUseDeterministicStoredSlotConfirmation
    && shouldTreatAsStoredSlotConfirmation(inboundText)
  ) {
    const deterministicServiceId = draftForInterpreter.selectedServiceId!
    const deterministicSelectedSlot = draftForInterpreter.selectedStoredSlot!

    console.info('[whatsapp-conversation] deterministic confirmation accepted', {
      conversationId: conversation.id,
      customerId: input.customer.id,
      inboundText,
      selectedServiceId: deterministicServiceId,
      selectedProfessionalId: draftForInterpreter.selectedProfessionalId,
      allowAnyProfessional: draftForInterpreter.allowAnyProfessional,
      selectedSlot: deterministicSelectedSlot,
    })

    console.info('[whatsapp-conversation] affirmative confirmation detected', {
      conversationId: conversation.id,
      customerId: input.customer.id,
      inboundText,
      selectedServiceId: deterministicServiceId,
      selectedSlot: deterministicSelectedSlot,
    })

    let confirmedSlot: ConversationSlot | null = null
    try {
      confirmedSlot = await findExactAvailableWhatsAppSlot({
        barbershopId: input.barbershop.id,
        serviceId: deterministicServiceId,
        professionalId: deterministicSelectedSlot.professionalId,
        dateIso: deterministicSelectedSlot.dateIso,
        timeLabel: deterministicSelectedSlot.timeLabel,
        timezone,
      })
    } catch (error) {
      if (error instanceof AvailabilityInfrastructureError) {
        return emitAvailabilityInfrastructureFallback({
          conversationId: conversation.id,
          baseUpdate: {
            lastInboundText: inboundText,
            lastIntent: buildJsonValue({
              source: 'backend_confirmation_guard',
              intent: 'CONFIRM',
              confirmationFailed: 'availability_infrastructure_error',
            }),
            selectedServiceId: deterministicServiceId,
            selectedServiceName: draftForInterpreter.selectedServiceName,
            selectedProfessionalId: draftForInterpreter.selectedProfessionalId,
            selectedProfessionalName: draftForInterpreter.selectedProfessionalName,
            allowAnyProfessional: draftForInterpreter.allowAnyProfessional,
            requestedDate: draftForInterpreter.requestedDateIso
              ? buildDateAnchorUtc(draftForInterpreter.requestedDateIso)
              : null,
            requestedTimeLabel: draftForInterpreter.requestedTimeLabel,
          },
          fallbackState: 'WAITING_CONFIRMATION',
          fallbackFlow: 'await_confirmation',
          usedAI: false,
          error,
          source: 'deterministic_confirmation_guard',
        })
      }

      throw error
    }

    if (!confirmedSlot) {
      const responseText =
        'Esse horario acabou de sair daqui. Vou te mostrar as opcoes atualizadas para voce escolher o melhor.'

      await prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: {
          state: 'WAITING_TIME',
          selectedServiceId: deterministicServiceId,
          selectedServiceName: draftForInterpreter.selectedServiceName,
          selectedProfessionalId: draftForInterpreter.selectedProfessionalId,
          selectedProfessionalName: draftForInterpreter.selectedProfessionalName,
          allowAnyProfessional: draftForInterpreter.allowAnyProfessional,
          requestedDate: draftForInterpreter.requestedDateIso
            ? buildDateAnchorUtc(draftForInterpreter.requestedDateIso)
            : null,
          requestedTimeLabel: draftForInterpreter.requestedTimeLabel,
          slotOptions: JSON_NULL,
          selectedSlot: JSON_NULL,
          bookingDraft: buildJsonValue({
            selectedServiceId: deterministicServiceId,
            selectedServiceName: draftForInterpreter.selectedServiceName,
            selectedProfessionalId: draftForInterpreter.selectedProfessionalId,
            selectedProfessionalName: draftForInterpreter.selectedProfessionalName,
            allowAnyProfessional: draftForInterpreter.allowAnyProfessional,
            requestedDateIso: draftForInterpreter.requestedDateIso,
            requestedTimeLabel: draftForInterpreter.requestedTimeLabel,
          }),
          lastInboundText: inboundText,
          lastIntent: buildJsonValue({
            source: 'backend_confirmation_guard',
            intent: 'CONFIRM',
            confirmationFailed: 'slot_unavailable',
          }),
          lastAssistantText: responseText,
        },
      })

      return {
        responseText,
        flow: 'reschedule',
        conversationId: conversation.id,
        conversationState: 'WAITING_TIME',
        usedAI: false,
      }
    }

    try {
      const appointment = await createAppointmentFromWhatsApp({
        barbershopId: input.barbershop.id,
        customerId: input.customer.id,
        serviceId: deterministicServiceId,
        professionalId: confirmedSlot.professionalId,
        startAtIso: confirmedSlot.startAtIso,
        dateIso: confirmedSlot.dateIso,
        timeLabel: confirmedSlot.timeLabel,
        timezone,
        sourceReference: `whatsapp:${conversation.id}:${input.eventId}`,
        notes: 'Agendamento criado via confirmacao deterministica do WhatsApp.',
      })

      const responseText = buildSuccessMessage(
        confirmedSlot,
        draftForInterpreter.selectedServiceName ?? 'o servico solicitado',
        timezone
      )

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
            confirmedSlot,
            draftForInterpreter.selectedServiceName ?? 'o servico solicitado',
            timezone
          ),
          bookingDraft: JSON_NULL,
          recentCorrections: JSON_NULL,
          lastInboundText: inboundText,
          lastIntent: buildJsonValue({
            source: 'backend_confirmation_guard',
            intent: 'CONFIRM',
            recentBooking: {
              serviceName: draftForInterpreter.selectedServiceName ?? 'o servico solicitado',
              professionalName: confirmedSlot.professionalName,
              dateIso: confirmedSlot.dateIso,
              timeLabel: confirmedSlot.timeLabel,
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
        usedAI: false,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown_error'

      console.warn('[whatsapp-conversation] deterministic confirmation failed', {
        conversationId: conversation.id,
        error: errorMessage,
      })

      const responseText =
        'Tive um problema para concluir esse agendamento agora e nao vou te confirmar antes de salvar de verdade. Se quiser, eu tento esse horario de novo para voce.'

      await prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: {
          state: 'WAITING_CONFIRMATION',
          selectedServiceId: deterministicServiceId,
          selectedServiceName: draftForInterpreter.selectedServiceName,
          selectedProfessionalId: confirmedSlot.professionalId,
          selectedProfessionalName: confirmedSlot.professionalName,
          allowAnyProfessional: false,
          requestedDate: buildDateAnchorUtc(confirmedSlot.dateIso),
          requestedTimeLabel: confirmedSlot.timeLabel,
          slotOptions: JSON_NULL,
          selectedSlot: buildJsonValue(confirmedSlot),
          bookingDraft: buildJsonValue({
            selectedServiceId: deterministicServiceId,
            selectedServiceName: draftForInterpreter.selectedServiceName,
            selectedProfessionalId: confirmedSlot.professionalId,
            selectedProfessionalName: confirmedSlot.professionalName,
            allowAnyProfessional: false,
            requestedDateIso: confirmedSlot.dateIso,
            requestedTimeLabel: confirmedSlot.timeLabel,
            selectedSlot: confirmedSlot,
          }),
          lastInboundText: inboundText,
          lastIntent: buildJsonValue({
            source: 'backend_confirmation_guard',
            intent: 'CONFIRM',
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
        usedAI: false,
      }
    }
  }

  const preAgentExistingBookingQuestion = isExistingBookingStatusQuestion({
    message: inboundText,
    lastCustomerMessage: canContinueFromContext ? conversation.lastInboundText : null,
    lastAssistantMessage: canContinueFromContext ? conversation.lastAssistantText : null,
  })

  if (preAgentExistingBookingQuestion) {
    return handleExistingBookingStatusQuery({
      conversationId: conversation.id,
      customerId: input.customer.id,
      inboundText,
      effectiveState,
      draft: draftForInterpreter,
      barbershopId: input.barbershop.id,
      timezone,
      nowDateIso: nowContext.dateIso,
      previousQuery: previousBookingStatusQuery,
    })
  }

  if (isAcknowledgementMessage(inboundText)) {
    console.info('[whatsapp-conversation] acknowledgement detected', {
      conversationId: conversation.id,
      customerId: input.customer.id,
      stateBefore: effectiveState,
      inboundText,
      hasRecentConfirmedBooking,
    })

    if (effectiveState !== 'IDLE' || hasUsefulConversationProgress(draftForInterpreter)) {
      console.info('[whatsapp-conversation] topic switch forced', {
        conversationId: conversation.id,
        customerId: input.customer.id,
        stateBefore: effectiveState,
        inboundText,
        reason: 'acknowledgement',
      })
    }

    const responseText = buildAcknowledgementResponse({
      recentBooking: hasRecentConfirmedBooking ? recentConfirmedBooking : null,
      timezone,
      effectiveState,
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
        bookingDraft: JSON_NULL,
        recentCorrections: JSON_NULL,
        lastInboundText: inboundText,
        lastIntent: buildJsonValue({
          source: 'acknowledgement',
          intent: 'ACKNOWLEDGEMENT',
          recentBooking: recentConfirmedBooking,
        }),
        lastAssistantText: responseText,
        completedAt: hasRecentConfirmedBooking ? conversation.completedAt : null,
      },
    })

    return {
      responseText,
      flow: 'acknowledgement',
      conversationId: conversation.id,
      conversationState: 'IDLE',
      usedAI: false,
    }
  }

  const agentResult = await processWhatsAppConversationWithAgent({
    barbershop: input.barbershop,
    customer: {
      ...input.customer,
      preferredProfessionalId: contextualProfessionalPreference?.professionalId ?? null,
      preferredProfessionalName: contextualProfessionalPreference?.professionalName ?? null,
    },
    inboundText,
    rawMessages: input.rawMessages,
    conversation: {
      id: conversation.id,
      state: effectiveState,
      updatedAt: canContinueFromContext ? conversation.updatedAt : new Date(),
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
      conversationSummary: canContinueFromContext ? conversation.conversationSummary ?? null : null,
      bookingDraft: canContinueFromContext ? conversation.bookingDraft : null,
      recentCorrections: canContinueFromContext ? conversation.recentCorrections : null,
      lastInboundText: canContinueFromContext ? conversation.lastInboundText ?? null : null,
      lastAssistantText: canContinueFromContext ? conversation.lastAssistantText ?? null : null,
    },
    services,
    professionals,
    nowContext,
  })

  if (agentResult) {
    const agentHasUsefulProgress = hasUsefulConversationProgress({
      selectedServiceId: agentResult.memory.selectedServiceId,
      selectedServiceName: agentResult.memory.selectedServiceName,
      selectedProfessionalId: agentResult.memory.selectedProfessionalId,
      selectedProfessionalName: agentResult.memory.selectedProfessionalName,
      allowAnyProfessional: agentResult.memory.allowAnyProfessional,
      requestedDateIso: agentResult.memory.requestedDateIso,
      requestedTimeLabel: agentResult.memory.requestedTimeLabel,
      offeredSlots: agentResult.memory.offeredSlots,
      selectedStoredSlot: agentResult.memory.selectedSlot,
    })
    const shouldResetPersistedContext =
      (
        agentResult.structured.nextAction === 'RESET_CONTEXT'
        || agentResult.structured.nextAction === 'GREET'
      )
      && !agentHasUsefulProgress

    if (!shouldResetPersistedContext && agentHasUsefulProgress && (
      agentResult.structured.nextAction === 'RESET_CONTEXT'
      || agentResult.structured.nextAction === 'GREET'
    )) {
      console.info('[whatsapp-conversation] preserving progress despite unreliable context', {
        mode: 'agent',
        conversationId: conversation.id,
        action: agentResult.structured.nextAction,
        selectedServiceId: agentResult.memory.selectedServiceId,
        requestedDateIso: agentResult.memory.requestedDateIso,
        requestedTimeLabel: agentResult.memory.requestedTimeLabel,
        offeredSlots: agentResult.memory.offeredSlots.length,
        hasSelectedSlot: Boolean(agentResult.memory.selectedSlot),
      })
    }

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

      if (agentResult.memory.selectedSlot) {
        console.info('[whatsapp-booking] slot persisted for confirmation', {
          conversationId: conversation.id,
          mode: 'agent',
          selectedServiceId: agentResult.memory.selectedServiceId,
          selectedProfessionalId: agentResult.memory.selectedSlot.professionalId,
          selectedProfessionalName: agentResult.memory.selectedSlot.professionalName,
          requestedDateIso: agentResult.memory.selectedSlot.dateIso,
          requestedTimeLabel: agentResult.memory.selectedSlot.timeLabel,
          selectedSlot: agentResult.memory.selectedSlot,
        })
      }
    }

    if (agentResult.shouldCreateAppointment && agentResult.memory.selectedSlot && agentResult.memory.selectedServiceId) {
      console.info('[whatsapp-conversation] confirmation received', {
        mode: 'agent',
        conversationId: conversation.id,
        stateBefore: effectiveState,
        inboundText,
        selectedProfessionalId: agentResult.memory.selectedProfessionalId,
        allowAnyProfessional: agentResult.memory.allowAnyProfessional,
        selectedSlot: agentResult.memory.selectedSlot,
        selectedServiceId: agentResult.memory.selectedServiceId,
      })

      try {
        console.info('[whatsapp-conversation] createAppointment started', {
          mode: 'agent',
          conversationId: conversation.id,
          selectedProfessionalId: agentResult.memory.selectedSlot.professionalId,
          allowAnyProfessional: agentResult.memory.allowAnyProfessional,
          selectedSlot: agentResult.memory.selectedSlot,
          selectedServiceId: agentResult.memory.selectedServiceId,
        })

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

        const responseText = buildSuccessMessage(
          agentResult.memory.selectedSlot,
          agentResult.memory.selectedServiceName ?? 'o servico solicitado',
          timezone
        )

        console.info('[whatsapp-conversation] createAppointment success', {
          mode: 'agent',
          conversationId: conversation.id,
          appointmentId: appointment.id,
          selectedProfessionalId: agentResult.memory.selectedSlot.professionalId,
          allowAnyProfessional: agentResult.memory.allowAnyProfessional,
          selectedSlot: agentResult.memory.selectedSlot,
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
            lastAssistantText: responseText,
            completedAt: new Date(),
          },
        })

        console.info('[whatsapp-conversation] backend action', {
          mode: 'agent',
          action: 'appointment_created',
          conversationId: conversation.id,
          appointmentId: appointment.id,
        })

        console.info('[whatsapp-conversation] final confirmation message emitted', {
          mode: 'agent',
          conversationId: conversation.id,
          appointmentId: appointment.id,
          responseText,
        })

        return {
          responseText,
          flow: 'appointment_created',
          conversationId: conversation.id,
          conversationState: 'IDLE',
          appointmentId: appointment.id,
          usedAI: true,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'unknown_error'

        console.warn('[whatsapp-conversation] createAppointment failed', {
          mode: 'agent',
          error: errorMessage,
          conversationId: conversation.id,
          selectedProfessionalId: agentResult.memory.selectedProfessionalId,
          allowAnyProfessional: agentResult.memory.allowAnyProfessional,
          selectedSlot: agentResult.memory.selectedSlot,
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
      console.info('[whatsapp-conversation] scheduling field persistence', {
        conversationId: conversation.id,
        requestedDateBeforeBackendAction: draftForInterpreter.requestedDateIso,
        requestedDateAfterBackendAction: shouldResetPersistedContext ? null : agentResult.memory.requestedDateIso,
        requestedTimeBeforeBackendAction: draftForInterpreter.requestedTimeLabel,
        requestedTimeAfterBackendAction: shouldResetPersistedContext ? null : agentResult.memory.requestedTimeLabel,
      })

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
      lastCustomerMessage: canContinueFromContext ? conversation.lastInboundText : null,
      lastAssistantMessage: canContinueFromContext ? conversation.lastAssistantText : null,
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
    contextReliable: canContinueFromContext,
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

  if (shortGreeting && canContinueFromContext) {
    const responseText = buildResumeMessage({
      state: effectiveState,
      timezone,
      nowContext,
      draft: draftForInterpreter,
      professionals: professionals.map((professional) => ({ id: professional.id, name: professional.name })),
      preferredProfessionalName: contextualProfessionalPreference?.professionalName ?? null,
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

    if (!canContinueFromContext) {
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

  const baselineDraft = draftForInterpreter
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
      contextualProfessionalPreference?.professionalId
      && contextualProfessionalPreference?.professionalName
      && !baselineDraft.selectedProfessionalId
      && !baselineDraft.allowAnyProfessional
      && (
        referencesPreferredProfessional(inboundText)
        || (
          effectiveState === 'WAITING_PROFESSIONAL'
          && Boolean(conversation.lastAssistantText?.includes(contextualProfessionalPreference?.professionalName ?? ''))
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
    && contextualProfessionalPreference?.professionalId
    && contextualProfessionalPreference?.professionalName
  ) {
    draft.selectedProfessionalId = contextualProfessionalPreference.professionalId
    draft.selectedProfessionalName = contextualProfessionalPreference.professionalName
    draft.allowAnyProfessional = false
  }

  if (interpreted.allowAnyProfessional || acceptedAlternativeProfessional) {
    draft.selectedProfessionalId = null
    draft.selectedProfessionalName = null
    draft.allowAnyProfessional = true
  }

  console.info('[whatsapp-conversation] professional routing decision', {
    customerId: input.customer.id,
    inferredByName: nameResolution.resolvedProfessional?.name ?? null,
    allowAnyProfessional: draft.allowAnyProfessional,
    contextualProfessionalName: contextualProfessionalPreference?.professionalName ?? null,
    contextualProfessionalSource: contextualProfessionalPreference?.source ?? null,
    selectedProfessionalId: draft.selectedProfessionalId,
    selectedProfessionalName: draft.selectedProfessionalName,
    recentBookingProfessional: recentConfirmedBooking?.professionalName ?? null,
    preferredProfessionalApplied: acceptedPreferredProfessional,
  })

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
  const shouldPreserveRequestedTimeOnProfessionalChange =
    !hasNewTimePreference
    && professionalChanged
    && !serviceChanged
    && !dateChanged
    && Boolean(baselineDraft.requestedTimeLabel)

  if (!hasNewTimePreference && (serviceChanged || dateChanged)) {
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

  if (shouldPreserveRequestedTimeOnProfessionalChange) {
    console.info('[whatsapp-conversation] professional correction preserved requested time', {
      customerId: input.customer.id,
      requestedTimeBefore: baselineDraft.requestedTimeLabel,
      requestedTimeAfter: draft.requestedTimeLabel,
      professionalBefore: baselineDraft.selectedProfessionalName,
      professionalAfter: draft.selectedProfessionalName,
      correctionTarget: interpreted.correctionTarget,
    })
  }

  console.info('[whatsapp-conversation] scheduling field normalization', {
    customerId: input.customer.id,
    requestedDateBefore: baselineDraft.requestedDateIso,
    requestedDateAfter: draft.requestedDateIso,
    preferredPeriodBefore: baselineDraft.requestedTimeLabel,
    preferredPeriodAfter: draft.requestedTimeLabel,
    serviceBefore: baselineDraft.selectedServiceName,
    serviceAfter: draft.selectedServiceName,
    professionalBefore: baselineDraft.selectedProfessionalName,
    professionalAfter: draft.selectedProfessionalName,
  })

  if (draft.requestedDateIso && detectRelativeDateExpression(inboundText)) {
    console.info('[whatsapp-conversation] requestedDate promoted from relative date', {
      customerId: input.customer.id,
      conversationId: conversation.id,
      inboundText,
      requestedDateIso: draft.requestedDateIso,
    })
  }

  if (hasBroadPeriodSchedulingFilter(draft.requestedTimeLabel) && (
    interpreted.preferredPeriod
    || (interpreted.timePreference && interpreted.timePreference !== 'NONE' && interpreted.timePreference !== 'EXACT')
  )) {
    console.info('[whatsapp-agent] preferred period interpreted', {
      customerId: input.customer.id,
      inboundText,
      preferredPeriod: interpreted.preferredPeriod,
      timePreference: interpreted.timePreference,
      requestedTimeLabel: draft.requestedTimeLabel,
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
          `Perfeito. Vou buscar com ${professionals[0].name}. ${draft.requestedDateIso
            ? buildSpecificTimeQuestion({
                requestedDateIso: draft.requestedDateIso,
                timezone,
                professionalName: professionals[0].name,
              })
            : buildDateQuestion()}`,
          responseLeadIn
        )
      : withLeadIn(
          buildProfessionalQuestion(
            professionals.map((professional) => professional.name),
            contextualProfessionalPreference?.professionalName ?? null
          ),
          responseLeadIn
        )

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
        data: {
          ...baseUpdate,
          state: professionals.length === 1
            ? (draft.requestedDateIso ? 'WAITING_TIME' : 'WAITING_DATE')
            : 'WAITING_PROFESSIONAL',
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
        flow: professionals.length === 1
          ? (draft.requestedDateIso ? 'collect_period' : 'collect_date')
          : 'collect_professional',
        conversationId: conversation.id,
        conversationState: professionals.length === 1
          ? (draft.requestedDateIso ? 'WAITING_TIME' : 'WAITING_DATE')
          : 'WAITING_PROFESSIONAL',
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

  if (!hasResolvedTimePreference(draft.requestedTimeLabel)) {
    const responseText = withLeadIn(
      draft.requestedDateIso
        ? buildSpecificTimeQuestion({
            requestedDateIso: draft.requestedDateIso,
            timezone,
            professionalName: draft.allowAnyProfessional
              ? null
              : (draft.selectedProfessionalName ?? contextualProfessionalPreference?.professionalName ?? null),
          })
        : buildPeriodQuestion({
            requestedDateIso: draft.requestedDateIso,
            nowContext,
          }),
      responseLeadIn
    )

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

  const selectedOfferedSlot = pickOfferedSlot({
    offeredSlots: draft.offeredSlots,
    selectedOptionNumber: interpreted.selectedOptionNumber,
    exactTime: interpreted.exactTime,
    message: inboundText,
  })
  const exactTimeForValidation = resolveExactTimeForSlotRevalidation({
    interpretedExactTime: interpreted.exactTime,
    requestedTimeLabel: draft.requestedTimeLabel,
    professionalChanged,
  })
  const professionalIdForExactSearch = draft.allowAnyProfessional
    ? null
    : draft.selectedProfessionalId ?? contextualProfessionalPreference?.professionalId ?? null
  const professionalNameForExactSearch = draft.allowAnyProfessional
    ? null
    : draft.selectedProfessionalName ?? contextualProfessionalPreference?.professionalName ?? null

  if (draft.requestedDateIso && detectRelativeDateExpression(inboundText)) {
    console.info('[availability] using requestedDateIso from relative date', {
      customerId: input.customer.id,
      conversationId: conversation.id,
      inboundText,
      requestedDateIso: draft.requestedDateIso,
      timezone,
    })
  }

  if (exactTimeForValidation) {
    console.info('[whatsapp-conversation] exact time requested', {
      customerId: input.customer.id,
      exactTimeRequested: exactTimeForValidation,
      requestedDateIso: draft.requestedDateIso,
      selectedProfessionalId: professionalIdForExactSearch,
      selectedProfessionalName: professionalNameForExactSearch,
      contextualProfessionalSource: contextualProfessionalPreference?.source ?? 'none',
      offeredSlotsCount: draft.offeredSlots.length,
      offeredSlots: draft.offeredSlots.map((slot) => `${slot.timeLabel} com ${slot.professionalName}`),
    })

    if (draft.offeredSlots.length === 0) {
      console.info('[whatsapp-conversation] no offeredSlots available', {
        customerId: input.customer.id,
        requestedDateIso: draft.requestedDateIso,
        requestedTimeLabel: draft.requestedTimeLabel,
        exactTimeRequested: exactTimeForValidation,
        selectedServiceId: draft.selectedServiceId,
        selectedProfessionalId: professionalIdForExactSearch,
      })
    }
  }

  let slotForConfirmation: ConversationSlot | null = null

  if (selectedOfferedSlot) {
    try {
      slotForConfirmation = await findExactAvailableWhatsAppSlot({
        barbershopId: input.barbershop.id,
        serviceId: draft.selectedServiceId,
        professionalId: selectedOfferedSlot.professionalId,
        dateIso: selectedOfferedSlot.dateIso,
        timeLabel: selectedOfferedSlot.timeLabel,
        timezone,
      })
    } catch (error) {
      if (error instanceof AvailabilityInfrastructureError) {
        return emitAvailabilityInfrastructureFallback({
          conversationId: conversation.id,
          baseUpdate,
          fallbackState: 'WAITING_TIME',
          fallbackFlow: 'collect_period',
          usedAI,
          error,
          source: 'selected_offered_slot_confirmation',
        })
      }

      throw error
    }
  }

  if (
    !slotForConfirmation
    && exactTimeForValidation
    && professionalIdForExactSearch
  ) {
    if (!interpreted.exactTime && professionalChanged) {
      console.info('[whatsapp-conversation] revalidating preserved time with new professional', {
        customerId: input.customer.id,
        requestedDateIso: draft.requestedDateIso,
        preservedExactTime: exactTimeForValidation,
        selectedProfessionalId: professionalIdForExactSearch,
        selectedProfessionalName: professionalNameForExactSearch,
      })
    }

    try {
      slotForConfirmation = await findExactAvailableWhatsAppSlot({
        barbershopId: input.barbershop.id,
        serviceId: draft.selectedServiceId,
        professionalId: professionalIdForExactSearch,
        dateIso: draft.requestedDateIso,
        timeLabel: exactTimeForValidation,
        timezone,
      })
    } catch (error) {
      if (error instanceof AvailabilityInfrastructureError) {
        return emitAvailabilityInfrastructureFallback({
          conversationId: conversation.id,
          baseUpdate,
          fallbackState: 'WAITING_TIME',
          fallbackFlow: 'collect_period',
          usedAI,
          error,
          source: 'preserved_exact_time_revalidation',
        })
      }

      throw error
    }
  }

  if (
    !slotForConfirmation
    && !interpreted.exactTime
    && effectiveState === 'WAITING_CONFIRMATION'
    && draft.selectedStoredSlot
  ) {
    try {
      slotForConfirmation = await findExactAvailableWhatsAppSlot({
        barbershopId: input.barbershop.id,
        serviceId: draft.selectedServiceId,
        professionalId: draft.selectedStoredSlot.professionalId,
        dateIso: draft.selectedStoredSlot.dateIso,
        timeLabel: draft.selectedStoredSlot.timeLabel,
        timezone,
      })
    } catch (error) {
      if (error instanceof AvailabilityInfrastructureError) {
        return emitAvailabilityInfrastructureFallback({
          conversationId: conversation.id,
          baseUpdate,
          fallbackState: 'WAITING_CONFIRMATION',
          fallbackFlow: 'await_confirmation',
          usedAI,
          error,
          source: 'stored_slot_revalidation',
        })
      }

      throw error
    }
  }

  if (!slotForConfirmation && exactTimeForValidation) {
    let exactTimeAvailability
    try {
      exactTimeAvailability = await getAvailableWhatsAppSlots({
        barbershopId: input.barbershop.id,
        serviceId: draft.selectedServiceId,
        dateIso: draft.requestedDateIso,
        timezone,
        professionalId: professionalIdForExactSearch,
        timePreference: 'EXACT',
        exactTime: exactTimeForValidation,
        limit: 8,
      })
    } catch (error) {
      if (error instanceof AvailabilityInfrastructureError) {
        return emitAvailabilityInfrastructureFallback({
          conversationId: conversation.id,
          baseUpdate,
          fallbackState: 'WAITING_TIME',
          fallbackFlow: 'collect_period',
          usedAI,
          error,
          source: 'exact_time_validation',
        })
      }

      throw error
    }

    console.info('[whatsapp-conversation] exact time validation result', {
      customerId: input.customer.id,
      exactTimeRequested: exactTimeForValidation,
      selectedProfessionalId: professionalIdForExactSearch,
      selectedProfessionalName: professionalNameForExactSearch,
      freeSlotsReturned: exactTimeAvailability.slots.length,
      slots: exactTimeAvailability.slots.map((slot) => `${slot.timeLabel} com ${slot.professionalName}`),
      finalReason: exactTimeAvailability.diagnostics.finalReason,
    })

    if (exactTimeAvailability.slots.length === 1) {
      slotForConfirmation = exactTimeAvailability.slots[0]
    } else if (exactTimeAvailability.slots.length > 1) {
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
        timePreference: 'EXACT',
        exactTime: exactTimeForValidation,
        requestedExactTimeForFallback: exactTimeForValidation,
        usedAI,
        responseLeadIn,
        previousAssistantText: conversation.lastAssistantText,
      })
    }
  }

  const hasPeriodSchedulingFilter = hasBroadPeriodSchedulingFilter(draft.requestedTimeLabel)

  if (!slotForConfirmation) {
    if (hasPeriodSchedulingFilter) {
      console.info('[whatsapp-conversation] period accepted as scheduling filter', {
        customerId: input.customer.id,
        conversationId: conversation.id,
        inboundText,
        requestedDateIso: draft.requestedDateIso,
        requestedTimeLabel: draft.requestedTimeLabel,
        selectedProfessionalId: draft.selectedProfessionalId,
        selectedProfessionalName: draft.selectedProfessionalName,
      })
    }

    if (!exactTimeForValidation && !hasPeriodSchedulingFilter && !hasExplicitFlexibleTimeRequest(inboundText)) {
      const responseText = withLeadIn(
        buildSpecificTimeQuestion({
          requestedDateIso: draft.requestedDateIso,
          timezone,
          professionalName: draft.allowAnyProfessional
            ? null
            : (draft.selectedProfessionalName ?? contextualProfessionalPreference?.professionalName ?? null),
        }),
        responseLeadIn
      )

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
      timePreference: exactTimeForValidation
        ? draft.requestedTimeLabel
        : interpreted.timePreference !== 'NONE'
          ? interpreted.timePreference
          : draft.requestedTimeLabel,
      exactTime: exactTimeForValidation ? null : (draft.requestedTimeLabel?.includes(':') ? draft.requestedTimeLabel : null),
      requestedExactTimeForFallback: exactTimeForValidation,
      usedAI,
      responseLeadIn,
      previousAssistantText: conversation.lastAssistantText,
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

    console.info('[whatsapp-booking] slot persisted for confirmation', {
      conversationId: conversation.id,
      mode: 'legacy',
      selectedServiceId: draft.selectedServiceId,
      selectedProfessionalId: slotForConfirmation.professionalId,
      selectedProfessionalName: slotForConfirmation.professionalName,
      requestedDateIso: slotForConfirmation.dateIso,
      requestedTimeLabel: slotForConfirmation.timeLabel,
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
      selectedProfessionalId: slotForConfirmation.professionalId,
      allowAnyProfessional: draft.allowAnyProfessional,
      selectedSlot: slotForConfirmation,
      selectedServiceId: draft.selectedServiceId,
    })

    console.info('[whatsapp-conversation] createAppointment started', {
      mode: 'legacy',
      conversationId: conversation.id,
      selectedProfessionalId: slotForConfirmation.professionalId,
      allowAnyProfessional: draft.allowAnyProfessional,
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

    console.info('[whatsapp-conversation] createAppointment success', {
      mode: 'legacy',
      conversationId: conversation.id,
      appointmentId: appointment.id,
      selectedProfessionalId: slotForConfirmation.professionalId,
      allowAnyProfessional: draft.allowAnyProfessional,
      selectedSlot: slotForConfirmation,
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

    console.info('[whatsapp-conversation] final confirmation message emitted', {
      mode: 'legacy',
      conversationId: conversation.id,
      appointmentId: appointment.id,
      responseText,
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
    console.warn('[whatsapp-conversation] createAppointment failed', {
      mode: 'legacy',
      error: error instanceof Error ? error.message : 'unknown_error',
      serviceId: draft.selectedServiceId,
      professionalId: slotForConfirmation.professionalId,
      allowAnyProfessional: draft.allowAnyProfessional,
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
      requestedExactTimeForFallback: null,
      usedAI,
      responseLeadIn: 'Esse horario nao estava mais livre no momento de confirmar. Vou te mostrar opcoes atualizadas.',
      previousAssistantText: conversation.lastAssistantText,
    })
  }
}

export const __testing = {
  buildAcknowledgementResponse,
  buildBookingStatusFollowUp,
  buildCompactNearbySlotSummary,
  buildEmptyConversationDraft,
  buildExactTimeUnavailableMessage,
  buildExactTimeFallbackResponse,
  buildExistingBookingStatusMessage,
  buildRecentConfirmedGreeting,
  buildServiceQuestion,
  buildProfessionalQuestion,
  buildHumanSlotOfferMessage,
  hasUsefulConversationProgress,
  hasRecentCompletedBookingContext,
  isAcknowledgementMessage,
  isExistingBookingStatusQuestion,
  isAffirmativeConfirmationMessage,
  isExactTimeLabel,
  resolveExactTimeForSlotRevalidation,
  shouldTreatAsStoredSlotConfirmation,
  isConversationContextReliable,
  parseExistingBookingQuery,
  parseRequestedDateFromExistingBookingQuestion,
  isShortGreetingMessage,
  referencesPreferredProfessional,
  resolveContextualProfessionalPreference,
  resolveConversationRuntimeContext,
  shouldResetConversationOnGreeting,
}
