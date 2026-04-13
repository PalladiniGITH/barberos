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
