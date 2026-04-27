const test = require('node:test')
const assert = require('node:assert/strict')

const { buildAssistantDisplayedMessages } = require('@/lib/assistant-widget-state')

function buildMessage(id, role, content) {
  return {
    id,
    role,
    content,
    createdAtIso: '2026-04-26T10:00:00.000Z',
    createdAtLabel: '10:00',
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    metadata: {
      statusNote: null,
      dataFreshnessLabel: null,
      scopeLabel: null,
    },
  }
}

test('monta displayedMessages com thread persistida e mensagens otimistas', () => {
  const persisted = [buildMessage('m1', 'USER', 'Pergunta antiga'), buildMessage('m2', 'ASSISTANT', 'Resposta antiga')]
  const optimistic = [buildMessage('m3', 'USER', 'Nova pergunta')]

  const displayed = buildAssistantDisplayedMessages({
    persistedMessages: persisted,
    optimisticMessages: optimistic,
  })

  assert.equal(displayed.length, 3)
  assert.deepEqual(
    displayed.map((message) => [message.id, message.role, message.content, message.status]),
    [
      ['m1', 'USER', 'Pergunta antiga', 'sent'],
      ['m2', 'ASSISTANT', 'Resposta antiga', 'sent'],
      ['m3', 'USER', 'Nova pergunta', 'sent'],
    ]
  )
})

test('inclui loading inline e erro inline como mensagens da IA', () => {
  const displayed = buildAssistantDisplayedMessages({
    optimisticMessages: [buildMessage('m1', 'USER', 'oi')],
    pendingAssistantMessage: buildMessage('m2', 'ASSISTANT', 'BarberEX IA esta analisando...'),
    errorAssistantMessage: buildMessage('m3', 'ASSISTANT', 'Nao consegui responder agora. Tente novamente em instantes.'),
  })

  assert.equal(displayed.length, 3)
  assert.deepEqual(
    displayed.map((message) => [message.id, message.status]),
    [
      ['m1', 'sent'],
      ['m2', 'pending'],
      ['m3', 'error'],
    ]
  )
})
