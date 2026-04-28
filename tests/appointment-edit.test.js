const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getAppointmentSaveSuccessMessage,
  isAppointmentRescheduled,
  shouldCommitAppointmentMove,
} = require('@/lib/agendamentos/appointment-edit')

test('salvar sem mudar data, horario ou barbeiro permanece como atualizacao comum', () => {
  const original = {
    date: '2026-04-30',
    time: '08:00',
    professionalId: 'pro-lucas',
  }

  assert.equal(isAppointmentRescheduled(original, original), false)
  assert.equal(getAppointmentSaveSuccessMessage({
    isEdit: true,
    originalAppointment: original,
    currentAppointment: original,
  }), 'Agendamento atualizado.')
})

test('salvar mudando horario ou barbeiro vira remarcacao real', () => {
  const original = {
    date: '2026-04-30',
    time: '08:00',
    professionalId: 'pro-lucas',
  }

  assert.equal(isAppointmentRescheduled(original, {
    date: '2026-04-30',
    time: '09:00',
    professionalId: 'pro-lucas',
  }), true)

  assert.equal(getAppointmentSaveSuccessMessage({
    isEdit: true,
    originalAppointment: original,
    currentAppointment: {
      date: '2026-04-30',
      time: '08:00',
      professionalId: 'pro-matheus',
    },
  }), 'Agendamento remarcado.')
})

test('clique sem mover slot nao deve persistir remarcacao da agenda', () => {
  const original = {
    dateIso: '2026-04-30',
    startMinutes: 8 * 60,
    professionalId: 'pro-lucas',
  }

  assert.equal(shouldCommitAppointmentMove(original, original), false)
  assert.equal(shouldCommitAppointmentMove(original, {
    dateIso: '2026-04-30',
    startMinutes: 9 * 60,
    professionalId: 'pro-lucas',
  }), true)
})
