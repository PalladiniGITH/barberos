import 'server-only'

export const OPENAI_PRICING_VERSION = 'openai-api-pricing-2026-04-26.v1'
export const OPENAI_PRICING_SOURCE_UPDATED_AT = new Date('2026-04-26T00:00:00.000Z')

const ONE_MILLION_TOKENS = 1_000_000

const OPENAI_MODEL_PRICING = {
  'gpt-5.5': {
    inputUsdPer1M: 5,
    cachedInputUsdPer1M: 0.5,
    outputUsdPer1M: 30,
  },
  'gpt-5.4': {
    inputUsdPer1M: 2.5,
    cachedInputUsdPer1M: 0.25,
    outputUsdPer1M: 15,
  },
  'gpt-5.4-mini': {
    inputUsdPer1M: 0.75,
    cachedInputUsdPer1M: 0.075,
    outputUsdPer1M: 4.5,
  },
} as const

export type OpenAIPricedModel = keyof typeof OPENAI_MODEL_PRICING

export interface OpenAIUsageCostEstimate {
  normalizedModel: string | null
  pricingVersion: string
  pricingSourceUpdatedAt: Date
  estimatedCostUsd: number | null
  estimatedCostCents: number | null
  pricingFound: boolean
}

function normalizeModelName(model: string | null | undefined) {
  if (typeof model !== 'string') {
    return null
  }

  const normalized = model.trim().toLowerCase()
  return normalized || null
}

function normalizeTokenCount(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.round(value))
}

function roundUsd(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

export function getConfiguredOpenAIModelPricing() {
  return { ...OPENAI_MODEL_PRICING }
}

export function getConfiguredOpenAIModelNames() {
  return Object.keys(OPENAI_MODEL_PRICING) as OpenAIPricedModel[]
}

export function estimateOpenAIUsageCost(input: {
  model: string | null | undefined
  inputTokens: number | null | undefined
  cachedInputTokens?: number | null | undefined
  outputTokens: number | null | undefined
}): OpenAIUsageCostEstimate {
  const normalizedModel = normalizeModelName(input.model)
  const pricing = normalizedModel
    ? OPENAI_MODEL_PRICING[normalizedModel as OpenAIPricedModel] ?? null
    : null

  if (!pricing) {
    return {
      normalizedModel,
      pricingVersion: OPENAI_PRICING_VERSION,
      pricingSourceUpdatedAt: OPENAI_PRICING_SOURCE_UPDATED_AT,
      estimatedCostUsd: null,
      estimatedCostCents: null,
      pricingFound: false,
    }
  }

  const rawInputTokens = normalizeTokenCount(input.inputTokens)
  const cachedInputTokens = Math.min(rawInputTokens, normalizeTokenCount(input.cachedInputTokens))
  const billableInputTokens = Math.max(0, rawInputTokens - cachedInputTokens)
  const outputTokens = normalizeTokenCount(input.outputTokens)

  const estimatedCostUsd = roundUsd(
    (billableInputTokens / ONE_MILLION_TOKENS) * pricing.inputUsdPer1M
    + (cachedInputTokens / ONE_MILLION_TOKENS) * pricing.cachedInputUsdPer1M
    + (outputTokens / ONE_MILLION_TOKENS) * pricing.outputUsdPer1M
  )

  return {
    normalizedModel,
    pricingVersion: OPENAI_PRICING_VERSION,
    pricingSourceUpdatedAt: OPENAI_PRICING_SOURCE_UPDATED_AT,
    estimatedCostUsd,
    estimatedCostCents: Math.round(estimatedCostUsd * 100),
    pricingFound: true,
  }
}

export function parseOpenAiUsdBrlRate(rawValue: string | null | undefined) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null
  }

  const normalized = rawValue.trim().replace(',', '.')
  const parsed = Number(normalized)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function getOpenAiUsdBrlRate() {
  return parseOpenAiUsdBrlRate(process.env.OPENAI_USD_BRL_RATE)
}

export function convertUsdToBrl(usdAmount: number | null | undefined, usdBrlRate: number | null | undefined) {
  if (typeof usdAmount !== 'number' || !Number.isFinite(usdAmount)) {
    return null
  }

  if (typeof usdBrlRate !== 'number' || !Number.isFinite(usdBrlRate) || usdBrlRate <= 0) {
    return null
  }

  return roundUsd(usdAmount * usdBrlRate)
}
