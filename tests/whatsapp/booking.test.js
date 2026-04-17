const test = require('node:test')
const assert = require('node:assert/strict')

const { prisma } = require('@/lib/prisma')
const {
  createAppointmentFromWhatsApp,
  resolveWhatsAppAppointmentStartAt,
} = require('@/lib/agendamentos/whatsapp-booking')
const {
  formatDateTimeInTimezone,
  formatDayLabelFromIsoDate,
  formatWeekdayFromIsoDate,
  localDateTimeToUtc,
} = require('@/lib/timezone')

test('localDateTimeToUtc preserva o horario local escolhido ao converter para UTC', () => {
  const { startAtUtc } = localDateTimeToUtc({
    dateIso: '2026-04-13',
    timeLabel: '17:30',
    timezone: 'America/Sao_Paulo',
  })

  assert.equal(startAtUtc.toISOString(), '2026-04-13T20:30:00.000Z')
  assert.equal(formatDateTimeInTimezone(startAtUtc, 'America/Sao_Paulo'), '2026-04-13 17:30')
})

test('17/04 usa sempre a mesma projecao local para dia da semana', () => {
  assert.equal(
    formatWeekdayFromIsoDate('1970-01-02', 'America/Sao_Paulo'),
    'sexta-feira'
  )
  assert.equal(
    formatDayLabelFromIsoDate('1970-01-02', 'America/Sao_Paulo'),
    'sexta-feira, 02/01'
  )
})

function withPrismaMocks(mocks, fn) {
  const originals = {
    customerFindFirst: prisma.customer.findFirst,
    serviceFindFirst: prisma.service.findFirst,
    professionalFindFirst: prisma.professional.findFirst,
    appointmentFindMany: prisma.appointment.findMany,
    appointmentCreate: prisma.appointment.create,
  }

  prisma.customer.findFirst = mocks.customerFindFirst ?? originals.customerFindFirst
  prisma.service.findFirst = mocks.serviceFindFirst ?? originals.serviceFindFirst
  prisma.professional.findFirst = mocks.professionalFindFirst ?? originals.professionalFindFirst
  prisma.appointment.findMany = mocks.appointmentFindMany ?? originals.appointmentFindMany
  prisma.appointment.create = mocks.appointmentCreate ?? originals.appointmentCreate

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      prisma.customer.findFirst = originals.customerFindFirst
      prisma.service.findFirst = originals.serviceFindFirst
      prisma.professional.findFirst = originals.professionalFindFirst
      prisma.appointment.findMany = originals.appointmentFindMany
      prisma.appointment.create = originals.appointmentCreate
    })
}

test('resolve horario local para UTC correto sem offset indevido', () => {
  const resolved = resolveWhatsAppAppointmentStartAt({
    dateIso: '2026-04-13',
    timeLabel: '13:15',
    timezone: 'America/Sao_Paulo',
  })

  assert.equal(resolved.startAt.toISOString(), '2026-04-13T16:15:00.000Z')
  assert.equal(formatDateTimeInTimezone(resolved.startAt, 'America/Sao_Paulo'), '2026-04-13 13:15')
})

test('cria agendamento persistindo o equivalente UTC correto do horario escolhido', async () => {
  let createdPayload = null

  await withPrismaMocks(
    {
      customerFindFirst: async () => ({ id: 'cust-1', type: 'WALK_IN' }),
      serviceFindFirst: async () => ({ id: 'svc-classic', duration: 35, price: 55 }),
      professionalFindFirst: async () => ({ id: 'pro-matheus' }),
      appointmentFindMany: async () => [],
      appointmentCreate: async ({ data }) => {
        createdPayload = data
        return {
          id: 'apt-1',
          startAt: data.startAt,
          endAt: data.endAt,
        }
      },
    },
    async () => {
      const appointment = await createAppointmentFromWhatsApp({
        barbershopId: 'shop-1',
        customerId: 'cust-1',
        serviceId: 'svc-classic',
        professionalId: 'pro-matheus',
        dateIso: '2026-04-13',
        timeLabel: '13:15',
        timezone: 'America/Sao_Paulo',
        sourceReference: 'whatsapp:test',
      })

      assert.equal(createdPayload.startAt.toISOString(), '2026-04-13T16:15:00.000Z')
      assert.equal(formatDateTimeInTimezone(createdPayload.startAt, 'America/Sao_Paulo'), '2026-04-13 13:15')
      assert.equal(appointment.startAt.toISOString(), '2026-04-13T16:15:00.000Z')
      assert.equal(formatDateTimeInTimezone(appointment.startAt, 'America/Sao_Paulo'), '2026-04-13 13:15')
    }
  )
})

test('cobre o caso completo de hoje + servico + tarde + escolha 13:15 sem offset de 3 horas', async () => {
  let createdPayload = null

  await withPrismaMocks(
    {
      customerFindFirst: async () => ({ id: 'cust-1', type: 'WALK_IN' }),
      serviceFindFirst: async () => ({ id: 'svc-classic', duration: 35, price: 55 }),
      professionalFindFirst: async () => ({ id: 'pro-matheus' }),
      appointmentFindMany: async () => [],
      appointmentCreate: async ({ data }) => {
        createdPayload = data
        return {
          id: 'apt-2',
          startAt: data.startAt,
          endAt: data.endAt,
        }
      },
    },
    async () => {
      const appointment = await createAppointmentFromWhatsApp({
        barbershopId: 'shop-1',
        customerId: 'cust-1',
        serviceId: 'svc-classic',
        professionalId: 'pro-matheus',
        dateIso: '2026-04-13',
        timeLabel: '13:15',
        timezone: 'America/Sao_Paulo',
        sourceReference: 'whatsapp:e2e',
        notes: 'Fluxo completo de teste',
      })

      assert.equal(createdPayload.startAt.toISOString(), '2026-04-13T16:15:00.000Z')
      assert.equal(formatDateTimeInTimezone(createdPayload.startAt, 'America/Sao_Paulo'), '2026-04-13 13:15')
      assert.equal(formatDateTimeInTimezone(appointment.startAt, 'America/Sao_Paulo'), '2026-04-13 13:15')
    }
  )
})

test('nao finge sucesso quando a persistencia final do agendamento falha', async () => {
  await withPrismaMocks(
    {
      customerFindFirst: async () => ({ id: 'cust-1', type: 'WALK_IN' }),
      serviceFindFirst: async () => ({ id: 'svc-classic', duration: 35, price: 55 }),
      professionalFindFirst: async () => ({ id: 'pro-matheus' }),
      appointmentFindMany: async () => [],
      appointmentCreate: async () => {
        throw new Error('db_write_failed')
      },
    },
    async () => {
      await assert.rejects(
        () => createAppointmentFromWhatsApp({
          barbershopId: 'shop-1',
          customerId: 'cust-1',
          serviceId: 'svc-classic',
          professionalId: 'pro-matheus',
          dateIso: '2026-04-13',
          timeLabel: '13:15',
          timezone: 'America/Sao_Paulo',
          sourceReference: 'whatsapp:failure',
        }),
        /db_write_failed/
      )
    }
  )
})
