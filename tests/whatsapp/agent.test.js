const test = require('node:test')
const assert = require('node:assert/strict')

const { interpretWhatsAppMessage } = require('@/lib/ai/openai-whatsapp-interpreter')
const { __testing: agentTesting } = require('@/lib/ai/openai-whatsapp-agent')

const SERVICES = [
  { id: 'svc-classic', name: 'Corte Classic', duration: 35, price: 55 },
  { id: 'svc-barba', name: 'Barba', duration: 20, price: 35 },
]

const PROFESSIONALS = [
  { id: 'pro-matheus', name: 'Matheus' },
  { id: 'pro-lucas', name: 'Lucas' },
  { id: 'pro-rafael', name: 'Rafael Costa' },
]

function createAgentInput() {
  return {
    barbershop: {
      id: 'shop-1',
      name: 'Linha Nobre',
      slug: 'linha-nobre',
      timezone: 'America/Sao_Paulo',
    },
    customer: {
      id: 'cust-1',
      name: 'Gustavo',
      created: false,
      phone: '5541999999999',
    },
    inboundText: '',
    conversation: {
      id: 'conv-1',
      state: 'IDLE',
      updatedAt: new Date('2026-04-13T14:00:00.000Z'),
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
    },
    services: SERVICES,
    professionals: PROFESSIONALS,
    nowContext: {
      dateIso: '2026-04-13',
      dateTimeLabel: '2026-04-13 10:30',
      hour: 10,
      minute: 30,
    },
  }
}

function getConversationSummaryFromMemory(memory) {
  return {
    selectedServiceName: memory.selectedServiceName,
    selectedProfessionalName: memory.selectedProfessionalName,
    requestedDateIso: memory.requestedDateIso,
    requestedTimeLabel: memory.requestedTimeLabel,
    allowAnyProfessional: memory.allowAnyProfessional,
    lastCustomerMessage: null,
    lastAssistantMessage: null,
  }
}

async function interpretMessage(message, memory) {
  return interpretWhatsAppMessage({
    message,
    barbershopName: 'Linha Nobre',
    barbershopTimezone: 'America/Sao_Paulo',
    conversationState: memory.state,
    offeredSlotCount: memory.offeredSlots.length,
    services: SERVICES.map((service) => ({ name: service.name })),
    professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
    todayIsoDate: '2026-04-13',
    currentLocalDateTime: '2026-04-13 10:30',
    conversationSummary: getConversationSummaryFromMemory(memory),
  })
}

test('promove imediatamente data, servico e periodo para a memoria do agente', async () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())

  const dateIntent = await interpretMessage('Quero marcar horario hoje', memory)
  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: dateIntent,
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  assert.equal(memory.requestedDateIso, '2026-04-13')

  const serviceIntent = await interpretMessage('Corte classic', memory)
  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: serviceIntent,
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  assert.equal(memory.selectedServiceId, 'svc-classic')
  assert.equal(memory.selectedServiceName, 'Corte Classic')

  const periodIntent = await interpretMessage('Tarde', memory)
  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: periodIntent,
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  assert.equal(memory.requestedTimeLabel, 'AFTERNOON')
})

test('requestedDate promovido nao volta para null quando o cliente informa o servico no turno seguinte', async () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())

  const dateIntent = await interpretMessage('Quero marcar horario hoje', memory)
  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: dateIntent,
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  const serviceIntent = await interpretMessage('Corte classic', memory)
  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: serviceIntent,
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  assert.equal(memory.requestedDateIso, '2026-04-13')
  assert.equal(memory.selectedServiceId, 'svc-classic')
})

test('backend corrige nextAction quando a IA tenta perguntar algo ja preenchido', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())

  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-matheus'
  memory.selectedProfessionalName = 'Matheus'
  memory.requestedDateIso = '2026-04-13'
  memory.requestedTimeLabel = 'AFTERNOON'
  memory.offeredSlots = [
    {
      key: 'pro-matheus:2026-04-13T16:15:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus',
      dateIso: '2026-04-13',
      timeLabel: '13:15',
      startAtIso: '2026-04-13T16:15:00.000Z',
      endAtIso: '2026-04-13T16:50:00.000Z',
    },
  ]

  const corrected = agentTesting.enforceNextActionFromMemory(
    'ASK_DATE',
    memory,
    false,
    createAgentInput().nowContext
  )
  assert.equal(corrected, 'OFFER_SLOTS')
})

