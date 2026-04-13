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
