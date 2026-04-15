const test = require('node:test')
const assert = require('node:assert/strict')

const { __testing: conversationTesting } = require('@/lib/whatsapp-conversation')

function buildSlot() {
  return {
    key: 'pro-matheus:2026-04-13T16:15:00.000Z',
    professionalId: 'pro-matheus',
    professionalName: 'Matheus',
    dateIso: '2026-04-13',
    timeLabel: '13:15',
    startAtIso: '2026-04-13T16:15:00.000Z',
    endAtIso: '2026-04-13T16:50:00.000Z',
  }
}

test('contexto velho ou incoerente nao e considerado confiavel', () => {
  const draft = conversationTesting.buildEmptyConversationDraft()
  draft.selectedServiceId = 'svc-classic'
  draft.selectedServiceName = 'Corte Classic'
  draft.selectedProfessionalId = 'pro-matheus'
  draft.selectedProfessionalName = 'Matheus'
  draft.requestedDateIso = '2026-04-13'
  draft.requestedTimeLabel = 'AFTERNOON'
  draft.offeredSlots = [buildSlot()]
  draft.selectedStoredSlot = buildSlot()

  const reliable = conversationTesting.isConversationContextReliable({
    state: 'WAITING_TIME',
    updatedAt: new Date(Date.now() - 60 * 60_000),
    draft,
  })

  assert.equal(reliable, false)
})

test('contexto com progresso util e preservado mesmo quando a confiabilidade estrita falha', () => {
  const draft = conversationTesting.buildEmptyConversationDraft()
  draft.selectedServiceId = 'svc-classic'
  draft.selectedServiceName = 'Corte Classic'
  draft.selectedProfessionalId = 'pro-matheus'
  draft.selectedProfessionalName = 'Matheus'
  draft.requestedDateIso = '2026-04-13'
  draft.requestedTimeLabel = '17:30'
  draft.selectedStoredSlot = buildSlot()

  const runtime = conversationTesting.resolveConversationRuntimeContext({
    state: 'WAITING_TIME',
    updatedAt: new Date(Date.now() - 60 * 60_000),
    draft,
  })

  assert.equal(runtime.contextReliable, false)
  assert.equal(runtime.shouldPreserveProgress, true)
  assert.equal(runtime.effectiveState, 'WAITING_CONFIRMATION')
  assert.equal(runtime.draftForContinuation.selectedStoredSlot?.timeLabel, '13:15')
})

test('saudacao curta com contexto nao confiavel dispara reset seguro', () => {
  assert.equal(conversationTesting.isShortGreetingMessage('Oi'), true)
  assert.equal(
    conversationTesting.shouldResetConversationOnGreeting({
      shortGreeting: true,
      contextReliable: false,
      restartConversation: false,
    }),
    true
  )
})

test('retomada logo apos agendamento confirmado usa contexto recente em vez de saudacao fria', () => {
  const hasRecentContext = conversationTesting.hasRecentCompletedBookingContext({
    state: 'IDLE',
    completedAt: new Date(Date.now() - 5 * 60_000),
    recentBooking: {
      serviceName: 'Barba Terapia',
      professionalName: 'Rafael Costa',
      dateIso: '2026-04-13',
      timeLabel: '16:45',
    },
  })

  const reply = conversationTesting.buildRecentConfirmedGreeting(
    {
      serviceName: 'Barba Terapia',
      professionalName: 'Rafael Costa',
      dateIso: '2026-04-13',
      timeLabel: '16:45',
    },
    'America/Sao_Paulo'
  )

  assert.equal(hasRecentContext, true)
  assert.match(reply, /16:45/)
  assert.match(reply, /Rafael Costa/)
  assert.match(reply, /ja ficou marcado|Precisa de mais alguma coisa/i)
})

test('detecta topic switch quando o cliente pergunta sobre horario ja confirmado', () => {
  const detected = conversationTesting.isExistingBookingStatusQuestion({
    message: 'eu tenho horario amanha ja marcado?',
    lastCustomerMessage: 'quero marcar barba amanha',
    lastAssistantMessage: 'Tem preferencia de barbeiro ou posso procurar com qualquer um?',
  })

  assert.equal(detected, true)
})