test('backend nao volta a pedir dia quando a data ja foi informada claramente', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-matheus'
  memory.selectedProfessionalName = 'Matheus'
  memory.requestedDateIso = '2026-04-14'

  const corrected = agentTesting.enforceNextActionFromMemory(
    'ASK_DATE',
    memory,
    false,
    createAgentInput().nowContext
  )

  assert.equal(corrected, 'ASK_PERIOD')
})

test('validateMissingFields nao oferece manha quando ja e tarde e a data e hoje', () => {
  const input = createAgentInput()
  input.nowContext = {
    dateIso: '2026-04-13',
    dateTimeLabel: '2026-04-13 14:00',
    hour: 14,
    minute: 0,
  }

  const memory = agentTesting.buildInitialMemory(input)
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-matheus'
  memory.selectedProfessionalName = 'Matheus'
  memory.requestedDateIso = '2026-04-13'

  const validation = agentTesting.validateMissingFields({
    memory,
    nowContext: input.nowContext,
  })

  assert.deepEqual(validation.availablePeriods, ['AFTERNOON', 'EVENING'])
  assert.deepEqual(validation.missingFields, ['period'])
})

test('guardrail de horario pergunta primeiro por horario especifico quando a data ja esta definida', () => {
  const input = createAgentInput()
  input.nowContext = {
    dateIso: '2026-04-13',
    dateTimeLabel: '2026-04-13 14:00',
    hour: 14,
    minute: 0,
  }

  const memory = agentTesting.buildInitialMemory(input)
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-matheus'
  memory.selectedProfessionalName = 'Matheus'
  memory.requestedDateIso = '2026-04-13'

  const reply = agentTesting.buildGuardrailReplyText({
    nextAction: 'ASK_PERIOD',
    memory,
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    nowContext: input.nowContext,
  })

  assert.match(reply, /Qual horario voce gostaria/i)
  assert.match(reply, /periodo/i)
  assert.doesNotMatch(reply, /Voce prefere manha, tarde ou noite/i)
})

test('backend fecha o fluxo quando ja existe resumo final e o cliente confirma', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.state = 'WAITING_CONFIRMATION'
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-lucas'
  memory.selectedProfessionalName = 'Lucas'
  memory.requestedDateIso = '2026-04-13'
  memory.requestedTimeLabel = '13:15'
  memory.selectedSlot = {
    key: 'pro-lucas:2026-04-13T16:15:00.000Z',
    professionalId: 'pro-lucas',
    professionalName: 'Lucas',
    dateIso: '2026-04-13',
    timeLabel: '13:15',
    startAtIso: '2026-04-13T16:15:00.000Z',
    endAtIso: '2026-04-13T16:50:00.000Z',
  }

  const corrected = agentTesting.enforceNextActionFromMemory(
    'ASK_SERVICE',
    memory,
    true,
    createAgentInput().nowContext
  )

  assert.equal(corrected, 'CONFIRM_BOOKING')
})

test('guardrail de barbeiro usa o barbeiro preferencial quando ele existe', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'

  const reply = agentTesting.buildGuardrailReplyText({
    nextAction: 'ASK_PROFESSIONAL',
    memory,
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    preferredProfessionalName: 'Matheus',
    nowContext: createAgentInput().nowContext,
  })

  assert.match(reply, /Matheus/)
  assert.match(reply, /de novo|prefere outro/i)
})

test('guardrail de servico mostra a lista real quando o servico ainda nao foi definido', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())

  const reply = agentTesting.buildGuardrailReplyText({
    nextAction: 'ASK_SERVICE',
    memory,
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    serviceNames: SERVICES.map((service) => service.name),
    nowContext: createAgentInput().nowContext,
  })

  assert.match(reply, /Corte Classic/)
  assert.match(reply, /Barba/)
})

