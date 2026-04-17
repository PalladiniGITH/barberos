const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SCHEDULE_GRID_STEP_MINUTES,
  buildSelectionFromPoint,
  intervalsOverlap,
  normalizeSelectionRange,
} = require('@/lib/schedule-grid')
const {
  OPERATIONAL_BLOCK_SOURCE_PREFIX,
  buildOperationalBlockSourceReference,
  isOperationalBlockSourceReference,
} = require('@/lib/agendamentos/operational-blocks')

test('normaliza selecao da agenda com snap e duracao minima', () => {
  const selection = normalizeSelectionRange({
    anchorMinutes: 617,
    currentMinutes: 631,
    dayStartMinutes: 540,
    dayEndMinutes: 1200,
    minimumDuration: 30,
  })

  assert.deepEqual(selection, {
    startMinutes: 615,
    endMinutes: 645,
    durationMinutes: 30,
  })
})

test('clique simples no grid cria intervalo padrao respeitando limites', () => {
  const selection = buildSelectionFromPoint({
    minutes: 1189,
    dayStartMinutes: 540,
    dayEndMinutes: 1200,
    defaultDuration: 30,
  })

  assert.deepEqual(selection, {
    startMinutes: 1170,
    endMinutes: 1200,
    durationMinutes: 30,
  })
})

test('agenda detecta conflito real de intervalos', () => {
  assert.equal(
    intervalsOverlap({
      startMinutes: 600,
      endMinutes: 645,
      compareStartMinutes: 630,
      compareEndMinutes: 660,
    }),
    true
  )

  assert.equal(
    intervalsOverlap({
      startMinutes: 600,
      endMinutes: 630,
      compareStartMinutes: 630,
      compareEndMinutes: 660,
    }),
    false
  )

  assert.equal(SCHEDULE_GRID_STEP_MINUTES, 15)
})

test('bloqueio operacional usa prefixo dedicado para distinguir itens da agenda', () => {
  const sourceReference = buildOperationalBlockSourceReference()

  assert.equal(sourceReference.startsWith(OPERATIONAL_BLOCK_SOURCE_PREFIX), true)
  assert.equal(isOperationalBlockSourceReference(sourceReference), true)
  assert.equal(isOperationalBlockSourceReference('whatsapp:booking:123'), false)
  assert.equal(isOperationalBlockSourceReference(null), false)
})
