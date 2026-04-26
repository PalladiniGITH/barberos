const test = require('node:test')
const assert = require('node:assert/strict')

const { canRoleAccessPath, hasPlatformAccess, normalizePlatformRole } = require('@/lib/auth-routes')

test('usuarios sem permissao master nao acessam /internal', () => {
  assert.equal(canRoleAccessPath('OWNER', '/internal'), false)
  assert.equal(canRoleAccessPath('MANAGER', '/internal'), false)
  assert.equal(canRoleAccessPath('BARBER', '/internal'), false)
})

test('platform admin acessa /internal sem afetar regras normais da barbearia', () => {
  assert.equal(canRoleAccessPath('OWNER', '/internal', 'PLATFORM_ADMIN'), true)
  assert.equal(canRoleAccessPath('MANAGER', '/internal/barbershops/tenant-1', 'PLATFORM_OWNER'), true)
  assert.equal(canRoleAccessPath('BARBER', '/dashboard', 'PLATFORM_ADMIN'), true)
})

test('normalizacao de platform role reconhece somente valores validos', () => {
  assert.equal(normalizePlatformRole('PLATFORM_ADMIN'), 'PLATFORM_ADMIN')
  assert.equal(normalizePlatformRole('NONE'), 'NONE')
  assert.equal(normalizePlatformRole('OWNER'), null)
  assert.equal(hasPlatformAccess('PLATFORM_OWNER'), true)
  assert.equal(hasPlatformAccess('NONE'), false)
})
