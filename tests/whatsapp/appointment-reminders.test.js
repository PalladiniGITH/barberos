const test = require('node:test')
const assert = require('node:assert/strict')

const { prisma } = require('@/lib/prisma')
const {
  __testing: reminderTesting,
  confirmAppointmentPresenceFromReminder,
  expirePendingAppointmentConfirmation,
  runDueWhatsAppAppointmentConfirmations,
} = require('@/lib/whatsapp-appointment-reminders')

function withReminderEnv() {
  process.env.EVOLUTION_API_URL = 'https://evolution.example.com'
  process.env.EVOLUTION_API_KEY = 'test-api-key'
  process.env.EVOLUTION_INSTANCE = 'linha-nobre'
  process.env.EVOLUTION_WEBHOOK_SECRET = 'test-webhook-secret'
  process.env.PUBLIC_APP_URL = 'https://barberex.example.com'
}

function withReminderMocks(mocks, fn) {
  const originals = {
    appointmentFindMany: prisma.appointment.findMany,
    appointmentUpdate: prisma.appointment.update,
    appointmentUpdateMany: prisma.appointment.updateMany,
    barbershopFindUnique: prisma.barbershop.findUnique,
    barbershopUpdate: prisma.barbershop.update,
    messagingEventCreate: prisma.messagingEvent.create,
    messagingEventUpdate: prisma.messagingEvent.update,
    whatsappConversationFindUnique: prisma.whatsappConversation.findUnique,
    whatsappConversationUpsert: prisma.whatsappConversation.upsert,
  }

  prisma.appointment.findMany = mocks.appointmentFindMany ?? originals.appointmentFindMany
  prisma.appointment.update = mocks.appointmentUpdate ?? originals.appointmentUpdate
  prisma.appointment.updateMany = mocks.appointmentUpdateMany ?? originals.appointmentUpdateMany
  prisma.barbershop.findUnique = mocks.barbershopFindUnique ?? originals.barbershopFindUnique
  prisma.barbershop.update = mocks.barbershopUpdate ?? originals.barbershopUpdate
  prisma.messagingEvent.create = mocks.messagingEventCreate ?? originals.messagingEventCreate
  prisma.messagingEvent.update = mocks.messagingEventUpdate ?? originals.messagingEventUpdate
  prisma.whatsappConversation.findUnique = mocks.whatsappConversationFindUnique ?? originals.whatsappConversationFindUnique
  prisma.whatsappConversation.upsert = mocks.whatsappConversationUpsert ?? originals.whatsappConversationUpsert

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      prisma.appointment.findMany = originals.appointmentFindMany
      prisma.appointment.update = originals.appointmentUpdate
      prisma.appointment.updateMany = originals.appointmentUpdateMany
      prisma.barbershop.findUnique = originals.barbershopFindUnique
      prisma.barbershop.update = originals.barbershopUpdate
      prisma.messagingEvent.create = originals.messagingEventCreate
      prisma.messagingEvent.update = originals.messagingEventUpdate
      prisma.whatsappConversation.findUnique = originals.whatsappConversationFindUnique
      prisma.whatsappConversation.upsert = originals.whatsappConversationUpsert
    })
}

test('buildAppointmentReminderDedupeKey remains deterministic per appointment and lead time', () => {
  assert.equal(
    reminderTesting.buildAppointmentReminderDedupeKey({
      appointmentId: 'apt-1',
      leadMinutes: 120,
    }),
    'appointment-reminder:apt-1:120'
  )
})

