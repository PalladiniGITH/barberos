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

function createConfirmationReadyMemory() {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.state = 'WAITING_CONFIRMATION'
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-rafael'
  memory.selectedProfessionalName = 'Rafael Costa'
  memory.requestedDateIso = '2026-04-16'
  memory.requestedTimeLabel = '17:30'
  memory.selectedSlot = {
    key: 'pro-rafael:2026-04-16T20:30:00.000Z',
    professionalId: 'pro-rafael',
    professionalName: 'Rafael Costa',
    dateIso: '2026-04-16',
    timeLabel: '17:30',
    startAtIso: '2026-04-16T20:30:00.000Z',
    endAtIso: '2026-04-16T21:05:00.000Z',
  }
  return memory
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

test('datas relativas reais geram requestedDateIso correto no timezone da barbearia', async () => {
  const cases = [
    ['daqui 10 dias', '2026-04-23'],
    ['daqui 15 dias', '2026-04-28'],
    ['daqui 2 semanas', '2026-04-27'],
    ['daqui 3 semanas', '2026-05-04'],
    ['daqui 1 mes', '2026-05-13'],
    ['daqui um mes', '2026-05-13'],
    ['na outra sexta', '2026-04-24'],
    ['sexta da semana que vem', '2026-04-24'],
    ['quinta da semana que vem', '2026-04-23'],
    ['terca da semana que vem', '2026-04-21'],
    ['quarta da proxima semana', '2026-04-22'],
    ['proxima quinta', '2026-04-16'],
    ['proximo domingo', '2026-04-19'],
    ['domingo da outra semana', '2026-05-03'],
  ]

  for (const [message, expectedDateIso] of cases) {
    const memory = agentTesting.buildInitialMemory(createAgentInput())
    memory.state = 'WAITING_DATE'

    const interpreted = await interpretMessage(message, memory)
    agentTesting.promoteIntentContextToMemory({
      memory,
      intent: interpreted,
      services: SERVICES,
      professionals: PROFESSIONALS,
    })

    assert.equal(interpreted.requestedDateIso, expectedDateIso, message)
    assert.equal(memory.requestedDateIso, expectedDateIso, message)
  }
})

test('data relativa promovida continua no contexto e nao volta a ASK_DATE no turno seguinte', async () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())

  const dateIntent = await interpretMessage('quinta da semana que vem', memory)
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

  const periodIntent = await interpretMessage('periodo da noite', memory)
  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: periodIntent,
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  const corrected = agentTesting.enforceNextActionFromMemory(
    'ASK_DATE',
    memory,
    false,
    createAgentInput().nowContext
  )

  assert.equal(memory.requestedDateIso, '2026-04-23')
  assert.equal(memory.requestedTimeLabel, 'EVENING')
  assert.notEqual(corrected, 'ASK_DATE')
  assert.equal(agentTesting.shouldAllowAvailabilitySearch({
    exactTime: null,
    preferredPeriod: memory.requestedTimeLabel,
    inboundText: 'periodo da noite',
  }), true)
})

test('data relativa entendida no turno segue o fluxo normal e nao volta para ASK_DATE', async () => {
  const cases = [
    ['daqui 15 dias', '2026-04-28'],
    ['daqui 2 semanas', '2026-04-27'],
    ['daqui 1 mes', '2026-05-13'],
    ['na outra sexta', '2026-04-24'],
    ['quinta da semana que vem', '2026-04-23'],
    ['proxima quinta', '2026-04-16'],
    ['domingo da outra semana', '2026-05-03'],
  ]

  for (const [message, expectedDateIso] of cases) {
    const memory = agentTesting.buildInitialMemory(createAgentInput())
    memory.state = 'WAITING_DATE'
    memory.selectedServiceId = 'svc-classic'
    memory.selectedServiceName = 'Corte Classic'

    const interpreted = await interpretMessage(message, memory)
    agentTesting.promoteIntentContextToMemory({
      memory,
      intent: interpreted,
      services: SERVICES,
      professionals: PROFESSIONALS,
    })

    const nextAction = agentTesting.enforceNextActionFromMemory(
      'ASK_DATE',
      memory,
      false,
      createAgentInput().nowContext
    )

    assert.equal(memory.requestedDateIso, expectedDateIso, message)
    assert.notEqual(nextAction, 'ASK_DATE', message)
  }
})

test('frases naturais de noite promovem EVENING de forma deterministica', async () => {
  const messages = [
    'periodo da noite',
    'período da noite',
    'isso de noite',
    'de noite',
    'a noite',
    'à noite',
    'mais tarde',
    'mais tarde de noite',
    'no periodo da noite',
    'no período da noite',
    'mais tarde a noite',
    'mais tarde à noite',
  ]

  for (const message of messages) {
    const memory = agentTesting.buildInitialMemory(createAgentInput())
    memory.state = 'WAITING_TIME'
    memory.selectedServiceId = 'svc-classic'
    memory.selectedServiceName = 'Corte Classic'
    memory.requestedDateIso = '2026-04-17'

    const interpreted = await interpretMessage(message, memory)

    assert.equal(interpreted.preferredPeriod, 'EVENING', message)
    assert.equal(interpreted.timePreference, 'EVENING', message)
  }
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

  assert.match(reply, /Qual horario voce gostaria|Que horas voce gostaria|Me diz o horario/i)
  assert.doesNotMatch(reply, /Voce prefere manha, tarde ou noite/i)
  assert.doesNotMatch(reply, /periodo/i)
})

