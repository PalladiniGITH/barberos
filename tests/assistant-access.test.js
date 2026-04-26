const test = require('node:test')
const assert = require('node:assert/strict')

const { canRoleAccessPath } = require('@/lib/auth-routes')

test('BARBER pode acessar o assistente e continua bloqueado de modulos administrativos indevidos', () => {
  assert.equal(canRoleAccessPath('BARBER', '/assistente'), true)
  assert.equal(canRoleAccessPath('BARBER', '/assistente/thread-1'), true)
  assert.equal(canRoleAccessPath('BARBER', '/clientes'), false)
})

test('OWNER e MANAGER mantem acesso ao assistente', () => {
  assert.equal(canRoleAccessPath('OWNER', '/assistente'), true)
  assert.equal(canRoleAccessPath('MANAGER', '/assistente'), true)
  assert.equal(canRoleAccessPath('FINANCIAL', '/assistente'), true)
})