test('runDueWhatsAppAppointmentConfirmations envia uma vez e nao duplica no segundo scan', async () => {
  withReminderEnv()

  const originalFetch = global.fetch
  const fetchCalls = []
  const fetchUrls = []
  const now = new Date('2026-04-28T15:00:00.000Z')
  const appointments = [
    {
      id: 'apt-1',
      barbershopId: 'shop-1',
      customerId: 'customer-1',
      source: 'WHATSAPP',
      status: 'PENDING',
      startAt: new Date('2026-04-28T17:00:00.000Z'),
      endAt: new Date('2026-04-28T17:45:00.000Z'),
      confirmationReminderSentAt: null,
      confirmationRequestedAt: null,
      confirmationResponseAt: null,
      customer: { name: 'Bruno', phone: '(11) 99999-1234' },
      barbershop: { name: 'Konoha', slug: 'konoha', timezone: 'America/Sao_Paulo', active: true },
      professional: { id: 'pro-1', name: 'Lucas' },
      service: { id: 'svc-1', name: 'Corte Classic' },
    },
    {
      id: 'apt-2',
      barbershopId: 'shop-1',
      customerId: 'customer-2',
      source: 'WHATSAPP',
      status: 'CANCELLED',
      startAt: new Date('2026-04-28T17:00:00.000Z'),
      endAt: new Date('2026-04-28T17:45:00.000Z'),
      confirmationReminderSentAt: null,
      confirmationRequestedAt: null,
      confirmationResponseAt: null,
      customer: { name: 'Maria', phone: '(11) 98888-7777' },
      barbershop: { name: 'Konoha', slug: 'konoha', timezone: 'America/Sao_Paulo', active: true },
      professional: { id: 'pro-1', name: 'Lucas' },
      service: { id: 'svc-1', name: 'Corte Classic' },
    },
    {
      id: 'apt-3',
      barbershopId: 'shop-1',
      customerId: 'customer-3',
      source: 'WHATSAPP',
      status: 'PENDING',
      startAt: new Date('2026-04-28T17:00:00.000Z'),
      endAt: new Date('2026-04-28T17:45:00.000Z'),
      confirmationReminderSentAt: null,
      confirmationRequestedAt: null,
      confirmationResponseAt: null,
      customer: { name: 'Pedro', phone: null },
      barbershop: { name: 'Konoha', slug: 'konoha', timezone: 'America/Sao_Paulo', active: true },
      professional: { id: 'pro-1', name: 'Lucas' },
      service: { id: 'svc-1', name: 'Corte Classic' },
    },
  ]

  global.fetch = async (url, init = {}) => {
    fetchUrls.push(String(url))
    fetchCalls.push(init.body ? JSON.parse(String(init.body)) : null)
    return {
      ok: true,
      status: 201,
      statusText: 'Created',
      text: async () => JSON.stringify({ key: { id: 'msg-1' } }),
    }
  }

  try {
    await withReminderMocks(
      {
        appointmentFindMany: async ({ where }) => {
          if (where.startAt?.gte) {
            return appointments.filter((appointment) => (
              appointment.source === 'WHATSAPP'
              && appointment.status === 'PENDING'
              && appointment.customer.phone
              && appointment.confirmationReminderSentAt === null
              && appointment.startAt >= where.startAt.gte
              && appointment.startAt <= where.startAt.lte
            ))
          }

          return []
        },
        appointmentUpdate: async ({ where, data }) => {
          const appointment = appointments.find((item) => item.id === where.id)
          Object.assign(appointment, data)
          return appointment
        },
        barbershopFindUnique: async ({ where }) => {
          if (where.id === 'shop-1') {
            return {
              id: 'shop-1',
              name: 'Konoha',
              slug: 'konoha',
              timezone: 'America/Sao_Paulo',
              active: true,
              whatsappEnabled: true,
              evolutionInstanceName: 'konoha',
            }
          }

          return null
        },
        barbershopUpdate: async () => ({ success: true }),
        messagingEventCreate: async () => ({ id: 'event-1' }),
        messagingEventUpdate: async () => ({ success: true }),
        whatsappConversationFindUnique: async () => ({ id: 'conv-1', state: 'IDLE', updatedAt: new Date('2026-04-28T12:00:00.000Z') }),
        whatsappConversationUpsert: async () => ({ id: 'conv-1' }),
      },
      async () => {
        const firstRun = await runDueWhatsAppAppointmentConfirmations({
          now,
          leadMinutes: 120,
          toleranceMinutes: 10,
        })

        const secondRun = await runDueWhatsAppAppointmentConfirmations({
          now,
          leadMinutes: 120,
          toleranceMinutes: 10,
        })

        assert.equal(firstRun.sent, 1)
        assert.equal(firstRun.failed, 0)
        assert.equal(fetchCalls.length, 1)
        assert.match(fetchUrls[0], /\/message\/sendText\/konoha$/)
        assert.equal(appointments[0].status, 'PENDING')
        assert.ok(appointments[0].confirmationReminderSentAt instanceof Date)
        assert.equal(secondRun.sent, 0)
        assert.equal(fetchCalls.length, 1)
      }
    )
  } finally {
    global.fetch = originalFetch
  }
})

