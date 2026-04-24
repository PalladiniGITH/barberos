const test = require('node:test')
const assert = require('node:assert/strict')

const {
  EvolutionApiError,
  buildEvolutionSendTextPayloadCandidates,
  normalizeEvolutionPhoneNumber,
  sendEvolutionTextMessage,
} = require('@/lib/integrations/evolution')

function withEvolutionEnv() {
  process.env.EVOLUTION_API_URL = 'https://evolution.example.com'
  process.env.EVOLUTION_API_KEY = 'test-api-key'
  process.env.EVOLUTION_INSTANCE = 'linha-nobre'
  process.env.EVOLUTION_WEBHOOK_SECRET = 'test-webhook-secret'
  process.env.PUBLIC_APP_URL = 'https://barberex.example.com'
}

test('normalizeEvolutionPhoneNumber adds Brazil country code when the record is local only', () => {
  assert.equal(normalizeEvolutionPhoneNumber('(11) 99999-1234'), '5511999991234')
  assert.equal(normalizeEvolutionPhoneNumber('5511999991234'), '5511999991234')
  assert.equal(normalizeEvolutionPhoneNumber('011999991234'), '5511999991234')
  assert.equal(normalizeEvolutionPhoneNumber('9999'), null)
})

test('buildEvolutionSendTextPayloadCandidates exposes modern and legacy payload formats', () => {
  const candidates = buildEvolutionSendTextPayloadCandidates({
    number: '(11) 99999-1234',
    text: 'Mensagem de teste',
    delay: 250,
  })

  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].format, 'v2_text')
  assert.deepEqual(candidates[0].body, {
    number: '5511999991234',
    text: 'Mensagem de teste',
    delay: 250,
  })

  assert.equal(candidates[1].format, 'v1_textMessage')
  assert.deepEqual(candidates[1].body, {
    number: '5511999991234',
    textMessage: { text: 'Mensagem de teste' },
    options: { delay: 250, presence: 'composing' },
  })
})

test('sendEvolutionTextMessage retries with legacy payload when the modern body gets HTTP 400', async () => {
  withEvolutionEnv()

  const originalFetch = global.fetch
  const calls = []

  global.fetch = async (_url, init = {}) => {
    const parsedBody = init.body ? JSON.parse(String(init.body)) : null
    calls.push(parsedBody)

    if (calls.length === 1) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => JSON.stringify({ message: 'textMessage is required' }),
      }
    }

    return {
      ok: true,
      status: 201,
      statusText: 'Created',
      text: async () => JSON.stringify({ key: { id: 'msg-1' } }),
    }
  }

  try {
    const payload = await sendEvolutionTextMessage({
      number: '(11) 99999-1234',
      text: 'Mensagem de teste',
    })

    assert.deepEqual(payload, { key: { id: 'msg-1' } })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].text, 'Mensagem de teste')
    assert.deepEqual(calls[1].textMessage, { text: 'Mensagem de teste' })
  } finally {
    global.fetch = originalFetch
  }
})

test('sendEvolutionTextMessage exposes sanitized diagnostics when both payload formats fail', async () => {
  withEvolutionEnv()

  const originalFetch = global.fetch

  global.fetch = async () => ({
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    text: async () => JSON.stringify({ message: 'invalid phone number' }),
  })

  try {
    await assert.rejects(
      () => sendEvolutionTextMessage({
        number: '(11) 99999-1234',
        text: 'Mensagem longa de diagnostico',
      }),
      (error) => {
        assert.ok(error instanceof EvolutionApiError)
        assert.equal(error.status, 400)
        assert.equal(error.requestPath, '/message/sendText/linha-nobre')
        assert.match(JSON.stringify(error.requestPayload), /v2_text/)
        assert.match(JSON.stringify(error.requestPayload), /v1_textMessage/)
        assert.doesNotMatch(JSON.stringify(error.requestPayload), /5511999991234/)
        assert.match(JSON.stringify(error.responseBody), /invalid phone number/)
        return true
      }
    )
  } finally {
    global.fetch = originalFetch
  }
})
