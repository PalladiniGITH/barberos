const test = require('node:test')
const assert = require('node:assert/strict')

const {
  OPENAI_PRICING_VERSION,
  estimateOpenAIUsageCost,
  parseOpenAiUsdBrlRate,
  convertUsdToBrl,
} = require('../src/lib/ai/openai-pricing')
const { extractOpenAIUsage } = require('../src/lib/ai/openai-usage')

test('estimateOpenAIUsageCost calcula input, cached input e output por modelo configurado', () => {
  const estimate = estimateOpenAIUsageCost({
    model: 'gpt-5.4',
    inputTokens: 1_000_000,
    cachedInputTokens: 200_000,
    outputTokens: 100_000,
  })

  assert.equal(estimate.pricingFound, true)
  assert.equal(estimate.pricingVersion, OPENAI_PRICING_VERSION)
  assert.equal(estimate.normalizedModel, 'gpt-5.4')
  assert.equal(estimate.estimatedCostUsd, 3.55)
  assert.equal(estimate.estimatedCostCents, 355)
})

test('estimateOpenAIUsageCost nao quebra quando o modelo nao existe na tabela', () => {
  const estimate = estimateOpenAIUsageCost({
    model: 'gpt-x-desconhecido',
    inputTokens: 20_000,
    outputTokens: 3_000,
  })

  assert.equal(estimate.pricingFound, false)
  assert.equal(estimate.normalizedModel, 'gpt-x-desconhecido')
  assert.equal(estimate.estimatedCostUsd, null)
  assert.equal(estimate.estimatedCostCents, null)
})

test('extractOpenAIUsage aproveita cached tokens quando a Responses API devolve input_tokens_details', () => {
  const usage = extractOpenAIUsage({
    usage: {
      input_tokens: 1200,
      output_tokens: 240,
      total_tokens: 1440,
      input_tokens_details: {
        cached_tokens: 320,
      },
    },
  })

  assert.deepEqual(usage, {
    inputTokens: 1200,
    cachedInputTokens: 320,
    outputTokens: 240,
    totalTokens: 1440,
  })
})

test('parseOpenAiUsdBrlRate e convertUsdToBrl aceitam taxa valida e ignoram valor invalido', () => {
  assert.equal(parseOpenAiUsdBrlRate('5.25'), 5.25)
  assert.equal(parseOpenAiUsdBrlRate('invalido'), null)
  assert.equal(convertUsdToBrl(3.55, 5.25), 18.6375)
  assert.equal(convertUsdToBrl(3.55, null), null)
})
