const test = require('node:test')
const assert = require('node:assert/strict')

const { detectRelativeDateExpression } = require('@/lib/ai/openai-whatsapp-interpreter')
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

test('expressoes relativas reais continuam reconhecidas para promover requestedDateIso no fluxo', () => {
  const messages = [
    'daqui 15 dias',
    'daqui 2 semanas',
    'daqui 1 mes',
    'na outra sexta',
    'quinta da semana que vem',
    'proxima quinta',
    'domingo da outra semana',
    'quarta da proxima semana',
  ]

  messages.forEach((message) => {
    assert.equal(detectRelativeDateExpression(message), true, message)
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

test('follow-up curto como "e sabado?" continua a consulta anterior', () => {
  const detected = conversationTesting.isExistingBookingStatusQuestion({
    message: 'e sabado?',
    lastCustomerMessage: 'quais horarios eu tenho essa semana?',
    lastAssistantMessage: 'Essa semana voce tem estes horarios confirmados:\n\n- Sexta-feira - 18:00\n  Hidratacao Capilar com Rafael Costa',
  })

  const query = conversationTesting.parseExistingBookingQuery({
    message: 'e sabado?',
    previousQuery: {
      scope: 'WEEK',
      requestedDateIso: null,
      referenceDateIso: '2026-04-14',
    },
    timezone: 'America/Sao_Paulo',
  })

  assert.equal(detected, true)
  assert.equal(query.scope, 'DAY')
  assert.equal(query.requestedDateIso, '2026-04-18')
})

test('follow-up curto como "e domingo?" nao cai em novo agendamento', () => {
  const detected = conversationTesting.isExistingBookingStatusQuestion({
    message: 'e domingo?',
    lastCustomerMessage: 'quais horarios eu tenho essa semana?',
    lastAssistantMessage: 'Essa semana voce tem estes horarios confirmados:\n\n- Sexta-feira - 18:00\n  Hidratacao Capilar com Rafael Costa',
  })

  assert.equal(detected, true)
})

test('sem barbeiro definido a conversa pergunta preferencia antes de sugerir horarios', () => {
  const reply = conversationTesting.buildProfessionalQuestion(
    ['Lucas Ribeiro', 'Matheus Lima', 'Rafael Costa'],
    null,
    {
      requestedDateIso: '2026-04-14',
      timezone: 'America/Sao_Paulo',
      serviceName: 'Barba Terapia',
    }
  )

  assert.match(reply, /preferencia de barbeiro|qualquer um/i)
  assert.match(reply, /1\. Lucas Ribeiro/i)
  assert.match(reply, /4\. Tanto faz/i)
  assert.doesNotMatch(reply, /09:30|09:45/)
})

test('resposta com nome do barbeiro seleciona a opcao ja apresentada sem depender de nova busca textual de horario', () => {
  const slot = conversationTesting.pickOfferedSlot({
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
    exactTime: null,
    message: 'Lucas',
  })

  assert.equal(slot?.professionalName, 'Lucas Ribeiro')
})

test('correcao de data no fluxo legado preserva o horario ja escolhido para revalidacao', () => {
  const draft = conversationTesting.buildEmptyConversationDraft()
  draft.selectedServiceId = 'svc-pigmentacao'
  draft.selectedServiceName = 'Pigmentacao Natural'
  draft.selectedProfessionalId = 'pro-lucas'
  draft.selectedProfessionalName = 'Lucas Ribeiro'
  draft.requestedDateIso = '2026-04-29'
  draft.requestedTimeLabel = '11:00'
  draft.selectedStoredSlot = buildSlot()
  draft.offeredSlots = [buildSlot()]

  conversationTesting.applyCorrectionTarget(draft, 'DATE')

  assert.equal(draft.requestedDateIso, null)
  assert.equal(draft.requestedTimeLabel, '11:00')
  assert.equal(draft.selectedStoredSlot, null)
  assert.deepEqual(draft.offeredSlots, [])
})

test('resumo de confirmacao de uma opcao ja apresentada nao usa linguagem de nova descoberta', () => {
  const reply = conversationTesting.buildConfirmationMessage(
    {
      key: 'pro-lucas:2026-04-27T14:00:00.000Z',
      professionalId: 'pro-lucas',
      professionalName: 'Lucas Ribeiro',
      dateIso: '2026-04-27',
      timeLabel: '11:00',
      startAtIso: '2026-04-27T14:00:00.000Z',
      endAtIso: '2026-04-27T14:45:00.000Z',
    },
    'Pigmentacao Natural',
    'America/Sao_Paulo',
    'selection'
  )

  assert.match(reply, /vou deixar assim para confirmacao/i)
  assert.match(reply, /Pigmentacao Natural/i)
  assert.doesNotMatch(reply, /Encontrei este horario/i)
})

test('lista de servicos fica formatada em multiplas linhas com bullets', () => {
  const reply = conversationTesting.buildServiceQuestion([
    'Barba Terapia',
    'Corte + Barba Premium',
    'Corte Classic',
  ])

  assert.match(reply, /Temos estes servicos disponiveis/i)
  assert.match(reply, /(?:^|\n)- Barba Terapia/m)
  assert.match(reply, /(?:^|\n)- Corte \+ Barba Premium/m)
  assert.match(reply, /(?:^|\n)- Corte Classic/m)
  assert.doesNotMatch(reply, /Barba Terapia, Corte \+ Barba Premium, Corte Classic/)
  assert.doesNotMatch(reply, /R\$|55|35/)
})

test('selecao de servico pendente reaproveita a data enviada fora de ordem', () => {
  const reply = conversationTesting.buildServiceSelectionQuestion({
    serviceNames: ['Barba Terapia', 'Corte + Barba Premium'],
    requestedDateIso: '2026-04-14',
    timezone: 'America/Sao_Paulo',
  })

  assert.match(reply, /14\/04/)
  assert.match(reply, /1\. Barba Terapia/i)
  assert.match(reply, /2\. Corte \+ Barba Premium/i)
  assert.doesNotMatch(reply, /Qual dia voce prefere/i)
})

test('com barbeiro recente ou preferencial a conversa usa pergunta mais contextual', () => {
  const reply = conversationTesting.buildProfessionalQuestion(
    ['Lucas Ribeiro', 'Matheus Lima', 'Rafael Costa'],
    'Matheus Lima',
    {
      requestedDateIso: '2026-04-14',
      timezone: 'America/Sao_Paulo',
      serviceName: 'Barba Terapia',
    }
  )

  assert.match(reply, /Matheus Lima/)
  assert.match(reply, /de novo|prefere outro/i)
  assert.match(reply, /Tanto faz/i)
})

test('contagem de opcoes prioriza servico pendente, depois barbeiro e por fim horarios', () => {
  const draft = conversationTesting.buildEmptyConversationDraft()

  draft.pendingServiceOptions = [
    { id: 'svc-1', name: 'Barba Terapia' },
    { id: 'svc-2', name: 'Corte + Barba Premium' },
  ]
  assert.equal(conversationTesting.getActiveSelectableOptionCount(draft), 2)

  draft.pendingServiceOptions = []
  draft.pendingProfessionalOptions = [
    { id: 'pro-1', name: 'Lucas Ribeiro' },
    { id: 'pro-2', name: 'Matheus Lima' },
  ]
  assert.equal(conversationTesting.getActiveSelectableOptionCount(draft), 3)

  draft.pendingProfessionalOptions = []
  draft.offeredSlots = [buildSlot()]
  assert.equal(conversationTesting.getActiveSelectableOptionCount(draft), 1)
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

test('troca de barbeiro preserva o horario explicito para revalidacao do novo profissional', () => {
  assert.equal(
    conversationTesting.resolveExactTimeForSlotRevalidation({
      interpretedExactTime: null,
      requestedTimeLabel: '09:30',
      professionalChanged: true,
    }),
    '09:30'
  )

  assert.equal(
    conversationTesting.resolveExactTimeForSlotRevalidation({
      interpretedExactTime: null,
      requestedTimeLabel: '09:30',
      professionalChanged: false,
    }),
    null
  )
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

  assert.match(reply, /Tenho estas opcoes com Matheus/i)
  assert.match(reply, /• 15:30/i)
  assert.match(reply, /• 16:00/i)
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
  assert.match(reply, /para Hidratacao Capilar com Rafael Costa/i)
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
  assert.match(reply, /- 10:00\s+  Corte Classic com Matheus Lima/i)
  assert.match(reply, /- 16:00\s+  Barba Terapia com Rafael Costa/i)
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
  assert.match(reply, /- Sexta-feira - 18:00/i)
  assert.match(reply, /Hidratacao Capilar com Rafael Costa/i)
  assert.match(reply, /- S[áa]bado - 10:00/i)
})

test('consulta de sabado sem horario responde de forma objetiva', () => {
  const reply = conversationTesting.buildExistingBookingStatusMessage({
    queryScope: 'DAY',
    requestedDateIso: '2026-04-18',
    bookings: [],
    timezone: 'America/Sao_Paulo',
    draft: conversationTesting.buildEmptyConversationDraft(),
    referenceDateIso: '2026-04-14',
  })

  assert.match(reply, /No s[áa]bado voce nao tem nenhum horario confirmado/i)
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

test('so confirmacoes explicitas fortes entram no fechamento deterministico', () => {
  const affirmativeReplies = ['sim', 's', 'pode', 'pode sim', 'quero', 'isso', 'esse', 'esse mesmo', 'confirmo', 'confirmar', 'pode confirmar', 'pode marcar', 'pode agendar', 'sim pode confirmar', 'sim pode marcar', 'quero confirmar', 'fechado']

  affirmativeReplies.forEach((reply) => {
    assert.equal(conversationTesting.isAffirmativeConfirmationMessage(reply), true)
  })
})

test('mensagens vagas nao contam como confirmacao final no fluxo legado', () => {
  ;['ok', 'ok tente', 'blz', 'beleza', 'pode tentar', 'tenta ai', 'aham', 'uhum', 'talvez'].forEach((message) => {
    assert.equal(conversationTesting.isAffirmativeConfirmationMessage(message), false, message)
  })
})

test('caminho de deterministic confirmation accepted exige frases fortes e explicitas', () => {
  ;['sim', 's', 'pode', 'pode sim', 'quero', 'isso', 'esse', 'esse mesmo', 'confirmo', 'confirmar', 'pode confirmar', 'pode marcar', 'pode agendar', 'sim pode confirmar', 'fechado'].forEach((message) => {
    assert.equal(conversationTesting.shouldTreatAsStoredSlotConfirmation(message), true, message)
  })
})

test('caminho de deterministic confirmation blocked barra correcoes explicitas junto da concordancia', () => {
  ;['confirmo 14:30', 'pode confirmar com o Matheus', 'pode confirmar amanha', 'fechado 16h', 'confirmo 14:30', 'confirmo com o Matheus'].forEach((message) => {
    assert.equal(conversationTesting.isAffirmativeConfirmationMessage(message), true, message)
    assert.equal(conversationTesting.shouldTreatAsStoredSlotConfirmation(message), false, message)
  })
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

test('horario bloqueado gera resposta operacional explicita com intervalo do bloqueio', () => {
  const slots = [
    {
      key: 'pro-matheus:2026-04-30T11:00:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus Lima',
      dateIso: '2026-04-30',
      timeLabel: '08:00',
      startAtIso: '2026-04-30T11:00:00.000Z',
      endAtIso: '2026-04-30T12:00:00.000Z',
    },
    {
      key: 'pro-matheus:2026-04-30T14:00:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus Lima',
      dateIso: '2026-04-30',
      timeLabel: '11:00',
      startAtIso: '2026-04-30T14:00:00.000Z',
      endAtIso: '2026-04-30T15:00:00.000Z',
    },
    {
      key: 'pro-lucas:2026-04-30T12:00:00.000Z',
      professionalId: 'pro-lucas',
      professionalName: 'Lucas Ribeiro',
      dateIso: '2026-04-30',
      timeLabel: '09:00',
      startAtIso: '2026-04-30T12:00:00.000Z',
      endAtIso: '2026-04-30T13:00:00.000Z',
    },
  ]

  const reply = conversationTesting.buildExactTimeFallbackResponse({
    exactTime: '09:00',
    timezone: 'America/Sao_Paulo',
    dateIso: '2026-04-30',
    slots,
    professionalName: 'Matheus Lima',
    diagnostics: {
      professionalId: 'pro-matheus',
      professionalName: 'Matheus Lima',
      date: '2026-04-30',
      period: 'EXACT',
      periodWindow: 'horario_exato',
      serviceDuration: 60,
      bufferMinutes: 0,
      leadTimeMinutes: 20,
      firstEligibleSlotTime: '08:00',
      busyAppointmentsFound: 1,
      freeSlotsReturned: 0,
      finalReason: 'exact_time_unavailable',
      requestedSlot: {
        exactTime: '09:00',
        status: 'blocked',
        blockStartTime: '09:00',
        blockEndTime: '11:00',
        isOperationalBlock: true,
      },
    },
  })

  assert.match(reply, /Matheus Lima esta indisponivel/i)
  assert.match(reply, /bloqueada das 09:00 as 11:00/i)
  assert.match(reply, /08:00/)
  assert.match(reply, /11:00/)
  assert.match(reply, /Lucas Ribeiro/)
  assert.doesNotMatch(reply, /Nao consegui verificar os horarios agora/i)
})

test('quando o cliente responde vagamente apos alternativas o fluxo pede a escolha de uma opcao', () => {
  const reply = conversationTesting.buildOfferedSlotSelectionPrompt([
    {
      key: 'pro-matheus:2026-04-30T11:00:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus Lima',
      dateIso: '2026-04-30',
      timeLabel: '08:00',
      startAtIso: '2026-04-30T11:00:00.000Z',
      endAtIso: '2026-04-30T12:00:00.000Z',
    },
    {
      key: 'pro-lucas:2026-04-30T12:00:00.000Z',
      professionalId: 'pro-lucas',
      professionalName: 'Lucas Ribeiro',
      dateIso: '2026-04-30',
      timeLabel: '09:00',
      startAtIso: '2026-04-30T12:00:00.000Z',
      endAtIso: '2026-04-30T13:00:00.000Z',
    },
  ])

  assert.match(reply, /Antes de confirmar, preciso que voce escolha uma das opcoes disponiveis/i)
  assert.match(reply, /1\. 08:00 com Matheus Lima/i)
  assert.match(reply, /2\. 09:00 com Lucas Ribeiro/i)
  assert.match(reply, /Qual voce prefere/i)
})
