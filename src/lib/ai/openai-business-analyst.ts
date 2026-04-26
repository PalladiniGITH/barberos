import 'server-only'

import { z } from 'zod'
import {
  BUSINESS_INSIGHT_HREFS,
  BUSINESS_INSIGHT_SEVERITIES,
  BUSINESS_INSIGHT_TYPES,
  type BusinessInsight,
  type BusinessInsightMode,
  type BusinessInsightSeverity,
  type BusinessInsightsContext,
  type BusinessIntelligenceReport,
} from '@/lib/business-insights'
import { formatCurrency, formatPercent } from '@/lib/utils'

const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini'
const DEFAULT_TIMEOUT_MS = 15000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 20000
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
export const BUSINESS_ANALYST_PROMPT_VERSION = '2026-04-25.windowed-cache.v1'

interface OpenAIBusinessAnalystConfig {
  apiKey: string
  model: string
  timeoutMs: number
}

export type OpenAIFailureReason =
  | 'bad_status'
  | 'invalid_json'
  | 'invalid_payload'
  | 'invalid_schema'
  | 'request_failed'
  | 'timeout'

export interface OpenAIBusinessReportAttempt {
  report: BusinessIntelligenceReport | null
  failureReason: OpenAIFailureReason | null
  model: string | null
  promptVersion: string
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

const AIInsightSchema = z.object({
  type: z.enum(BUSINESS_INSIGHT_TYPES),
  severity: z.enum(BUSINESS_INSIGHT_SEVERITIES),
  title: z.string().min(6).max(120),
  explanation: z.string().min(12).max(320),
  recommendedAction: z.string().min(12).max(220),
  href: z.enum(BUSINESS_INSIGHT_HREFS),
})

const AIResponseSchema = z.object({
  summary: z.object({
    headline: z.string().min(6).max(140),
    body: z.string().min(12).max(360),
    focus: z.string().min(8).max(200),
  }),
  insights: z.array(AIInsightSchema).min(1).max(5),
})

const OPENAI_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        headline: { type: 'string' },
        body: { type: 'string' },
        focus: { type: 'string' },
      },
      required: ['headline', 'body', 'focus'],
    },
    insights: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: [...BUSINESS_INSIGHT_TYPES],
          },
          severity: {
            type: 'string',
            enum: [...BUSINESS_INSIGHT_SEVERITIES],
          },
          title: { type: 'string' },
          explanation: { type: 'string' },
          recommendedAction: { type: 'string' },
          href: {
            type: 'string',
            enum: [...BUSINESS_INSIGHT_HREFS],
          },
        },
        required: ['type', 'severity', 'title', 'explanation', 'recommendedAction', 'href'],
      },
    },
  },
  required: ['summary', 'insights'],
} as const

function readEnv(name: 'OPENAI_API_KEY' | 'OPENAI_MODEL' | 'OPENAI_TIMEOUT_MS') {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTimeoutMs(rawTimeout: string) {
  if (!rawTimeout) {
    return DEFAULT_TIMEOUT_MS
  }

  const parsed = Number(rawTimeout)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMEOUT_MS
  }

  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(parsed)))
}