test('detecta consultas naturais sobre agendamentos ja confirmados', () => {
  const messages = [
    'quais horarios eu tenho amanha?',
    'que horas eu marquei amanha?',
    'tenho algo amanha?',
    'com quem eu estou marcado amanha?',
    'qual meu horario de amanha?',
    'qual meu proximo horario?',
    'quais horarios eu tenho essa semana?',
    'tenho algo essa semana?',
    'meus horarios dessa semana',
    'nada eu so queria confirmar que horario ficou amanha',
    'tem algo pra mim amanha?',
    'o que eu tenho amanha?',
  ]

  messages.forEach((message) => {
    const detected = conversationTesting.isExistingBookingStatusQuestion({
      message,
      lastCustomerMessage: 'quero marcar barba amanha',
      lastAssistantMessage: 'Tem preferencia de barbeiro ou posso procurar com qualquer um?',
    })

    assert.equal(detected, true, message)
  })
})

test('consulta dessa semana vira escopo semanal em vez de novo agendamento', () => {
  const query = conversationTesting.parseExistingBookingQuery({
    message: 'quais horarios eu tenho essa semana?',
    draft: conversationTesting.buildEmptyConversationDraft(),
    recentBooking: null,
    timezone: 'America/Sao_Paulo',
  })

  assert.equal(query.scope, 'WEEK')
  assert.equal(query.requestedDateIso, null)
})

test('follow-up curto como "que horas?" consulta o agendamento ja encontrado', () => {
  const detected = conversationTesting.isExistingBookingStatusQuestion({
    message: 'que horas?',
    lastCustomerMessage: 'eu tenho horario amanha?',
    lastAssistantMessage: 'Voce tem um horario confirmado amanha as 17:00 com Matheus Lima para Pigmentacao Natural.',
  })

  const requestedDateIso = conversationTesting.parseRequestedDateFromExistingBookingQuestion({
    message: 'que horas?',
    previousQuery: {
      scope: 'DAY',
      requestedDateIso: '2026-04-15',
    },
    timezone: 'America/Sao_Paulo',
  })

  assert.equal(detected, true)
  assert.equal(requestedDateIso, '2026-04-15')
})

test('sem barbeiro definido a conversa pergunta preferencia antes de sugerir horarios', () => {
  const reply = conversationTesting.buildProfessionalQuestion(
    ['Lucas Ribeiro', 'Matheus Lima', 'Rafael Costa'],
    null
  )

  assert.match(reply, /preferencia de barbeiro|qualquer um/i)
  assert.match(reply, /Lucas Ribeiro/)
})

test('com barbeiro recente ou preferencial a conversa usa pergunta mais contextual', () => {
  const reply = conversationTesting.buildProfessionalQuestion(
    ['Lucas Ribeiro', 'Matheus Lima', 'Rafael Costa'],
    'Matheus Lima'
  )

  assert.match(reply, /Matheus Lima/)
  assert.match(reply, /de novo|prefere outro/i)
})

test('lista de horarios com o mesmo barbeiro ainda exibe o nome do profissional em cada linha', () => {
  const reply = conversationTesting.buildHumanSlotOfferMessage(
    [
      {
        key: 'pro-lucas:2026-04-15T12:30:00.000Z',
        professionalId: 'pro-lucas',
        professionalName: 'Lucas Ribeiro',
        dateIso: '2026-04-15',
        timeLabel: '09:30',
        startAtIso: '2026-04-15T12:30:00.000Z',
        endAtIso: '2026-04-15T13:05:00.000Z',
      },
      {
        key: 'pro-lucas:2026-04-15T12:45:00.000Z',
        professionalId: 'pro-lucas',
        professionalName: 'Lucas Ribeiro',
        dateIso: '2026-04-15',
        timeLabel: '09:45',
        startAtIso: '2026-04-15T12:45:00.000Z',
        endAtIso: '2026-04-15T13:20:00.000Z',
      },
    ],
    'Corte Classic',
    'America/Sao_Paulo',
    'MORNING'
  )

  assert.match(reply, /09:30 com Lucas Ribeiro/i)
  assert.match(reply, /09:45 com Lucas Ribeiro/i)
})

