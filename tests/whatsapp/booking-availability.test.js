const test = require('node:test')
const assert = require('node:assert/strict')

const { prisma } = require('@/lib/prisma')
const { buildLocalDate, __testing: availabilityTesting } = require('@/lib/agendamentos/availability')
const {
  getAvailableWhatsAppSlots,
  __testing: bookingTesting,
} = require('@/lib/agendamentos/whatsapp-booking')

const TIMEZONE = 'America/Sao_Paulo'
const DATE_ISO = '2026-04-30'

function buildBlockedSlot(startAtIso, endAtIso) {
  return {
    id: 'blk-1',
    professionalId: 'pro-matheus',
    startAt: new Date(startAtIso),
    endAt: new Date(endAtIso),
    sourceReference: 'schedule:block:manual',
  }
}

function withAvailabilityPrismaMocks(mocks, fn) {
  const originals = {
    serviceFindFirst: prisma.service.findFirst,
    professionalFindMany: prisma.professional.findMany,
    appointmentFindMany: prisma.appointment.findMany,
  }

  prisma.service.findFirst = mocks.serviceFindFirst ?? originals.serviceFindFirst
  prisma.professional.findMany = mocks.professionalFindMany ?? originals.professionalFindMany
  prisma.appointment.findMany = mocks.appointmentFindMany ?? originals.appointmentFindMany

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      prisma.service.findFirst = originals.serviceFindFirst
      prisma.professional.findMany = originals.professionalFindMany
      prisma.appointment.findMany = originals.appointmentFindMany
    })
}

function withEnv(env, fn) {
  const previousValues = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]])
  )

  Object.assign(process.env, env)

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.entries(previousValues).forEach(([key, value]) => {
        if (typeof value === 'undefined') {
          delete process.env[key]
          return
        }

        process.env[key] = value
      })
    })
}

function buildOpenSlot(professionalId, professionalName, timeLabel, startAtIso, endAtIso) {
  return {
    key: `${professionalId}:${startAtIso}`,
    professionalId,
    professionalName,
    dateIso: DATE_ISO,
    timeLabel,
    startAtIso,
    endAtIso,
  }
}

test('diagnostico do horario exato identifica bloqueio operacional e gera alternativas proximas', () => {
  const resolution = bookingTesting.buildRequestedSlotDiagnostic({
    exactTime: '09:00',
    dateIso: DATE_ISO,
    timezone: TIMEZONE,
    serviceDuration: 60,
    operationalBufferMinutes: 0,
    dayOpen: buildLocalDate(DATE_ISO, 8, 0, TIMEZONE),
    dayClose: buildLocalDate(DATE_ISO, 21, 0, TIMEZONE),
    firstEligibleStartAt: buildLocalDate(DATE_ISO, 8, 0, TIMEZONE),
    isToday: false,
    professionalId: 'pro-matheus',
    blockedSlots: [
      buildBlockedSlot('2026-04-30T12:00:00.000Z', '2026-04-30T14:00:00.000Z'),
    ],
    openSlots: [
      buildOpenSlot('pro-matheus', 'Matheus Lima', '08:00', '2026-04-30T11:00:00.000Z', '2026-04-30T12:00:00.000Z'),
      buildOpenSlot('pro-matheus', 'Matheus Lima', '11:00', '2026-04-30T14:00:00.000Z', '2026-04-30T15:00:00.000Z'),
      buildOpenSlot('pro-lucas', 'Lucas Ribeiro', '09:00', '2026-04-30T12:00:00.000Z', '2026-04-30T13:00:00.000Z'),
      buildOpenSlot('pro-rafael', 'Rafael Costa', '09:00', '2026-04-30T12:00:00.000Z', '2026-04-30T13:00:00.000Z'),
    ],
  })

  assert.equal(resolution.requestedSlot.status, 'blocked')
  assert.equal(resolution.requestedSlot.isOperationalBlock, true)
  assert.equal(resolution.requestedSlot.blockStartTime, '09:00')
  assert.equal(resolution.requestedSlot.blockEndTime, '11:00')
  assert.deepEqual(
    resolution.suggestedSlots.map((slot) => `${slot.timeLabel} com ${slot.professionalName}`),
    [
      '08:00 com Matheus Lima',
      '11:00 com Matheus Lima',
      '09:00 com Lucas Ribeiro',
      '09:00 com Rafael Costa',
    ]
  )
})

