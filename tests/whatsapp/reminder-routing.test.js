const test = require('node:test')
const assert = require('node:assert/strict')

const { prisma } = require('@/lib/prisma')
const conversationModule = require('@/lib/whatsapp-conversation')
const bookingModule = require('@/lib/agendamentos/whatsapp-booking')
const reminderModule = require('@/lib/whatsapp-appointment-reminders')
const appointmentOpsModule = require('@/lib/agendamentos/whatsapp-appointment-operations')
const preferredProfessionalModule = require('@/lib/customers/preferred-professional')
const agentModule = require('@/lib/ai/openai-whatsapp-agent')
const interpreterModule = require('@/lib/ai/openai-whatsapp-interpreter')

function getDateIsoInTimezone(date, timeZone = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function shiftDateIso(dateIso, days) {
  const [year, month, day] = dateIso.split('-').map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  anchor.setUTCDate(anchor.getUTCDate() + days)
  return anchor.toISOString().slice(0, 10)
}

function buildReminderContext(overrides = {}) {
  const now = new Date()
  const timezone = overrides.timezone ?? 'America/Sao_Paulo'
  const dateIso = overrides.dateIso ?? getDateIsoInTimezone(now, timezone)
  const startAt = overrides.startAt ?? now
  const endAt = overrides.endAt ?? new Date(startAt.getTime() + 45 * 60_000)

  return {
    id: 'apt-1',
    barbershopId: 'shop-1',
    barbershopSlug: 'linha-nobre',
    customerId: 'customer-1',
    customerPhone: '5511999991234',
    customerName: 'Bruno',
    barbershopName: 'Barbearia Linha Nobre',
    timezone,
    serviceId: 'svc-1',
    serviceName: 'Barba Terapia',
    professionalId: 'pro-1',
    professionalName: 'Rafael Costa',
    source: 'WHATSAPP',
    status: 'PENDING',
    startAt,
    endAt,
    dateIso,
    dateLabel: overrides.dateLabel ?? 'Hoje',
    timeLabel: overrides.timeLabel ?? '11:30',
    confirmationReminderSentAt: overrides.confirmationReminderSentAt ?? new Date(now.getTime() - 5 * 60_000),
    confirmationRequestedAt: overrides.confirmationRequestedAt ?? new Date(now.getTime() - 5 * 60_000),
    ...overrides,
  }
}

function toManagedAppointment(reminder) {
  return {
    id: reminder.id,
    barbershopId: reminder.barbershopId,
    customerId: reminder.customerId,
    serviceId: reminder.serviceId,
    serviceName: reminder.serviceName,
    professionalId: reminder.professionalId,
    professionalName: reminder.professionalName,
    status: reminder.status,
    startAtIso: reminder.startAt.toISOString(),
    endAtIso: reminder.endAt.toISOString(),
    dateIso: reminder.dateIso,
    dateLabel: reminder.dateLabel,
    timeLabel: reminder.timeLabel,
  }
}

function buildConversationRecord(overrides = {}) {
  return {
    id: 'conv-1',
    barbershopId: 'shop-1',
    customerId: 'customer-1',
    phone: '5511999991234',
    state: 'IDLE',
    selectedServiceId: null,
    selectedServiceName: null,
    selectedProfessionalId: null,
    selectedProfessionalName: null,
    allowAnyProfessional: false,
    requestedDate: null,
    requestedTimeLabel: null,
    slotOptions: null,
    selectedSlot: null,
    conversationSummary: null,
    bookingDraft: null,
    recentCorrections: null,
    lastInboundText: null,
    lastAssistantText: null,
    lastIntent: null,
    completedAt: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildAgentFallbackResult() {
  return {
    responseText: 'Perfeito! Temos estes servicos disponiveis:\n\n- Barba Terapia\n- Corte Classic\n\nQual voce gostaria de agendar?',
    flow: 'collect_service',
    conversationState: 'WAITING_SERVICE',
    usedAI: false,
    shouldCreateAppointment: false,
    structured: {
      nextAction: 'ASK_SERVICE',
    },
    memory: {
      selectedServiceId: null,
      selectedServiceName: null,
      selectedProfessionalId: null,
      selectedProfessionalName: null,
      professionalSelectionReason: null,
      allowAnyProfessional: false,
      requestedDateIso: null,
      requestedTimeLabel: null,
      offeredSlots: [],
      selectedSlot: null,
      pendingServiceOptions: [],
      pendingProfessionalOptions: [],
      conversationSummary: null,
      recentCorrections: [],
    },
    toolTrace: [],
  }
}

async function withReminderRoutingMocks(config, fn) {
  const originals = {
    whatsappConversationUpsert: prisma.whatsappConversation.upsert,
    whatsappConversationUpdate: prisma.whatsappConversation.update,
    messagingEventFindMany: prisma.messagingEvent.findMany,
    loadBarbershopSchedulingOptions: bookingModule.loadBarbershopSchedulingOptions,
    cancelAppointmentFromWhatsApp: appointmentOpsModule.cancelAppointmentFromWhatsApp,
    findPendingReminderAppointmentsForCustomer: reminderModule.findPendingReminderAppointmentsForCustomer,
    findExpiredReminderAppointmentsForCustomer: reminderModule.findExpiredReminderAppointmentsForCustomer,
    confirmAppointmentPresenceFromReminder: reminderModule.confirmAppointmentPresenceFromReminder,
    markAppointmentReminderResponse: reminderModule.markAppointmentReminderResponse,
    resolveCustomerPreferredProfessional: preferredProfessionalModule.resolveCustomerPreferredProfessional,
    processWhatsAppConversationWithAgent: agentModule.processWhatsAppConversationWithAgent,
    interpretWhatsAppMessage: interpreterModule.interpretWhatsAppMessage,
  }

  const conversationRecord = buildConversationRecord(config.conversation)
  const updates = []
  const reminderQueryCalls = []
  const expiredReminderQueryCalls = []
  const confirmCalls = []
  const markCalls = []
  const cancelCalls = []

  prisma.whatsappConversation.upsert = async () => ({ ...conversationRecord })
  prisma.whatsappConversation.update = async ({ data }) => {
    Object.assign(conversationRecord, data, { updatedAt: new Date() })
    updates.push(data)
    return { ...conversationRecord }
  }
  prisma.messagingEvent.findMany = async () => []

  bookingModule.loadBarbershopSchedulingOptions = async () => ({
    services: [
      { id: 'svc-1', name: 'Barba Terapia' },
      { id: 'svc-2', name: 'Corte Classic' },
    ],
    professionals: [
      { id: 'pro-1', name: 'Rafael Costa' },
      { id: 'pro-2', name: 'Matheus Lima' },
    ],
  })

  appointmentOpsModule.cancelAppointmentFromWhatsApp = async (args) => {
    cancelCalls.push(args)
    return config.cancelResult ?? {
      ...toManagedAppointment(config.pendingReminders?.[0] ?? buildReminderContext()),
      status: 'CANCELLED',
    }
  }

  reminderModule.findPendingReminderAppointmentsForCustomer = async (args) => {
    reminderQueryCalls.push(args)
    return config.pendingReminders ?? []
  }
  reminderModule.findExpiredReminderAppointmentsForCustomer = async (args) => {
    expiredReminderQueryCalls.push(args)
    return config.expiredReminders ?? []
  }
  reminderModule.confirmAppointmentPresenceFromReminder = async (args) => {
    confirmCalls.push(args)
    return config.confirmResult ?? { count: 1 }
  }
  reminderModule.markAppointmentReminderResponse = async (args) => {
    markCalls.push(args)
    return config.markResult ?? { count: 1 }
  }

  preferredProfessionalModule.resolveCustomerPreferredProfessional = async () => ({
    professionalId: null,
    professionalName: null,
    reason: 'none',
    completedAppointmentsCount: 0,
  })

  agentModule.processWhatsAppConversationWithAgent = async () => buildAgentFallbackResult()
  interpreterModule.interpretWhatsAppMessage = async () => ({
    source: 'fallback',
    intent: 'UNKNOWN',
    serviceName: null,
    mentionedName: null,
    preferredPeriod: null,
    allowAnyProfessional: false,
    requestedDateIso: null,
    timePreference: 'NONE',
    exactTime: null,
    selectedOptionNumber: null,
    correctionTarget: 'NONE',
    greetingOnly: true,
    restartConversation: false,
    confidence: 0.9,
    reasoning: 'test',
  })

  try {
    return await fn({
      conversationRecord,
      updates,
      reminderQueryCalls,
      expiredReminderQueryCalls,
      confirmCalls,
      markCalls,
      cancelCalls,
    })
  } finally {
    prisma.whatsappConversation.upsert = originals.whatsappConversationUpsert
    prisma.whatsappConversation.update = originals.whatsappConversationUpdate
    prisma.messagingEvent.findMany = originals.messagingEventFindMany
    bookingModule.loadBarbershopSchedulingOptions = originals.loadBarbershopSchedulingOptions
    appointmentOpsModule.cancelAppointmentFromWhatsApp = originals.cancelAppointmentFromWhatsApp
    reminderModule.findPendingReminderAppointmentsForCustomer = originals.findPendingReminderAppointmentsForCustomer
    reminderModule.findExpiredReminderAppointmentsForCustomer = originals.findExpiredReminderAppointmentsForCustomer
    reminderModule.confirmAppointmentPresenceFromReminder = originals.confirmAppointmentPresenceFromReminder
    reminderModule.markAppointmentReminderResponse = originals.markAppointmentReminderResponse
    preferredProfessionalModule.resolveCustomerPreferredProfessional = originals.resolveCustomerPreferredProfessional
    agentModule.processWhatsAppConversationWithAgent = originals.processWhatsAppConversationWithAgent
    interpreterModule.interpretWhatsAppMessage = originals.interpretWhatsAppMessage
  }
}

function buildProcessInput(overrides = {}) {
  return {
    barbershop: {
      id: 'shop-1',
      name: 'Barbearia Linha Nobre',
      slug: 'linha-nobre',
      timezone: 'America/Sao_Paulo',
      ...(overrides.barbershop ?? {}),
    },
    customer: {
      id: 'customer-1',
      name: 'Bruno',
      created: false,
      phone: '5511999991234',
      ...(overrides.customer ?? {}),
    },
    inboundText: overrides.inboundText ?? 'Oi',
    rawMessages: overrides.rawMessages ?? [],
    eventId: overrides.eventId ?? 'event-1',
    instanceName: overrides.instanceName ?? 'linha-nobre',
  }
}

test('cliente responde 1 com reminder pendente e confirma sem listar servicos', async () => {
  const pendingReminder = buildReminderContext()

  await withReminderRoutingMocks(
    {
      pendingReminders: [pendingReminder],
    },
    async ({ confirmCalls, conversationRecord }) => {
      const result = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: '1' })
      )

      assert.match(result.responseText, /presenca confirmada/i)
      assert.doesNotMatch(result.responseText, /Temos estes servicos disponiveis/i)
      assert.equal(confirmCalls.length, 1)
      assert.equal(confirmCalls[0].appointmentId, pendingReminder.id)
      assert.equal(conversationRecord.state, 'IDLE')
    }
  )
})

