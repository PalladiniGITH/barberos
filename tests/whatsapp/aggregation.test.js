const test = require('node:test')
const assert = require('node:assert/strict')

const { interpretWhatsAppMessage } = require('@/lib/ai/openai-whatsapp-interpreter')
const { __testing: handlerTesting } = require('@/lib/whatsapp-handler')
const { __testing: conversationTesting } = require('@/lib/whatsapp-conversation')
const { __testing: bookingTesting } = require('@/lib/agendamentos/whatsapp-booking')

test('agregacao sensivel consolida horario e barbeiro em um unico turno util', async () => {
  const rawMessages = ['16:45', 'com o rafael']
  const concatenatedMessage = handlerTesting.buildConcatenatedMessage(rawMessages)
  const aggregationWindowMs = handlerTesting.resolveAggregationWindowMs({
    state: 'WAITING_TIME',
    currentMessage: rawMessages[0],
    previousMessages: [],
  })

  const intent = await interpretWhatsAppMessage({
    message: concatenatedMessage,
    barbershopName: 'Linha Nobre',
    barbershopTimezone: 'America/Sao_Paulo',
    conversationState: 'WAITING_TIME',
    offeredSlotCount: 4,
    services: [{ name: 'Barba Terapia' }],
    professionals: [{ name: 'Matheus' }, { name: 'Rafael' }],
    todayIsoDate: '2026-04-13',
    currentLocalDateTime: '2026-04-13 15:40',
    conversationSummary: {
      selectedServiceName: 'Barba Terapia',
      selectedProfessionalName: null,
      requestedDateIso: '2026-04-13',
      requestedTimeLabel: 'AFTERNOON',
      allowAnyProfessional: false,
      lastCustomerMessage: 'quero hoje a tarde',
      lastAssistantMessage: 'Hoje a tarde eu tenho 16:30, 16:45, 17:00 e 17:15. Qual prefere?',
    },
  })

  assert.equal(handlerTesting.isComplementaryShortMessage('16:45'), true)
  assert.equal(handlerTesting.isComplementaryShortMessage('com o rafael'), true)
  assert.equal(aggregationWindowMs, 6000)
  assert.equal(concatenatedMessage, '16:45 com o rafael')
  assert.equal(intent.exactTime, '16:45')
  assert.equal(intent.mentionedName, 'Rafael')
})

test('saudacoes curtas e fragmentos entram no debounce em vez de responder na hora', () => {
  assert.equal(handlerTesting.isStronglyAggregatedMessage('!'), true)
  assert.equal(handlerTesting.isStronglyAggregatedMessage('oi'), true)
  assert.equal(handlerTesting.isStronglyAggregatedMessage('amanhã'), true)
  assert.equal(handlerTesting.isStronglyAggregatedMessage('de manhã'), true)
  assert.equal(handlerTesting.isStronglyAggregatedMessage('sim'), true)

  assert.equal(
    handlerTesting.shouldProcessImmediately({
      state: 'IDLE',
      message: 'oi',
      previousMessages: [],
    }),
    false
  )

  assert.equal(
    handlerTesting.shouldProcessImmediately({
      state: 'WAITING_CONFIRMATION',
      message: 'sim',
      previousMessages: [],
    }),
    false
  )
})

test('sequencias curtas como exclamação e saudacao viram um unico turno agregado', () => {
  const rawMessages = ['!', 'oi']
  const concatenatedMessage = handlerTesting.buildConcatenatedMessage(rawMessages)

  assert.equal(concatenatedMessage, '! oi')
  assert.equal(
    handlerTesting.shouldProcessImmediately({
      state: 'IDLE',
      message: 'oi',
      previousMessages: ['!'],
    }),
    false
  )
})

test('fragmentos de servico, dia e periodo tambem sao consolidados antes da resposta', () => {
  const rawMessages = ['barba', 'amanhã', 'de manhã']
  const concatenatedMessage = handlerTesting.buildConcatenatedMessage(rawMessages)

  assert.equal(concatenatedMessage, 'barba amanhã de manhã')
  assert.equal(handlerTesting.isStronglyAggregatedMessage('barba'), true)
  assert.equal(handlerTesting.isStronglyAggregatedMessage('amanhã'), true)
  assert.equal(handlerTesting.isStronglyAggregatedMessage('de manhã'), true)
})