function getOpenAIBusinessAnalystConfig(): OpenAIBusinessAnalystConfig | null {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return null

  return {
    apiKey,
    model: readEnv('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL,
    timeoutMs: normalizeTimeoutMs(readEnv('OPENAI_TIMEOUT_MS')),
  }
}

function assertServerRuntime() {
  if (typeof window !== 'undefined') {
    throw new Error('OpenAI business analyst must run on the server.')
  }
}

function severityPriority(severity: BusinessInsightSeverity) {
  switch (severity) {
    case 'critical':
      return 900
    case 'warning':
      return 750
    case 'opportunity':
      return 600
    case 'positive':
    default:
      return 450
  }
}

function compactValue(value: number | null) {
  if (value === null) return null
  return Math.round(value * 10) / 10
}

function buildPromptPayload(context: BusinessInsightsContext, deterministic: BusinessIntelligenceReport) {
  const topAlerts = deterministic.alerts.slice(0, 1).map((insight) => ({
    title: insight.title,
    severity: insight.severity,
    action: insight.recommendedAction,
    href: insight.href,
  }))

  const topOpportunities = deterministic.opportunities.slice(0, 1).map((insight) => ({
    title: insight.title,
    severity: insight.severity,
    action: insight.recommendedAction,
    href: insight.href,
  }))

  const professionalsBelowGoal = context.professionals
    .filter((professional) => professional.goalValue > 0 && professional.revenue < professional.goalValue)
    .slice(0, 2)
    .map((professional) => ({
      name: professional.name,
      revenue: compactValue(professional.revenue),
      goalValue: compactValue(professional.goalValue),
      progress: compactValue(professional.progress),
    }))

  const lowMarginServices = context.services
    .filter((service) => service.active && service.marginPercent < context.benchmarks.idealMarginPercent)
    .slice(0, 2)
    .map((service) => ({
      name: service.name,
      marginPercent: compactValue(service.marginPercent),
      price: compactValue(service.price),
    }))

  const topProfitableCustomers = context.customers.rankings.mostProfitable
    .slice(0, 2)
    .map((customer) => ({
      name: customer.name,
      type: customer.type,
      margin: compactValue(customer.margin),
      revenue: compactValue(customer.totalRevenue),
      visits: customer.visits,
    }))

  const topRiskSubscribers = context.customers.rankings.atRiskSubscribers
    .slice(0, 2)
    .map((customer) => ({
      name: customer.name,
      margin: compactValue(customer.margin),
      costVsFee: compactValue(customer.costVsFeePercent),
      visits: customer.visits,
      riskLabel: customer.riskLabel,
    }))

  const topProfessional = context.professionals
    .slice()
    .sort((left, right) => right.revenue - left.revenue)[0]

  return {
    p: {
      label: context.period.label,
      compare: context.period.comparisonLabel,
      partial: context.period.partialComparison,
      current: context.period.isCurrentPeriod,
      daysLeft: context.period.remainingDays,
    },
    kpi: {
      revenue: compactValue(context.financial.totalRevenue),
      expense: compactValue(context.financial.totalExpense),
      profit: compactValue(context.financial.profit),
      margin: compactValue(context.financial.profitMargin),
      ticket: compactValue(context.financial.ticketAverage),
      appointments: context.financial.totalAppointments,
      revenueChange: compactValue(context.financial.revenueChange),
      expenseChange: compactValue(context.financial.expenseChange),
      profitChange: compactValue(context.financial.profitChange),
      ticketChange: compactValue(context.financial.ticketChange),
    },
    goals: {
      revenueGoal: compactValue(context.goals.revenueGoal),
      attainment: compactValue(context.goals.goalAttainment),
      expected: compactValue(context.goals.expectedProgress),
      gap: compactValue(context.goals.remainingToGoal),
      dailyNeeded: compactValue(context.goals.requiredDailyRevenue),
      expenseLimitUsage: compactValue(context.goals.expenseLimitUsage),
      ticketReference: compactValue(context.goals.ticketReference),
    },
    risks: {
      overdueExpenseCount: context.overdueExpenses.count,
      overdueExpenseAmount: compactValue(context.overdueExpenses.amount),
      professionalsBelowGoalCount: context.professionals.filter(
        (professional) => professional.goalValue > 0 && professional.revenue < professional.goalValue
      ).length,
      lowMarginServicesCount: context.services.filter(
        (service) => service.active && service.marginPercent < context.benchmarks.idealMarginPercent
      ).length,
    },
    team: {
      professionals: context.professionals.length,
      belowGoal: professionalsBelowGoal,
      topProfessional: topProfessional
        ? {
            name: topProfessional.name,
            revenue: compactValue(topProfessional.revenue),
            progress: compactValue(topProfessional.progress),
          }
        : null,
    },
    services: {
      averageMarginPercent: compactValue(context.benchmarks.averageMarginPercent),
      lowMarginServices,
    },
    customers: {
      filter: context.customers.filters.customerType,
      visibleCustomers: context.customers.summary.visibleCustomers,
      totalMargin: compactValue(context.customers.summary.totalMargin),
      subscription: {
        members: context.customers.plan.activeMembers,
        revenue: compactValue(context.customers.plan.totalRevenue),
        cost: compactValue(context.customers.plan.totalCost),
        margin: compactValue(context.customers.plan.margin),
        coverage: compactValue(context.customers.plan.averageCostCoverage),
        riskCount: context.customers.plan.riskCount,
        lossCount: context.customers.plan.lossCount,
        underusedCount: context.customers.plan.underusedCount,
        topRiskProfessional: context.customers.plan.topRiskProfessionalName,
        topRiskService: context.customers.plan.topRiskServiceName,
      },
      walkIn: {
        customers: context.customers.groups.walkIn.customers,
        revenue: compactValue(context.customers.groups.walkIn.totalRevenue),
        margin: compactValue(context.customers.groups.walkIn.margin),
        averageMarginPerCustomer: compactValue(context.customers.groups.walkIn.averageMarginPerCustomer),
      },
      topProfitableCustomers,
      topRiskSubscribers,
    },
    trend: context.trend.slice(-2).map((point) => ({
      label: point.label,
      revenue: compactValue(point.revenue),
      expense: compactValue(point.expense),
      profit: compactValue(point.profit),
    })),
    deterministic: {
      headline: deterministic.summary.headline,
      focus: deterministic.summary.focus,
      alerts: topAlerts,
      opportunities: topOpportunities,
    },
  }
}

function logOpenAIFallback(reason: OpenAIFailureReason, details?: string) {
  const suffix = details ? ` ${details}` : ''
  console.warn(`[business-analyst/openai] falling back to deterministic mode: ${reason}.${suffix}`)
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Unknown error'
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const response = payload as {
    output_text?: unknown
    output?: Array<{ content?: Array<{ text?: unknown }> }>
  }

  if (typeof response.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text
  }

  const chunks: string[] = []
  const output = Array.isArray(response.output) ? response.output : []

  output.forEach((item) => {
    const content = Array.isArray(item?.content) ? item.content : []
    content.forEach((part) => {
      if (typeof part?.text === 'string') {
        chunks.push(part.text)
      }
    })
  })

  return chunks.join('\n').trim()
}

function extractUsage(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    }
  }

  const usage = (payload as {
    usage?: {
      input_tokens?: unknown
      output_tokens?: unknown
      total_tokens?: unknown
    }
  }).usage

  const normalize = (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return {
    inputTokens: normalize(usage?.input_tokens),
    outputTokens: normalize(usage?.output_tokens),
    totalTokens: normalize(usage?.total_tokens),
  }
}