test('cliente responde oi com reminder pendente e o fluxo nao reinicia', async () => {
  const pendingReminder = buildReminderContext()

  await withReminderRoutingMocks(
    {
      pendingReminders: [pendingReminder],
    },
    async ({ confirmCalls, conversationRecord }) => {
      const result = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: 'Oi' })
      )

      assert.match(result.responseText, /1 - Confirmo/i)
      assert.match(result.responseText, /2 - Quero remarcar/i)
      assert.equal(confirmCalls.length, 0)
      assert.equal(result.conversationState, 'WAITING_REMINDER_RESPONSE')
      assert.equal(conversationRecord.state, 'WAITING_REMINDER_RESPONSE')
    }
  )
})

test('cliente responde oi e depois 1 e confirma o mesmo reminder pendente', async () => {
  const pendingReminder = buildReminderContext()

  await withReminderRoutingMocks(
    {
      pendingReminders: [pendingReminder],
    },
    async ({ confirmCalls, conversationRecord }) => {
      const firstResult = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: 'Oi' })
      )
      const secondResult = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: '1' })
      )

      assert.equal(firstResult.conversationState, 'WAITING_REMINDER_RESPONSE')
      assert.match(secondResult.responseText, /presenca confirmada/i)
      assert.equal(confirmCalls.length, 1)
      assert.equal(confirmCalls[0].appointmentId, pendingReminder.id)
      assert.equal(conversationRecord.state, 'IDLE')
    }
  )
})

