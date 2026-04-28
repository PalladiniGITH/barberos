const test = require('node:test')
const assert = require('node:assert/strict')

const { prisma } = require('@/lib/prisma')
const {
  __testing: reminderTesting,
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
    messagingEventCreate: prisma.messagingEvent.create,
    messagingEventUpdate: prisma.messagingEvent.update,
    whatsappConversationFindUnique: prisma.whatsappConversation.findUnique,
    whatsappConversationUpsert: prisma.whatsappConversation.upsert,
  }

  prisma.appointment.findMany = mocks.appointmentFindMany ?? originals.appointmentFindMany
  prisma.appointment.update = mocks.appointmentUpdate ?? originals.appointmentUpdate
  prisma.messagingEvent.create = mocks.messagingEventCreate ?? originals.messagingEventCreate
  prisma.messagingEvent.update = mocks.messagingEventUpdate ?? originals.messagingEventUpdate
  prisma.whatsappConversation.findUnique = mocks.whatsappConversationFindUnique ?? originals.whatsappConversationFindUnique
  prisma.whatsappConversation.upsert = mocks.whatsappConversationUpsert ?? originals.whatsappConversationUpsert

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      prisma.appointment.findMany = originals.appointmentFindMany
      prisma.appointment.update = originals.appointmentUpdate
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
  const now = new Date('2026-04-28T15:00:00.000Z')
  const appointments = [
    {
      id: 'apt-1',
      barbershopId: 'shop-1',
      customerId: 'customer-1',
      status: 'CONFIRMED',
      startAt: new Date('2026-04-28T17:00:00.000Z'),
      endAt: new Date('2026-04-28T17:45:00.000Z'),
      confirmationReminderSentAt: null,
      customer: { name: 'Bruno', phone: '(11) 99999-1234' },
      barbershop: { name: 'Konoha', timezone: 'America/Sao_Paulo', active: true },
      professional: { id: 'pro-1', name: 'Lucas' },
      service: { id: 'svc-1', name: 'Corte Classic' },
    },
    {
      id: 'apt-2',
      barbershopId: 'shop-1',
      customerId: 'customer-2',
      status: 'CANCELLED',
      startAt: new Date('2026-04-28T17:00:00.000Z'),
      endAt: new Date('2026-04-28T17:45:00.000Z'),
      confirmationReminderSentAt: null,
      customer: { name: 'Maria', phone: '(11) 98888-7777' },
      barbershop: { name: 'Konoha', timezone: 'America/Sao_Paulo', active: true },
      professional: { id: 'pro-1', name: 'Lucas' },
      service: { id: 'svc-1', name: 'Corte Classic' },
    },
    {
      id: 'apt-3',
      barbershopId: 'shop-1',
      customerId: 'customer-3',
      status: 'CONFIRMED',
      startAt: new Date('2026-04-28T17:00:00.000Z'),
      endAt: new Date('2026-04-28T17:45:00.000Z'),
      confirmationReminderSentAt: null,
      customer: { name: 'Pedro', phone: null },
      barbershop: { name: 'Konoha', timezone: 'America/Sao_Paulo', active: true },
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
        appointmentFindMany: async ({ where }) => appointments.filter((appointment) => (
          ['PENDING', 'CONFIRMED'].includes(appointment.status)
          && appointment.customer.phone
          && appointment.confirmationReminderSentAt === null
          && appointment.startAt >= where.startAt.gte
          && appointment.startAt <= where.startAt.lte
        )),
        appointmentUpdate: async ({ where, data }) => {
          const appointment = appointments.find((item) => item.id === where.id)
          Object.assign(appointment, data)
          return appointment
        },
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
        assert.ok(appointments[0].confirmationReminderSentAt instanceof Date)
        assert.equal(secondRun.sent, 0)
        assert.equal(fetchCalls.length, 1)
      }
    )
  } finally {
    global.fetch = originalFetch
  }
})