test('mensagem completa sozinha usa debounce curto, mas nunca responde de forma imediata', () => {
  const fullMessage = 'Quero marcar um horário amanhã de manhã para barba'

  assert.equal(handlerTesting.isClearlyCompleteMessage(fullMessage), true)
  assert.equal(
    handlerTesting.resolveAggregationWindowMs({
      state: 'IDLE',
      currentMessage: fullMessage,
      previousMessages: [],
    }),
    1800
  )

  assert.equal(
    handlerTesting.shouldProcessImmediately({
      state: 'IDLE',
      message: fullMessage,
      previousMessages: [],
    }),
    false
  )

  assert.equal(
    handlerTesting.shouldProcessImmediately({
      state: 'IDLE',
      message: 'quero marcar amanhã',
      previousMessages: ['oi'],
    }),
    false
  )
})

test('intencao curta de agendamento sozinha ja recebe debounce mais conservador', () => {
  assert.equal(
    handlerTesting.resolveAggregationWindowMs({
      state: 'IDLE',
      currentMessage: 'quero marcar um horario',
      previousMessages: [],
    }),
    5500
  )
})

test('estados sensiveis usam janela de agregacao mais conservadora para mensagens curtas', () => {
  const windowForIdleGreeting = handlerTesting.resolveAggregationWindowMs({
    state: 'IDLE',
    currentMessage: 'oi',
    previousMessages: [],
  })

  const windowForGreeting = handlerTesting.resolveAggregationWindowMs({
    state: 'WAITING_SERVICE',
    currentMessage: 'barba',
    previousMessages: [],
  })

  const windowForConfirmation = handlerTesting.resolveAggregationWindowMs({
    state: 'WAITING_CONFIRMATION',
    currentMessage: 'sim',
    previousMessages: [],
  })

  assert.equal(windowForIdleGreeting, 5500)
  assert.equal(windowForGreeting, 6000)
  assert.equal(windowForConfirmation, 6000)
})

test('debounce reinicia quando chega nova mensagem antes do timer acabar', () => {
  const waitStartedAt = new Date('2026-04-15T15:00:00.000Z')

  assert.equal(
    handlerTesting.shouldFinalizeDebouncedTurn({
      waitStartedAt,
      lastMessageTimestamp: new Date('2026-04-15T15:00:02.000Z'),
    }),
    false
  )

  assert.equal(
    handlerTesting.shouldFinalizeDebouncedTurn({
      waitStartedAt,
      lastMessageTimestamp: new Date('2026-04-15T15:00:00.000Z'),
    }),
    true
  )
})

test('mensagem de horarios nao repete linhas nem cria espacos em branco extras', () => {
  const message = conversationTesting.buildHumanSlotOfferMessage(
    [
      {
        key: 'pro-rafael:2026-04-13T19:45:00.000Z',
        professionalId: 'pro-rafael',
        professionalName: 'Rafael',
        dateIso: '2026-04-13',
        timeLabel: '16:45',
        startAtIso: '2026-04-13T19:45:00.000Z',
        endAtIso: '2026-04-13T20:20:00.000Z',
      },
      {
        key: 'pro-rafael:2026-04-13T19:45:00.000Z',
        professionalId: 'pro-rafael',
        professionalName: 'Rafael',
        dateIso: '2026-04-13',
        timeLabel: '16:45',
        startAtIso: '2026-04-13T19:45:00.000Z',
        endAtIso: '2026-04-13T20:20:00.000Z',
      },
    ],
    'Barba Terapia',
    'America/Sao_Paulo',
    'AFTERNOON'
  )

  assert.equal((message.match(/16:45/g) ?? []).length, 1)
  assert.doesNotMatch(message, /\n{3,}/)
})