function normalizeAIInsights(parsed: z.infer<typeof AIResponseSchema>, context: BusinessInsightsContext): BusinessIntelligenceReport {
  const normalizedInsights: BusinessInsight[] = parsed.insights.map((insight, index) => ({
    id: `ai-${insight.type}-${index + 1}`,
    type: insight.type,
    severity: insight.severity,
    title: insight.title,
    explanation: insight.explanation,
    recommendedAction: insight.recommendedAction,
    href: insight.href,
    priority: severityPriority(insight.severity) - index * 10,
    metric: undefined,
  }))

  const prioritized = normalizedInsights
    .slice()
    .sort((left, right) => right.priority - left.priority)

  const alerts = prioritized.filter((insight) => insight.severity === 'critical' || insight.severity === 'warning')
  const opportunities = prioritized.filter((insight) => insight.severity === 'opportunity' || insight.severity === 'positive')

  return {
    mode: 'ai',
    runtime: {
      userModeLabel: 'OpenAI ativo',
    },
    summary: parsed.summary,
    insights: normalizedInsights,
    prioritized,
    alerts,
    opportunities: opportunities.length > 0 ? opportunities : prioritized.slice(0, 2),
    context,
  }
}

export function isOpenAIBusinessAnalystEnabled() {
  return Boolean(getOpenAIBusinessAnalystConfig())
}

