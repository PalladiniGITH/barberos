const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildExistingCustomerBookingResponse,
  __testing: bookingStatusTesting,
} = require('@/lib/agendamentos/customer-booking-status')
const { getUtcRangeForLocalDate } = require('@/lib/timezone')

function buildAppointment(startAtUtcIso, overrides = {}) {
  return {
    id: overrides.id ?? startAtUtcIso,
    status: overrides.status ?? 'CONFIRMED',
    startAt: new Date(startAtUtcIso),
    professional: {
      name: overrides.professionalName ?? 'Rafael Costa',
    },
    service: {
      name: overrides.serviceName ?? 'Hidratacao Capilar',
    },
  }
}

test('janela UTC do dia local usa a timezone da barbearia como fonte unica', () => {
  const range = getUtcRangeForLocalDate({
    dateIso: '2026-04-15',
    timezone: 'America/Sao_Paulo',
  })

  assert.equal(range.startAtUtc.toISOString(), '2026-04-15T03:00:00.000Z')
  assert.equal(range.endAtUtc.toISOString(), '2026-04-16T03:00:00.000Z')
})

test('serializa horarios do banco exatamente no horario local da barbearia', () => {
  const appointments = [
    buildAppointment('2026-04-15T13:00:00.000Z', { id: 'apt-1', serviceName: 'Corte Classic', professionalName: 'Lucas Ribeiro' }),
    buildAppointment('2026-04-15T14:30:00.000Z', { id: 'apt-2', serviceName: 'Barba Terapia', professionalName: 'Matheus Lima' }),
    buildAppointment('2026-04-15T19:00:00.000Z', { id: 'apt-3', serviceName: 'Hidratacao Capilar', professionalName: 'Rafael Costa' }),
    buildAppointment('2026-04-15T20:00:00.000Z', { id: 'apt-4', serviceName: 'Pigmentacao Natural', professionalName: 'Lucas Ribeiro' }),
  ]

  const serialized = appointments.map((appointment) =>
    bookingStatusTesting.serializeExistingCustomerBooking({
      appointment,
      timezone: 'America/Sao_Paulo',
    })
  )

  assert.deepEqual(
    serialized.map((item) => item.timeLabel),
    ['10:00', '11:30', '16:00', '17:00']
  )
  assert.deepEqual(
    serialized.map((item) => item.startAtUtc),
    [
      '2026-04-15T13:00:00.000Z',
      '2026-04-15T14:30:00.000Z',
      '2026-04-15T19:00:00.000Z',
      '2026-04-15T20:00:00.000Z',
    ]
  )
})

test('consulta de horarios de amanha responde exatamente os horarios locais salvos no banco', () => {
  const bookings = [
    bookingStatusTesting.serializeExistingCustomerBooking({
      appointment: buildAppointment('2026-04-15T13:00:00.000Z', { id: 'apt-1', serviceName: 'Corte Classic', professionalName: 'Lucas Ribeiro' }),
      timezone: 'America/Sao_Paulo',
    }),
    bookingStatusTesting.serializeExistingCustomerBooking({
      appointment: buildAppointment('2026-04-15T14:30:00.000Z', { id: 'apt-2', serviceName: 'Barba Terapia', professionalName: 'Matheus Lima' }),
      timezone: 'America/Sao_Paulo',
    }),
    bookingStatusTesting.serializeExistingCustomerBooking({
      appointment: buildAppointment('2026-04-15T19:00:00.000Z', { id: 'apt-3', serviceName: 'Hidratacao Capilar', professionalName: 'Rafael Costa' }),
      timezone: 'America/Sao_Paulo',
    }),
    bookingStatusTesting.serializeExistingCustomerBooking({
      appointment: buildAppointment('2026-04-15T20:00:00.000Z', { id: 'apt-4', serviceName: 'Pigmentacao Natural', professionalName: 'Lucas Ribeiro' }),
      timezone: 'America/Sao_Paulo',
    }),
  ]

  const response = buildExistingCustomerBookingResponse({
    bookings,
    requestedDateIso: '2026-04-15',
    queryScope: 'DAY',
    timezone: 'America/Sao_Paulo',
    hasSchedulingContext: false,
  })

  assert.match(response, /10:00 com Lucas Ribeiro para Corte Classic/i)
  assert.match(response, /11:30 com Matheus Lima para Barba Terapia/i)
  assert.match(response, /16:00 com Rafael Costa para Hidratacao Capilar/i)
  assert.match(response, /17:00 com Lucas Ribeiro para Pigmentacao Natural/i)
  assert.doesNotMatch(response, /06:00|12:00|15:00/)
})