test('runDueWhatsAppAppointmentConfirmations nao derruba o job quando a integracao outbound nao existe', async () => {
  withReminderEnv()

  const originalFetch = global.fetch
  const fetchCalls = []
  const now = new Date('2026-04-28T15:00:00.000Z')
  const appointments = [
    {
      id: 'apt-1',
      barbershopId: 'shop-without-whatsapp',
      customerId: 'customer-1',
      source: 'WHATSAPP',
      status: 'PENDING',
      startAt: new Date('2026-04-28T17:00:00.000Z'),
      endAt: new Date('2026-04-28T17:45:00.000Z'),
      confirmationReminderSentAt: null,
      confirmationRequestedAt: null,
      confirmationResponseAt: null,
      customer: { name: 'Bruno', phone: '(11) 99999-1234' },
      barbershop: { name: 'Sem WhatsApp', slug: 'sem-whatsapp', timezone: 'America/Sao_Paulo', active: true },
      professional: { id: 'pro-1', name: 'Lucas' },
      service: { id: 'svc-1', name: 'Corte Classic' },
    },
  ]

  global.fetch = async (_url, init = {}) => {
    fetchCalls.push(init.body ? JSON.parse(String(init.body)) : null)
    return {
      ok: true,
      status: 201,
      statusText: 'Created',
      text: async () => JSON.stringify({ key: { id: 'msg-1' } }),
    }
  }

  try {
    await withReminderMocks(
      {
        appointmentFindMany: async ({ where }) => (where.startAt?.gte ? appointments : []),
        appointmentUpdate: async ({ where, data }) => {
          const appointment = appointments.find((item) => item.id === where.id)
          Object.assign(appointment, data)
          return appointment
        },
        barbershopFindUnique: async () => ({
          id: 'shop-without-whatsapp',
          name: 'Sem WhatsApp',
          slug: 'sem-whatsapp',
          timezone: 'America/Sao_Paulo',
          active: true,
          whatsappEnabled: false,
          evolutionInstanceName: null,
        }),
        barbershopUpdate: async () => ({ success: true }),
      },
      async () => {
        const summary = await runDueWhatsAppAppointmentConfirmations({
          now,
          leadMinutes: 120,
          toleranceMinutes: 10,
        })

        assert.equal(summary.sent, 0)
        assert.equal(summary.failed, 1)
        assert.equal(fetchCalls.length, 0)
        assert.equal(appointments[0].confirmationReminderStatus, 'FAILED')
        assert.equal(appointments[0].confirmationReminderError, 'outbound_integration_missing')
        assert.equal(appointments[0].status, 'PENDING')
      }
    )
  } finally {
    global.fetch = originalFetch
  }
})

test('confirmAppointmentPresenceFromReminder confirma presenca e preenche responseAt', async () => {
  let updateManyArgs = null

  await withReminderMocks(
    {
      appointmentUpdateMany: async (args) => {
        updateManyArgs = args
        return { count: 1 }
      },
    },
    async () => {
      const result = await confirmAppointmentPresenceFromReminder({
        appointmentId: 'apt-confirm',
        barbershopId: 'shop-1',
      })

      assert.equal(result.count, 1)
      assert.equal(updateManyArgs.where.source, 'WHATSAPP')
      assert.equal(updateManyArgs.data.status, 'CONFIRMED')
      assert.ok(updateManyArgs.data.confirmedAt instanceof Date)
      assert.ok(updateManyArgs.data.confirmationResponseAt instanceof Date)
      assert.equal(updateManyArgs.data.confirmationResponseStatus, 'CONFIRMED')
    }
  )
})

test('expirePendingAppointmentConfirmation marca o horario como no_show sem tratar como cancelamento do cliente', async () => {
  let updateManyArgs = null

  await withReminderMocks(
    {
      appointmentUpdateMany: async (args) => {
        updateManyArgs = args
        return { count: 1 }
      },
    },
    async () => {
      const result = await expirePendingAppointmentConfirmation({
        appointmentId: 'apt-expire',
        barbershopId: 'shop-1',
      })

      assert.equal(result.count, 1)
      assert.equal(updateManyArgs.where.source, 'WHATSAPP')
      assert.equal(updateManyArgs.where.status, 'PENDING')
      assert.equal(updateManyArgs.data.status, 'NO_SHOW')
      assert.equal(updateManyArgs.data.cancelledAt, null)
    }
  )
})