test('diagnostico do horario exato trata servico que invade bloqueio como indisponivel', () => {
  const resolution = bookingTesting.buildRequestedSlotDiagnostic({
    exactTime: '08:30',
    dateIso: DATE_ISO,
    timezone: TIMEZONE,
    serviceDuration: 60,
    operationalBufferMinutes: 0,
    dayOpen: buildLocalDate(DATE_ISO, 8, 0, TIMEZONE),
    dayClose: buildLocalDate(DATE_ISO, 21, 0, TIMEZONE),
    firstEligibleStartAt: buildLocalDate(DATE_ISO, 8, 0, TIMEZONE),
    isToday: false,
    professionalId: 'pro-matheus',
    blockedSlots: [
      buildBlockedSlot('2026-04-30T12:00:00.000Z', '2026-04-30T14:00:00.000Z'),
    ],
    openSlots: [
      buildOpenSlot('pro-matheus', 'Matheus Lima', '08:00', '2026-04-30T11:00:00.000Z', '2026-04-30T12:00:00.000Z'),
      buildOpenSlot('pro-matheus', 'Matheus Lima', '11:00', '2026-04-30T14:00:00.000Z', '2026-04-30T15:00:00.000Z'),
    ],
  })

  assert.equal(resolution.requestedSlot.status, 'blocked')
  assert.equal(resolution.requestedSlot.blockStartTime, '09:00')
  assert.equal(resolution.requestedSlot.blockEndTime, '11:00')
  assert.equal(
    availabilityTesting.matchesTimePreference({
      startAt: new Date('2026-04-30T11:30:00.000Z'),
      preference: 'EXACT',
      exactTime: '08:30',
      timezone: TIMEZONE,
    }),
    true
  )
})

test('horario exato no limite do expediente continua disponivel quando termina exatamente no fechamento', async () => {
  await withEnv(
    {
      WHATSAPP_APPOINTMENT_BUFFER_MINUTES: '5',
      WHATSAPP_MIN_LEAD_TIME_MINUTES: '20',
    },
    async () => withAvailabilityPrismaMocks(
      {
        serviceFindFirst: async () => ({
          id: 'svc-premium',
          name: 'Corte + Barba Premium',
          duration: 60,
          price: 95,
        }),
        professionalFindMany: async () => ([{
          id: 'pro-rafael',
          name: 'Rafael Costa',
        }]),
        appointmentFindMany: async () => ([]),
      },
      async () => {
        const availability = await getAvailableWhatsAppSlots({
          barbershopId: 'shop-1',
          serviceId: 'svc-premium',
          professionalId: 'pro-rafael',
          dateIso: DATE_ISO,
          timezone: TIMEZONE,
          timePreference: 'EXACT',
          exactTime: '20:00',
          limit: 4,
        })

        assert.deepEqual(
          availability.slots.map((slot) => `${slot.timeLabel} com ${slot.professionalName}`),
          ['20:00 com Rafael Costa']
        )
        assert.equal(availability.diagnostics.requestedSlot?.status, 'available')
        assert.equal(availabilityTesting.isAppointmentWithinWorkingWindow({
          startAt: buildLocalDate(DATE_ISO, 20, 0, TIMEZONE),
          endAt: buildLocalDate(DATE_ISO, 21, 0, TIMEZONE),
          dayOpen: buildLocalDate(DATE_ISO, 8, 0, TIMEZONE),
          dayClose: buildLocalDate(DATE_ISO, 21, 0, TIMEZONE),
        }), true)
      }
    )
  )
})

