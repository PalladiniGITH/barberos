const test = require('node:test')
const assert = require('node:assert/strict')

const {
  maskEmail,
  maskPhone,
  sanitizeErrorForLogs,
  sanitizeForLogs,
} = require('@/lib/security/safe-logger')

test('mascara telefone e email para logs', () => {
  assert.equal(maskPhone('5541998765432'), '5541***5432')
  assert.equal(maskEmail('bruno@barberex.com'), 'br***@barberex.com')
})

test('sanitizeForLogs remove secrets e resume textos sensiveis', () => {
  const originalMessage = 'Mensagem do cliente com bastante detalhe que nao deveria aparecer inteira no log.'
  const sanitized = sanitizeForLogs({
    apiKey: 'secret-key',
    token: 'token-value',
    phone: '5541998765432',
    email: 'bruno@barberex.com',
    message: originalMessage,
  })

  assert.equal(sanitized.apiKey, '[redacted]')
  assert.equal(sanitized.token, '[redacted]')
  assert.equal(sanitized.phone, '5541***5432')
  assert.equal(sanitized.email, 'br***@barberex.com')
  assert.equal(typeof sanitized.message.preview, 'string')
  assert.equal(sanitized.message.length, originalMessage.length)
  assert.equal(sanitized.message.preview.length <= 83, true)
})

test('sanitizeErrorForLogs nao inclui stack completa por padrao', () => {
  const sanitized = sanitizeErrorForLogs(new Error('Falha interna sensivel'))

  assert.deepEqual(sanitized, {
    name: 'Error',
    message: 'Falha interna sensivel',
  })
})