test('fallback stateless confirma pelo banco mesmo sem estado salvo', async () => {
  const pendingReminder = buildReminderContext()

  await withReminderRoutingMocks(
    {
      pendingReminders: [pendingReminder],
      conversation: {
        state: 'IDLE',
        bookingDraft: null,
      },
    },
    async ({ confirmCalls }) => {
      const result = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: '1' })
      )

      assert.match(result.responseText, /presenca confirmada/i)
      assert.equal(confirmCalls.length, 1)
      assert.equal(confirmCalls[0].appointmentId, pendingReminder.id)
    }
  )
})

test('cliente responde 2 e entra em remarcacao do appointment correto', async () => {
  const pendingReminder = buildReminderContext()

  await withReminderRoutingMocks(
    {
      pendingReminders: [pendingReminder],
    },
    async ({ markCalls, conversationRecord }) => {
      const result = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: '2' })
      )

      assert.match(result.responseText, /Para qual dia e horario voce quer remarcar/i)
      assert.equal(markCalls.length, 1)
      assert.equal(markCalls[0].responseStatus, 'RESCHEDULE_REQUESTED')
      assert.equal(conversationRecord.state, 'WAITING_RESCHEDULE_TIME')
    }
  )
})

test('cliente responde 3 e cancela o appointment correto', async () => {
  const pendingReminder = buildReminderContext()

  await withReminderRoutingMocks(
    {
      pendingReminders: [pendingReminder],
    },
    async ({ markCalls, cancelCalls, conversationRecord }) => {
      const result = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: '3' })
      )

      assert.match(result.responseText, /foi cancelado/i)
      assert.equal(markCalls.length, 1)
      assert.equal(markCalls[0].responseStatus, 'CANCELLATION_REQUESTED')
      assert.equal(cancelCalls.length, 1)
      assert.equal(cancelCalls[0].appointmentId, pendingReminder.id)
      assert.equal(conversationRecord.state, 'IDLE')
    }
  )
})