test('sem historico e sem liberacao para qualquer um o backend pergunta barbeiro antes de sugerir horarios', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.requestedDateIso = '2026-04-13'
  memory.requestedTimeLabel = '15:00'

  const corrected = agentTesting.enforceNextActionFromMemory(
    'OFFER_SLOTS',
    memory,
    false,
    createAgentInput().nowContext
  )

  assert.equal(corrected, 'ASK_PROFESSIONAL')
})

test('backend nao confirma horario enquanto o barbeiro nao estiver definido ou liberado como qualquer um', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.requestedDateIso = '2026-04-13'
  memory.requestedTimeLabel = 'AFTERNOON'
  memory.offeredSlots = [
    {
      key: 'pro-matheus:2026-04-13T16:15:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus',
      dateIso: '2026-04-13',
      timeLabel: '13:15',
      startAtIso: '2026-04-13T16:15:00.000Z',
      endAtIso: '2026-04-13T16:50:00.000Z',
    },
  ]

  const corrected = agentTesting.enforceNextActionFromMemory(
    'ASK_CONFIRMATION',
    memory,
    false,
    createAgentInput().nowContext
  )

  assert.equal(corrected, 'ASK_PROFESSIONAL')
})

test('preserva o slot quando o cliente escolhe um horario exato antes da confirmacao', async () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.state = 'WAITING_TIME'
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-lucas'
  memory.selectedProfessionalName = 'Lucas'
  memory.requestedDateIso = '2026-04-13'
  memory.requestedTimeLabel = 'AFTERNOON'
  memory.offeredSlots = [
    {
      key: 'pro-lucas:2026-04-13T19:00:00.000Z',
      professionalId: 'pro-lucas',
      professionalName: 'Lucas',
      dateIso: '2026-04-13',
      timeLabel: '16:00',
      startAtIso: '2026-04-13T19:00:00.000Z',
      endAtIso: '2026-04-13T19:35:00.000Z',
    },
  ]
  memory.selectedSlot = memory.offeredSlots[0]

  const exactIntent = await interpretMessage('16hr', memory)
  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: exactIntent,
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  assert.equal(exactIntent.exactTime, '16:00')
  assert.equal(memory.requestedTimeLabel, '16:00')
  assert.equal(memory.selectedSlot?.timeLabel, '16:00')
})

test('trata respostas afirmativas amplas como confirmacao real no momento certo', () => {
  const affirmativeReplies = ['sim', 'desejo', 'quero', 'pode marcar', 'confirmar', 'fechado', 'ok']

  affirmativeReplies.forEach((reply) => {
  assert.equal(agentTesting.isExplicitConfirmation(reply), true)
  })
})

test('interpreta "rafael" isolado como escolha de barbeiro no contexto certo', async () => {
  const intent = await interpretWhatsAppMessage({
    message: 'rafael',
    barbershopName: 'Linha Nobre',
    barbershopTimezone: 'America/Sao_Paulo',
    conversationState: 'WAITING_PROFESSIONAL',
    offeredSlotCount: 0,
    services: SERVICES.map((service) => ({ name: service.name })),
    professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
    todayIsoDate: '2026-04-13',
    currentLocalDateTime: '2026-04-13 10:30',
    conversationSummary: {
      selectedServiceName: 'Corte Classic',
      selectedProfessionalName: null,
      requestedDateIso: '2026-04-13',
      requestedTimeLabel: null,
      allowAnyProfessional: false,
      lastCustomerMessage: 'corte',
      lastAssistantMessage: 'Tem preferencia de barbeiro ou posso procurar com qualquer um?',
    },
  })

  assert.equal(intent.mentionedName, 'Rafael Costa')
  assert.equal(intent.greetingOnly, false)
})

test('remove vocativo ambiguo quando o nome citado e do barbeiro e nao do cliente', () => {
  const reply = agentTesting.sanitizeReplyTextAgainstProfessionalVocative({
    replyText: 'Perfeito, Rafael. Tenho o Corte Classic as 15:00 com o Rafael Costa para hoje. Posso confirmar?',
    customerName: 'Gustavo',
    selectedProfessionalName: 'Rafael Costa',
    mentionedName: 'Rafael Costa',
    professionals: PROFESSIONALS,
  })

  assert.equal(reply.startsWith('Perfeito, Rafael'), false)
  assert.match(reply, /^Perfeito\./)
})

