const test = require('node:test')
const assert = require('node:assert/strict')

const {
  __testing: flowTesting,
} = require('@/lib/whatsapp-appointment-flow')

function buildAppointment(overrides = {}) {
  return {
    id: 'apt-1',
    barbershopId: 'shop-1',
    customerId: 'customer-1',
    serviceId: 'svc-1',
    serviceName: 'Corte Classic',
    professionalId: 'pro-1',
    professionalName: 'Lucas',
    status: 'CONFIRMED',
    startAtIso: '2026-04-28T13:00:00.000Z',
    endAtIso: '2026-04-28T13:45:00.000Z',
    dateIso: '2026-04-28',
    dateLabel: 'terca-feira, 28/04',
    timeLabel: '10:00',
    ...overrides,
  }
}

test('cancelamento detecta a intencao e exige confirmacao forte', () => {
  assert.equal(flowTesting.isCancellationIntentMessage('quero cancelar meu horario'), true)
  assert.equal(flowTesting.isExplicitCancellationConfirmationMessage('ok'), false)
  assert.equal(flowTesting.isExplicitCancellationConfirmationMessage('pode cancelar'), true)
  assert.match(flowTesting.buildCancellationStrictConfirmationMessage(), /pode cancelar/i)
})

test('cancelamento com multiplos agendamentos lista opcoes numeradas', () => {
  const message = flowTesting.buildCancellationSelectionMessage([
    buildAppointment(),
    buildAppointment({
      id: 'apt-2',
      serviceName: 'Barba Terapia',
      professionalName: 'Matheus',
      dateIso: '2026-04-30',
      dateLabel: 'quinta-feira, 30/04',
      timeLabel: '15:00',
    }),
  ])

  assert.match(message, /mais de um agendamento/i)
  assert.match(message, /1\./)
  assert.match(message, /2\./)
  assert.match(message, /Qual deles voce quer cancelar/i)
})

test('remarcacao detecta intencao, pede novo horario e exige confirmacao forte', () => {
  assert.equal(flowTesting.isRescheduleIntentMessage('preciso remarcar meu horario'), true)
  assert.equal(flowTesting.isExplicitRescheduleConfirmationMessage('pode remarcar'), true)
  assert.equal(flowTesting.isExplicitRescheduleConfirmationMessage('blz'), false)

  const prompt = flowTesting.buildReschedulePromptMessage(buildAppointment())
  assert.match(prompt, /Para qual dia e horario voce quer remarcar/i)
})

test('resposta ao lembrete diferencia confirmar, remarcar, cancelar e ambiguo', () => {
  assert.equal(flowTesting.parseReminderResponseAction('1'), 'confirm')
  assert.equal(flowTesting.parseReminderResponseAction('confirmo'), 'confirm')
  assert.equal(flowTesting.parseReminderResponseAction('2'), 'reschedule')
  assert.equal(flowTesting.parseReminderResponseAction('quero remarcar'), 'reschedule')
  assert.equal(flowTesting.parseReminderResponseAction('3'), 'cancel')
  assert.equal(flowTesting.parseReminderResponseAction('quero cancelar'), 'cancel')
  assert.equal(flowTesting.parseReminderResponseAction('ok'), 'ambiguous')
  assert.equal(flowTesting.parseReminderResponseAction('boa tarde'), 'none')
})

test('seleciona a opcao numerada do fluxo operacional', () => {
  assert.equal(flowTesting.parseOperationalSelectionNumber('1', 3), 1)
  assert.equal(flowTesting.parseOperationalSelectionNumber('opcao 2', 3), 2)
  assert.equal(flowTesting.parseOperationalSelectionNumber('5', 3), null)
})