test('depois de escolher o servico o fluxo pede a data antes de perguntar barbeiro', () => {
  const input = createAgentInput()
  const memory = agentTesting.buildInitialMemory(input)
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'

  const corrected = agentTesting.enforceNextActionFromMemory(
    'ASK_PROFESSIONAL',
    memory,
    false,
    input.nowContext
  )

  assert.equal(corrected, 'ASK_DATE')
})

test('depois de servico e data o fluxo pergunta barbeiro antes de falar de horario', () => {
  const input = createAgentInput()
  const memory = agentTesting.buildInitialMemory(input)
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.requestedDateIso = '2026-04-13'

  const corrected = agentTesting.enforceNextActionFromMemory(
    'ASK_PERIOD',
    memory,
    false,
    input.nowContext
  )

  const reply = agentTesting.buildGuardrailReplyText({
    nextAction: corrected,
    memory,
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    nowContext: input.nowContext,
  })

  assert.equal(corrected, 'ASK_PROFESSIONAL')
  assert.match(reply, /barbeiro de preferencia|qualquer um/i)
  assert.doesNotMatch(reply, /Qual horario|Que horas/i)
})

test('guardrail de oferta de horarios sempre mostra o barbeiro junto de cada horario', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.requestedDateIso = '2026-04-13'
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
    {
      key: 'pro-lucas:2026-04-13T16:30:00.000Z',
      professionalId: 'pro-lucas',
      professionalName: 'Lucas',
      dateIso: '2026-04-13',
      timeLabel: '13:30',
      startAtIso: '2026-04-13T16:30:00.000Z',
      endAtIso: '2026-04-13T17:05:00.000Z',
    },
  ]

  const reply = agentTesting.buildGuardrailReplyText({
    nextAction: 'OFFER_SLOTS',
    memory,
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    nowContext: createAgentInput().nowContext,
  })

  assert.match(reply, /13:15 com Matheus/i)
  assert.match(reply, /13:30 com Lucas/i)
})

test('quando o cliente escolhe uma opcao ja apresentada a confirmacao vira resumo, sem soar como nova descoberta', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Pigmentacao Natural'
  memory.selectedSlot = {
    key: 'pro-lucas:2026-04-27T14:00:00.000Z',
    professionalId: 'pro-lucas',
    professionalName: 'Lucas Ribeiro',
    dateIso: '2026-04-27',
    timeLabel: '11:00',
    startAtIso: '2026-04-27T14:00:00.000Z',
    endAtIso: '2026-04-27T14:45:00.000Z',
  }

  const reply = agentTesting.buildGuardrailReplyText({
    nextAction: 'ASK_CONFIRMATION',
    memory,
    lastAssistantText: 'Tenho estes horarios disponiveis:\n\n- 11:00 com Lucas Ribeiro\n- 11:00 com Matheus Lima\n- 11:00 com Rafael Costa\n\nQual voce prefere?',
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    nowContext: createAgentInput().nowContext,
  })

  assert.match(reply, /vou deixar assim para confirmacao/i)
  assert.match(reply, /Pigmentacao Natural/i)
  assert.match(reply, /Lucas Ribeiro/i)
  assert.doesNotMatch(reply, /Encontrei este horario/i)
})

test('seleciona slot ja oferecido quando o cliente responde com o nome do barbeiro', () => {
  const slot = agentTesting.pickPresentedOfferedSlot({
    offeredSlots: [
      {
        key: 'pro-lucas:2026-04-27T14:00:00.000Z',
        professionalId: 'pro-lucas',
        professionalName: 'Lucas Ribeiro',
        dateIso: '2026-04-27',
        timeLabel: '11:00',
        startAtIso: '2026-04-27T14:00:00.000Z',
        endAtIso: '2026-04-27T14:45:00.000Z',
      },
      {
        key: 'pro-matheus:2026-04-27T14:00:00.000Z',
        professionalId: 'pro-matheus',
        professionalName: 'Matheus Lima',
        dateIso: '2026-04-27',
        timeLabel: '11:00',
        startAtIso: '2026-04-27T14:00:00.000Z',
        endAtIso: '2026-04-27T14:45:00.000Z',
      },
    ],
    selectedOptionNumber: null,
    requestedTime: null,
    professionalName: 'Lucas',
    message: 'Lucas',
  })

  assert.equal(slot?.professionalName, 'Lucas Ribeiro')
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

  assert.match(reply, /Temos estes servicos disponiveis/i)
  assert.match(reply, /(?:^|\n)- Corte Classic/m)
  assert.match(reply, /(?:^|\n)- Barba/m)
  assert.doesNotMatch(reply, /Corte Classic, Barba/)
  assert.doesNotMatch(reply, /55|35|R\$/)
})