test('atalho deterministico fecha a confirmacao quando o cliente responde afirmativamente', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.state = 'WAITING_CONFIRMATION'
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-rafael'
  memory.selectedProfessionalName = 'Rafael Costa'
  memory.requestedDateIso = '2026-04-13'
  memory.selectedSlot = {
    key: 'pro-rafael:2026-04-13T18:00:00.000Z',
    professionalId: 'pro-rafael',
    professionalName: 'Rafael Costa',
    dateIso: '2026-04-13',
    timeLabel: '15:00',
    startAtIso: '2026-04-13T18:00:00.000Z',
    endAtIso: '2026-04-13T18:35:00.000Z',
  }

  assert.equal(
    agentTesting.shouldUseDeterministicConfirmationShortcut({
      memory,
      inboundText: 'pode',
      lastAssistantText: 'Posso confirmar esse horario para voce?',
    }),
    true
  )
})

test('interpreta horario explicito como busca exata prioritaria', async () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.state = 'WAITING_TIME'
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.requestedDateIso = '2026-04-14'
  memory.requestedTimeLabel = 'MORNING'

  const exactIntent = await interpretMessage('Quero às 10h da manhã', memory)
  const exactIntentWithoutH = await interpretMessage('Quero às 10', memory)

  assert.equal(exactIntent.exactTime, '10:00')
  assert.equal(exactIntent.timePreference, 'EXACT')
  assert.equal(exactIntentWithoutH.exactTime, '10:00')
  assert.equal(exactIntentWithoutH.timePreference, 'EXACT')
})

test('erro de search_availability por servico inexistente volta para a lista real de servicos', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())

  const override = agentTesting.resolveToolFailureOverride({
    toolTrace: [
      {
        name: 'search_availability',
        arguments: {},
        result: {
          status: 'error',
          reason: 'service_not_found',
        },
      },
    ],
    memory,
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    preferredProfessionalName: null,
    serviceNames: SERVICES.map((service) => service.name),
    nowContext: createAgentInput().nowContext,
  })

  assert.equal(override.nextAction, 'ASK_SERVICE')
  assert.match(override.replyText, /Corte Classic/)
  assert.match(override.replyText, /Barba/)
})

test('fluxo com progresso util nao volta para IDLE quando ainda nao existe slot real', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.requestedDateIso = '2026-04-14'
  memory.requestedTimeLabel = '15:00'
  memory.offeredSlots = []
  memory.selectedSlot = null

  const corrected = agentTesting.enforceNextActionFromMemory(
    'GREET',
    memory,
    false,
    createAgentInput().nowContext
  )
  const state = agentTesting.inferConversationState(
    corrected,
    memory,
    createAgentInput().nowContext
  )

  assert.equal(corrected, 'ASK_PROFESSIONAL')
  assert.equal(state, 'WAITING_PROFESSIONAL')
})

test('horario pedido sem slot real responde de forma objetiva e sem loop', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-matheus'
  memory.selectedProfessionalName = 'Matheus'
  memory.requestedDateIso = '2026-04-14'
  memory.requestedTimeLabel = '15:00'
  memory.offeredSlots = [
    {
      key: 'pro-matheus:2026-04-14T16:15:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus',
      dateIso: '2026-04-14',
      timeLabel: '13:15',
      startAtIso: '2026-04-14T16:15:00.000Z',
      endAtIso: '2026-04-14T16:50:00.000Z',
    },
  ]

  const override = agentTesting.resolveToolFailureOverride({
    toolTrace: [
      {
        name: 'confirm_booking',
        arguments: {
          requestedTime: '15:00',
        },
        result: {
          status: 'error',
          reason: 'slot_not_found',
          nearbySlots: memory.offeredSlots,
        },
      },
    ],
    memory,
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    preferredProfessionalName: null,
    serviceNames: SERVICES.map((service) => service.name),
    nowContext: createAgentInput().nowContext,
  })

  assert.equal(override.nextAction, 'OFFER_SLOTS')
  assert.match(override.replyText, /13:15 com Matheus/)
  assert.doesNotMatch(override.replyText, /Qual servico|Qual dia/i)
})
