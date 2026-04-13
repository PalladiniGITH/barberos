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

test('respostas afirmativas amplas sao aceitas para fechamento deterministico', () => {
  const affirmativeReplies = ['sim', 's', 'ok', 'pode', 'confirmar', 'quero', 'desejo', 'fechado']

  affirmativeReplies.forEach((reply) => {
    assert.equal(conversationTesting.isAffirmativeConfirmationMessage(reply), true)
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
  assert.doesNotMatch(reply, /10h e manha|10:00 e manha/i)
})
