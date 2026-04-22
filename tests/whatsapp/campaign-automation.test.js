const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CampaignAutomationBenefitType,
  CampaignAutomationType,
} = require('@prisma/client')

const {
  buildCampaignDeliveryDedupeKey,
  buildCampaignFallbackMessage,
  evaluateCampaignEligibility,
  shouldRunDailyCampaignAtLocalTime,
} = require('@/lib/campaign-automation')

function buildCustomer(overrides = {}) {
  return {
    id: 'customer-1',
    name: 'Bruno Souza',
    phone: '(11) 99999-1234',
    type: 'WALK_IN',
    subscriptionStatus: null,
    birthDate: null,
    marketingOptOutAt: null,
    active: true,
    ...overrides,
  }
}

function buildActivity(overrides = {}) {
  return {
    lastCompletedLocalDateIso: null,
    hasFutureAppointment: false,
    latestSentLocalDateIso: null,
    ...overrides,
  }
}

test('shouldRunDailyCampaignAtLocalTime only becomes true from 09:00 forward', () => {
  assert.equal(shouldRunDailyCampaignAtLocalTime({ hour: 8, minute: 59 }), false)
  assert.equal(shouldRunDailyCampaignAtLocalTime({ hour: 9, minute: 0 }), true)
  assert.equal(shouldRunDailyCampaignAtLocalTime({ hour: 9, minute: 17 }), true)
})

test('birthday campaign accepts customers with birthday today and no same-year send', () => {
  const result = evaluateCampaignEligibility({
    campaignType: CampaignAutomationType.BIRTHDAY,
    localDateIso: '2026-04-22',
    localYear: 2026,
    cooldownDays: 365,
    customer: buildCustomer({
      type: 'SUBSCRIPTION',
      subscriptionStatus: 'ACTIVE',
      birthDate: new Date('1994-04-22T12:00:00.000Z'),
    }),
    activity: buildActivity(),
  })

  assert.deepEqual(result, {
    eligible: true,
    reason: 'ELIGIBLE',
  })
})

test('birthday campaign blocks resend within the same year', () => {
  const result = evaluateCampaignEligibility({
    campaignType: CampaignAutomationType.BIRTHDAY,
    localDateIso: '2026-04-22',
    localYear: 2026,
    cooldownDays: 365,
    customer: buildCustomer({
      birthDate: new Date('1994-04-22T12:00:00.000Z'),
    }),
    activity: buildActivity({
      latestSentLocalDateIso: '2026-04-22',
    }),
  })

  assert.deepEqual(result, {
    eligible: false,
    reason: 'BIRTHDAY_ALREADY_SENT',
  })
})

test('walk-in inactive campaign requires 15+ days without completed visit and no future booking', () => {
  const eligible = evaluateCampaignEligibility({
    campaignType: CampaignAutomationType.WALK_IN_INACTIVE,
    localDateIso: '2026-04-22',
    localYear: 2026,
    cooldownDays: 15,
    customer: buildCustomer(),
    activity: buildActivity({
      lastCompletedLocalDateIso: '2026-04-07',
    }),
  })

  assert.deepEqual(eligible, {
    eligible: true,
    reason: 'ELIGIBLE',
  })

  const blockedByFutureAppointment = evaluateCampaignEligibility({
    campaignType: CampaignAutomationType.WALK_IN_INACTIVE,
    localDateIso: '2026-04-22',
    localYear: 2026,
    cooldownDays: 15,
    customer: buildCustomer(),
    activity: buildActivity({
      lastCompletedLocalDateIso: '2026-04-07',
      hasFutureAppointment: true,
    }),
  })

  assert.deepEqual(blockedByFutureAppointment, {
    eligible: false,
    reason: 'HAS_FUTURE_APPOINTMENT',
  })
})

test('subscription absent campaign requires active subscription and 30+ days without attendance', () => {
  const eligible = evaluateCampaignEligibility({
    campaignType: CampaignAutomationType.SUBSCRIPTION_ABSENT,
    localDateIso: '2026-04-22',
    localYear: 2026,
    cooldownDays: 30,
    customer: buildCustomer({
      type: 'SUBSCRIPTION',
      subscriptionStatus: 'ACTIVE',
    }),
    activity: buildActivity({
      lastCompletedLocalDateIso: '2026-03-23',
    }),
  })

  assert.deepEqual(eligible, {
    eligible: true,
    reason: 'ELIGIBLE',
  })

  const pausedSubscription = evaluateCampaignEligibility({
    campaignType: CampaignAutomationType.SUBSCRIPTION_ABSENT,
    localDateIso: '2026-04-22',
    localYear: 2026,
    cooldownDays: 30,
    customer: buildCustomer({
      type: 'SUBSCRIPTION',
      subscriptionStatus: 'PAUSED',
    }),
    activity: buildActivity({
      lastCompletedLocalDateIso: '2026-03-23',
    }),
  })

  assert.deepEqual(pausedSubscription, {
    eligible: false,
    reason: 'SUBSCRIPTION_INACTIVE',
  })
})