export function buildBusinessAnalystPrompt(context: BusinessInsightsContext, deterministic: BusinessIntelligenceReport) {
  const payload = buildPromptPayload(context, deterministic)
  const serializedPayload = JSON.stringify(payload)

  return [
    'Voce e o analista de negocio da BarberEX.',
    'Use apenas o JSON enviado.',
    'Escreva para dono de barbearia com linguagem curta, clara e acionavel.',
    'Nao invente dados. Nao use texto generico. Nao misture tenants.',
    'Cada insight deve dizer problema ou oportunidade, impacto e acao pratica.',
    'Priorize caixa, lucro, meta, ticket, margem e rentabilidade de clientes.',
    'Retorne no maximo 4 insights.',
    `Use apenas estes hrefs quando fizer sentido: ${BUSINESS_INSIGHT_HREFS.join(', ')}.`,
    `JSON:${serializedPayload}`,
  ].join('\n')
}

export async function generateOpenAIBusinessReport(params: {
  context: BusinessInsightsContext
  deterministic: BusinessIntelligenceReport
}): Promise<OpenAIBusinessReportAttempt> {
  assertServerRuntime()

  const config = getOpenAIBusinessAnalystConfig()
  if (!config) {
    return {
      report: null,
      failureReason: null,
      model: null,
      promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        store: false,
        max_output_tokens: 520,
        input: [
          {
            role: 'user',
            content: buildBusinessAnalystPrompt(params.context, params.deterministic),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'barberex_business_analyst',
            strict: true,
            schema: OPENAI_RESPONSE_JSON_SCHEMA,
          },
        },
      }),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      logOpenAIFallback('bad_status', `status=${response.status}`)
      return {
        report: null,
        failureReason: 'bad_status',
        model: config.model,
        promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }
    }

    const payload = await response.json()
    const outputText = extractResponseText(payload)
    const usage = extractUsage(payload)

    if (!outputText) {
      logOpenAIFallback('invalid_payload', 'OpenAI returned no output_text.')
      return {
        report: null,
        failureReason: 'invalid_payload',
        model: config.model,
        promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      }
    }

    let parsedJson: unknown

    try {
      parsedJson = JSON.parse(outputText)
    } catch (error) {
      logOpenAIFallback('invalid_json', getErrorMessage(error))
      return {
        report: null,
        failureReason: 'invalid_json',
        model: config.model,
        promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      }
    }

    const parsed = AIResponseSchema.safeParse(parsedJson)

    if (!parsed.success) {
      logOpenAIFallback(
        'invalid_schema',
        parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ')
      )
      return {
        report: null,
        failureReason: 'invalid_schema',
        model: config.model,
        promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      }
    }

    return {
      report: normalizeAIInsights(parsed.data, params.context),
      failureReason: null,
      model: config.model,
      promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    }
  } catch (error) {
    if (isAbortError(error)) {
      logOpenAIFallback('timeout', `timeout_ms=${config.timeoutMs}`)
      return {
        report: null,
        failureReason: 'timeout',
        model: config.model,
        promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }
    }

    logOpenAIFallback('request_failed', getErrorMessage(error))
    return {
      report: null,
      failureReason: 'request_failed',
      model: config.model,
      promptVersion: BUSINESS_ANALYST_PROMPT_VERSION,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function describeBusinessAnalystMode(mode: BusinessInsightMode) {
  return mode === 'ai'
    ? 'OpenAI via Responses API'
    : 'Motor deterministico local'
}

export function buildOpenAIExampleSnippet() {
  const config = getOpenAIBusinessAnalystConfig()

  return [
    `POST ${OPENAI_RESPONSES_URL}`,
    `model=${config?.model ?? DEFAULT_OPENAI_MODEL}`,
    'store=false',
    'text.format=json_schema',
    `timeout_ms=${config?.timeoutMs ?? DEFAULT_TIMEOUT_MS}`,
    'fallback=deterministic',
    `sample_kpi=${formatCurrency(0)} / ${formatPercent(0, 0)}`,
  ].join('\n')
}
