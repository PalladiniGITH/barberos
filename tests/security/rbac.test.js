const test = require('node:test')
const assert = require('node:assert/strict')

const auth = require('@/lib/auth')
const {
  assertCanManageAppointment,
  assertCanManageFinance,
  assertCanManageProfessional,
  requirePlatformAdmin,
} = require('@/lib/security/guards')

function withMockedRequireSession(mockImplementation, fn) {
  const originalRequireSession = auth.requireSession
  auth.requireSession = mockImplementation

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      auth.requireSession = originalRequireSession
    })
}

test('BARBER nao pode gerenciar equipe administrativa', () => {
  assert.throws(
    () => assertCanManageProfessional('BARBER'),
    /Sem permissao para alterar configuracoes administrativas da equipe\./
  )
})

test('OWNER pode gerenciar financeiro', () => {
  assert.doesNotThrow(() => assertCanManageFinance('OWNER'))
})

test('BARBER pode operar agenda dentro do fluxo permitido', () => {
  assert.doesNotThrow(() => assertCanManageAppointment('BARBER'))
})

test('helper de /internal bloqueia admin comum sem platform role', async () => {
  await withMockedRequireSession(
    async () => ({
      user: {
        id: 'user-1',
        barbershopId: 'shop-1',
        platformRole: 'NONE',
      },
    }),
    async () => {
      await assert.rejects(
        () => requirePlatformAdmin(),
        /Sem permissao para acessar a operacao interna da plataforma\./
      )
    }
  )
})

test('helper de /internal aceita PLATFORM_ADMIN', async () => {
  await withMockedRequireSession(
    async () => ({
      user: {
        id: 'user-1',
        barbershopId: 'shop-1',
        platformRole: 'PLATFORM_ADMIN',
      },
    }),
    async () => {
      const result = await requirePlatformAdmin()
      assert.equal(result.userId, 'user-1')
      assert.equal(result.platformRole, 'PLATFORM_ADMIN')
    }
  )
})
