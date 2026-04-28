const test = require('node:test')
const assert = require('node:assert/strict')

const { buildLocalDate, __testing: availabilityTesting } = require('@/lib/agendamentos/availability')
const { __testing: bookingTesting } = require('@/lib/agendamentos/whatsapp-booking')

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