test('preco so entra em fluxo explicito de consulta', () => {
  assert.equal(agentTesting.hasExplicitPriceQuestion('quero marcar um horario'), false)
  assert.equal(agentTesting.hasExplicitPriceQuestion('qual o preco do corte classic?'), true)
  assert.equal(agentTesting.hasExplicitPriceQuestion('quanto custa a barba?'), true)
})

test('guardrail de barbeiro pergunta a preferencia antes de qualquer oferta de horario', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.requestedDateIso = '2026-04-13'

  const reply = agentTesting.buildGuardrailReplyText({
    nextAction: 'ASK_PROFESSIONAL',
    memory,
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    nowContext: createAgentInput().nowContext,
  })

  assert.match(reply, /preferencia de barbeiro|qualquer um/i)
  assert.doesNotMatch(reply, /13:15|13:30|09:30|09:45/)
})

test('consentimento para qualquer barbeiro so vale quando o cliente fala isso explicitamente', () => {
  assert.equal(agentTesting.hasExplicitAnyProfessionalConsent('quero 16:00'), false)
  assert.equal(agentTesting.hasExplicitAnyProfessionalConsent('qualquer um'), true)
  assert.equal(agentTesting.hasExplicitAnyProfessionalConsent('pode ser qualquer barbeiro'), true)
})

test('listar opcoes de horario so e liberado quando o cliente explicita que quer ver opcoes', () => {
  assert.equal(agentTesting.hasExplicitFlexibleTimeRequest('qualquer horario'), true)
  assert.equal(agentTesting.hasExplicitFlexibleTimeRequest('me mostra os horarios'), true)
  assert.equal(agentTesting.hasExplicitFlexibleTimeRequest('amanha'), false)
  assert.equal(agentTesting.hasExplicitFlexibleTimeRequest('15:00'), false)
})

