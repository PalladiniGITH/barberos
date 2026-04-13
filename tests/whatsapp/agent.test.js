const test = require('node:test')
const assert = require('node:assert/strict')

const { interpretWhatsAppMessage } = require('@/lib/ai/openai-whatsapp-interpreter')
const { __testing: agentTesting } = require('@/lib/ai/openai-whatsapp-agent')

const SERVICES = [
  { id: 'svc-classic', name: 'Corte Classic', duration: 35, price: 55 },
  { id: 'svc-barba', name: 'Barba', duration: 20, price: 35 },
]

const PROFESSIONALS = [
  { id: 'pro-matheus', name: 'Matheus' },
  { id: 'pro-lucas', name: 'Lucas' },
]

function createAgentInput() {
  return {
    barbershop: {
      id: 'shop-1',
      name: 'Linha Nobre',
      slug: 'linha-nobre',
      timezone: 'America/Sao_Paulo',
    },
    customer: {
      id: 'cust-1',
      name: 'Gustavo',
      created: false,
      phone: '5541999999999',
    },
    inboundText: '',
    conversation: {
      id: 'conv-1',
      state: 'IDLE',
      updatedAt: new Date('2026-04-13T14:00:00.000Z'),
      selectedServiceId: null,
      selectedServiceName: null,
      selectedProfessionalId: null,
      selectedProfessionalName: null,
      allowAnyProfessional: false,
      requestedDate: null,
      requestedTimeLabel: null,
      slotOptions: null,
      selectedSlot: null,
      conversationSummary: null,
      bookingDraft: null,
      recentCorrections: null,
      lastInboundText: null,
      lastAssistantText: null,
    },
    services: SERVICES,
    professionals: PROFESSIONALS,
    nowContext: {
      dateIso: '2026-04-13',
      dateTimeLabel: '2026-04-13 10:30',
    },
  }
}

function getConversationSummaryFromMemory(memory) {
  return {
    selectedServiceName: memory.selectedServiceName,
    selectedProfessionalName: memory.selectedProfessionalName,
    requestedDateIso: memory.requestedDateIso,
    requestedTimeLabel: memory.requestedTimeLabel,
    allowAnyProfessional: memory.allowAnyProfessional,
    lastCustomerMessage: null,
    lastAssistantMessage: null,
  }
}

async function interpretMessage(message, memory) {
  return interpretWhatsAppMessage({
    message,
    barbershopName: 'Linha Nobre',
    barbershopTimezone: 'America/Sao_Paulo',
    conversationState: memory.state,
    offeredSlotCount: memory.offeredSlots.length,
    services: SERVICES.map((service) => ({ name: service.name })),
    professionals: PROFESSIONALS.map((professional) => ({ name: professional.name })),
    todayIsoDate: '2026-04-13',
    currentLocalDateTime: '2026-04-13 10:30',
    conversationSummary: getConversationSummaryFromMemory(memory),
  })
}

test('promove imediatamente data, servico e periodo para a memoria do agente', async () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())

  const dateIntent = await interpretMessage('Quero marcar horario hoje', memory)
  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: dateIntent,
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  assert.equal(memory.requestedDateIso, '2026-04-13')

  const serviceIntent = await interpretMessage('Corte classic', memory)
  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: serviceIntent,
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  assert.equal(memory.selectedServiceId, 'svc-classic')
  assert.equal(memory.selectedServiceName, 'Corte Classic')

  const periodIntent = await interpretMessage('Tarde', memory)
  agentTesting.promoteIntentContextToMemory({
    memory,
    intent: periodIntent,
    services: SERVICES,
    professionals: PROFESSIONALS,
  })

  assert.equal(memory.requestedTimeLabel, 'AFTERNOON')
})

test('backend corrige nextAction quando a IA tenta perguntar algo ja preenchido', () => {
  const memory = agentTesting.buildInitialMemory(createAgentInput())

  memory.selectedServiceId = 'svc-classic'
  memory.selectedServiceName = 'Corte Classic'
  memory.selectedProfessionalId = 'pro-matheus'
  memory.selectedProfessionalName = 'Matheus'
  memory.requestedDateIso = '2026-04-13'
  memory.requestedTimeLabel = 'AFTERNOON'
  memory.offeredSlots = [
    {
      key: 'pro-matheus:2026-04-13T16:15:00.000Z',
      professionalId: 'pro-matheus',
      professionalName: 'Matheus',
      dateIso: '2026-04-13',
      timeLabel: '13:15',
      startAtIso: '2026-04-13T16:15:00.000Z',
      endAtIso: '2026-04-13T16:50:00.000Z',
    },
  ]

  const corrected = agentTesting.enforceNextActionFromMemory('ASK_DATE', memory, false)
  assert.equal(corrected, 'OFFER_SLOTS')
})
