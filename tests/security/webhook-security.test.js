const test = require('node:test')
const assert = require('node:assert/strict')

const evolutionWebhookModule = require('@/lib/integrations/evolution-webhook')
const { normalizeEvolutionWebhookPayload } = require('@/lib/integrations/evolution')
const evolutionWebhookRoute = require('@/app/api/webhooks/evolution/route')

function withWebhookEnv(overrides, fn) {
  const keys = [
    'PUBLIC_APP_URL',
    'NEXTAUTH_URL',
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_WEBHOOK_SECRET',
  ]
  const originalValues = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

  Object.assign(process.env, {
    PUBLIC_APP_URL: 'http://localhost:3000',
    NEXTAUTH_URL: 'http://localhost:3000',
    EVOLUTION_API_URL: 'https://evolution.local',
    EVOLUTION_API_KEY: 'test-api-key',
    EVOLUTION_WEBHOOK_SECRET: 'super-secret',
    ...overrides,
  })

  const restoreValue = (key, value) => {
    if (typeof value === 'string') {
      process.env[key] = value
      return
    }

    delete process.env[key]
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(originalValues)) {
        restoreValue(key, value)
      }
    })
}

function withMockedProcessor(mockImplementation, fn) {
  const originalProcessor = evolutionWebhookModule.processEvolutionWebhookPayload
  evolutionWebhookModule.processEvolutionWebhookPayload = mockImplementation

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      evolutionWebhookModule.processEvolutionWebhookPayload = originalProcessor
    })
}

test('secret invalido rejeita webhook Evolution', async () => {
  await withWebhookEnv({}, async () => {
    const response = await evolutionWebhookRoute.POST(
      new Request('http://localhost/api/webhooks/evolution?secret=wrong-secret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'MESSAGES_UPSERT' }),
      })
    )

    assert.equal(response.status, 401)
  })
})

test('connection.update e tratado como evento ignorado sem processamento inbound', () => {
  const normalized = normalizeEvolutionWebhookPayload({
    event: 'CONNECTION_UPDATE',
    instanceName: 'barberex',
  })

  assert.equal(normalized.event, 'CONNECTION_UPDATE')
  assert.equal(normalized.shouldProcessInboundMessage, false)
  assert.equal(normalized.ignoreReason, 'evento_connection_update')
})

test('evento ignorado valido nao responde 409 quando o processor devolve ignored seguro', async () => {
  await withWebhookEnv({}, async () => {
    await withMockedProcessor(
      async () => ({
        ok: true,
        code: 200,
        reason: 'evento_connection_update',
        eventId: 'evt-1',
        replySent: false,
      }),
      async () => {
        const response = await evolutionWebhookRoute.POST(
          new Request('http://localhost/api/webhooks/evolution?secret=super-secret', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              event: 'CONNECTION_UPDATE',
              instanceName: 'barberex',
            }),
          })
        )

        const body = await response.json()
        assert.equal(response.status, 200)
        assert.equal(body.reason, 'evento_connection_update')
        assert.equal(body.replySent, false)
      }
    )
  })
})