test('erro de falta de horario especifico vira pergunta direta de horario antes de listar opcoes', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-matheus'
  memory.selectedProfessionalName = 'Matheus'
  memory.requestedDateIso = '2026-04-13'

  const override = agentTesting.resolveToolFailureOverride({
    toolTrace: [
      {
        name: 'search_availability',
        arguments: {},
        result: {
          status: 'error',
          reason: 'time_preference_required',
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

  assert.equal(override.nextAction, 'ASK_PERIOD')
  assert.match(override.replyText, /Que horas voce gostaria|Qual horario voce gostaria/i)
  assert.doesNotMatch(override.replyText, /13:15|13:30/i)
})

test('erro transitório de disponibilidade vira fallback neutro de infraestrutura no agente', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.requestedDateIso = '2026-04-13'
  memory.requestedTimeLabel = 'EVENING'

  const override = agentTesting.resolveToolFailureOverride({
    toolTrace: [
      {
        name: 'search_availability',
        arguments: {},
        result: {
          status: 'error',
          reason: 'availability_infrastructure_error',
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

  assert.equal(override.nextAction, 'ASK_CLARIFICATION')
  assert.equal(override.replyText, 'Nao consegui verificar os horarios agora, pode tentar novamente daqui a pouco?')
})

test('preferredPeriod EVENING libera a busca de disponibilidade sem exigir horario exato', () => {
  const shortPeriodMessages = ['de noite', 'a noite', 'à noite', 'mais tarde']

  shortPeriodMessages.forEach((message) => {
    assert.equal(
      agentTesting.shouldAllowAvailabilitySearch({
        exactTime: null,
        preferredPeriod: 'EVENING',
        inboundText: message,
      }),
      true,
      message
    )
  })

  assert.equal(
    agentTesting.shouldAllowAvailabilitySearch({
      exactTime: null,
      preferredPeriod: null,
      inboundText: 'quero marcar',
    }),
    false
  )
})

test('confirm_booking é bloqueado quando não existe slot selecionado nem offeredSlots', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.state = 'WAITING_CONFIRMATION'
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.requestedDateIso = '2026-04-13'
  memory.requestedTimeLabel = 'EVENING'

  assert.equal(agentTesting.shouldBlockConfirmationWithoutSlot(memory), true)

  memory.offeredSlots = [
    {
      key: 'pro-matheus:2026-04-13T21:00:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus',
      dateIso: '2026-04-13',
      timeLabel: '18:00',
      startAtIso: '2026-04-13T21:00:00.000Z',
      endAtIso: '2026-04-13T21:35:00.000Z',
    },
  ]

  assert.equal(agentTesting.shouldBlockConfirmationWithoutSlot(memory), false)
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

test('servico + barbeiro + data + periodo ainda nao bastam para pedir confirmacao', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-matheus'
  memory.selectedProfessionalName = 'Matheus'
  memory.requestedDateIso = '2026-04-17'
  memory.requestedTimeLabel = 'AFTERNOON'

  const corrected = agentTesting.enforceNextActionFromMemory(
    'ASK_CONFIRMATION',
    memory,
    false,
    createAgentInput().nowContext
  )

  const reply = agentTesting.buildGuardrailReplyText({
    nextAction: corrected,
    memory,
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    nowContext: createAgentInput().nowContext,
  })

  assert.equal(corrected, 'ASK_PERIOD')
  assert.match(reply, /Qual horario voce gostaria|Que horas voce gostaria|Me diz o horario/i)
  assert.doesNotMatch(reply, /Posso confirmar/i)
  assert.doesNotMatch(reply, /periodo/i)
})

test('servico + barbeiro + slot validado liberam confirmacao real', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-matheus'
  memory.selectedProfessionalName = 'Matheus'
  memory.requestedDateIso = '2026-04-17'
  memory.requestedTimeLabel = '15:00'
  memory.selectedSlot = {
    key: 'pro-matheus:2026-04-17T18:00:00.000Z',
    professionalId: 'pro-matheus',
    professionalName: 'Matheus',
    dateIso: '2026-04-17',
    timeLabel: '15:00',
    startAtIso: '2026-04-17T18:00:00.000Z',
    endAtIso: '2026-04-17T18:35:00.000Z',
  }

  assert.equal(agentTesting.canAskForBookingConfirmation(memory), true)
  assert.equal(
    agentTesting.enforceNextActionFromMemory(
      'ASK_CONFIRMATION',
      memory,
      false,
      createAgentInput().nowContext
    ),
    'ASK_CONFIRMATION'
  )
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

test('aceita apenas confirmacoes explicitas fortes como fechamento real', () => {
  const affirmativeReplies = [
    'confirmo',
    'confirmar',
    'pode marcar',
    'pode confirmar',
    'pode agendar',
    'sim pode marcar',
    'sim pode confirmar',
    'quero confirmar',
    'fechado',
  ]

  affirmativeReplies.forEach((reply) => {
    assert.equal(agentTesting.isExplicitConfirmation(reply), true)
  })
})

test('mensagens vagas nao contam como confirmacao final do agendamento', () => {
  ;['ok', 'ok tente', 'blz', 'beleza', 'pode tentar', 'tenta ai', 'aham', 'uhum', 'talvez'].forEach((reply) => {
    assert.equal(agentTesting.isExplicitConfirmation(reply), false, reply)
  })
})

test('confirmacoes contextuais curtas fecham corretamente em WAITING_CONFIRMATION', () => {
  ;['sim', 's', 'pode', 'pode sim', 'quero', 'isso', 'esse', 'esse mesmo', 'confirmo', 'confirmar', 'pode confirmar', 'pode marcar', 'pode agendar', 'sim pode confirmar', 'fechado'].forEach((message) => {
    const memory = createConfirmationReadyMemory()

    assert.equal(
      agentTesting.shouldUseDeterministicConfirmationShortcut({
        memory,
        inboundText: message,
        lastAssistantText: 'Posso confirmar Corte Classic para quinta-feira, 16/04 as 17:30 com Rafael Costa?',
      }),
      true,
      message
    )
  })
})

test('fora de WAITING_CONFIRMATION uma concordancia curta nao vira confirmacao de agendamento', () => {
  ;['confirmo', 'confirmar', 'pode confirmar', 'pode marcar', 'pode agendar', 'sim pode confirmar', 'fechado'].forEach((message) => {
    const memory = createConfirmationReadyMemory()
    memory.state = 'WAITING_TIME'

    assert.equal(
      agentTesting.shouldUseDeterministicConfirmationShortcut({
        memory,
        inboundText: message,
        lastAssistantText: 'Posso confirmar Corte Classic para quinta-feira, 16/04 as 17:30 com Rafael Costa?',
      }),
      false,
      message
    )
  })
})

test('heuristica contextual so aceita confirmacoes explicitas com slot realmente apresentado', () => {
  ;['sim', 's', 'pode', 'pode sim', 'quero', 'isso', 'esse', 'esse mesmo', 'confirmo', 'confirmar', 'pode confirmar', 'pode marcar', 'pode agendar', 'sim pode confirmar', 'fechado'].forEach((message) => {
    const result = agentTesting.resolveContextualConfirmationHeuristic({
      memory: createConfirmationReadyMemory(),
      inboundText: message,
      lastAssistantText: 'Encontrei este horario para Corte Classic:\n\n- Data: quinta-feira, 16/04\n- Horario: 17:30\n- Barbeiro: Rafael Costa\n\nQuer confirmar esse agendamento?',
    })

    assert.equal(result.accepted, true, message)
    assert.equal(result.hasRequiredContext, true, message)
    assert.equal(result.hasCorrectionCue, false, message)
    assert.equal(result.isAffirmative, true, message)
  })
})

test('caminho de llm confirmation classification so arma para concordancias curtas sem correcao explicita', () => {
  ;['sim', 'pode', 'quero', 'isso', 'esse mesmo', 'confirmo', 'pode confirmar', 'pode marcar', 'pode agendar', 'fechado'].forEach((message) => {
    assert.equal(
      agentTesting.shouldUseContextualConfirmationClassifier({
        memory: createConfirmationReadyMemory(),
        inboundText: message,
        lastAssistantText: 'Encontrei este horario para Corte Classic:\n\n- Data: quinta-feira, 16/04\n- Horario: 17:30\n- Barbeiro: Rafael Costa\n\nQuer confirmar esse agendamento?',
      }),
      true,
      message
    )
  })

  ;['ok', 'blz', 'beleza', 'ok tente', 'tenta ai', 'pode tentar', 'confirmo 14:30', 'pode confirmar amanha'].forEach((message) => {
    assert.equal(
      agentTesting.shouldUseContextualConfirmationClassifier({
        memory: createConfirmationReadyMemory(),
        inboundText: message,
        lastAssistantText: 'Encontrei este horario para Corte Classic:\n\n- Data: quinta-feira, 16/04\n- Horario: 17:30\n- Barbeiro: Rafael Costa\n\nQuer confirmar esse agendamento?',
      }),
      false,
      message
    )
  })
})

test('horario explicito vence confirmacao generica na mesma frase', async () => {
  const samples = [
    ['confirmo 14:30', '14:30'],
    ['pode confirmar 15h', '15:00'],
    ['ok 16:00', '16:00'],
  ]

  for (const [message, expectedTime] of samples) {
    const intent = await interpretWhatsAppMessage({
      message,
      barbershopName: 'Linha Nobre',
      barbershopTimezone: 'America/Sao_Paulo',
      conversationState: 'WAITING_CONFIRMATION',
      offeredSlotCount: 0,
      services: SERVICES.map((service) => ({ name: service.name })),
      professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
      todayIsoDate: '2026-04-14',
      currentLocalDateTime: '2026-04-14 10:30',
      conversationSummary: {
        selectedServiceName: 'Corte Classic',
        selectedProfessionalName: 'Lucas',
        requestedDateIso: '2026-04-16',
        requestedTimeLabel: '08:00',
        allowAnyProfessional: false,
        lastCustomerMessage: '08:00',
        lastAssistantMessage: 'Posso confirmar quinta-feira, 16/04 as 08:00 com Lucas Ribeiro?',
      },
    })

    assert.equal(intent.exactTime, expectedTime, message)
    assert.equal(intent.intent, 'CHANGE_REQUEST', message)
    assert.equal(intent.correctionTarget, 'TIME', message)
  }
})

test('mudanca de barbeiro vence confirmacao curta na mesma frase', async () => {
  const intent = await interpretWhatsAppMessage({
    message: 'pode ser com o Matheus',
    barbershopName: 'Linha Nobre',
    barbershopTimezone: 'America/Sao_Paulo',
    conversationState: 'WAITING_CONFIRMATION',
    offeredSlotCount: 0,
    services: SERVICES.map((service) => ({ name: service.name })),
    professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
    todayIsoDate: '2026-04-14',
    currentLocalDateTime: '2026-04-14 10:30',
    conversationSummary: {
      selectedServiceName: 'Corte Classic',
      selectedProfessionalName: 'Lucas',
      requestedDateIso: '2026-04-16',
      requestedTimeLabel: '08:00',
      allowAnyProfessional: false,
      lastCustomerMessage: '08:00',
      lastAssistantMessage: 'Posso confirmar quinta-feira, 16/04 as 08:00 com Lucas Ribeiro?',
    },
  })

  assert.equal(intent.intent, 'CHANGE_REQUEST')
  assert.equal(intent.correctionTarget, 'PROFESSIONAL')
  assert.equal(intent.mentionedName, 'Matheus')
})

test('mudanca de data vence confirmacao curta na mesma frase', async () => {
  const intent = await interpretWhatsAppMessage({
    message: 'pode confirmar amanha',
    barbershopName: 'Linha Nobre',
    barbershopTimezone: 'America/Sao_Paulo',
    conversationState: 'WAITING_CONFIRMATION',
    offeredSlotCount: 0,
    services: SERVICES.map((service) => ({ name: service.name })),
    professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
    todayIsoDate: '2026-04-14',
    currentLocalDateTime: '2026-04-14 10:30',
    conversationSummary: {
      selectedServiceName: 'Corte Classic',
      selectedProfessionalName: 'Lucas',
      requestedDateIso: '2026-04-16',
      requestedTimeLabel: '08:00',
      allowAnyProfessional: false,
      lastCustomerMessage: '08:00',
      lastAssistantMessage: 'Posso confirmar quinta-feira, 16/04 as 08:00 com Lucas Ribeiro?',
    },
  })

  assert.equal(intent.intent, 'CHANGE_REQUEST')
  assert.equal(intent.correctionTarget, 'DATE')
})

test('sim, pode e quero viram CONFIRM em WAITING_CONFIRMATION quando o slot ja foi apresentado', async () => {
  for (const message of ['sim', 'pode', 'quero', 'isso', 'esse mesmo']) {
    const intent = await interpretWhatsAppMessage({
      message,
      barbershopName: 'Linha Nobre',
      barbershopTimezone: 'America/Sao_Paulo',
      conversationState: 'WAITING_CONFIRMATION',
      offeredSlotCount: 0,
      services: SERVICES.map((service) => ({ name: service.name })),
      professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
      todayIsoDate: '2026-04-14',
      currentLocalDateTime: '2026-04-14 10:30',
      conversationSummary: {
        selectedServiceName: 'Corte Classic',
        selectedProfessionalName: 'Lucas Ribeiro',
        requestedDateIso: '2026-04-16',
        requestedTimeLabel: '08:00',
        allowAnyProfessional: false,
        lastCustomerMessage: '08:00',
        lastAssistantMessage: 'Encontrei este horario para Corte Classic:\n\n- Servico: Corte Classic\n- Data: quinta-feira, 16/04\n- Horario: 08:00\n- Barbeiro: Lucas Ribeiro\n\nQuer confirmar esse agendamento?',
      },
    })

    assert.equal(intent.intent, 'CONFIRM', message)
  }
})

test('correcoes explicitas vencem a confirmacao curta e nao reaproveitam slot antigo', async () => {
  const samples = [
    ['confirmo 14:30', 'TIME'],
    ['pode ser com o Matheus', 'PROFESSIONAL'],
    ['pode confirmar amanha', 'DATE'],
    ['fechado 16h', 'TIME'],
    ['confirmo 14:30', 'TIME'],
    ['confirmo com o Matheus', 'PROFESSIONAL'],
  ]

  for (const [message, correctionTarget] of samples) {
    const intent = await interpretWhatsAppMessage({
      message,
      barbershopName: 'Linha Nobre',
      barbershopTimezone: 'America/Sao_Paulo',
      conversationState: 'WAITING_CONFIRMATION',
      offeredSlotCount: 0,
      services: SERVICES.map((service) => ({ name: service.name })),
      professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
      todayIsoDate: '2026-04-14',
      currentLocalDateTime: '2026-04-14 10:30',
      conversationSummary: {
        selectedServiceName: 'Corte Classic',
        selectedProfessionalName: 'Rafael Costa',
        requestedDateIso: '2026-04-16',
        requestedTimeLabel: '17:30',
        allowAnyProfessional: false,
        lastCustomerMessage: '17:30',
        lastAssistantMessage: 'Posso confirmar Corte Classic para quinta-feira, 16/04 as 17:30 com Rafael Costa?',
      },
    })

    assert.equal(intent.intent, 'CHANGE_REQUEST', message)
    assert.equal(intent.correctionTarget, correctionTarget, message)
    assert.equal(
      agentTesting.shouldUseDeterministicConfirmationShortcut({
        memory: createConfirmationReadyMemory(),
        inboundText: message,
        lastAssistantText: 'Posso confirmar Corte Classic para quinta-feira, 16/04 as 17:30 com Rafael Costa?',
      }),
      false,
      message
    )
  }
})

test('confirmacoes curtas nao passam sem slot real ou com barbeiro indefinido', () => {
  ;['confirmo', 'pode confirmar', 'pode marcar', 'sim pode confirmar', 'fechado'].forEach((message) => {
    const noSlotMemory = createConfirmationReadyMemory()
    noSlotMemory.selectedSlot = null

    const noProfessionalMemory = createConfirmationReadyMemory()
    noProfessionalMemory.selectedProfessionalId = null
    noProfessionalMemory.selectedProfessionalName = null
    noProfessionalMemory.allowAnyProfessional = false

    assert.equal(
      agentTesting.resolveContextualConfirmationHeuristic({
        memory: noSlotMemory,
        inboundText: message,
        lastAssistantText: 'Encontrei este horario para Corte Classic:\n\n- Data: quinta-feira, 16/04\n- Horario: 17:30\n- Barbeiro: Rafael Costa\n\nQuer confirmar esse agendamento?',
      }).accepted,
      false,
      `noSlot ${message}`
    )

    assert.equal(
      agentTesting.resolveContextualConfirmationHeuristic({
        memory: noProfessionalMemory,
        inboundText: message,
        lastAssistantText: 'Encontrei este horario para Corte Classic:\n\n- Data: quinta-feira, 16/04\n- Horario: 17:30\n- Barbeiro: Rafael Costa\n\nQuer confirmar esse agendamento?',
      }).accepted,
      false,
      `noProfessional ${message}`
    )

    assert.equal(
      agentTesting.shouldUseDeterministicConfirmationShortcut({
        memory: noSlotMemory,
        inboundText: message,
        lastAssistantText: 'Encontrei este horario para Corte Classic:\n\n- Data: quinta-feira, 16/04\n- Horario: 17:30\n- Barbeiro: Rafael Costa\n\nQuer confirmar esse agendamento?',
      }),
      false,
      `noSlot shortcut ${message}`
    )
  })
})

test('atalho deterministico nao confirma slot antigo quando a resposta traz novo horario', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.state = 'WAITING_CONFIRMATION'
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-lucas'
  memory.selectedProfessionalName = 'Lucas'
  memory.requestedDateIso = '2026-04-16'
  memory.requestedTimeLabel = '08:00'
  memory.selectedSlot = {
    key: 'pro-lucas:2026-04-16T11:00:00.000Z',
    professionalId: 'pro-lucas',
    professionalName: 'Lucas',
    dateIso: '2026-04-16',
    timeLabel: '08:00',
    startAtIso: '2026-04-16T11:00:00.000Z',
    endAtIso: '2026-04-16T11:35:00.000Z',
  }

  assert.equal(agentTesting.isExplicitConfirmation('confirmo 14:30'), true)
  assert.equal(agentTesting.isPureExplicitConfirmation('confirmo 14:30'), false)
  assert.equal(
    agentTesting.shouldUseDeterministicConfirmationShortcut({
      memory,
      inboundText: 'confirmo 14:30',
      lastAssistantText: 'Posso confirmar quinta-feira, 16/04 as 08:00 com Lucas Ribeiro?',
    }),
    false
  )
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

test('interpreta barbeiro isolado como PROFESSIONAL_CORRECTION quando o horario ja esta escolhido', async () => {
  const intent = await interpretWhatsAppMessage({
    message: 'matheus',
    barbershopName: 'Linha Nobre',
    barbershopTimezone: 'America/Sao_Paulo',
    conversationState: 'WAITING_TIME',
    offeredSlotCount: 0,
    services: SERVICES.map((service) => ({ name: service.name })),
    professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
    todayIsoDate: '2026-04-13',
    currentLocalDateTime: '2026-04-13 10:30',
    conversationSummary: {
      selectedServiceName: 'Corte Classic',
      selectedProfessionalName: null,
      requestedDateIso: '2026-04-16',
      requestedTimeLabel: '09:30',
      allowAnyProfessional: false,
      lastCustomerMessage: '09:30',
      lastAssistantMessage: 'Qual horario voce prefere?',
    },
  })

  assert.equal(intent.mentionedName, 'Matheus')
  assert.equal(intent.correctionTarget, 'PROFESSIONAL')
})

test('troca de barbeiro preserva o horario ja escolhido na memoria do agente', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
  memory.state = 'WAITING_TIME'
  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.requestedDateIso = '2026-04-16'
  memory.requestedTimeLabel = '09:30'
  memory.selectedSlot = {
    key: 'pro-lucas:2026-04-16T12:30:00.000Z',
    professionalId: 'pro-lucas',
    professionalName: 'Lucas',
    dateIso: '2026-04-16',
    timeLabel: '09:30',
    startAtIso: '2026-04-16T12:30:00.000Z',
    endAtIso: '2026-04-16T13:05:00.000Z',
  }
  memory.offeredSlots = [memory.selectedSlot]

  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: {
      intent: 'CHANGE_REQUEST',
      correctionTarget: 'PROFESSIONAL',
      serviceName: null,
      mentionedName: 'Matheus',
      allowAnyProfessional: false,
      requestedDateIso: null,
      timePreference: 'NONE',
      preferredPeriod: null,
      exactTime: null,
      selectedOptionNumber: null,
      confidence: 0.92,
      greetingOnly: false,
      restartConversation: false,
      reasoning: 'professional correction',
    },
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  assert.equal(memory.selectedProfessionalId, 'pro-matheus')
  assert.equal(memory.selectedProfessionalName, 'Matheus')
  assert.equal(memory.requestedTimeLabel, '09:30')
  assert.equal(memory.selectedSlot, null)
  assert.deepEqual(memory.offeredSlots, [])
})

test('interpreta consulta de agendamento ja confirmado como CHECK_EXISTING_BOOKING', async () => {
  const intent = await interpretWhatsAppMessage({
    message: 'eu tenho horario amanha?',
    barbershopName: 'Linha Nobre',
    barbershopTimezone: 'America/Sao_Paulo',
    conversationState: 'WAITING_SERVICE',
    offeredSlotCount: 0,
    services: SERVICES.map((service) => ({ name: service.name })),
    professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
    todayIsoDate: '2026-04-14',
    currentLocalDateTime: '2026-04-14 10:30',
    conversationSummary: {
      selectedServiceName: 'Barba',
      selectedProfessionalName: null,
      requestedDateIso: '2026-04-15',
      requestedTimeLabel: null,
      allowAnyProfessional: false,
      lastCustomerMessage: 'quero marcar barba amanha',
      lastAssistantMessage: 'Tem preferencia de barbeiro ou posso procurar com qualquer um?',
    },
  })

  assert.equal(intent.intent, 'CHECK_EXISTING_BOOKING')
})

test('interpreta frases naturais sobre horario ja marcado sem cair em novo agendamento', async () => {
  const bookingQueries = [
    'quais horarios eu tenho amanha?',
    'que horas eu marquei amanha?',
    'tenho algo amanha?',
    'com quem eu estou marcado amanha?',
    'qual meu horario de amanha?',
    'qual meu proximo horario?',
    'quais horarios eu tenho essa semana?',
    'meus horarios dessa semana',
    'nada eu so queria confirmar que horario ficou amanha',
    'tem algo pra mim amanha?',
    'o que eu tenho amanha?',
  ]

  for (const message of bookingQueries) {
    const intent = await interpretWhatsAppMessage({
      message,
      barbershopName: 'Linha Nobre',
      barbershopTimezone: 'America/Sao_Paulo',
      conversationState: 'WAITING_SERVICE',
      offeredSlotCount: 0,
      services: SERVICES.map((service) => ({ name: service.name })),
      professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
      todayIsoDate: '2026-04-14',
      currentLocalDateTime: '2026-04-14 10:30',
      conversationSummary: {
        selectedServiceName: 'Barba',
        selectedProfessionalName: null,
        requestedDateIso: '2026-04-15',
        requestedTimeLabel: null,
        allowAnyProfessional: false,
        lastCustomerMessage: 'quero marcar barba amanha',
        lastAssistantMessage: 'Tem preferencia de barbeiro ou posso procurar com qualquer um?',
      },
    })

    assert.equal(intent.intent, 'CHECK_EXISTING_BOOKING', message)
  }
})

test('interpreta encerramentos simples como acknowledgement fora da confirmacao', async () => {
  const samples = ['obrigado', 'ok obrigado', 'nenhum', 'nao quero', 'so isso']

  for (const message of samples) {
    const intent = await interpretWhatsAppMessage({
      message,
      barbershopName: 'Linha Nobre',
      barbershopTimezone: 'America/Sao_Paulo',
      conversationState: 'IDLE',
      offeredSlotCount: 0,
      services: SERVICES.map((service) => ({ name: service.name })),
      professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
      todayIsoDate: '2026-04-14',
      currentLocalDateTime: '2026-04-14 10:30',
      conversationSummary: {
        selectedServiceName: null,
        selectedProfessionalName: null,
        requestedDateIso: null,
        requestedTimeLabel: null,
        allowAnyProfessional: false,
        lastCustomerMessage: 'pode confirmar',
        lastAssistantMessage: 'Perfeito, ficou marcado.',
      },
    })

    assert.equal(intent.intent, 'ACKNOWLEDGEMENT', message)
  }
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

test('bloqueia linguagem de sucesso antes da persistencia real do agendamento', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())
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

  const reply = agentTesting.sanitizePrematureConfirmationReply({
    replyText: 'Agendamento confirmado para hoje as 15:00 com Rafael Costa.',
    nextAction: 'ASK_CONFIRMATION',
    shouldCreateAppointment: false,
    memory,
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    preferredProfessionalName: null,
    serviceNames: SERVICES.map((service) => service.name),
    nowContext: createAgentInput().nowContext,
  })

  assert.doesNotMatch(reply, /Agendamento confirmado/i)
  assert.match(reply, /Quer confirmar esse agendamento/i)
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
      inboundText: 'sim',
      lastAssistantText: 'Encontrei este horario para Corte Classic:\n\n- Data: domingo, 13/04\n- Horario: 15:00\n- Barbeiro: Rafael Costa\n\nQuer confirmar esse agendamento?',
    }),
    true
  )
})

test('quando o slot ja foi apresentado e a resposta e ambigua o agente pede confirmacao explicita sem repetir o resumo inteiro', () => {
  const memory = createConfirmationReadyMemory()

  const reply = agentTesting.buildGuardrailReplyText({
    nextAction: 'ASK_CONFIRMATION',
    memory,
    lastAssistantText: 'Encontrei este horario para Corte Classic:\n\n- Servico: Corte Classic\n- Data: quinta-feira, 16/04\n- Horario: 17:30\n- Barbeiro: Rafael Costa\n\nQuer confirmar esse agendamento?',
    customerName: 'Gustavo',
    barbershopName: 'Linha Nobre',
    nowContext: createAgentInput().nowContext,
  })

  assert.match(reply, /Para confirmar, me responda: pode marcar/i)
  assert.doesNotMatch(reply, /Encontrei este horario/i)
})

test('atalho deterministico nao confirma quando o slot nao foi apresentado claramente ao cliente', () => {
  const memory = createConfirmationReadyMemory()

  assert.equal(
    agentTesting.shouldUseDeterministicConfirmationShortcut({
      memory,
      inboundText: 'confirmo',
      lastAssistantText: 'Posso confirmar esse horario para voce?',
    }),
    false
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

test('falha critica de disponibilidade limpa slot promovido e nao deixa o fluxo em confirmacao', () => {
  const memory = createConfirmationReadyMemory()
  memory.offeredSlots = [memory.selectedSlot]

  const override = agentTesting.resolveToolFailureOverride({
    toolTrace: [
      {
        name: 'confirm_booking',
        arguments: {},
        result: {
          status: 'error',
          reason: 'availability_infrastructure_error',
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

  const nextState = agentTesting.inferConversationState(
    override.nextAction,
    memory,
    createAgentInput().nowContext
  )

  assert.equal(override.nextAction, 'ASK_CLARIFICATION')
  assert.equal(override.replyText, 'Nao consegui verificar os horarios agora, pode tentar novamente daqui a pouco?')
  assert.equal(memory.selectedSlot, null)
  assert.deepEqual(memory.offeredSlots, [])
  assert.equal(nextState, 'WAITING_TIME')
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
