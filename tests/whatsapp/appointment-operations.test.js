const test = require('node:test')
const assert = require('node:assert/strict')

const { prisma } = require('@/lib/prisma')
const {
  cancelAppointmentFromWhatsApp,
  rescheduleAppointmentFromWhatsApp,
} = require('@/lib/agendamentos/whatsapp-appointment-operations')

function withTransactionMock(factory, fn) {
  const originalTransaction = prisma.$transaction
  prisma.$transaction = async (callback) => callback(factory())

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      prisma.$transaction = originalTransaction
    })
}

test('cancelAppointmentFromWhatsApp cancela o agendamento ativo e nao depende de create novo', async () => {
  let updatePayload = null

  await withTransactionMock(
    () => ({
      appointment: {
        findFirst: async () => ({
          id: 'apt-1',
          barbershopId: 'shop-1',
          customerId: 'customer-1',
          serviceId: 'svc-1',
          startAt: new Date('2026-04-28T13:00:00.000Z'),
          endAt: new Date('2026-04-28T13:45:00.000Z'),
          professional: { id: 'pro-1', name: 'Lucas' },
          service: { id: 'svc-1', name: 'Corte Classic' },
        }),
        update: async ({ data }) => {
          updatePayload = data
          return {
            id: 'apt-1',
            barbershopId: 'shop-1',
            customerId: 'customer-1',
            serviceId: 'svc-1',
            status: 'CANCELLED',
            startAt: new Date('2026-04-28T13:00:00.000Z'),
            endAt: new Date('2026-04-28T13:45:00.000Z'),
            professional: { id: 'pro-1', name: 'Lucas' },
            service: { id: 'svc-1', name: 'Corte Classic' },
          }
        },
      },
    }),
    async () => {
      const result = await cancelAppointmentFromWhatsApp({
        appointmentId: 'apt-1',
        barbershopId: 'shop-1',
        timezone: 'America/Sao_Paulo',
      })

      assert.equal(result.status, 'CANCELLED')
      assert.equal(updatePayload.status, 'CANCELLED')
      assert.ok(updatePayload.cancelledAt instanceof Date)
    }
  )
})

test('rescheduleAppointmentFromWhatsApp atualiza o mesmo agendamento e reseta ciclo de lembrete', async () => {
  let updatePayload = null

  await withTransactionMock(
    () => ({
      appointment: {
        findFirst: async () => ({
          id: 'apt-1',
          barbershopId: 'shop-1',
          customerId: 'customer-1',
          serviceId: 'svc-1',
          status: 'CONFIRMED',
          startAt: new Date('2026-04-28T13:00:00.000Z'),
          endAt: new Date('2026-04-28T13:45:00.000Z'),
          billingModel: 'AVULSO',
          notes: null,
          sourceReference: 'whatsapp:old',
          customer: { id: 'customer-1', type: 'WALK_IN' },
          service: {
            id: 'svc-1',
            name: 'Corte Classic',
            duration: 45,
            price: 55,
          },
          professional: { id: 'pro-1', name: 'Lucas' },
        }),
        findMany: async () => [],
        update: async ({ data }) => {
          updatePayload = data
          return {
            id: 'apt-1',
            barbershopId: 'shop-1',
            customerId: 'customer-1',
            serviceId: 'svc-1',
            status: data.status,
            startAt: data.startAt,
            endAt: data.endAt,
            professional: { id: 'pro-2', name: 'Matheus' },
            service: { id: 'svc-1', name: 'Corte Classic' },
          }
        },
      },
      professional: {
        findFirst: async () => ({
          id: 'pro-2',
          name: 'Matheus',
          haircutPrice: null,
          beardPrice: null,
          comboPrice: null,
          acceptsWalkIn: true,
          acceptsSubscription: true,
        }),
      },
    }),
    async () => {
      const result = await rescheduleAppointmentFromWhatsApp({
        appointmentId: 'apt-1',
        barbershopId: 'shop-1',
        timezone: 'America/Sao_Paulo',
        professionalId: 'pro-2',
        dateIso: '2026-04-29',
        timeLabel: '15:00',
        startAtIso: '2026-04-29T18:00:00.000Z',
        endAtIso: '2026-04-29T18:45:00.000Z',
      })

      assert.equal(result.ok, true)
      assert.equal(result.reason, 'success')
      assert.equal(result.appointment.professionalName, 'Matheus')
      assert.equal(result.appointment.status, 'PENDING')
      assert.equal(updatePayload.professionalId, 'pro-2')
      assert.equal(updatePayload.status, 'PENDING')
      assert.equal(updatePayload.confirmedAt, null)
      assert.equal(updatePayload.confirmationReminderSentAt, null)
      assert.equal(updatePayload.confirmationResponseStatus, null)
    }
  )
})