test('reminder expirado nao confirma mais o horario e responde com a janela encerrada', async () => {
  const expiredReminder = buildReminderContext({
    startAt: new Date(Date.now() - 60 * 60_000),
    endAt: new Date(Date.now() - 15 * 60_000),
  })

  await withReminderRoutingMocks(
    {
      pendingReminders: [],
      expiredReminders: [expiredReminder],
    },
    async ({ confirmCalls, expiredReminderQueryCalls }) => {
      const result = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: '1' })
      )

      assert.match(result.responseText, /Nao recebemos sua confirmacao a tempo/i)
      assert.equal(confirmCalls.length, 0)
      assert.equal(expiredReminderQueryCalls.length > 0, true)
    }
  )
})

test('sem reminder pendente o oi continua no fluxo normal e nao ativa 1 2 3', async () => {
  await withReminderRoutingMocks(
    {
      pendingReminders: [],
      expiredReminders: [],
    },
    async ({ confirmCalls, conversationRecord }) => {
      const result = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: 'Oi' })
      )

      assert.doesNotMatch(result.responseText, /1 - Confirmo/i)
      assert.equal(confirmCalls.length, 0)
      assert.notEqual(conversationRecord.state, 'WAITING_REMINDER_RESPONSE')
    }
  )
})

test('quero confirmar meu horario lista appointments pendentes e salva estado de selecao', async () => {
  const todayIso = getDateIsoInTimezone(new Date())
  const tomorrowIso = shiftDateIso(todayIso, 1)
  const pendingReminders = [
    buildReminderContext({
      id: 'apt-hoje',
      dateIso: todayIso,
      dateLabel: 'Hoje',
      timeLabel: '11:30',
      professionalName: 'Rafael Costa',
      serviceName: 'Barba Terapia',
    }),
    buildReminderContext({
      id: 'apt-amanha',
      dateIso: tomorrowIso,
      dateLabel: 'Amanha',
      timeLabel: '12:00',
      professionalId: 'pro-2',
      professionalName: 'Matheus Lima',
      serviceId: 'svc-2',
      serviceName: 'Pigmentacao Natural',
    }),
  ]

  await withReminderRoutingMocks(
    {
      pendingReminders,
    },
    async ({ conversationRecord }) => {
      const result = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: 'Quero confirmar meu horario' })
      )

      assert.match(result.responseText, /Seus proximos horarios agendados sao/i)
      assert.match(result.responseText, /1\./)
      assert.match(result.responseText, /2\./)
      assert.equal(conversationRecord.state, 'WAITING_REMINDER_RESPONSE')
      assert.equal(conversationRecord.bookingDraft?.appointments?.length ?? 0, 2)
    }
  )
})

