const test = require('node:test')
const assert = require('node:assert/strict')

const { formatDateTimeInTimezone } = require('@/lib/timezone')
const { __testing: availabilityTesting } = require('@/lib/agendamentos/availability')

test('aplica lead time minimo antes de oferecer horarios no mesmo dia', () => {
  process.env.WHATSAPP_MIN_LEAD_TIME_MINUTES = '20'

  const earliest = availabilityTesting.getEarliestCustomerSlotStart({
    timezone: 'America/Sao_Paulo',
    leadTimeMinutes: availabilityTesting.getMinimumLeadTimeMinutes(),
    referenceDate: new Date('2026-04-13T18:44:00.000Z'),
  })

  assert.equal(availabilityTesting.getMinimumLeadTimeMinutes(), 20)
  assert.equal(formatDateTimeInTimezone(earliest, 'America/Sao_Paulo'), '2026-04-13 16:15')
})

test('periodo EVENING filtra corretamente horarios da noite', () => {
  const timezone = 'America/Sao_Paulo'

  assert.equal(
    availabilityTesting.matchesTimePreference({
      startAt: new Date('2026-04-18T21:00:00.000Z'),
      preference: 'EVENING',
      timezone,
    }),
    true
  )

  assert.equal(
    availabilityTesting.matchesTimePreference({
      startAt: new Date('2026-04-18T18:30:00.000Z'),
      preference: 'EVENING',
      timezone,
    }),
    false
  )
})

test('retry de disponibilidade executa uma vez em erro transitório e recupera a consulta', async () => {
  let attempts = 0

  const result = await availabilityTesting.runAvailabilityDbQueryWithRetry({
    label: 'availability_test_retry_success',
    operation: async () => {
      attempts += 1

      if (attempts === 1) {
        throw new Error('server has closed the connection unexpectedly')
      }

      return { ok: true }
    },
  })

  assert.equal(attempts, 2)
  assert.deepEqual(result, { ok: true })
})

test('retry de disponibilidade falha depois da segunda tentativa transitória', async () => {
  let attempts = 0

  await assert.rejects(
    availabilityTesting.runAvailabilityDbQueryWithRetry({
      label: 'availability_test_retry_failure',
      operation: async () => {
        attempts += 1
        throw new Error('connection pool timeout while waiting for an available connection')
      },
    }),
    /availability_infrastructure_error:availability_test_retry_failure/
  )

  assert.equal(attempts, 2)
})

test('erro lógico de disponibilidade não entra em retry de infraestrutura', async () => {
  let attempts = 0

  await assert.rejects(
    availabilityTesting.runAvailabilityDbQueryWithRetry({
      label: 'availability_test_logical_error',
      operation: async () => {
        attempts += 1
        throw new Error('service_not_found')
      },
    }),
    /service_not_found/
  )

  assert.equal(attempts, 1)
})