test('rescheduleAppointmentFromWhatsApp aceita atendimento que termina exatamente no fechamento', async () => {
  let updatePayload = null

  await withTransactionMock(
    () => ({
      appointment: {
        findFirst: async () => ({
          id: 'apt-1',
          barbershopId: 'shop-1',
          customerId: 'customer-1',
          serviceId: 'svc-premium',
          status: 'CONFIRMED',
          startAt: new Date('2026-04-28T13:00:00.000Z'),
          endAt: new Date('2026-04-28T14:00:00.000Z'),
          billingModel: 'AVULSO',
          notes: null,
          sourceReference: 'whatsapp:old',
          customer: { id: 'customer-1', type: 'WALK_IN' },
          service: {
            id: 'svc-premium',
            name: 'Corte + Barba Premium',
            duration: 60,
            price: 95,
          },
          professional: { id: 'pro-rafael', name: 'Rafael Costa' },
        }),
        findMany: async () => ([]),
        update: async ({ data }) => {
          updatePayload = data
          return {
            id: 'apt-1',
            barbershopId: 'shop-1',
            customerId: 'customer-1',
            serviceId: 'svc-premium',
            status: data.status,
            startAt: data.startAt,
            endAt: data.endAt,
            professional: { id: 'pro-rafael', name: 'Rafael Costa' },
            service: { id: 'svc-premium', name: 'Corte + Barba Premium' },
          }
        },
      },
      professional: {
        findFirst: async () => ({
          id: 'pro-rafael',
          name: 'Rafael Costa',
          haircutPrice: null,
          beardPrice: null,
          comboPrice: null,
          acceptsWalkIn: true,
          acceptsSubscription: true,
        }),
      },
    }),
    async () => {
      const result = await rescheduleAppointmentFromWhatsApp({
        appointmentId: 'apt-1',
        barbershopId: 'shop-1',
        timezone: 'America/Sao_Paulo',
        professionalId: 'pro-rafael',
        dateIso: '2026-04-29',
        timeLabel: '20:00',
        startAtIso: '2026-04-29T23:00:00.000Z',
        endAtIso: '2026-04-30T00:00:00.000Z',
      })

      assert.equal(result.ok, true)
      assert.equal(result.reason, 'success')
      assert.equal(updatePayload.endAt.toISOString(), '2026-04-30T00:00:00.000Z')
      assert.equal(updatePayload.status, 'PENDING')
    }
  )
})

test('rescheduleAppointmentFromWhatsApp rejeita horario que ultrapassa o fechamento', async () => {
  let updateCalled = false

  await withTransactionMock(
    () => ({
      appointment: {
        findFirst: async () => ({
          id: 'apt-1',
          barbershopId: 'shop-1',
          customerId: 'customer-1',
          serviceId: 'svc-premium',
          status: 'CONFIRMED',
          startAt: new Date('2026-04-28T13:00:00.000Z'),
          endAt: new Date('2026-04-28T14:00:00.000Z'),
          billingModel: 'AVULSO',
          notes: null,
          sourceReference: 'whatsapp:old',
          customer: { id: 'customer-1', type: 'WALK_IN' },
          service: {
            id: 'svc-premium',
            name: 'Corte + Barba Premium',
            duration: 60,
            price: 95,
          },
          professional: { id: 'pro-rafael', name: 'Rafael Costa' },
        }),
        findMany: async () => ([]),
        update: async () => {
          updateCalled = true
          return null
        },
      },
      professional: {
        findFirst: async () => ({
          id: 'pro-rafael',
          name: 'Rafael Costa',
          haircutPrice: null,
          beardPrice: null,
          comboPrice: null,
          acceptsWalkIn: true,
          acceptsSubscription: true,
        }),
      },
    }),
    async () => {
      const result = await rescheduleAppointmentFromWhatsApp({
        appointmentId: 'apt-1',
        barbershopId: 'shop-1',
        timezone: 'America/Sao_Paulo',
        professionalId: 'pro-rafael',
        dateIso: '2026-04-29',
        timeLabel: '20:15',
        startAtIso: '2026-04-29T23:15:00.000Z',
        endAtIso: '2026-04-30T00:15:00.000Z',
      })

      assert.equal(result.ok, false)
      assert.equal(result.reason, 'slot_unavailable')
      assert.equal(updateCalled, false)
    }
  )
})

test('rescheduleAppointmentFromWhatsApp nao confirma quando o slot ficou indisponivel', async () => {
  let updateCalled = false

  await withTransactionMock(
    () => ({
      appointment: {
        findFirst: async () => ({
          id: 'apt-1',
          barbershopId: 'shop-1',
          customerId: 'customer-1',
          serviceId: 'svc-1',
          status: 'CONFIRMED',
          startAt: new Date('2026-04-28T13:00:00.000Z'),
          endAt: new Date('2026-04-28T13:45:00.000Z'),
          billingModel: 'AVULSO',
          notes: null,
          sourceReference: 'whatsapp:old',
          customer: { id: 'customer-1', type: 'WALK_IN' },
          service: {
            id: 'svc-1',
            name: 'Corte Classic',
            duration: 45,
            price: 55,
          },
          professional: { id: 'pro-1', name: 'Lucas' },
        }),
        findMany: async () => ([
          {
            startAt: new Date('2026-04-29T18:15:00.000Z'),
            endAt: new Date('2026-04-29T19:00:00.000Z'),
          },
        ]),
        update: async () => {
          updateCalled = true
          return null
        },
      },
      professional: {
        findFirst: async () => ({
          id: 'pro-2',
          name: 'Matheus',
          haircutPrice: null,
          beardPrice: null,
          comboPrice: null,
          acceptsWalkIn: true,
          acceptsSubscription: true,
        }),
      },
    }),
    async () => {
      const result = await rescheduleAppointmentFromWhatsApp({
        appointmentId: 'apt-1',
        barbershopId: 'shop-1',
        timezone: 'America/Sao_Paulo',
        professionalId: 'pro-2',
        dateIso: '2026-04-29',
        timeLabel: '15:00',
        startAtIso: '2026-04-29T18:00:00.000Z',
        endAtIso: '2026-04-29T18:45:00.000Z',
      })

      assert.equal(result.ok, false)
      assert.equal(result.reason, 'slot_unavailable')
      assert.equal(updateCalled, false)
    }
  )
})