test('quando o barbeiro preferido nao tem o horario pedido, sugere proximos horarios com ele antes de outro barbeiro', () => {
  const reply = conversationTesting.buildExactTimeFallbackResponse({
    exactTime: '15:00',
    timezone: 'America/Sao_Paulo',
    dateIso: '2026-04-15',
    professionalName: 'Matheus',
    slots: [
      {
        key: 'pro-matheus:2026-04-15T18:30:00.000Z',
        professionalId: 'pro-matheus',
        professionalName: 'Matheus',
        dateIso: '2026-04-15',
        timeLabel: '15:30',
        startAtIso: '2026-04-15T18:30:00.000Z',
        endAtIso: '2026-04-15T19:05:00.000Z',
      },
      {
        key: 'pro-matheus:2026-04-15T19:00:00.000Z',
        professionalId: 'pro-matheus',
        professionalName: 'Matheus',
        dateIso: '2026-04-15',
        timeLabel: '16:00',
        startAtIso: '2026-04-15T19:00:00.000Z',
        endAtIso: '2026-04-15T19:35:00.000Z',
      },
    ],
    allowAlternativeProfessionalSuggestion: false,
  })

  assert.match(reply, /15:30 e 16:00/i)
  assert.match(reply, /com Matheus/i)
  assert.doesNotMatch(reply, /outro barbeiro/i)
})

test('consulta de agendamento existente responde com o horario encontrado e retoma o fluxo se necessario', () => {
  const draft = conversationTesting.buildEmptyConversationDraft()
  draft.selectedServiceId = 'svc-barba'
  draft.selectedServiceName = 'Barba'
  draft.requestedDateIso = '2026-04-15'

  const reply = conversationTesting.buildExistingBookingStatusMessage({
    queryScope: 'DAY',
    requestedDateIso: '2026-04-15',
    bookings: [
      {
        id: 'apt-1',
        status: 'CONFIRMED',
        serviceName: 'Pigmentacao Natural',
        professionalName: 'Matheus Lima',
        dateIso: '2026-04-15',
        timeLabel: '17:00',
      },
    ],
    timezone: 'America/Sao_Paulo',
    draft,
    referenceDateIso: '2026-04-14',
  })

  assert.match(reply, /17:00/)
  assert.match(reply, /Matheus Lima/)
  assert.match(reply, /Pigmentacao Natural/)
  assert.match(reply, /continuo seu novo agendamento de Barba/i)
})

test('consulta de amanha com um unico horario responde de forma direta e natural', () => {
  const reply = conversationTesting.buildExistingBookingStatusMessage({
    queryScope: 'DAY',
    requestedDateIso: '2026-04-15',
    bookings: [
      {
        id: 'apt-1',
        status: 'CONFIRMED',
        serviceName: 'Hidratacao Capilar',
        professionalName: 'Rafael Costa',
        dateIso: '2026-04-15',
        dateLabel: 'quarta-feira, 15/04',
        timeLabel: '16:00',
      },
    ],
    timezone: 'America/Sao_Paulo',
    draft: conversationTesting.buildEmptyConversationDraft(),
    referenceDateIso: '2026-04-14',
  })

  assert.match(reply, /Amanha voce esta marcado as 16:00/i)
  assert.match(reply, /Rafael Costa/)
  assert.match(reply, /Hidratacao Capilar/)
})

test('consulta com multiplos horarios amanha lista todos de forma clara', () => {
  const reply = conversationTesting.buildExistingBookingStatusMessage({
    queryScope: 'DAY',
    requestedDateIso: '2026-04-15',
    bookings: [
      {
        id: 'apt-1',
        status: 'CONFIRMED',
        serviceName: 'Corte Classic',
        professionalName: 'Matheus Lima',
        dateIso: '2026-04-15',
        dateLabel: 'quarta-feira, 15/04',
        timeLabel: '10:00',
      },
      {
        id: 'apt-2',
        status: 'CONFIRMED',
        serviceName: 'Barba Terapia',
        professionalName: 'Rafael Costa',
        dateIso: '2026-04-15',
        dateLabel: 'quarta-feira, 15/04',
        timeLabel: '16:00',
      },
    ],
    timezone: 'America/Sao_Paulo',
    draft: conversationTesting.buildEmptyConversationDraft(),
    referenceDateIso: '2026-04-14',
  })

  assert.match(reply, /Amanha voce tem estes horarios confirmados/i)
  assert.match(reply, /10:00 com Matheus Lima para Corte Classic/i)
  assert.match(reply, /16:00 com Rafael Costa para Barba Terapia/i)
})

test('consulta sem agendamento confirmado responde de forma objetiva', () => {
  const reply = conversationTesting.buildExistingBookingStatusMessage({
    queryScope: 'DAY',
    requestedDateIso: '2026-04-15',
    bookings: [],
    timezone: 'America/Sao_Paulo',
    draft: conversationTesting.buildEmptyConversationDraft(),
    referenceDateIso: '2026-04-14',
  })

  assert.match(reply, /nao tem nenhum horario confirmado/i)
})