test('deduplica offeredSlots sem esconder horarios iguais com barbeiros diferentes', () => {
  const deduped = bookingTesting.dedupeWhatsAppSlots([
    {
      key: 'pro-rafael:2026-04-13T19:45:00.000Z',
      professionalId: 'pro-rafael',
      professionalName: 'Rafael',
      dateIso: '2026-04-13',
      timeLabel: '16:45',
      startAtIso: '2026-04-13T19:45:00.000Z',
      endAtIso: '2026-04-13T20:20:00.000Z',
    },
    {
      key: 'pro-rafael:2026-04-13T19:45:00.000Z',
      professionalId: 'pro-rafael',
      professionalName: 'Rafael',
      dateIso: '2026-04-13',
      timeLabel: '16:45',
      startAtIso: '2026-04-13T19:45:00.000Z',
      endAtIso: '2026-04-13T20:20:00.000Z',
    },
    {
      key: 'pro-matheus:2026-04-13T19:45:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus',
      dateIso: '2026-04-13',
      timeLabel: '16:45',
      startAtIso: '2026-04-13T19:45:00.000Z',
      endAtIso: '2026-04-13T20:20:00.000Z',
    },
  ])

  assert.equal(deduped.length, 2)
  assert.equal(deduped.filter((slot) => slot.timeLabel === '16:45').length, 2)
})

test('quando ha varios barbeiros no mesmo horario a mensagem mostra o nome de cada um', () => {
  const message = conversationTesting.buildHumanSlotOfferMessage(
    [
      {
        key: 'pro-lucas:2026-04-14T12:00:00.000Z',
        professionalId: 'pro-lucas',
        professionalName: 'Lucas Ribeiro',
        dateIso: '2026-04-14',
        timeLabel: '09:00',
        startAtIso: '2026-04-14T12:00:00.000Z',
        endAtIso: '2026-04-14T12:35:00.000Z',
      },
      {
        key: 'pro-matheus:2026-04-14T12:00:00.000Z',
        professionalId: 'pro-matheus',
        professionalName: 'Matheus Lima',
        dateIso: '2026-04-14',
        timeLabel: '09:00',
        startAtIso: '2026-04-14T12:00:00.000Z',
        endAtIso: '2026-04-14T12:35:00.000Z',
      },
    ],
    'Corte Classic',
    'America/Sao_Paulo',
    'MORNING'
  )

  assert.match(message, /09:00 com Lucas Ribeiro/)
  assert.match(message, /09:00 com Matheus Lima/)
  assert.match(message, /• 09:00 com Lucas Ribeiro/)
  assert.match(message, /• 09:00 com Matheus Lima/)
})

test('oi seguido de intencao completa em IDLE continua em um unico turno agregado', () => {
  const fullMessage = 'Queria marcar horario pra hoje'

  assert.equal(
    handlerTesting.hasPendingBufferedMessages({
      bufferedMessages: ['Oi'],
      lastMessageTimestamp: new Date(),
      activeWindowMs: 4000,
      referenceTime: Date.now(),
    }),
    true
  )

  assert.equal(
    handlerTesting.shouldProcessImmediately({
      state: 'IDLE',
      message: fullMessage,
      previousMessages: ['Oi'],
    }),
    false
  )

  assert.equal(
    handlerTesting.buildConcatenatedMessage(['Oi', fullMessage]),
    'Oi Queria marcar horario pra hoje'
  )

  assert.equal(
    handlerTesting.detectFragmentedBookingTurn({
      state: 'IDLE',
      currentMessage: fullMessage,
      previousMessages: ['Oi'],
    }).active,
    true
  )
})

test('barba, amanha e com o matheus continuam em um unico bloco agregado', () => {
  assert.equal(
    handlerTesting.buildConcatenatedMessage(['barba', 'amanha', 'com o matheus']),
    'barba amanha com o matheus'
  )

  assert.equal(
    handlerTesting.resolveAggregationWindowMs({
      state: 'WAITING_SERVICE',
      currentMessage: 'com o matheus',
      previousMessages: ['barba', 'amanha'],
    }),
    6800
  )
})