test('runDueWhatsAppAppointmentConfirmations expira pendencias sem resposta e respeita tenant/instanceName', async () => {
  withReminderEnv()

  const originalFetch = global.fetch
  const fetchUrls = []
  const now = new Date('2026-04-28T15:00:00.000Z')
  const appointments = [
    {
      id: 'apt-konoha',
      barbershopId: 'shop-konoha',
      customerId: 'customer-1',
      source: 'WHATSAPP',
      status: 'PENDING',
      startAt: new Date('2026-04-28T14:40:00.000Z'),
      endAt: new Date('2026-04-28T15:25:00.000Z'),
      confirmationReminderSentAt: new Date('2026-04-28T12:40:00.000Z'),
      confirmationRequestedAt: new Date('2026-04-28T12:40:00.000Z'),
      confirmationResponseAt: null,
      customer: { name: 'Bruno Silva', phone: '(11) 99999-1234' },
      barbershop: { name: 'Konoha', slug: 'konoha', timezone: 'America/Sao_Paulo', active: true },
      professional: { id: 'pro-1', name: 'Lucas' },
      service: { id: 'svc-1', name: 'Corte Classic' },
    },
    {
      id: 'apt-linha',
      barbershopId: 'shop-linha',
      customerId: 'customer-2',
      source: 'WHATSAPP',
      status: 'PENDING',
      startAt: new Date('2026-04-28T14:45:00.000Z'),
      endAt: new Date('2026-04-28T15:30:00.000Z'),
      confirmationReminderSentAt: new Date('2026-04-28T12:45:00.000Z'),
      confirmationRequestedAt: new Date('2026-04-28T12:45:00.000Z'),
      confirmationResponseAt: null,
      customer: { name: 'Maria Costa', phone: '(11) 98888-7777' },
      barbershop: { name: 'Linha Nobre', slug: 'linha-nobre', timezone: 'America/Sao_Paulo', active: true },
      professional: { id: 'pro-2', name: 'Rafael' },
      service: { id: 'svc-2', name: 'Barba Terapia' },
    },
  ]

  global.fetch = async (url) => {
    fetchUrls.push(String(url))
    return {
      ok: true,
      status: 201,
      statusText: 'Created',
      text: async () => JSON.stringify({ key: { id: `msg-${fetchUrls.length}` } }),
    }
  }

  try {
    await withReminderMocks(
      {
        appointmentFindMany: async ({ where }) => {
          if (where.startAt?.gte) {
            return []
          }

          if (where.startAt?.lte) {
            return appointments.filter((appointment) => (
              appointment.source === 'WHATSAPP'
              && appointment.status === 'PENDING'
              && appointment.confirmationReminderSentAt
              && appointment.confirmationRequestedAt
              && appointment.confirmationResponseAt === null
              && appointment.startAt <= where.startAt.lte
            ))
          }

          return []
        },
        appointmentUpdateMany: async ({ where, data }) => {
          const appointment = appointments.find((item) => (
            item.id === where.id
            && item.barbershopId === where.barbershopId
          ))
          if (!appointment || appointment.status !== 'PENDING') {
            return { count: 0 }
          }

          Object.assign(appointment, data)
          return { count: 1 }
        },
        barbershopFindUnique: async ({ where }) => {
          if (where.id === 'shop-konoha') {
            return {
              id: 'shop-konoha',
              name: 'Konoha',
              slug: 'konoha',
              timezone: 'America/Sao_Paulo',
              active: true,
              whatsappEnabled: true,
              evolutionInstanceName: 'konoha',
            }
          }

          if (where.id === 'shop-linha') {
            return {
              id: 'shop-linha',
              name: 'Linha Nobre',
              slug: 'linha-nobre',
              timezone: 'America/Sao_Paulo',
              active: true,
              whatsappEnabled: true,
              evolutionInstanceName: 'linha-nobre',
            }
          }

          return null
        },
        barbershopUpdate: async () => ({ success: true }),
        messagingEventCreate: async ({ data }) => ({ id: `${data.dedupeKey}-event` }),
        messagingEventUpdate: async () => ({ success: true }),
      },
      async () => {
        const summary = await runDueWhatsAppAppointmentConfirmations({
          now,
          leadMinutes: 120,
          toleranceMinutes: 10,
        })

        assert.equal(summary.sent, 0)
        assert.equal(summary.expiredAppointmentsFound, 2)
        assert.equal(summary.expired, 2)
        assert.equal(summary.expiredOutboundSent, 2)
        assert.equal(appointments[0].status, 'NO_SHOW')
        assert.equal(appointments[1].status, 'NO_SHOW')
        assert.match(fetchUrls[0], /\/message\/sendText\/konoha$/)
        assert.match(fetchUrls[1], /\/message\/sendText\/linha-nobre$/)
      }
    )
  } finally {
    global.fetch = originalFetch
  }
})
