const test = require('node:test')
const assert = require('node:assert/strict')

const {
  resolveAssistantScreenContext,
  shouldShowAssistantOnPath,
} = require('@/lib/assistant-screen-context')

test('esconde o assistente comum no painel master interno', () => {
  assert.equal(shouldShowAssistantOnPath('/internal'), false)
  assert.equal(shouldShowAssistantOnPath('/internal/barbershops/tenant-1'), false)
  assert.equal(shouldShowAssistantOnPath('/dashboard'), true)
})

test('ajusta sugestoes da agenda para escopo gerencial', () => {
  const context = resolveAssistantScreenContext('/agendamentos', 'MANAGEMENT')

  assert.equal(context.key, 'agendamentos')
  assert.equal(context.label, 'Agenda operacional')
  assert.match(context.suggestions[0], /horarios ociosos/i)
})

test('mantem escopo individual para barbeiro mesmo fora do dashboard', () => {
  const context = resolveAssistantScreenContext('/financeiro', 'PROFESSIONAL')

  assert.equal(context.label, 'Meu desempenho')
  assert.match(context.subtitle, /escopo continua individual/i)
})