test('reactivation campaigns respect cooldown windows', () => {
  const result = evaluateCampaignEligibility({
    campaignType: CampaignAutomationType.WALK_IN_INACTIVE,
    localDateIso: '2026-04-22',
    localYear: 2026,
    cooldownDays: 15,
    customer: buildCustomer(),
    activity: buildActivity({
      lastCompletedLocalDateIso: '2026-04-05',
      latestSentLocalDateIso: '2026-04-12',
    }),
  })

  assert.deepEqual(result, {
    eligible: false,
    reason: 'RECENT_CAMPAIGN_IN_COOLDOWN',
  })
})

test('campaigns never send without valid channel and respect opt-out', () => {
  const invalidPhone = evaluateCampaignEligibility({
    campaignType: CampaignAutomationType.BIRTHDAY,
    localDateIso: '2026-04-22',
    localYear: 2026,
    cooldownDays: 365,
    customer: buildCustomer({
      phone: null,
      birthDate: new Date('1994-04-22T12:00:00.000Z'),
    }),
    activity: buildActivity(),
  })

  assert.deepEqual(invalidPhone, {
    eligible: false,
    reason: 'INVALID_CHANNEL',
  })

  const optedOut = evaluateCampaignEligibility({
    campaignType: CampaignAutomationType.BIRTHDAY,
    localDateIso: '2026-04-22',
    localYear: 2026,
    cooldownDays: 365,
    customer: buildCustomer({
      birthDate: new Date('1994-04-22T12:00:00.000Z'),
      marketingOptOutAt: new Date('2026-01-10T12:00:00.000Z'),
    }),
    activity: buildActivity(),
  })

  assert.deepEqual(optedOut, {
    eligible: false,
    reason: 'OPT_OUT',
  })
})

test('fallback messages keep benefit and CTA by campaign type', () => {
  const birthdayMessage = buildCampaignFallbackMessage({
    campaignType: CampaignAutomationType.BIRTHDAY,
    customerName: 'Bruno Souza',
    barbershopName: 'Linha Nobre',
    benefitType: CampaignAutomationBenefitType.FREE_ADD_ON,
    benefitDescription: 'fazendo um servico hoje, voce ganha uma limpeza expressa',
  })

  assert.match(birthdayMessage, /Feliz aniversario/i)
  assert.match(birthdayMessage, /limpeza expressa/i)
  assert.match(birthdayMessage, /agendar/i)

  const subscriptionMessage = buildCampaignFallbackMessage({
    campaignType: CampaignAutomationType.SUBSCRIPTION_ABSENT,
    customerName: 'Bruno Souza',
    barbershopName: 'Linha Nobre',
    benefitType: CampaignAutomationBenefitType.CUSTOM,
    benefitDescription: 'um retorno com prioridade na agenda desta semana',
  })

  assert.match(subscriptionMessage, /assinatura/i)
  assert.match(subscriptionMessage, /prioridade na agenda/i)
  assert.match(subscriptionMessage, /reagendar/i)
})

test('delivery dedupe keys remain deterministic by campaign scope', () => {
  assert.equal(
    buildCampaignDeliveryDedupeKey({
      campaignType: CampaignAutomationType.BIRTHDAY,
      barbershopId: 'shop-1',
      customerId: 'customer-1',
      localDateIso: '2026-04-22',
      localYear: 2026,
    }),
    'birthday:shop-1:customer-1:2026'
  )

  assert.equal(
    buildCampaignDeliveryDedupeKey({
      campaignType: CampaignAutomationType.WALK_IN_INACTIVE,
      barbershopId: 'shop-1',
      customerId: 'customer-1',
      localDateIso: '2026-04-22',
      localYear: 2026,
    }),
    'walk-in-inactive:shop-1:customer-1:2026-04-22'
  )
})
