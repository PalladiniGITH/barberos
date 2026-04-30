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
  assert.equal(flowTesting.isExplicitRescheduleConfirmationMessage('com o Rafael'), false)
  assert.equal(flowTesting.isExplicitRescheduleConfirmationMessage('pode'), false)

  const prompt = flowTesting.buildReschedulePromptMessage(buildAppointment())
  assert.match(prompt, /Para qual dia e horario voce quer remarcar/i)
})

test('remarcacao com horario repetido por barbeiro pede escolha explicita do profissional', () => {
  const message = flowTesting.buildRescheduleProfessionalChoiceMessage({
    timeLabel: '19:30',
    professionals: [
      { id: 'pro-lucas', name: 'Lucas Ribeiro' },
      { id: 'pro-rafael', name: 'Rafael Costa' },
    ],
  })

  assert.match(message, /19:30/)
  assert.match(message, /1\. Lucas Ribeiro/i)
  assert.match(message, /2\. Rafael Costa/i)
  assert.match(message, /Qual voce prefere/i)
})

test('remarcacao com o barbeiro atual disponivel resume direto mantendo o mesmo profissional', () => {
  const message = flowTesting.buildRescheduleCurrentProfessionalConfirmationMessage({
    appointment: buildAppointment({
      professionalId: 'pro-matheus',
      professionalName: 'Matheus Lima',
      serviceName: 'Corte + Barba Premium',
      dateIso: '2026-04-29',
      dateLabel: 'quarta-feira, 29/04',
      timeLabel: '14:00',
    }),
    slot: {
      key: 'pro-matheus:2026-04-29T19:00:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus Lima',
      dateIso: '2026-04-29',
      timeLabel: '16:00',
      startAtIso: '2026-04-29T19:00:00.000Z',
      endAtIso: '2026-04-29T20:00:00.000Z',
    },
    timezone: 'America/Sao_Paulo',
  })

  assert.match(message, /mantive com Matheus Lima/i)
  assert.match(message, /Horario: 16:00/i)
  assert.match(message, /Barbeiro: Matheus Lima/i)
  assert.doesNotMatch(message, /Lucas Ribeiro|Rafael Costa/i)
})

test('troca de barbeiro indisponivel na remarcacao responde com mensagem operacional clara', () => {
  const message = flowTesting.buildRescheduleProfessionalUnavailableMessage({
    professionalName: 'Rafael Costa',
    dateIso: '2026-04-29',
    timeLabel: '19:30',
    timezone: 'America/Sao_Paulo',
  })

  assert.match(message, /Rafael Costa nao esta disponivel/i)
  assert.match(message, /19:30/)
  assert.match(message, /Posso procurar outros horarios com ele/i)
})

test('remarcacao explica quando o barbeiro atual nao esta disponivel e lista outros no mesmo horario', () => {
  const message = flowTesting.buildRescheduleCurrentProfessionalUnavailableAlternativesMessage({
    professionalName: 'Matheus Lima',
    dateIso: '2026-04-29',
    timeLabel: '16:00',
    timezone: 'America/Sao_Paulo',
    professionals: [
      { id: 'pro-lucas', name: 'Lucas Ribeiro' },
      { id: 'pro-rafael', name: 'Rafael Costa' },
    ],
  })

  assert.match(message, /Matheus Lima nao esta disponivel/i)
  assert.match(message, /16:00/)
  assert.match(message, /1\. Lucas Ribeiro/i)
  assert.match(message, /2\. Rafael Costa/i)
  assert.match(message, /outro horario com Matheus Lima/i)
})

test('draft operacional preserva pendingProfessionalOptions quando o fluxo de remarcacao aguarda barbeiro', () => {
  const parsed = flowTesting.parseOperationalDraft({
    kind: 'reschedule',
    appointments: [buildAppointment()],
    selectedAppointmentId: 'apt-1',
    offeredSlots: [],
    selectedSlot: null,
    pendingProfessionalOptions: [
      { id: 'pro-lucas', name: 'Lucas Ribeiro' },
      { id: 'pro-rafael', name: 'Rafael Costa' },
    ],
    requestedDateIso: '2026-04-29',
    requestedTimeLabel: '19:30',
    selectedProfessionalId: null,
    selectedProfessionalName: null,
    allowAnyProfessional: false,
    triggeredByReminder: false,
    reminderPromptedAtIso: null,
  })

  assert.deepEqual(
    parsed?.pendingProfessionalOptions.map((option) => option.name),
    ['Lucas Ribeiro', 'Rafael Costa']
  )
})

test('resposta ao lembrete diferencia confirmar, remarcar, cancelar e ambiguo', () => {
  assert.equal(flowTesting.parseReminderResponseAction('1'), 'confirm')
  assert.equal(flowTesting.parseReminderResponseAction('confirmo'), 'confirm')
  assert.equal(flowTesting.parseReminderResponseAction('pode confirmar'), 'confirm')
  assert.equal(flowTesting.parseReminderResponseAction('vou sim'), 'confirm')
  assert.equal(flowTesting.parseReminderResponseAction('oi 1'), 'confirm')
  assert.equal(flowTesting.parseReminderResponseAction('quero confirmar meu horario'), 'confirm')
  assert.equal(flowTesting.parseReminderResponseAction('2'), 'reschedule')
  assert.equal(flowTesting.parseReminderResponseAction('quero remarcar'), 'reschedule')
  assert.equal(flowTesting.parseReminderResponseAction('outro horario'), 'reschedule')
  assert.equal(flowTesting.parseReminderResponseAction('3'), 'cancel')
  assert.equal(flowTesting.parseReminderResponseAction('quero cancelar'), 'cancel')
  assert.equal(flowTesting.parseReminderResponseAction('nao vou'), 'cancel')
  assert.equal(flowTesting.parseReminderResponseAction('ok'), 'ambiguous')
  assert.equal(flowTesting.parseReminderResponseAction('boa tarde'), 'none')
  assert.equal(flowTesting.isReminderGreetingMessage('Oi'), true)
  assert.equal(flowTesting.isReminderGreetingMessage('tudo bem'), true)
})

test('seleciona a opcao numerada do fluxo operacional', () => {
  assert.equal(flowTesting.parseOperationalSelectionNumber('1', 3), 1)
  assert.equal(flowTesting.parseOperationalSelectionNumber('opcao 2', 3), 2)
  assert.equal(flowTesting.parseOperationalSelectionNumber('5', 3), null)
})
