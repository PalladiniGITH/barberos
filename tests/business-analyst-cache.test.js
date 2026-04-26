const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildBusinessAnalystInputHash,
  buildBusinessAnalystScopeKey,
  resolveBusinessAnalystCacheWindow,
} = require('../src/lib/business-analyst-cache')
const { formatIsoDateInTimezone, formatTimeInTimezone } = require('../src/lib/timezone')

test('resolveBusinessAnalystCacheWindow usa a janela da manha ate 16:59 local', () => {
  const window = resolveBusinessAnalystCacheWindow('America/Sao_Paulo', new Date('2026-04-25T13:00:00.000Z'))

  assert.equal(window.localDateIso, '2026-04-25')
  assert.equal(window.periodKey, 'MORNING')
  assert.equal(window.periodLabel, 'Leitura da manhã')
  assert.equal(formatTimeInTimezone(window.expiresAt, 'America/Sao_Paulo'), '17:00')
  assert.equal(formatIsoDateInTimezone(window.expiresAt, 'America/Sao_Paulo'), '2026-04-25')
})

test('resolveBusinessAnalystCacheWindow abre nova leitura na janela da tarde', () => {
  const window = resolveBusinessAnalystCacheWindow('America/Sao_Paulo', new Date('2026-04-25T21:30:00.000Z'))

  assert.equal(window.localDateIso, '2026-04-25')
  assert.equal(window.periodKey, 'EVENING')
  assert.equal(window.periodLabel, 'Leitura da tarde')
  assert.equal(formatTimeInTimezone(window.expiresAt, 'America/Sao_Paulo'), '08:00')
  assert.equal(formatIsoDateInTimezone(window.expiresAt, 'America/Sao_Paulo'), '2026-04-26')
})

test('scopeKey e inputHash permanecem estaveis por escopo e mudam quando o filtro muda', () => {
  const baseInput = {
    month: 4,
    year: 2026,
    professionalId: null,
    customerType: 'all',
  }

  const scopeKey = buildBusinessAnalystScopeKey(baseInput)
  const sameHash = buildBusinessAnalystInputHash({
    ...baseInput,
    aiEnabled: true,
    promptVersion: 'v1',
  })
  const differentHash = buildBusinessAnalystInputHash({
    ...baseInput,
    customerType: 'subscription',
    aiEnabled: true,
    promptVersion: 'v1',
  })

  assert.equal(scopeKey, 'month:4|year:2026|professional:all|customer:all')
  assert.equal(sameHash, buildBusinessAnalystInputHash({
    ...baseInput,
    aiEnabled: true,
    promptVersion: 'v1',
  }))
  assert.notEqual(sameHash, differentHash)
})
