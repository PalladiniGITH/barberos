const test = require('node:test')
const assert = require('node:assert/strict')

const {
  canProfessionalHandleCustomerType,
  resolveProfessionalAttendanceScope,
  resolveProfessionalCommissionRatePercent,
  resolveProfessionalServicePrice,
} = require('@/lib/professionals/operational-config')

test('resolve preco operacional por barbeiro respeita categoria do servico', () => {
  const result = resolveProfessionalServicePrice({
    serviceName: 'Corte + Barba Premium',
    basePrice: 75,
    professional: {
      haircutPrice: 60,
      beardPrice: 35,
      comboPrice: 95,
    },
  })

  assert.equal(result.category, 'COMBO')
  assert.equal(result.price, 95)
})

test('escopo do barbeiro bloqueia tipo de cliente incompatível', () => {
  const professional = {
    acceptsSubscription: false,
    acceptsWalkIn: true,
  }

  assert.equal(
    canProfessionalHandleCustomerType({ customerType: 'SUBSCRIPTION', professional }),
    false
  )
  assert.equal(
    canProfessionalHandleCustomerType({ customerType: 'WALK_IN', professional }),
    true
  )
  assert.equal(
    resolveProfessionalAttendanceScope(professional),
    'WALK_IN_ONLY'
  )
  assert.equal(
    resolveProfessionalCommissionRatePercent({ professionalRate: 47 }),
    47
  )
})