test('apos listar duas opcoes, confirma o de hoje resolve o appointment correto', async () => {
  const todayIso = getDateIsoInTimezone(new Date())
  const tomorrowIso = shiftDateIso(todayIso, 1)
  const pendingReminders = [
    buildReminderContext({
      id: 'apt-hoje',
      dateIso: todayIso,
      dateLabel: 'Hoje',
      timeLabel: '11:30',
      professionalName: 'Rafael Costa',
      serviceName: 'Barba Terapia',
    }),
    buildReminderContext({
      id: 'apt-amanha',
      dateIso: tomorrowIso,
      dateLabel: 'Amanha',
      timeLabel: '12:00',
      professionalId: 'pro-2',
      professionalName: 'Matheus Lima',
      serviceId: 'svc-2',
      serviceName: 'Pigmentacao Natural',
    }),
  ]

  await withReminderRoutingMocks(
    {
      pendingReminders,
      conversation: {
        state: 'WAITING_REMINDER_RESPONSE',
        bookingDraft: {
          kind: 'reminder',
          appointments: pendingReminders.map(toManagedAppointment),
          selectedAppointmentId: null,
          offeredSlots: [],
          selectedSlot: null,
          pendingProfessionalOptions: [],
          requestedDateIso: null,
          requestedTimeLabel: null,
          selectedProfessionalId: null,
          selectedProfessionalName: null,
          allowAnyProfessional: false,
          triggeredByReminder: true,
          reminderPromptedAtIso: new Date().toISOString(),
        },
      },
    },
    async ({ confirmCalls }) => {
      const result = await conversationModule.processWhatsAppConversation(
        buildProcessInput({ inboundText: 'confirma o de hoje' })
      )

      assert.match(result.responseText, /11:30/i)
      assert.match(result.responseText, /Rafael Costa/i)
      assert.equal(confirmCalls.length, 1)
      assert.equal(confirmCalls[0].appointmentId, 'apt-hoje')
      assert.doesNotMatch(result.responseText, /Degrade Signature/i)
    }
  )
})

test('usa o tenant atual para buscar reminders pendentes e nao mistura barbearias', async () => {
  await withReminderRoutingMocks(
    {
      pendingReminders: [],
    },
    async ({ reminderQueryCalls }) => {
      await conversationModule.processWhatsAppConversation(
        buildProcessInput({
          barbershop: {
            id: 'shop-konoha',
            name: 'Konoha',
            slug: 'konoha',
          },
          instanceName: 'konoha',
          inboundText: '1',
        })
      )

      assert.equal(reminderQueryCalls[0]?.barbershopId, 'shop-konoha')
    }
  )
})
