import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { interpretWhatsAppMessage } from '@/lib/ai/openai-whatsapp-interpreter'
import {
  createAppointmentFromWhatsApp,
  findExactAvailableWhatsAppSlot,
  getAvailableWhatsAppSlots,
  loadBarbershopSchedulingOptions,
  type WhatsAppBookingSlot,
} from '@/lib/agendamentos/whatsapp-booking'

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

type ConversationSlot = WhatsAppBookingSlot

const JSON_NULL = Prisma.JsonNull
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

function isToday(dateIso: string) {
  return dateIso === formatDateIso(new Date())
}

function formatDayLabel(dateIso: string) {
  if (isToday(dateIso)) {
    return 'Hoje'
  }

  const date = new Date(`${dateIso}T12:00:00`)
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  })
}

function buildGreeting(barbershopName: string, customerName?: string | null) {
  const firstName = customerName?.trim()?.split(' ')[0]
  const greeting = firstName ? `Oi, ${firstName}!` : 'Oi!'
  return `${greeting} Posso te ajudar com seu agendamento na ${barbershopName}. Você quer marcar um horário?`
}

function buildServiceQuestion(serviceNames: string[]) {
  const preview = serviceNames.slice(0, 6).join(', ')
  return `Perfeito. Qual serviço você quer agendar? ${preview ? `Hoje temos: ${preview}.` : ''}`.trim()
}

function buildProfessionalQuestion(professionalNames: string[]) {
  return `Tem preferência de barbeiro? Posso agendar com ${professionalNames.slice(0, 6).join(', ')}. Se preferir, também posso buscar com qualquer um.`
}

function buildDateQuestion() {
  return 'Qual dia você prefere? Pode me falar algo como hoje, amanhã, sexta ou uma data.'
}

function buildPeriodQuestion() {
  return 'Perfeito. Você prefere manhã, tarde ou noite?'
}

function buildNoAvailabilityMessage(dateIso: string) {
  return `Não encontrei horário livre em ${formatDayLabel(dateIso).toLowerCase()} com essa combinação. Me fala outro dia ou outro período que eu procuro de novo.`
}

function buildSpecificProfessionalNoAvailabilityMessage(dateIso: string, professionalName: string) {
  const dayLabel = formatDayLabel(dateIso)
  return `${dayLabel} o ${professionalName} não tem mais horários disponíveis. Quer ver com outro barbeiro?`
}

function buildHumanSlotOfferMessage(slots: ConversationSlot[], serviceName: string) {
  const sameDay = slots.every((slot) => slot.dateIso === slots[0]?.dateIso)
  const sameProfessional = slots.every((slot) => slot.professionalId === slots[0]?.professionalId)

  let header = `Encontrei estes horários disponíveis para ${serviceName}:`
  if (sameDay && sameProfessional) {
    header = `${formatDayLabel(slots[0].dateIso)} o ${slots[0].professionalName} tem estes horários disponíveis para ${serviceName}:`
  } else if (sameDay) {
    header = `${formatDayLabel(slots[0].dateIso)} encontrei estes horários disponíveis para ${serviceName}:`
  }

  const lines = slots.map((slot) => {
    if (sameDay && sameProfessional) {
      return `• ${slot.timeLabel}`
    }

    if (sameDay) {
      return `• ${slot.timeLabel} com ${slot.professionalName}`
    }

    return `• ${formatDayLabel(slot.dateIso)} às ${slot.timeLabel} com ${slot.professionalName}`
  })

  return `${header}\n\n${lines.join('\n')}\n\nPode me dizer qual prefere ou pedir outro horário.`
}

function buildConfirmationMessage(slot: ConversationSlot, serviceName: string) {
  return `Posso confirmar ${serviceName} para ${formatDayLabel(slot.dateIso).toLowerCase()} às ${slot.timeLabel} com ${slot.professionalName}? Me responde com sim para eu fechar.`
}

