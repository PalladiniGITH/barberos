const test = require('node:test')
const assert = require('node:assert/strict')

const { __testing: preferenceTesting } = require('@/lib/customers/preferred-professional')
const { __testing: scheduleTesting } = require('@/lib/agendamentos')
const { __testing: conversationTesting } = require('@/lib/whatsapp-conversation')

test('cliente sem historico recebe pergunta generica de barbeiro', () => {
  const reply = conversationTesting.buildProfessionalQuestion(['Matheus', 'Lucas'], null)

  assert.match(reply, /preferencia de barbeiro|qualquer um/i)
  assert.doesNotMatch(reply, /de novo/)
})

test('cliente com historico real recebe sugestao contextual do barbeiro preferencial', () => {
  const preferred = preferenceTesting.choosePreferredProfessionalFromHistory([
    {
      professionalId: 'pro-matheus',
      professionalName: 'Matheus',
      completedAt: new Date('2026-04-10T18:00:00.000Z'),
      startAt: new Date('2026-04-10T17:15:00.000Z'),
    },
    {
      professionalId: 'pro-matheus',
      professionalName: 'Matheus',
      completedAt: new Date('2026-04-03T18:00:00.000Z'),
      startAt: new Date('2026-04-03T17:15:00.000Z'),
    },
    {
      professionalId: 'pro-lucas',
      professionalName: 'Lucas',
      completedAt: new Date('2026-03-28T18:00:00.000Z'),
      startAt: new Date('2026-03-28T17:15:00.000Z'),
    },
  ])

  const reply = conversationTesting.buildProfessionalQuestion(
    ['Matheus', 'Lucas'],
    preferred.professionalName
  )

  assert.equal(preferred.professionalName, 'Matheus')
  assert.match(reply, /Matheus/)
  assert.match(reply, /de novo|prefere outro/i)
})

test('frases como "com o de sempre" ativam a referencia ao barbeiro preferencial', () => {
  assert.equal(conversationTesting.referencesPreferredProfessional('pode ser com o de sempre'), true)
  assert.equal(conversationTesting.referencesPreferredProfessional('com meu barbeiro'), true)
  assert.equal(conversationTesting.referencesPreferredProfessional('quero ver horario hoje'), false)
})

test('barbeiro do agendamento recente vira preferencia contextual para o proximo servico', () => {
  const contextual = conversationTesting.resolveContextualProfessionalPreference({
    professionals: [
      { id: 'pro-matheus', name: 'Matheus' },
      { id: 'pro-lucas', name: 'Lucas' },
    ],
    preferredProfessional: {
      professionalId: 'pro-lucas',
      professionalName: 'Lucas',
    },
    recentBooking: {
      serviceName: 'Corte Classic',
      professionalName: 'Matheus',
      dateIso: '2026-04-13',
      timeLabel: '16:45',
    },
    hasRecentConfirmedBooking: true,
  })

  const reply = conversationTesting.buildProfessionalQuestion(
    ['Matheus', 'Lucas'],
    contextual?.professionalName ?? null
  )

  assert.equal(contextual?.professionalName, 'Matheus')
  assert.equal(contextual?.source, 'recent_booking')
  assert.match(reply, /Matheus/)
  assert.match(reply, /de novo|prefere outro/i)
})

test('agenda e fila do dia projetam o mesmo horario local do agendamento confirmado', () => {
  const serialized = scheduleTesting.serializeScheduleAppointment({
    timezone: 'America/Sao_Paulo',
    appointment: {
      id: 'apt-1',
      customerId: 'cust-1',
      professionalId: 'pro-1',
      serviceId: 'svc-1',
      status: 'CONFIRMED',
      source: 'WHATSAPP',
      billingModel: 'AVULSO',
      startAt: new Date('2026-04-13T18:15:00.000Z'),
      endAt: new Date('2026-04-13T18:50:00.000Z'),
      durationMinutes: 35,
      priceSnapshot: 55,
      notes: null,
      customer: {
        name: 'Gustavo',
        phone: '5541999999999',
        email: null,
        type: 'WALK_IN',
        subscriptionPrice: null,
      },
      professional: {
        name: 'Matheus',
      },
      service: {
        name: 'Barba Terapia',
      },
    },
  })

  assert.equal(serialized.localDateIso, '2026-04-13')
  assert.equal(serialized.startTimeLabel, '15:15')
  assert.equal(serialized.endTimeLabel, '15:50')
  assert.equal(serialized.startDateTimeLabel, '2026-04-13 15:15')
  assert.equal(serialized.startMinutesOfDay, 15 * 60 + 15)
})
