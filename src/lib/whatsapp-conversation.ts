import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { interpretWhatsAppMessage } from '@/lib/ai/openai-whatsapp-interpreter'
import {
  createAppointmentFromWhatsApp,
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
    | 'offer_slots'
    | 'await_confirmation'
    | 'appointment_created'
    | 'reschedule'
  conversationId: string
  conversationState: ConversationState
  appointmentId?: string
  usedAI: boolean
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

function formatDateLabel(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`)
  return date.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
}

function formatSlotSummary(slot: ConversationSlot) {
  return `${formatDateLabel(slot.dateIso)} as ${slot.timeLabel} com ${slot.professionalName}`
}

function buildGreeting(barbershopName: string, customerName?: string | null) {
  const firstName = customerName?.trim()?.split(' ')[0]
  const greeting = firstName ? `Oi, ${firstName}!` : 'Oi!'
  return `${greeting} Posso te ajudar com seu agendamento na ${barbershopName}. Voce quer marcar um horario?`
}

function buildServiceQuestion(serviceNames: string[]) {
  const preview = serviceNames.slice(0, 6).join(', ')
  return `Perfeito. Qual servico voce quer agendar? ${preview ? `Hoje temos: ${preview}.` : ''}`.trim()
}

function buildProfessionalQuestion(professionalNames: string[]) {
  const preview = professionalNames.slice(0, 6).join(', ')
  return `Tem preferencia de barbeiro? ${preview ? `Posso agendar com ${preview}.` : ''} Se preferir, posso procurar com qualquer um.`
}

function buildDateQuestion() {
  return 'Qual dia voce prefere? Pode me falar algo como hoje, amanha, sexta ou uma data.'
}

function buildNoAvailabilityMessage(dateIso: string) {
  return `Nao encontrei horario livre em ${formatDateLabel(dateIso)} com essa combinacao. Me fala outro dia ou outro periodo que eu procuro de novo.`
}

function buildSlotOfferMessage(slots: ConversationSlot[], serviceName: string) {
  const options = slots
    .map((slot, index) => `${index + 1}) ${formatSlotSummary(slot)}`)
    .join(' | ')

  return `Encontrei estes horarios para ${serviceName}: ${options}. Me responde com o numero da opcao ou com outro horario.`
}

function buildConfirmationMessage(slot: ConversationSlot, serviceName: string) {
  return `Posso confirmar ${serviceName} para ${formatSlotSummary(slot)}? Me responde com sim para eu fechar.`
}

function buildSuccessMessage(slot: ConversationSlot, serviceName: string) {
  return `Agendamento confirmado: ${serviceName} em ${formatSlotSummary(slot)}. Se quiser ajustar depois, me chama por aqui.`
}

function buildRescheduleMessage() {
  return 'Sem problema. Me fala outro horario, outro periodo ou outro dia que eu busco novas opcoes.'
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

function isBookingEntryPoint(state: ConversationState, intent: string) {
  return intent === 'BOOK_APPOINTMENT' || (state === 'IDLE' && intent === 'CONFIRM')
}

function matchByName<T extends { id: string; name: string }>(items: T[], rawName?: string | null) {
  if (!rawName) {
    return null
  }

  const normalizedRaw = normalizeText(rawName)

  const exactMatch = items.find((item) => normalizeText(item.name) === normalizedRaw)
  if (exactMatch) {
    return exactMatch
  }

  const partialMatch = items.find((item) => normalizeText(item.name).includes(normalizedRaw))
  if (partialMatch) {
    return partialMatch
  }

  return items.find((item) => normalizedRaw.includes(normalizeText(item.name))) ?? null
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

export async function processWhatsAppConversation(input: ConversationServiceInput): Promise<ConversationServiceResult> {
  const inboundText = input.inboundText.trim()
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
  const offeredSlots = parseConversationSlots(conversation.slotOptions)
  const selectedStoredSlot = parseSelectedSlot(conversation.selectedSlot)

  const interpreted = await interpretWhatsAppMessage({
    message: inboundText,
    barbershopName: input.barbershop.name,
    conversationState: currentState,
    offeredSlotCount: offeredSlots.length,
    services: services.map((service) => ({ name: service.name })),
    professionals: professionals.map((professional) => ({ name: professional.name })),
    todayIsoDate: new Date().toISOString().slice(0, 10),
  })

  const matchedService = matchByName(services, interpreted.serviceName)
  const matchedProfessional = matchByName(professionals, interpreted.professionalName)
  const bookingRequested = isBookingEntryPoint(currentState, interpreted.intent)
  const selectedOfferedSlot = pickOfferedSlot({
    offeredSlots,
    selectedOptionNumber: interpreted.selectedOptionNumber,
    exactTime: interpreted.exactTime,
    message: inboundText,
  })

  const selectedServiceId = matchedService?.id ?? conversation.selectedServiceId ?? null
  const selectedServiceName = matchedService?.name ?? conversation.selectedServiceName ?? null
  const selectedProfessionalId =
    matchedProfessional?.id
    ?? (interpreted.allowAnyProfessional ? null : conversation.selectedProfessionalId ?? null)
  const selectedProfessionalName =
    matchedProfessional?.name
    ?? (interpreted.allowAnyProfessional ? null : conversation.selectedProfessionalName ?? null)
  const allowAnyProfessional = interpreted.allowAnyProfessional || conversation.allowAnyProfessional
  const requestedDateIso =
    interpreted.requestedDateIso
    ?? (conversation.requestedDate ? conversation.requestedDate.toISOString().slice(0, 10) : null)
  const requestedTimeLabel = resolveRequestedTimeLabel({
    exactTime: interpreted.exactTime,
    timePreference: interpreted.timePreference,
    existingValue: conversation.requestedTimeLabel,
  })

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
      usedAI: interpreted.source === 'openai',
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
      usedAI: interpreted.source === 'openai',
    }
  }

  if (!allowAnyProfessional && !selectedProfessionalId) {
    const responseText = professionals.length <= 1
      ? buildDateQuestion()
      : buildProfessionalQuestion(professionals.map((professional) => professional.name))

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: professionals.length <= 1 ? 'WAITING_DATE' : 'WAITING_PROFESSIONAL',
        selectedProfessionalId: professionals.length === 1 ? professionals[0]?.id ?? null : null,
        selectedProfessionalName: professionals.length === 1 ? professionals[0]?.name ?? null : null,
        allowAnyProfessional,
        slotOptions: JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: professionals.length <= 1 ? 'collect_date' : 'collect_professional',
      conversationId: conversation.id,
      conversationState: professionals.length <= 1 ? 'WAITING_DATE' : 'WAITING_PROFESSIONAL',
      usedAI: interpreted.source === 'openai',
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
      usedAI: interpreted.source === 'openai',
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
      usedAI: interpreted.source === 'openai',
    }
  }

  let slotForConfirmation = selectedStoredSlot

  if (selectedOfferedSlot) {
    slotForConfirmation = selectedOfferedSlot
  }

  const needsFreshSlotSearch =
    !slotForConfirmation
    || interpreted.intent === 'CHANGE_REQUEST'
    || currentState === 'WAITING_TIME'
    || currentState === 'WAITING_DATE'
    || Boolean(interpreted.exactTime)
    || interpreted.timePreference !== 'NONE'

  if (needsFreshSlotSearch && !slotForConfirmation) {
    const availability = await getAvailableWhatsAppSlots({
      barbershopId: input.barbershop.id,
      serviceId: selectedServiceId,
      dateIso: requestedDateIso,
      professionalId: allowAnyProfessional ? null : selectedProfessionalId,
      timePreference: interpreted.timePreference,
      exactTime: interpreted.exactTime,
      limit: 4,
    })

    if (availability.slots.length === 0) {
      const responseText = buildNoAvailabilityMessage(requestedDateIso)

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
        usedAI: interpreted.source === 'openai',
      }
    }

    if (interpreted.timePreference === 'EXACT' && interpreted.exactTime && availability.slots.length === 1) {
      slotForConfirmation = availability.slots[0]
    } else {
      const responseText = buildSlotOfferMessage(availability.slots, selectedServiceName)

      await prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: {
          ...baseUpdate,
          state: 'WAITING_TIME',
          slotOptions: buildJsonValue(availability.slots),
          selectedSlot: JSON_NULL,
          lastAssistantText: responseText,
        },
      })

      return {
        responseText,
        flow: 'offer_slots',
        conversationId: conversation.id,
        conversationState: 'WAITING_TIME',
        usedAI: interpreted.source === 'openai',
      }
    }
  }

  if (!slotForConfirmation) {
    const availability = await getAvailableWhatsAppSlots({
      barbershopId: input.barbershop.id,
      serviceId: selectedServiceId,
      dateIso: requestedDateIso,
      professionalId: allowAnyProfessional ? null : selectedProfessionalId,
      timePreference: requestedTimeLabel,
      exactTime: requestedTimeLabel?.includes(':') ? requestedTimeLabel : null,
      limit: 4,
    })

    const responseText = availability.slots.length > 0
      ? buildSlotOfferMessage(availability.slots, selectedServiceName)
      : buildNoAvailabilityMessage(requestedDateIso)

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: availability.slots.length > 0 ? 'WAITING_TIME' : 'WAITING_DATE',
        slotOptions: availability.slots.length > 0 ? buildJsonValue(availability.slots) : JSON_NULL,
        selectedSlot: JSON_NULL,
        lastAssistantText: responseText,
      },
    })

    return {
      responseText,
      flow: availability.slots.length > 0 ? 'offer_slots' : 'collect_date',
      conversationId: conversation.id,
      conversationState: availability.slots.length > 0 ? 'WAITING_TIME' : 'WAITING_DATE',
      usedAI: interpreted.source === 'openai',
    }
  }

  if (currentState !== 'WAITING_CONFIRMATION' || interpreted.intent !== 'CONFIRM') {
    const responseText = buildConfirmationMessage(slotForConfirmation, selectedServiceName)

    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        ...baseUpdate,
        state: 'WAITING_CONFIRMATION',
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
      usedAI: interpreted.source === 'openai',
    }
  }

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
    usedAI: interpreted.source === 'openai',
  }
}
