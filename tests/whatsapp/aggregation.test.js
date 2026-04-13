const test = require('node:test')
const assert = require('node:assert/strict')

const { interpretWhatsAppMessage } = require('@/lib/ai/openai-whatsapp-interpreter')
const { __testing: handlerTesting } = require('@/lib/whatsapp-handler')
const { __testing: conversationTesting } = require('@/lib/whatsapp-conversation')

test('agregacao sensivel consolida horario e barbeiro em um unico turno util', async () => {
  const rawMessages = ['16:45', 'com o rafael']
  const concatenatedMessage = handlerTesting.buildConcatenatedMessage(rawMessages)
  const aggregationWindowMs = handlerTesting.resolveAggregationWindowMs({
    state: 'WAITING_TIME',
    currentMessage: rawMessages[0],
    previousMessages: [],
  })

  const intent = await interpretWhatsAppMessage({
    message: concatenatedMessage,
    barbershopName: 'Linha Nobre',
    barbershopTimezone: 'America/Sao_Paulo',
    conversationState: 'WAITING_TIME',
    offeredSlotCount: 4,
    services: [{ name: 'Barba Terapia' }],
    professionals: [{ name: 'Matheus' }, { name: 'Rafael' }],
    todayIsoDate: '2026-04-13',
    currentLocalDateTime: '2026-04-13 15:40',
    conversationSummary: {
      selectedServiceName: 'Barba Terapia',
      selectedProfessionalName: null,
      requestedDateIso: '2026-04-13',
      requestedTimeLabel: 'AFTERNOON',
      allowAnyProfessional: false,
      lastCustomerMessage: 'quero hoje a tarde',
      lastAssistantMessage: 'Hoje a tarde eu tenho 16:30, 16:45, 17:00 e 17:15. Qual prefere?',
    },
  })

  assert.equal(handlerTesting.isComplementaryShortMessage('16:45'), true)
  assert.equal(handlerTesting.isComplementaryShortMessage('com o rafael'), true)
  assert.equal(aggregationWindowMs, 4000)
  assert.equal(concatenatedMessage, '16:45 com o rafael')
  assert.equal(intent.exactTime, '16:45')
  assert.equal(intent.mentionedName, 'Rafael')
})

test('mensagem de horarios nao repete linhas nem cria espacos em branco extras', () => {
  const message = conversationTesting.buildHumanSlotOfferMessage(
    [
      {
        key: 'pro-rafael:2026-04-13T19:45:00.000Z',
        professionalId: 'pro-rafael',
        professionalName: 'Rafael',
        dateIso: '2026-04-13',
        timeLabel: '16:45',
        startAtIso: '2026-04-13T19:45:00.000Z',
        endAtIso: '2026-04-13T20:20:00.000Z',
      },
      {
        key: 'pro-rafael:2026-04-13T19:45:00.000Z',
        professionalId: 'pro-rafael',
        professionalName: 'Rafael',
        dateIso: '2026-04-13',
        timeLabel: '16:45',
        startAtIso: '2026-04-13T19:45:00.000Z',
        endAtIso: '2026-04-13T20:20:00.000Z',
      },
    ],
    'Barba Terapia',
    'America/Sao_Paulo',
    'AFTERNOON'
  )

  assert.equal((message.match(/16:45/g) ?? []).length, 1)
  assert.doesNotMatch(message, /\n{3,}/)
})