test('oi, quero marcar um horario e sexta que vem formam um turno fragmentado unico', () => {
  const rawMessages = ['Oi', 'quero marcar um horario', 'sexta que vem']

  assert.equal(
    handlerTesting.buildConcatenatedMessage(rawMessages),
    'Oi quero marcar um horario sexta que vem'
  )

  const fragmentedTurn = handlerTesting.detectFragmentedBookingTurn({
    state: 'IDLE',
    currentMessage: 'sexta que vem',
    previousMessages: ['Oi', 'quero marcar um horario'],
  })

  assert.equal(fragmentedTurn.active, true)
  assert.equal(fragmentedTurn.summary.greeting, true)
  assert.equal(fragmentedTurn.summary.intent, true)
  assert.equal(fragmentedTurn.summary.date, true)
  assert.equal(
    handlerTesting.resolveAggregationWindowMs({
      state: 'IDLE',
      currentMessage: 'sexta que vem',
      previousMessages: ['Oi', 'quero marcar um horario'],
    }),
    6200
  )
})

test('barba e amanha continuam em formacao ate o debounce final', () => {
  const fragmentedTurn = handlerTesting.detectFragmentedBookingTurn({
    state: 'WAITING_SERVICE',
    currentMessage: 'amanha',
    previousMessages: ['barba'],
  })

  assert.equal(fragmentedTurn.active, true)
  assert.equal(fragmentedTurn.summary.service, true)
  assert.equal(fragmentedTurn.summary.date, true)
  assert.equal(
    handlerTesting.resolveAggregationWindowMs({
      state: 'WAITING_SERVICE',
      currentMessage: 'amanha',
      previousMessages: ['barba'],
    }),
    6800
  )
})

test('corte, sexta e com o matheus viram um unico turno fragmentado de agendamento', () => {
  const rawMessages = ['corte', 'sexta', 'com o matheus']

  assert.equal(
    handlerTesting.buildConcatenatedMessage(rawMessages),
    'corte sexta com o matheus'
  )

  const fragmentedTurn = handlerTesting.detectFragmentedBookingTurn({
    state: 'WAITING_DATE',
    currentMessage: 'com o matheus',
    previousMessages: ['corte', 'sexta'],
  })

  assert.equal(fragmentedTurn.active, true)
  assert.equal(fragmentedTurn.summary.service, true)
  assert.equal(fragmentedTurn.summary.date, true)
  assert.equal(fragmentedTurn.summary.professional, true)
  assert.equal(
    handlerTesting.resolveAggregationWindowMs({
      state: 'WAITING_DATE',
      currentMessage: 'com o matheus',
      previousMessages: ['corte', 'sexta'],
    }),
    6800
  )
})

test('debounce nao finaliza no meio do bloco quando chega uma nova mensagem fragmentada', () => {
  const firstWaitStartedAt = new Date('2026-04-15T15:00:00.000Z')
  const restartedAt = new Date('2026-04-15T15:00:04.000Z')

  assert.equal(
    handlerTesting.shouldFinalizeDebouncedTurn({
      waitStartedAt: firstWaitStartedAt,
      lastMessageTimestamp: restartedAt,
    }),
    false
  )

  assert.equal(
    handlerTesting.detectFragmentedBookingTurn({
      state: 'IDLE',
      currentMessage: 'sexta que vem',
      previousMessages: ['Oi', 'quero marcar um horario'],
    }).active,
    true
  )
})

test('turno WAITING_ recente preserva contexto mesmo sem buffer imediato', () => {
  assert.equal(
    handlerTesting.hasOngoingTurnContext({
      state: 'WAITING_TIME',
      updatedAt: new Date('2026-04-16T13:00:00.000Z'),
      referenceTime: new Date('2026-04-16T13:00:20.000Z').getTime(),
    }),
    true
  )

  assert.equal(
    handlerTesting.hasOngoingTurnContext({
      state: 'WAITING_TIME',
      updatedAt: new Date('2026-04-16T13:00:00.000Z'),
      referenceTime: new Date('2026-04-16T13:00:40.000Z').getTime(),
    }),
    false
  )
})
