const test = require('node:test')
const assert = require('node:assert/strict')

const auth = require('@/lib/auth')
const { prisma } = require('@/lib/prisma')
const financeActions = require('@/actions/financeiro')
const appointmentActions = require('@/actions/agendamentos')

const VALID_CUID = `c${'1'.repeat(24)}`

function withMockedRequireSession(mockImplementation, fn) {
  const originalRequireSession = auth.requireSession
  auth.requireSession = mockImplementation

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      auth.requireSession = originalRequireSession
    })
}

test('receita invalida e rejeitada antes de persistir', async () => {
  const originalCreate = prisma.revenue.create
  let createCalled = false
  prisma.revenue.create = async () => {
    createCalled = true
  }

  try {
    await withMockedRequireSession(
      async () => ({
        user: {
          id: 'user-1',
          role: 'OWNER',
          barbershopId: 'shop-linha-nobre',
        },
      }),
      async () => {
        const result = await financeActions.addRevenue({
          amount: '-10',
          paymentMethod: 'PIX',
          date: '2026-04-30',
          professionalId: null,
          serviceId: null,
          categoryId: null,
          description: 'Teste',
        })

        assert.deepEqual(result, {
          success: false,
          error: 'Valor deve ser positivo',
        })
        assert.equal(createCalled, false)
      }
    )
  } finally {
    prisma.revenue.create = originalCreate
  }
})

test('agendamento com data invalida e rejeitado no backend', async () => {
  await withMockedRequireSession(
    async () => ({
      user: {
        id: 'user-1',
        role: 'OWNER',
        name: 'Admin',
        email: 'admin@barberex.com',
        barbershopId: 'shop-linha-nobre',
      },
    }),
    async () => {
      const result = await appointmentActions.createAppointment({
        customerName: 'Cliente Teste',
        professionalId: VALID_CUID,
        serviceId: VALID_CUID,
        date: '30/04/2026',
        time: '10:00',
        status: 'CONFIRMED',
        source: 'MANUAL',
        customerType: 'WALK_IN',
        billingModel: 'AVULSO',
      })

      assert.equal(result.success, false)
      assert.match(result.error, /Data invalida/)
    }
  )
})

test('status invalido de agendamento e bloqueado antes de consultar o banco', async () => {
  const originalFindUnique = prisma.appointment.findUnique
  let findUniqueCalled = false
  prisma.appointment.findUnique = async () => {
    findUniqueCalled = true
    return null
  }

  try {
    await withMockedRequireSession(
      async () => ({
        user: {
          id: 'user-1',
          role: 'OWNER',
          name: 'Admin',
          email: 'admin@barberex.com',
          barbershopId: 'shop-linha-nobre',
        },
      }),
      async () => {
        const result = await appointmentActions.updateAppointmentStatus('apt-1', 'INVALID_STATUS')
        assert.deepEqual(result, { success: false, error: 'Status invalido.' })
        assert.equal(findUniqueCalled, false)
      }
    )
  } finally {
    prisma.appointment.findUnique = originalFindUnique
  }
})