function buildSuccessMessage(slot: ConversationSlot, serviceName: string) {
  return `Agendamento confirmado: ${serviceName} em ${formatDayLabel(slot.dateIso).toLowerCase()} às ${slot.timeLabel} com ${slot.professionalName}. Se quiser ajustar depois, me chama por aqui.`
}

function buildRescheduleMessage() {
  return 'Sem problema. Me fala outro horário, outro período ou outro dia que eu busco novas opções.'
}

function buildCustomerReferenceMessage(match: CustomerNameMatch, professionals: NameMatch[]) {
  const appointmentHint = match.nextAppointmentAt
    ? ` que já tem horário marcado com ${match.nextAppointmentProfessionalName ?? 'a equipe'}`
    : ''

  return `Você quis dizer o cliente ${match.name}${appointmentHint}? Se estiver procurando um barbeiro, posso te mostrar horários com ${professionals.map((professional) => professional.name).join(', ')}.`
}

function buildAmbiguousNameMessage(name: string, professionals: NameMatch[]) {
  return `Encontrei "${name}" tanto como barbeiro quanto como cliente. Você está procurando um barbeiro ou o cliente? Se quiser, posso te mostrar os barbeiros disponíveis: ${professionals.map((professional) => professional.name).join(', ')}.`
}

function buildProfessionalNotFoundMessage(name: string, professionals: NameMatch[]) {
  return `Não encontrei barbeiro com o nome ${name}. Posso te mostrar horários com ${professionals.map((professional) => professional.name).join(', ')}.`
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
  existingValue: string | null
}) {
  if (input.exactTime) {
    return input.exactTime
  }

  if (input.timePreference && input.timePreference !== 'NONE') {
    return input.timePreference
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

async function offerFreshSlots(input: {
  conversationId: string
  customerId: string
  conversationStep: ConversationState
  baseUpdate: {
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
  barbershopId: string
  requestedDateIso: string
  serviceId: string
  serviceName: string
  professionalId: string | null
  professionalName: string | null
  timePreference: string | null
  exactTime: string | null
  usedAI: boolean
}): Promise<ConversationServiceResult> {
  const availability = await getAvailableWhatsAppSlots({
    barbershopId: input.barbershopId,
    serviceId: input.serviceId,
    dateIso: input.requestedDateIso,
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
    const responseText = input.professionalId && input.professionalName
      ? buildSpecificProfessionalNoAvailabilityMessage(input.requestedDateIso, input.professionalName)
      : buildNoAvailabilityMessage(input.requestedDateIso)

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

  const responseText = buildHumanSlotOfferMessage(availability.slots, input.serviceName)

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
  const { services, professionals } = await loadBarbershopSchedulingOptions(input.barbershop.id)
  const conversation = await getOrCreateConversation({
    barbershopId: input.barbershop.id,
    customerId: input.customer.id,
    phone: input.customer.phone ?? null,
  })

  if (services.length === 0 || professionals.length === 0) {
    const responseText = 'Ainda não consigo fechar agendamento por aqui porque a agenda da barbearia ainda está sem serviços ou profissionais ativos.'

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
  const offeredSlots = parseConversationSlots(conversation.slotOptions)
  const selectedStoredSlot = parseSelectedSlot(conversation.selectedSlot)

  const interpreted = await interpretWhatsAppMessage({
    message: inboundText,
    barbershopName: input.barbershop.name,
    conversationState: currentState,
    offeredSlotCount: offeredSlots.length,
    services: services.map((service) => ({ name: service.name })),
    professionals: professionals.map((professional) => ({ name: professional.name })),
    todayIsoDate: formatDateIso(new Date()),
  })

  const usedAI = interpreted.source === 'openai'
  const bookingRequested = isBookingEntryPoint(currentState, interpreted.intent)
  const matchedService =
    currentState === 'WAITING_SERVICE' || currentState === 'IDLE'
      ? services.find((service) => normalizeText(service.name) === normalizeText(interpreted.serviceName ?? ''))
        ?? services.find((service) => normalizeText(interpreted.serviceName ?? '').includes(normalizeText(service.name)))
        ?? null
      : null

  const requestedDateIso =
    interpreted.requestedDateIso
    ?? conversationRequestedDateIso

  const nameResolution = await resolveMentionedName({
    rawName: normalizeOptionalText(interpreted.mentionedName),
    barbershopId: input.barbershop.id,
    requestedDateIso,
    professionals: professionals.map((professional) => ({ id: professional.id, name: professional.name })),
  })

  const acceptedAlternativeProfessional =
    currentState === 'WAITING_PROFESSIONAL'
    && Boolean(conversation.selectedProfessionalId)
    && Boolean(conversation.lastAssistantText?.includes('Quer ver com outro barbeiro?'))
    && interpreted.intent === 'CONFIRM'
    && nameResolution.action === 'none'

  let selectedServiceId =
    matchedService?.id
    ?? conversation.selectedServiceId
    ?? null
  let selectedServiceName =
    matchedService?.name
    ?? conversation.selectedServiceName
    ?? null

  if (currentState !== 'WAITING_SERVICE' && currentState !== 'IDLE' && !matchedService) {
    selectedServiceId = conversation.selectedServiceId ?? null
    selectedServiceName = conversation.selectedServiceName ?? null
  }

  let selectedProfessionalId = conversation.selectedProfessionalId ?? null
  let selectedProfessionalName = conversation.selectedProfessionalName ?? null
  let allowAnyProfessional = conversation.allowAnyProfessional

  if (nameResolution.action === 'professional' && nameResolution.resolvedProfessional) {
    selectedProfessionalId = nameResolution.resolvedProfessional.id
    selectedProfessionalName = nameResolution.resolvedProfessional.name
    allowAnyProfessional = false
  }

  if (interpreted.allowAnyProfessional || acceptedAlternativeProfessional) {
    selectedProfessionalId = null
    selectedProfessionalName = null
    allowAnyProfessional = true
  }

  const hasNewTimePreference =
    Boolean(interpreted.exactTime)
    || Boolean(interpreted.timePreference && interpreted.timePreference !== 'NONE')
  const serviceChanged =
    Boolean(selectedServiceId && selectedServiceId !== conversation.selectedServiceId)
  const professionalChanged =
    selectedProfessionalId !== (conversation.selectedProfessionalId ?? null)
    || allowAnyProfessional !== conversation.allowAnyProfessional
  const dateChanged = requestedDateIso !== conversationRequestedDateIso
  const shouldResetTimePreference =
    !hasNewTimePreference
    && (serviceChanged || professionalChanged || dateChanged)

  const requestedTimeLabel = shouldResetTimePreference
    ? null
    : resolveRequestedTimeLabel({
        exactTime: interpreted.exactTime,
        timePreference: interpreted.timePreference,
        existingValue: conversation.requestedTimeLabel,
      })
  const shouldDiscardStoredSlots =
    serviceChanged
    || professionalChanged
    || dateChanged
    || shouldResetTimePreference
  const effectiveOfferedSlots = shouldDiscardStoredSlots ? [] : offeredSlots
  const effectiveSelectedStoredSlot = shouldDiscardStoredSlots ? null : selectedStoredSlot

  if (shouldDiscardStoredSlots) {
    console.info('[whatsapp-conversation] cleared stale availability context', {
      customerId: input.customer.id,
      serviceChanged,
      professionalChanged,
      dateChanged,
      resetTimePreference: shouldResetTimePreference,
      previousRequestedTimeLabel: conversation.requestedTimeLabel,
      nextRequestedTimeLabel: requestedTimeLabel,
    })
  }

  const baseUpdate = {
    lastInboundText: inboundText,
    lastIntent: buildJsonValue(interpreted),
    selectedServiceId,
    selectedServiceName,
    selectedProfessionalId,
    selectedProfessionalName,
    allowAnyProfessional,
    requestedDate: requestedDateIso ? new Date(`${requestedDateIso}T12:00:00`) : null,
    requestedTimeLabel,
  }

  if (nameResolution.action === 'customer_reference') {
    const responseText = buildCustomerReferenceMessage(
      nameResolution.customerMatches[0],
      professionals.map((professional) => ({ id: professional.id, name: professional.name }))
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
    const responseText = buildAmbiguousNameMessage(
      nameResolution.receivedName,
      nameResolution.professionalMatches
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
    const responseText = buildProfessionalNotFoundMessage(
      nameResolution.receivedName,
      professionals.map((professional) => ({ id: professional.id, name: professional.name }))
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

  if (!bookingRequested && currentState === 'IDLE') {
    const responseText = buildGreeting(input.barbershop.name, input.customer.created ? null : input.customer.name)

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: 'IDLE',
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

  if (!selectedServiceId || !selectedServiceName) {
    const responseText = buildServiceQuestion(services.map((service) => service.name))

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

  if (!allowAnyProfessional && !selectedProfessionalId) {
    const responseText = professionals.length === 1
      ? buildDateQuestion()
      : buildProfessionalQuestion(professionals.map((professional) => professional.name))

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: professionals.length === 1 ? 'WAITING_DATE' : 'WAITING_PROFESSIONAL',
        selectedProfessionalId: professionals.length === 1 ? professionals[0].id : null,
        selectedProfessionalName: professionals.length === 1 ? professionals[0].name : null,
        allowAnyProfessional,
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: professionals.length === 1 ? 'collect_date' : 'collect_professional',
      conversationId: conversation.id,
      conversationState: professionals.length === 1 ? 'WAITING_DATE' : 'WAITING_PROFESSIONAL',
      usedAI,
    }
  }

  if (!requestedDateIso) {
    const responseText = buildDateQuestion()

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

  if (currentState === 'WAITING_CONFIRMATION' && interpreted.intent === 'DECLINE') {
    const responseText = buildRescheduleMessage()

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

  if (!hasResolvedTimePreference(requestedTimeLabel)) {
    const responseText = buildPeriodQuestion()

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
    offeredSlots: effectiveOfferedSlots,
    selectedOptionNumber: interpreted.selectedOptionNumber,
    exactTime: interpreted.exactTime,
    message: inboundText,
  })

  let slotForConfirmation: ConversationSlot | null = null

  if (selectedOfferedSlot) {
    slotForConfirmation = await findExactAvailableWhatsAppSlot({
      barbershopId: input.barbershop.id,
      serviceId: selectedServiceId,
      professionalId: selectedOfferedSlot.professionalId,
      dateIso: selectedOfferedSlot.dateIso,
      timeLabel: selectedOfferedSlot.timeLabel,
    })

    if (!slotForConfirmation) {
      return offerFreshSlots({
        conversationId: conversation.id,
        customerId: input.customer.id,
        conversationStep: currentState,
        baseUpdate,
        barbershopId: input.barbershop.id,
        requestedDateIso,
        serviceId: selectedServiceId,
        serviceName: selectedServiceName,
        professionalId: allowAnyProfessional ? null : selectedProfessionalId,
        professionalName: allowAnyProfessional ? null : selectedProfessionalName,
        timePreference: interpreted.timePreference,
        exactTime: interpreted.exactTime,
        usedAI,
      })
    }
  }

  if (!slotForConfirmation && interpreted.exactTime) {
    if (selectedProfessionalId) {
      slotForConfirmation = await findExactAvailableWhatsAppSlot({
        barbershopId: input.barbershop.id,
        serviceId: selectedServiceId,
        professionalId: selectedProfessionalId,
        dateIso: requestedDateIso,
        timeLabel: interpreted.exactTime,
      })
    }

    if (!slotForConfirmation) {
      return offerFreshSlots({
        conversationId: conversation.id,
        customerId: input.customer.id,
        conversationStep: currentState,
        baseUpdate,
        barbershopId: input.barbershop.id,
        requestedDateIso,
        serviceId: selectedServiceId,
        serviceName: selectedServiceName,
        professionalId: allowAnyProfessional ? null : selectedProfessionalId,
        professionalName: allowAnyProfessional ? null : selectedProfessionalName,
        timePreference: 'EXACT',
        exactTime: interpreted.exactTime,
        usedAI,
      })
    }
  }

  if (!slotForConfirmation && currentState === 'WAITING_CONFIRMATION' && effectiveSelectedStoredSlot) {
    slotForConfirmation = await findExactAvailableWhatsAppSlot({
      barbershopId: input.barbershop.id,
      serviceId: selectedServiceId,
      professionalId: effectiveSelectedStoredSlot.professionalId,
      dateIso: effectiveSelectedStoredSlot.dateIso,
      timeLabel: effectiveSelectedStoredSlot.timeLabel,
    })

    if (!slotForConfirmation) {
      return offerFreshSlots({
        conversationId: conversation.id,
        customerId: input.customer.id,
        conversationStep: currentState,
        baseUpdate,
        barbershopId: input.barbershop.id,
        requestedDateIso,
        serviceId: selectedServiceId,
        serviceName: selectedServiceName,
        professionalId: allowAnyProfessional ? null : selectedProfessionalId,
        professionalName: allowAnyProfessional ? null : selectedProfessionalName,
        timePreference: requestedTimeLabel,
        exactTime: requestedTimeLabel?.includes(':') ? requestedTimeLabel : null,
        usedAI,
      })
    }
  }

  if (!slotForConfirmation) {
    return offerFreshSlots({
      conversationId: conversation.id,
      customerId: input.customer.id,
      conversationStep: currentState,
      baseUpdate,
      barbershopId: input.barbershop.id,
      requestedDateIso,
      serviceId: selectedServiceId,
      serviceName: selectedServiceName,
      professionalId: allowAnyProfessional ? null : selectedProfessionalId,
      professionalName: allowAnyProfessional ? null : selectedProfessionalName,
      timePreference: interpreted.timePreference !== 'NONE' ? interpreted.timePreference : requestedTimeLabel,
      exactTime: interpreted.exactTime,
      usedAI,
    })
  }

  if (currentState !== 'WAITING_CONFIRMATION' || interpreted.intent !== 'CONFIRM') {
    const responseText = buildConfirmationMessage(slotForConfirmation, selectedServiceName)

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
      serviceId: selectedServiceId,
      professionalId: slotForConfirmation.professionalId,
      startAtIso: slotForConfirmation.startAtIso,
      sourceReference: `whatsapp:${conversation.id}:${input.eventId}`,
      notes: 'Agendamento criado via fluxo conversacional do WhatsApp.',
    })

    const responseText = buildSuccessMessage(slotForConfirmation, selectedServiceName)

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
      serviceId: selectedServiceId,
      professionalId: slotForConfirmation.professionalId,
      startAtIso: slotForConfirmation.startAtIso,
    })

    return offerFreshSlots({
      conversationId: conversation.id,
      customerId: input.customer.id,
      conversationStep: currentState,
      baseUpdate,
      barbershopId: input.barbershop.id,
      requestedDateIso,
      serviceId: selectedServiceId,
      serviceName: selectedServiceName,
      professionalId: allowAnyProfessional ? null : selectedProfessionalId,
      professionalName: allowAnyProfessional ? null : selectedProfessionalName,
      timePreference: requestedTimeLabel,
      exactTime: requestedTimeLabel?.includes(':') ? requestedTimeLabel : null,
      usedAI,
    })
  }
}
