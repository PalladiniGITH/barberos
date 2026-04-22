const test = require('node:test')
const assert = require('node:assert/strict')

const { buildBarbershopHealthSnapshot } = require('@/lib/barbershop-health')

test('saude da barbearia resume recorrencia de assinantes e retorno de avulsos', () => {
  const snapshot = buildBarbershopHealthSnapshot({
    filters: {
      professionalId: null,
      customerType: 'all',
    },
    summary: {
      activeCustomers: 14,
      visibleCustomers: 14,
      visits: 32,
      totalRevenue: 4200,
      realRevenue: 3500,
      estimatedRevenue: 700,
      totalCost: 1600,
      totalMargin: 2600,
      averageTicket: 131.25,
      averageVisitsPerCustomer: 2.28,
      profitableCustomers: 12,
      lossCustomers: 2,
    },
    methodology: {
      realRevenueDefinition: '',
      estimatedRevenueDefinition: '',
      costDefinition: '',
      marginDefinition: '',
      caution: '',
    },
    groups: {
      subscription: {
        type: 'SUBSCRIPTION',
        label: 'Assinatura',
        customers: 8,
        visits: 18,
        totalRevenue: 2200,
        realRevenue: 1800,
        estimatedRevenue: 400,
        totalCost: 900,
        margin: 1300,
        marginPercent: 59.09,
        revenueSharePercent: 52.38,
        operationalSharePercent: 56.25,
        averageTicket: 122.22,
        averageVisitsPerCustomer: 2.25,
        averageRevenuePerVisit: 122.22,
        averageMarginPerCustomer: 162.5,
        averageCostPerVisit: 50,
      },
      walkIn: {
        type: 'WALK_IN',
        label: 'Avulso',
        customers: 6,
        visits: 14,
        totalRevenue: 2000,
        realRevenue: 1700,
        estimatedRevenue: 300,
        totalCost: 700,
        margin: 1300,
        marginPercent: 65,
        revenueSharePercent: 47.62,
        operationalSharePercent: 43.75,
        averageTicket: 142.85,
        averageVisitsPerCustomer: 2.33,
        averageRevenuePerVisit: 142.85,
        averageMarginPerCustomer: 216.66,
        averageCostPerVisit: 50,
      },
    },
    plan: {
      enabled: true,
      monthlyPriceReference: 199.9,
      activeMembers: 8,
      activeMembersWithVisits: 6,
      totalRevenue: 2200,
      realRevenue: 1800,
      estimatedRevenue: 400,
      totalCost: 900,
      margin: 1300,
      marginPercent: 59.09,
      revenueSharePercent: 52.38,
      operationalSharePercent: 56.25,
      averageVisitsPerMember: 2.25,
      averagePublicValueConsumed: 160,
      averageCostCoverage: 41,
      riskCount: 1,
      lossCount: 0,
      underusedCount: 2,
      healthyCount: 5,
      topRiskProfessionalName: 'Matheus',
      topRiskServiceName: 'Corte Classic',
    },
    rankings: {
      mostProfitable: [],
      leastProfitable: [],
      mostFrequent: [],
      atRiskSubscribers: [],
      lossSubscribers: [],
      underusedSubscribers: [],
      profitableSubscribers: [],
      valuableWalkIns: [],
    },
    table: [
      { id: 's1', name: 'Assinante 1', type: 'SUBSCRIPTION', visits: 3 },
      { id: 's2', name: 'Assinante 2', type: 'SUBSCRIPTION', visits: 2 },
      { id: 's3', name: 'Assinante 3', type: 'SUBSCRIPTION', visits: 1 },
      { id: 's4', name: 'Assinante 4', type: 'SUBSCRIPTION', visits: 0 },
      { id: 'w1', name: 'Avulso 1', type: 'WALK_IN', visits: 3 },
      { id: 'w2', name: 'Avulso 2', type: 'WALK_IN', visits: 2 },
      { id: 'w3', name: 'Avulso 3', type: 'WALK_IN', visits: 1 },
      { id: 'w4', name: 'Avulso 4', type: 'WALK_IN', visits: 1 },
      { id: 'w5', name: 'Avulso 5', type: 'WALK_IN', visits: 0 },
      { id: 'w6', name: 'Avulso 6', type: 'WALK_IN', visits: 0 },
    ],
  })

  assert.equal(snapshot.activeSubscribers, 8)
  assert.equal(snapshot.subscribersWithVisits, 6)
  assert.equal(snapshot.subscriberReturnRate, 75)
  assert.equal(snapshot.returningWalkInCustomers, 2)
  assert.equal(snapshot.walkInReturnRate, 33.33333333333333)
  assert.equal(snapshot.healthStatus, 'healthy')
})
