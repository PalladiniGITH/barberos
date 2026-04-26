const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildAssistantFailureResult,
  buildAssistantValidationReply,
  validateAssistantQuestion,
} = require('@/lib/assistant-chat-guards')

test('input curto do assistente e tratado sem excecao e marcado para pular OpenAI', () => {
  const result = validateAssistantQuestion('oi', 600)

  assert.equal(result.reason, 'SHORT_INPUT')
  assert.equal(result.shouldSkipOpenAi, true)
  assert.equal(result.normalizedQuestion, 'oi')
})

test('input comum continua elegivel para processamento normal', () => {
  const result = validateAssistantQuestion('Como posso preencher horarios ociosos amanha?', 600)

  assert.equal(result.reason, 'NORMAL')
  assert.equal(result.shouldSkipOpenAi, false)
})

test('resposta de orientacao para input curto continua amigavel e serializavel', () => {
  const reply = buildAssistantValidationReply({
    originalQuestion: 'teste',
    reason: 'SHORT_INPUT',
    suggestions: ['Como posso faturar mais esta semana?', 'Quais clientes devo reativar?'],
  })

  assert.match(reply, /Me diga|Oi!/)
  assert.doesNotThrow(() => JSON.stringify({ reply }))
})

test('resultado de falha do assistente permanece serializavel para o client', () => {
  const result = buildAssistantFailureResult(undefined, 'thread-123')

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ok: false,
    errorCode: 'ASSISTANT_FAILED',
    message: 'Nao consegui responder agora. Tente novamente em instantes.',
    threadId: 'thread-123',
  })
})