test('horario exato que ultrapassa o expediente continua indisponivel', async () => {
  await withEnv(
    {
      WHATSAPP_APPOINTMENT_BUFFER_MINUTES: '5',
      WHATSAPP_MIN_LEAD_TIME_MINUTES: '20',
    },
    async () => withAvailabilityPrismaMocks(
      {
        serviceFindFirst: async () => ({
          id: 'svc-premium',
          name: 'Corte + Barba Premium',
          duration: 60,
          price: 95,
        }),
        professionalFindMany: async () => ([{
          id: 'pro-rafael',
          name: 'Rafael Costa',
        }]),
        appointmentFindMany: async () => ([]),
      },
      async () => {
        const availability = await getAvailableWhatsAppSlots({
          barbershopId: 'shop-1',
          serviceId: 'svc-premium',
          professionalId: 'pro-rafael',
          dateIso: DATE_ISO,
          timezone: TIMEZONE,
          timePreference: 'EXACT',
          exactTime: '20:15',
          limit: 4,
        })

        assert.equal(availability.slots.length, 0)
        assert.equal(availability.diagnostics.requestedSlot?.status, 'outside_working_hours')
        assert.equal(availabilityTesting.isAppointmentWithinWorkingWindow({
          startAt: buildLocalDate(DATE_ISO, 20, 15, TIMEZONE),
          endAt: new Date(buildLocalDate(DATE_ISO, 20, 15, TIMEZONE).getTime() + 60 * 60_000),
          dayOpen: buildLocalDate(DATE_ISO, 8, 0, TIMEZONE),
          dayClose: buildLocalDate(DATE_ISO, 21, 0, TIMEZONE),
        }), false)
      }
    )
  )
})

test('horario exato e bloqueado quando um bloqueio operacional ocupa parte final do atendimento', async () => {
  await withEnv(
    {
      WHATSAPP_APPOINTMENT_BUFFER_MINUTES: '0',
      WHATSAPP_MIN_LEAD_TIME_MINUTES: '20',
    },
    async () => withAvailabilityPrismaMocks(
      {
        serviceFindFirst: async () => ({
          id: 'svc-premium',
          name: 'Corte + Barba Premium',
          duration: 60,
          price: 95,
        }),
        professionalFindMany: async () => ([{
          id: 'pro-rafael',
          name: 'Rafael Costa',
        }]),
        appointmentFindMany: async () => ([{
          id: 'blk-20h30',
          professionalId: 'pro-rafael',
          startAt: new Date('2026-04-30T23:30:00.000Z'),
          endAt: new Date('2026-05-01T00:00:00.000Z'),
          sourceReference: 'schedule:block:manual',
        }]),
      },
      async () => {
        const availability = await getAvailableWhatsAppSlots({
          barbershopId: 'shop-1',
          serviceId: 'svc-premium',
          professionalId: 'pro-rafael',
          dateIso: DATE_ISO,
          timezone: TIMEZONE,
          timePreference: 'EXACT',
          exactTime: '20:00',
          limit: 4,
        })

        assert.equal(availability.slots.length, 0)
        assert.equal(availability.diagnostics.requestedSlot?.status, 'blocked')
      }
    )
  )
})

test('horario exato e bloqueado quando existe outro agendamento ativo em conflito', async () => {
  await withEnv(
    {
      WHATSAPP_APPOINTMENT_BUFFER_MINUTES: '0',
      WHATSAPP_MIN_LEAD_TIME_MINUTES: '20',
    },
    async () => withAvailabilityPrismaMocks(
      {
        serviceFindFirst: async () => ({
          id: 'svc-premium',
          name: 'Corte + Barba Premium',
          duration: 60,
          price: 95,
        }),
        professionalFindMany: async () => ([{
          id: 'pro-rafael',
          name: 'Rafael Costa',
        }]),
        appointmentFindMany: async () => ([{
          id: 'apt-ocupado',
          professionalId: 'pro-rafael',
          startAt: new Date('2026-04-30T23:30:00.000Z'),
          endAt: new Date('2026-05-01T00:00:00.000Z'),
          sourceReference: 'whatsapp:test',
        }]),
      },
      async () => {
        const availability = await getAvailableWhatsAppSlots({
          barbershopId: 'shop-1',
          serviceId: 'svc-premium',
          professionalId: 'pro-rafael',
          dateIso: DATE_ISO,
          timezone: TIMEZONE,
          timePreference: 'EXACT',
          exactTime: '20:00',
          limit: 4,
        })

        assert.equal(availability.slots.length, 0)
        assert.equal(availability.diagnostics.requestedSlot?.status, 'occupied')
      }
    )
  )
})