test('consulta dessa semana responde com os horarios futuros da semana de forma natural', () => {
  const reply = conversationTesting.buildExistingBookingStatusMessage({
    queryScope: 'WEEK',
    requestedDateIso: null,
    bookings: [
      {
        id: 'apt-1',
        status: 'CONFIRMED',
        serviceName: 'Hidratacao Capilar',
        professionalName: 'Rafael Costa',
        dateIso: '2026-04-17',
        dateLabel: '17/04/2026',
        timeLabel: '18:00',
      },
      {
        id: 'apt-2',
        status: 'CONFIRMED',
        serviceName: 'Corte Classic',
        professionalName: 'Matheus Lima',
        dateIso: '2026-04-18',
        dateLabel: '18/04/2026',
        timeLabel: '10:00',
      },
    ],
    timezone: 'America/Sao_Paulo',
    draft: conversationTesting.buildEmptyConversationDraft(),
    referenceDateIso: '2026-04-14',
  })

  assert.match(reply, /Essa semana voce tem estes horarios confirmados/i)
  assert.match(reply, /sexta/i)
  assert.match(reply, /18:00 com Rafael Costa para Hidratacao Capilar/i)
  assert.match(reply, /s[áa]bado/i)
})

test('ok apos agendamento concluido vira encerramento leve em vez de novo fluxo', () => {
  assert.equal(conversationTesting.isAcknowledgementMessage('ok'), true)

  const reply = conversationTesting.buildAcknowledgementResponse({
    recentBooking: {
      serviceName: 'Corte Classic',
      professionalName: 'Matheus Lima',
      dateIso: '2026-04-15',
      timeLabel: '16:00',
    },
    timezone: 'America/Sao_Paulo',
    effectiveState: 'IDLE',
  })

  assert.match(reply, /Qualquer coisa e so me chamar/i)
})

test('encerramentos naturais como "ok obrigado", "nenhum" e "nao quero" saem do fluxo', () => {
  const closingMessages = ['ok obrigado', 'nenhum', 'nao quero', 'so isso', 'deixa assim']

  closingMessages.forEach((message) => {
    assert.equal(conversationTesting.isAcknowledgementMessage(message), true, message)
  })
})

test('respostas afirmativas amplas sao aceitas para fechamento deterministico', () => {
  const affirmativeReplies = ['sim', 's', 'ok', 'pode', 'confirmar', 'quero', 'desejo', 'fechado']

  affirmativeReplies.forEach((reply) => {
    assert.equal(conversationTesting.isAffirmativeConfirmationMessage(reply), true)
  })
})

test('novo horario explicito bloqueia a confirmacao do slot antigo', () => {
  assert.equal(conversationTesting.isAffirmativeConfirmationMessage('pode ser 14:30'), true)
  assert.equal(conversationTesting.shouldTreatAsStoredSlotConfirmation('pode ser 14:30'), false)
  assert.equal(conversationTesting.shouldTreatAsStoredSlotConfirmation('pode'), true)
})

test('quando o horario exato nao existe a resposta avanca com alternativas proximas', () => {
  const slots = [
    {
      key: 'pro-matheus:2026-04-14T11:00:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus',
      dateIso: '2026-04-14',
      timeLabel: '08:00',
      startAtIso: '2026-04-14T11:00:00.000Z',
      endAtIso: '2026-04-14T11:35:00.000Z',
    },
    {
      key: 'pro-matheus:2026-04-14T11:15:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus',
      dateIso: '2026-04-14',
      timeLabel: '08:15',
      startAtIso: '2026-04-14T11:15:00.000Z',
      endAtIso: '2026-04-14T11:50:00.000Z',
    },
  ]

  const reply = conversationTesting.buildExactTimeFallbackResponse({
    exactTime: '10:00',
    timezone: 'America/Sao_Paulo',
    dateIso: '2026-04-14',
    slots,
    professionalName: 'Matheus',
    previousAssistantText: 'Amanha de manha com Matheus eu tenho estes horarios livres para Corte Classic:\n\n- 08:00\n- 08:15\n\nPode me dizer qual prefere ou pedir outro horario.',
  })

  assert.match(reply, /10:00/)
  assert.match(reply, /08:00/)
  assert.match(reply, /08:15/)
  assert.match(reply, /Matheus/)
  assert.doesNotMatch(reply, /10h e manha|10:00 e manha/i)
})
