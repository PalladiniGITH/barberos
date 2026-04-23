import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import {
  AppointmentSource,
  CampaignAutomationBenefitType,
  CampaignAutomationDeliveryStatus,
  CampaignAutomationRunStatus,
  CampaignAutomationTrigger,
  CampaignAutomationType,
  MessagingDirection,
  MessagingProvider,
  Prisma,
  type CampaignAutomationConfig,
  type CampaignAutomationRun,
  type Customer,
} from '@prisma/client'
import { z } from 'zod'
import {
  EvolutionApiError,
  getEvolutionInstanceName,
  normalizeEvolutionPhoneNumber,
  sendTextMessage,
} from '@/lib/integrations/evolution'
import { prisma } from '@/lib/prisma'
import {
  formatIsoDateInTimezone,
  getCurrentDateTimeInTimezone,
  resolveBusinessTimezone,
  shiftIsoDate,
} from '@/lib/timezone'

const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini'
const DEFAULT_TIMEOUT_MS = 8000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 15000
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

export const CAMPAIGN_AUTOMATION_ROUTE_PATH = '/api/internal/campaign-automation/run'
export const CAMPAIGN_AUTOMATION_SECRET_HEADER = 'x-automation-secret'
export const CAMPAIGN_AUTOMATION_TARGET_HOUR = 9
export const CAMPAIGN_AUTOMATION_TARGET_MINUTE = 0

type CampaignCustomerSnapshot = Pick<
  Customer,
  | 'id'
  | 'name'
  | 'phone'
  | 'type'
  | 'subscriptionStatus'
  | 'birthDate'
  | 'marketingOptOutAt'
  | 'active'
>

interface EligibilitySnapshot {
  lastCompletedLocalDateIso: string | null
  hasFutureAppointment: boolean
  latestSentLocalDateIso: string | null
}

export interface CampaignEligibilityInput {
  campaignType: CampaignAutomationType
  localDateIso: string
  localYear: number
  cooldownDays: number
  customer: CampaignCustomerSnapshot
  activity: EligibilitySnapshot
}

export interface CampaignEligibilityResult {
  eligible: boolean
  reason:
    | 'ELIGIBLE'
    | 'INVALID_CHANNEL'
    | 'OPT_OUT'
    | 'INACTIVE_CUSTOMER'
    | 'CUSTOMER_TYPE_MISMATCH'
    | 'SUBSCRIPTION_INACTIVE'
    | 'BIRTHDAY_NOT_TODAY'
    | 'BIRTHDAY_ALREADY_SENT'
    | 'NO_COMPLETED_VISIT'
    | 'NOT_INACTIVE_YET'
    | 'HAS_FUTURE_APPOINTMENT'
    | 'RECENT_CAMPAIGN_IN_COOLDOWN'
}

export interface CampaignAutomationRunSummary {
  checkedBarbershops: number
  dueBarbershops: number
  createdRuns: number
  skippedRuns: number
  failedRuns: number
  deliveriesCreated: number
  deliveriesSent: number
  deliveriesFailed: number
  deliveriesSkipped: number
  barbershops: Array<{
    barbershopId: string
    barbershopSlug: string
    localDateIso: string
    timezone: string
    outcome: 'processed' | 'skipped' | 'failed'
    reason: string
    totals?: {
      deliveriesCreated: number
      deliveriesSent: number
      deliveriesFailed: number
      deliveriesSkipped: number
      eligibleCustomers: number
    }
  }>
}

export interface CampaignAutomationManagementData {
  enabled: boolean
  status: 'active' | 'inactive' | 'attention'
  statusLabel: string
  statusDescription: string
  executionTimeLabel: string
  localDateIso: string
  timezone: string
  lastRun: {
    localDateIso: string
    status: CampaignAutomationRunStatus
    startedAt: Date
    completedAt: Date | null
    deliveriesSent: number
    deliveriesFailed: number
    deliveriesSkipped: number
  } | null
  nextWindow: {
    localDateIso: string
    timeLabel: string
    description: string
  }
  todayTotals: {
    eligibleCustomers: number
    deliveriesCreated: number
    deliveriesSent: number
    deliveriesFailed: number
    deliveriesSkipped: number
    deliveryRate: number | null
  }
  campaignSummaries: Array<{
    campaignType: CampaignAutomationType
    active: boolean
    benefitDescription: string | null
    eligibleCustomers: number
    deliveriesCreated: number
    deliveriesSent: number
    deliveriesFailed: number
    deliveriesSkipped: number
    deliveryRate: number | null
    usedAiCount: number
    fallbackCount: number
  }>
  recentDeliveries: Array<{
    id: string
    customerName: string
    campaignType: CampaignAutomationType
    benefitDescription: string | null
    status: CampaignAutomationDeliveryStatus
    sentAt: Date | null
    createdAt: Date
    usedAi: boolean
    usedFallback: boolean
  }>
  estimatedImpact: {
    windowDays: number
    respondedCustomers: number
    rebookedCustomers: number
  }
}

interface DeliveryPreparation {
  customer: CampaignCustomerSnapshot
  normalizedPhone: string
  fallbackMessage: string
  finalMessage: string
  usedAi: boolean
  aiFailureReason: OpenAIFailureReason | null
}

type DailyRunRecordResult =
  | {
      id: string
      created: true
    }
  | {
      id: string
      created: false
      status: CampaignAutomationRun['status']
    }

type OpenAIFailureReason =
  | 'disabled'
  | 'bad_status'
  | 'invalid_json'
  | 'invalid_payload'
  | 'invalid_schema'
  | 'request_failed'
  | 'timeout'

interface OpenAIMessageConfig {
  apiKey: string
  model: string
  timeoutMs: number
}

const CAMPAIGN_MESSAGE_SCHEMA = z.object({
  message: z.string().min(24).max(360),
})

const CAMPAIGN_MESSAGE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    message: { type: 'string' },
  },
  required: ['message'],
} as const

const DEFAULT_CAMPAIGN_CONFIGS: Record<
  CampaignAutomationType,
  {
    cooldownDays: number
    benefitType: CampaignAutomationBenefitType
    benefitDescription: string
    active: boolean
  }
> = {
  BIRTHDAY: {
    cooldownDays: 365,
    benefitType: CampaignAutomationBenefitType.FREE_ADD_ON,
    benefitDescription: 'fazendo um servico hoje, voce ganha uma limpeza expressa como mimo de aniversario',
    active: true,
  },
  WALK_IN_INACTIVE: {
    cooldownDays: 15,
    benefitType: CampaignAutomationBenefitType.DISCOUNT_COUPON,
    benefitDescription: '10% OFF no proximo atendimento ate o fim da semana',
    active: true,
  },
  SUBSCRIPTION_ABSENT: {
    cooldownDays: 30,
    benefitType: CampaignAutomationBenefitType.CUSTOM,
    benefitDescription: 'sua assinatura segue ativa e podemos encaixar seu retorno nesta semana',
    active: true,
  },
}

function logCampaign(event: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[campaign-automation] ${event}`, details)
    return
  }

  console.info(`[campaign-automation] ${event}`)
}

function logCampaignError(event: string, details?: Record<string, unknown>) {
  if (details) {
    console.error(`[campaign-automation] ${event}`, details)
    return
  }

  console.error(`[campaign-automation] ${event}`)
}

function readBooleanEnv(name: string) {
  return process.env[name]?.trim().toLowerCase() === 'true'
}

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

function getOpenAIMessageConfig(): OpenAIMessageConfig | null {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) {
    return null
  }

  return {
    apiKey,
    model: readEnv('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL,
    timeoutMs: normalizeTimeoutMs(readEnv('OPENAI_TIMEOUT_MS')),
  }
}

function getAutomationRunnerSecret() {
  const explicitSecret = process.env.AUTOMATION_RUNNER_SECRET?.trim()
  if (explicitSecret) {
    return explicitSecret
  }

  const fallbackSecret = process.env.NEXTAUTH_SECRET?.trim()
  return fallbackSecret || null
}

function safeCompare(left: string | null, right: string | null) {
  if (!left || !right) {
    return false
  }

  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

export function isCampaignAutomationRequestAuthorized(request: Request) {
  const sharedSecret = getAutomationRunnerSecret()
  const providedSecret =
    request.headers.get(CAMPAIGN_AUTOMATION_SECRET_HEADER)
    ?? request.headers.get('x-internal-secret')

  return safeCompare(sharedSecret, providedSecret)
}

export function isCampaignAutomationEnabled() {
  if (process.env.CUSTOMER_CAMPAIGN_AUTOMATION_ENABLED?.trim()) {
    return readBooleanEnv('CUSTOMER_CAMPAIGN_AUTOMATION_ENABLED')
  }

  return false
}

function normalizePhoneDigits(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const digits = value.replace(/\D/g, '')
  if (digits.length < 10) {
    return null
  }

  return digits
}

function getCustomerFirstName(name: string) {
  const [firstName] = name.trim().split(/\s+/)
  return firstName || name.trim()
}

function getBirthdayMonthDayKey(date: Date | null) {
  if (!date) {
    return null
  }

  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${month}-${day}`
}

function getLocalMonthDayKey(dateIso: string) {
  const [, month, day] = dateIso.split('-')
  return `${month}-${day}`
}

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function getSafeEvolutionInstanceName() {
  try {
    return getEvolutionInstanceName()
  } catch {
    return process.env.EVOLUTION_INSTANCE?.trim() || 'evolution'
  }
}

export function describeExistingDailyRunReason(status: CampaignAutomationRun['status']) {
  if (status === CampaignAutomationRunStatus.RUNNING) {
    return 'already_running_today'
  }

  if (status === CampaignAutomationRunStatus.FAILED) {
    return 'already_failed_today'
  }

  return 'already_processed_today'
}

function buildDeliveryFailureDiagnostics(error: unknown) {
  if (error instanceof EvolutionApiError) {
    return {
      type: 'evolution_api_error',
      message: error.message,
      evolution: error.toLogObject(),
    }
  }

  return {
    type: 'unknown_error',
    message: error instanceof Error ? error.message : String(error),
  }
}

export function shouldRunDailyCampaignAtLocalTime(input: {
  hour: number
  minute: number
  targetHour?: number
  targetMinute?: number
}) {
  const targetHour = input.targetHour ?? CAMPAIGN_AUTOMATION_TARGET_HOUR
  const targetMinute = input.targetMinute ?? CAMPAIGN_AUTOMATION_TARGET_MINUTE

  return (
    input.hour > targetHour
    || (input.hour === targetHour && input.minute >= targetMinute)
  )
}

function isCooldownBlocked(input: {
  latestSentLocalDateIso: string | null
  localDateIso: string
  cooldownDays: number
}) {
  if (!input.latestSentLocalDateIso) {
    return false
  }

  const thresholdLocalDateIso = shiftIsoDate(input.localDateIso, -input.cooldownDays)
  return input.latestSentLocalDateIso > thresholdLocalDateIso
}

export function evaluateCampaignEligibility(input: CampaignEligibilityInput): CampaignEligibilityResult {
  if (!input.customer.active) {
    return {
      eligible: false,
      reason: 'INACTIVE_CUSTOMER',
    }
  }

  if (!normalizePhoneDigits(input.customer.phone)) {
    return {
      eligible: false,
      reason: 'INVALID_CHANNEL',
    }
  }

  if (input.customer.marketingOptOutAt) {
    return {
      eligible: false,
      reason: 'OPT_OUT',
    }
  }

  if (input.campaignType === CampaignAutomationType.BIRTHDAY) {
    if (getBirthdayMonthDayKey(input.customer.birthDate) !== getLocalMonthDayKey(input.localDateIso)) {
      return {
        eligible: false,
        reason: 'BIRTHDAY_NOT_TODAY',
      }
    }

    if (
      input.activity.latestSentLocalDateIso
      && input.activity.latestSentLocalDateIso.startsWith(`${input.localYear}-`)
    ) {
      return {
        eligible: false,
        reason: 'BIRTHDAY_ALREADY_SENT',
      }
    }

    return {
      eligible: true,
      reason: 'ELIGIBLE',
    }
  }

  if (input.activity.hasFutureAppointment) {
    return {
      eligible: false,
      reason: 'HAS_FUTURE_APPOINTMENT',
    }
  }

  if (!input.activity.lastCompletedLocalDateIso) {
    return {
      eligible: false,
      reason: 'NO_COMPLETED_VISIT',
    }
  }

  if (isCooldownBlocked({
    latestSentLocalDateIso: input.activity.latestSentLocalDateIso,
    localDateIso: input.localDateIso,
    cooldownDays: input.cooldownDays,
  })) {
    return {
      eligible: false,
      reason: 'RECENT_CAMPAIGN_IN_COOLDOWN',
    }
  }

  if (input.campaignType === CampaignAutomationType.WALK_IN_INACTIVE) {
    if (input.customer.type !== 'WALK_IN') {
      return {
        eligible: false,
        reason: 'CUSTOMER_TYPE_MISMATCH',
      }
    }

    const inactivityCutoffDateIso = shiftIsoDate(input.localDateIso, -15)
    if (input.activity.lastCompletedLocalDateIso > inactivityCutoffDateIso) {
      return {
        eligible: false,
        reason: 'NOT_INACTIVE_YET',
      }
    }

    return {
      eligible: true,
      reason: 'ELIGIBLE',
    }
  }

  if (input.customer.type !== 'SUBSCRIPTION') {
    return {
      eligible: false,
      reason: 'CUSTOMER_TYPE_MISMATCH',
    }
  }

  if (input.customer.subscriptionStatus !== 'ACTIVE') {
    return {
      eligible: false,
      reason: 'SUBSCRIPTION_INACTIVE',
    }
  }

  const subscriptionAbsenceCutoffDateIso = shiftIsoDate(input.localDateIso, -30)
  if (input.activity.lastCompletedLocalDateIso > subscriptionAbsenceCutoffDateIso) {
    return {
      eligible: false,
      reason: 'NOT_INACTIVE_YET',
    }
  }

  return {
    eligible: true,
    reason: 'ELIGIBLE',
  }
}

export function buildCampaignDeliveryDedupeKey(input: {
  campaignType: CampaignAutomationType
  barbershopId: string
  customerId: string
  localDateIso: string
  localYear: number
}) {
  switch (input.campaignType) {
    case CampaignAutomationType.BIRTHDAY:
      return `birthday:${input.barbershopId}:${input.customerId}:${input.localYear}`
    case CampaignAutomationType.WALK_IN_INACTIVE:
      return `walk-in-inactive:${input.barbershopId}:${input.customerId}:${input.localDateIso}`
    case CampaignAutomationType.SUBSCRIPTION_ABSENT:
      return `subscription-absent:${input.barbershopId}:${input.customerId}:${input.localDateIso}`
    default:
      return `campaign:${input.barbershopId}:${input.customerId}:${input.localDateIso}`
  }
}

export function buildCampaignMessagingEventDedupeKey(input: {
  deliveryId: string
}) {
  return `campaign-event:${input.deliveryId}`
}

const MANAGEMENT_CAMPAIGN_TYPES = [
  CampaignAutomationType.BIRTHDAY,
  CampaignAutomationType.WALK_IN_INACTIVE,
  CampaignAutomationType.SUBSCRIPTION_ABSENT,
] as const

type CampaignResultSnapshot = {
  eligibleCustomers: number
  deliveriesCreated: number
  deliveriesSent: number
  deliveriesFailed: number
  deliveriesSkipped: number
}

function asAutomationRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asAutomationNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isKnownCampaignType(value: unknown): value is CampaignAutomationType {
  return (
    value === CampaignAutomationType.BIRTHDAY
    || value === CampaignAutomationType.WALK_IN_INACTIVE
    || value === CampaignAutomationType.SUBSCRIPTION_ABSENT
  )
}

function calculateDeliveryRate(sent: number, failed: number) {
  const totalFinished = sent + failed
  return totalFinished > 0 ? (sent / totalFinished) * 100 : null
}

function extractCampaignResultsFromRunSummary(summary: unknown) {
  const summaryRecord = asAutomationRecord(summary)
  const rawResults = Array.isArray(summaryRecord?.campaignResults)
    ? summaryRecord.campaignResults
    : []

  const results = new Map<CampaignAutomationType, CampaignResultSnapshot>()

  rawResults.forEach((rawResult) => {
    const record = asAutomationRecord(rawResult)
    if (!record) {
      return
    }

    const campaignType = record.campaignType

    if (!isKnownCampaignType(campaignType)) {
      return
    }

    results.set(campaignType, {
      eligibleCustomers: asAutomationNumber(record.eligibleCustomers),
      deliveriesCreated: asAutomationNumber(record.deliveriesCreated),
      deliveriesSent: asAutomationNumber(record.deliveriesSent),
      deliveriesFailed: asAutomationNumber(record.deliveriesFailed),
      deliveriesSkipped: asAutomationNumber(record.deliveriesSkipped),
    })
  })

  return results
}

function extractRunTotalsFromSummary(summary: unknown) {
  const summaryRecord = asAutomationRecord(summary)
  const totalsRecord = asAutomationRecord(summaryRecord?.totals)

  return {
    deliveriesSent: asAutomationNumber(totalsRecord?.deliveriesSent),
    deliveriesFailed: asAutomationNumber(totalsRecord?.deliveriesFailed),
    deliveriesSkipped: asAutomationNumber(totalsRecord?.deliveriesSkipped),
  }
}

function buildNextAutomationWindow(input: {
  localDateIso: string
  dueToday: boolean
  alreadyRanToday: boolean
}) {
  if (input.dueToday && input.alreadyRanToday) {
    return {
      localDateIso: shiftIsoDate(input.localDateIso, 1),
      timeLabel: '09:00',
      description: 'Proxima execucao diaria esperada.',
    }
  }

  if (input.dueToday) {
    return {
      localDateIso: input.localDateIso,
      timeLabel: '09:00',
      description: 'Janela de hoje ja esta aberta.',
    }
  }

  return {
    localDateIso: input.localDateIso,
    timeLabel: '09:00',
    description: 'Execucao prevista para hoje.',
  }
}

async function countEligibleCustomersForManagementPanel(input: {
  barbershopId: string
  campaignType: CampaignAutomationType
  localDateIso: string
  localYear: number
  cooldownDays: number
  timezone: string
  referenceDate: Date
}) {
  const baseCustomers = await getBaseCustomersForCampaign({
    barbershopId: input.barbershopId,
    campaignType: input.campaignType,
  })

  if (baseCustomers.length === 0) {
    return 0
  }

  const activity = await loadCustomerActivity({
    barbershopId: input.barbershopId,
    customerIds: baseCustomers.map((customer) => customer.id),
    campaignType: input.campaignType,
    localDateIso: input.localDateIso,
    timezone: input.timezone,
    cooldownDays: input.cooldownDays,
    referenceDate: input.referenceDate,
  })

  return baseCustomers.filter((customer) =>
    evaluateCampaignEligibility({
      campaignType: input.campaignType,
      localDateIso: input.localDateIso,
      localYear: input.localYear,
      cooldownDays: input.cooldownDays,
      customer,
      activity: {
        lastCompletedLocalDateIso: activity.lastCompletedByCustomerId.get(customer.id) ?? null,
        hasFutureAppointment: activity.futureAppointmentCustomerIds.has(customer.id),
        latestSentLocalDateIso: activity.latestSentByCustomerId.get(customer.id) ?? null,
      },
    }).eligible
  ).length
}

function describeCampaignBenefit(input: {
  benefitType: CampaignAutomationBenefitType | null | undefined
  benefitDescription: string | null | undefined
}) {
  if (!input.benefitDescription?.trim()) {
    return null
  }

  return input.benefitDescription.trim()
}

export function buildCampaignFallbackMessage(input: {
  campaignType: CampaignAutomationType
  customerName: string
  barbershopName: string
  benefitType: CampaignAutomationBenefitType | null | undefined
  benefitDescription: string | null | undefined
}) {
  const firstName = getCustomerFirstName(input.customerName)
  const benefit = describeCampaignBenefit({
    benefitType: input.benefitType,
    benefitDescription: input.benefitDescription,
  })

  if (input.campaignType === CampaignAutomationType.BIRTHDAY) {
    return [
      `Oi, ${firstName}! Feliz aniversario!`,
      `Aqui na ${input.barbershopName}, separamos ${benefit ?? 'um mimo especial para voce hoje'}.`,
      'Se quiser aproveitar, me responde aqui que eu te ajudo a agendar.',
    ].join(' ')
  }

  if (input.campaignType === CampaignAutomationType.WALK_IN_INACTIVE) {
    return [
      `Oi, ${firstName}! Passando para lembrar que a ${input.barbershopName} esta com saudade de te ver por aqui.`,
      benefit
        ? `Para facilitar seu retorno, deixamos ${benefit}.`
        : 'Se fizer sentido, posso te passar alguns horarios para esta semana.',
      'Se quiser, eu ja vejo um horario para voce.',
    ].join(' ')
  }

  return [
    `Oi, ${firstName}! Notei que faz um tempinho desde seu ultimo uso da assinatura na ${input.barbershopName}.`,
    benefit
      ? `Temos ${benefit} para estimular seu retorno.`
      : 'Sua rotina de cuidado esta te esperando por aqui.',
    'Se quiser, eu posso te ajudar a reagendar ainda hoje.',
  ].join(' ')
}

function buildCampaignAiPrompt(input: {
  campaignType: CampaignAutomationType
  customerName: string
  barbershopName: string
  benefitDescription: string | null
  fallbackMessage: string
}) {
  return [
    'Voce escreve mensagens curtas de relacionamento comercial para uma barbearia premium.',
    'A elegibilidade ja foi decidida pelo backend. Voce NAO decide quem recebe.',
    'Escreva somente uma mensagem curta para WhatsApp, em portugues, natural, profissional e proxima.',
    'Nao use emoji. Nao use markdown. Nao invente horarios, descontos ou regras fora do que foi passado.',
    'Sempre termine com um CTA simples para o cliente responder e reagendar.',
    `Campanha: ${input.campaignType}`,
    `Barbearia: ${input.barbershopName}`,
    `Cliente: ${input.customerName}`,
    `Beneficio: ${input.benefitDescription ?? 'nenhum beneficio extra explicitado'}`,
    `Fallback de seguranca: ${input.fallbackMessage}`,
  ].join('\n')
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const directOutput = (payload as { output_text?: unknown }).output_text
  if (typeof directOutput === 'string' && directOutput.trim()) {
    return directOutput.trim()
  }

  const output = Array.isArray((payload as { output?: unknown }).output)
    ? (payload as { output: Array<{ content?: Array<{ text?: string }> }> }).output
    : []

  const parts = output
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((item) => (typeof item.text === 'string' ? item.text.trim() : ''))
    .filter(Boolean)

  return parts.length > 0 ? parts.join('\n').trim() : null
}

async function generateCampaignMessageWithAI(input: {
  campaignType: CampaignAutomationType
  customerName: string
  barbershopName: string
  benefitDescription: string | null
  fallbackMessage: string
}): Promise<{ message: string | null; failureReason: OpenAIFailureReason | null }> {
  const config = getOpenAIMessageConfig()
  if (!config) {
    return {
      message: null,
      failureReason: 'disabled',
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
        max_output_tokens: 220,
        input: [
          {
            role: 'user',
            content: buildCampaignAiPrompt(input),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'barbermain_campaign_message',
            strict: true,
            schema: CAMPAIGN_MESSAGE_JSON_SCHEMA,
          },
        },
      }),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        message: null,
        failureReason: 'bad_status',
      }
    }

    const payload = await response.json()
    const outputText = extractResponseText(payload)

    if (!outputText) {
      return {
        message: null,
        failureReason: 'invalid_payload',
      }
    }

    let parsedJson: unknown

    try {
      parsedJson = JSON.parse(outputText)
    } catch {
      return {
        message: null,
        failureReason: 'invalid_json',
      }
    }

    const parsed = CAMPAIGN_MESSAGE_SCHEMA.safeParse(parsedJson)
    if (!parsed.success) {
      return {
        message: null,
        failureReason: 'invalid_schema',
      }
    }

    return {
      message: parsed.data.message.trim(),
      failureReason: null,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        message: null,
        failureReason: 'timeout',
      }
    }

    return {
      message: null,
      failureReason: 'request_failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function ensureCampaignConfigsForBarbershop(barbershopId: string) {
  const configs = await Promise.all(
    Object.entries(DEFAULT_CAMPAIGN_CONFIGS).map(async ([campaignType, definition]) => (
      prisma.campaignAutomationConfig.upsert({
        where: {
          barbershopId_campaignType: {
            barbershopId,
            campaignType: campaignType as CampaignAutomationType,
          },
        },
        update: {},
        create: {
          barbershopId,
          campaignType: campaignType as CampaignAutomationType,
          active: definition.active,
          cooldownDays: definition.cooldownDays,
          benefitType: definition.benefitType,
          benefitDescription: definition.benefitDescription,
        },
      })
    ))
  )

  return configs.sort((left, right) => left.campaignType.localeCompare(right.campaignType))
}

async function getBaseCustomersForCampaign(input: {
  barbershopId: string
  campaignType: CampaignAutomationType
}) {
  const baseWhere: Prisma.CustomerWhereInput = {
    barbershopId: input.barbershopId,
    active: true,
    phone: { not: null },
    marketingOptOutAt: null,
  }

  if (input.campaignType === CampaignAutomationType.BIRTHDAY) {
    baseWhere.birthDate = { not: null }
  }

  if (input.campaignType === CampaignAutomationType.WALK_IN_INACTIVE) {
    baseWhere.type = 'WALK_IN'
  }

  if (input.campaignType === CampaignAutomationType.SUBSCRIPTION_ABSENT) {
    baseWhere.type = 'SUBSCRIPTION'
    baseWhere.subscriptionStatus = 'ACTIVE'
  }

  return prisma.customer.findMany({
    where: baseWhere,
    select: {
      id: true,
      name: true,
      phone: true,
      type: true,
      subscriptionStatus: true,
      birthDate: true,
      marketingOptOutAt: true,
      active: true,
    },
  })
}

async function loadCustomerActivity(input: {
  barbershopId: string
  customerIds: string[]
  campaignType: CampaignAutomationType
  localDateIso: string
  timezone: string
  cooldownDays: number
  referenceDate: Date
}) {
  if (input.customerIds.length === 0) {
    return {
      lastCompletedByCustomerId: new Map<string, string | null>(),
      futureAppointmentCustomerIds: new Set<string>(),
      latestSentByCustomerId: new Map<string, string | null>(),
    }
  }

  const [lastCompletedAppointments, futureAppointments, sentDeliveries] = await Promise.all([
    prisma.appointment.groupBy({
      by: ['customerId'],
      where: {
        barbershopId: input.barbershopId,
        customerId: { in: input.customerIds },
        status: 'COMPLETED',
      },
      _max: {
        completedAt: true,
        startAt: true,
      },
    }),
    prisma.appointment.findMany({
      where: {
        barbershopId: input.barbershopId,
        customerId: { in: input.customerIds },
        status: { in: ['PENDING', 'CONFIRMED'] },
        startAt: { gte: input.referenceDate },
      },
      distinct: ['customerId'],
      select: {
        customerId: true,
      },
    }),
    prisma.campaignAutomationDelivery.findMany({
      where: {
        barbershopId: input.barbershopId,
        customerId: { in: input.customerIds },
        campaignType: input.campaignType,
        status: CampaignAutomationDeliveryStatus.SENT,
      },
      select: {
        customerId: true,
        sentAt: true,
      },
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
    }),
  ])

  const lastCompletedByCustomerId = new Map<string, string | null>()
  lastCompletedAppointments.forEach((item) => {
    const referenceDate = item._max.completedAt ?? item._max.startAt ?? null
    lastCompletedByCustomerId.set(
      item.customerId,
      referenceDate ? formatIsoDateInTimezone(referenceDate, input.timezone) : null
    )
  })

  const futureAppointmentCustomerIds = new Set(futureAppointments.map((item) => item.customerId))

  const latestSentByCustomerId = new Map<string, string | null>()
  sentDeliveries.forEach((item) => {
    if (!item.sentAt || latestSentByCustomerId.has(item.customerId)) {
      return
    }

    latestSentByCustomerId.set(
      item.customerId,
      formatIsoDateInTimezone(item.sentAt, input.timezone)
    )
  })

  return {
    lastCompletedByCustomerId,
    futureAppointmentCustomerIds,
    latestSentByCustomerId,
  }
}

async function createCampaignDeliveryRecord(input: {
  runId: string
  config: CampaignAutomationConfig
  customer: CampaignCustomerSnapshot
  barbershopId: string
  destinationPhone: string
  dedupeKey: string
  fallbackMessage: string
}) {
  try {
    const delivery = await prisma.campaignAutomationDelivery.create({
      data: {
        runId: input.runId,
        configId: input.config.id,
        barbershopId: input.barbershopId,
        customerId: input.customer.id,
        campaignType: input.config.campaignType,
        destinationPhone: input.destinationPhone,
        dedupeKey: input.dedupeKey,
        status: CampaignAutomationDeliveryStatus.PENDING,
        benefitType: input.config.benefitType,
        benefitDescription: input.config.benefitDescription,
        fallbackMessage: input.fallbackMessage,
        metadata: {
          customerName: input.customer.name,
        } as Prisma.InputJsonValue,
      },
      select: {
        id: true,
      },
    })

    return delivery.id
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002'
    ) {
      return null
    }

    throw error
  }
}

async function createAutomationMessagingEvent(input: {
  barbershopId: string
  customerId: string
  phone: string
  campaignType: CampaignAutomationType
  deliveryDedupeKey: string
  message: string
  usedAi: boolean
  benefitDescription: string | null
  deliveryId: string
  runId: string
  providerPayload: unknown
  status: 'PROCESSED' | 'FAILED'
  errorMessage?: string | null
}) {
  const dedupeKey = buildCampaignMessagingEventDedupeKey({
    deliveryId: input.deliveryId,
  })

  const event = await prisma.messagingEvent.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      provider: MessagingProvider.EVOLUTION,
      direction: 'OUTBOUND',
      status: input.status,
      eventType: `CAMPAIGN_${input.campaignType}`,
      instanceName: getSafeEvolutionInstanceName(),
      dedupeKey,
      remotePhone: input.phone,
      bodyText: input.message,
      responseText: input.status === 'PROCESSED' ? input.message : null,
      lastError: input.errorMessage ?? null,
      payload: {
        source: 'campaign-automation',
        campaignType: input.campaignType,
        deliveryId: input.deliveryId,
        deliveryDedupeKey: input.deliveryDedupeKey,
        runId: input.runId,
        usedAi: input.usedAi,
        benefitDescription: input.benefitDescription,
        providerPayload: input.providerPayload,
      } as Prisma.InputJsonValue,
      processedAt: new Date(),
    },
    select: {
      id: true,
    },
  })

  return event.id
}

async function prepareDeliveryMessage(input: {
  config: CampaignAutomationConfig
  customer: CampaignCustomerSnapshot
  barbershopName: string
}): Promise<DeliveryPreparation> {
  const normalizedPhone = normalizeEvolutionPhoneNumber(input.customer.phone)

  if (!normalizedPhone) {
    throw new Error('Telefone invalido para campanha automatica.')
  }

  const fallbackMessage = buildCampaignFallbackMessage({
    campaignType: input.config.campaignType,
    customerName: input.customer.name,
    barbershopName: input.barbershopName,
    benefitType: input.config.benefitType,
    benefitDescription: input.config.benefitDescription,
  })

  const aiAttempt = await generateCampaignMessageWithAI({
    campaignType: input.config.campaignType,
    customerName: input.customer.name,
    barbershopName: input.barbershopName,
    benefitDescription: input.config.benefitDescription ?? null,
    fallbackMessage,
  })

  return {
    customer: input.customer,
    normalizedPhone,
    fallbackMessage,
    finalMessage: aiAttempt.message ?? fallbackMessage,
    usedAi: Boolean(aiAttempt.message),
    aiFailureReason: aiAttempt.failureReason,
  }
}

async function processCampaignType(input: {
  runId: string
  config: CampaignAutomationConfig
  barbershop: {
    id: string
    name: string
    slug: string
    timezone: string
  }
  localDateIso: string
  localYear: number
  referenceDate: Date
}) {
  const baseCustomers = await getBaseCustomersForCampaign({
    barbershopId: input.barbershop.id,
    campaignType: input.config.campaignType,
  })

  const activity = await loadCustomerActivity({
    barbershopId: input.barbershop.id,
    customerIds: baseCustomers.map((customer) => customer.id),
    campaignType: input.config.campaignType,
    localDateIso: input.localDateIso,
    timezone: input.barbershop.timezone,
    cooldownDays: input.config.cooldownDays,
    referenceDate: input.referenceDate,
  })

  const eligibleCustomers = baseCustomers.filter((customer) =>
    evaluateCampaignEligibility({
      campaignType: input.config.campaignType,
      localDateIso: input.localDateIso,
      localYear: input.localYear,
      cooldownDays: input.config.cooldownDays,
      customer,
      activity: {
        lastCompletedLocalDateIso: activity.lastCompletedByCustomerId.get(customer.id) ?? null,
        hasFutureAppointment: activity.futureAppointmentCustomerIds.has(customer.id),
        latestSentLocalDateIso: activity.latestSentByCustomerId.get(customer.id) ?? null,
      },
    }).eligible
  )

  let deliveriesCreated = 0
  let deliveriesSent = 0
  let deliveriesFailed = 0
  let deliveriesSkipped = 0

  for (const customer of eligibleCustomers) {
    let prepared: DeliveryPreparation

    try {
      prepared = await prepareDeliveryMessage({
        config: input.config,
        customer,
        barbershopName: input.barbershop.name,
      })
    } catch (error) {
      deliveriesSkipped += 1

      logCampaignError('delivery_preparation_failed', {
        campaignType: input.config.campaignType,
        barbershopSlug: input.barbershop.slug,
        customerId: customer.id,
        error: error instanceof Error ? error.message : String(error),
      })

      continue
    }

    const dedupeKey = buildCampaignDeliveryDedupeKey({
      campaignType: input.config.campaignType,
      barbershopId: input.barbershop.id,
      customerId: customer.id,
      localDateIso: input.localDateIso,
      localYear: input.localYear,
    })

    const deliveryId = await createCampaignDeliveryRecord({
      runId: input.runId,
      config: input.config,
      customer,
      barbershopId: input.barbershop.id,
      destinationPhone: prepared.normalizedPhone,
      dedupeKey,
      fallbackMessage: prepared.fallbackMessage,
    })

    if (!deliveryId) {
      deliveriesSkipped += 1
      continue
    }

    deliveriesCreated += 1

    try {
      const providerPayload = await sendTextMessage({
        number: prepared.normalizedPhone,
        text: prepared.finalMessage,
      })

      const messagingEventId = await createAutomationMessagingEvent({
        barbershopId: input.barbershop.id,
        customerId: customer.id,
        phone: prepared.normalizedPhone,
        campaignType: input.config.campaignType,
        deliveryDedupeKey: dedupeKey,
        message: prepared.finalMessage,
        usedAi: prepared.usedAi,
        benefitDescription: input.config.benefitDescription ?? null,
        deliveryId,
        runId: input.runId,
        providerPayload,
        status: 'PROCESSED',
      })

      await prisma.campaignAutomationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: CampaignAutomationDeliveryStatus.SENT,
          usedAi: prepared.usedAi,
          generatedMessage: prepared.finalMessage,
          fallbackMessage: prepared.fallbackMessage,
          sentAt: new Date(),
          lastError: prepared.aiFailureReason ? `ai_fallback:${prepared.aiFailureReason}` : null,
          messagingEventId,
          metadata: {
            customerName: customer.name,
            customerPhoneHash: hashValue(prepared.normalizedPhone),
            aiFailureReason: prepared.aiFailureReason,
            lastCompletedLocalDateIso: activity.lastCompletedByCustomerId.get(customer.id) ?? null,
            hasFutureAppointment: activity.futureAppointmentCustomerIds.has(customer.id),
          } as Prisma.InputJsonValue,
        },
      })

      deliveriesSent += 1

      logCampaign('delivery_sent', {
        campaignType: input.config.campaignType,
        barbershopSlug: input.barbershop.slug,
        customerId: customer.id,
        usedAi: prepared.usedAi,
      })
    } catch (error) {
      const diagnostics = buildDeliveryFailureDiagnostics(error)
      const message = diagnostics.message
      const messagingEventId = await createAutomationMessagingEvent({
        barbershopId: input.barbershop.id,
        customerId: customer.id,
        phone: prepared.normalizedPhone,
        campaignType: input.config.campaignType,
        deliveryDedupeKey: dedupeKey,
        message: prepared.finalMessage,
        usedAi: prepared.usedAi,
        benefitDescription: input.config.benefitDescription ?? null,
        deliveryId,
        runId: input.runId,
        providerPayload: diagnostics,
        status: 'FAILED',
        errorMessage: message,
      })

      await prisma.campaignAutomationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: CampaignAutomationDeliveryStatus.FAILED,
          usedAi: prepared.usedAi,
          generatedMessage: prepared.finalMessage,
          fallbackMessage: prepared.fallbackMessage,
          lastError: message,
          messagingEventId,
          metadata: {
            customerName: customer.name,
            customerPhoneHash: hashValue(prepared.normalizedPhone),
            aiFailureReason: prepared.aiFailureReason,
            lastCompletedLocalDateIso: activity.lastCompletedByCustomerId.get(customer.id) ?? null,
            hasFutureAppointment: activity.futureAppointmentCustomerIds.has(customer.id),
            failureDiagnostics: diagnostics,
          } as Prisma.InputJsonValue,
        },
      })

      deliveriesFailed += 1

      logCampaignError('delivery_failed', {
        campaignType: input.config.campaignType,
        barbershopSlug: input.barbershop.slug,
        customerId: customer.id,
        error: message,
        diagnostics,
      })
    }
  }

  return {
    campaignType: input.config.campaignType,
    eligibleCustomers: eligibleCustomers.length,
    deliveriesCreated,
    deliveriesSent,
    deliveriesFailed,
    deliveriesSkipped,
  }
}

async function createDailyRunRecord(input: {
  barbershopId: string
  localDateIso: string
  timezone: string
  trigger: CampaignAutomationTrigger
}): Promise<DailyRunRecordResult> {
  const where = {
    barbershopId_localDateIso: {
      barbershopId: input.barbershopId,
      localDateIso: input.localDateIso,
    },
  } as const

  const existingRun = await prisma.campaignAutomationRun.findUnique({
    where,
    select: {
      id: true,
      status: true,
    },
  })

  if (existingRun) {
    return {
      id: existingRun.id,
      created: false,
      status: existingRun.status,
    }
  }

  try {
    const createdRun = await prisma.campaignAutomationRun.create({
      data: {
        barbershopId: input.barbershopId,
        localDateIso: input.localDateIso,
        timezone: input.timezone,
        trigger: input.trigger,
        status: CampaignAutomationRunStatus.RUNNING,
      },
      select: {
        id: true,
      },
    })

    return {
      id: createdRun.id,
      created: true,
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002'
    ) {
      const racedRun = await prisma.campaignAutomationRun.findUnique({
        where,
        select: {
          id: true,
          status: true,
        },
      })

      if (racedRun) {
        return {
          id: racedRun.id,
          created: false,
          status: racedRun.status,
        }
      }
    }

    throw error
  }
}

export async function getCampaignAutomationManagementData(input: {
  barbershopId: string
  referenceDate?: Date
}): Promise<CampaignAutomationManagementData> {
  const referenceDate = input.referenceDate ?? new Date()
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: input.barbershopId },
    select: {
      id: true,
      timezone: true,
    },
  })

  if (!barbershop) {
    throw new Error('Barbearia nao encontrada para o painel de campanhas automaticas.')
  }

  const timezone = resolveBusinessTimezone(barbershop.timezone)
  const localNow = getCurrentDateTimeInTimezone(timezone, referenceDate)
  const localDateIso = localNow.dateIso
  const dueToday = shouldRunDailyCampaignAtLocalTime(localNow)

  const [
    configs,
    todayRun,
    latestRun,
    todayDeliveries,
    recentDeliveries,
    recentSentDeliveries,
  ] = await Promise.all([
    prisma.campaignAutomationConfig.findMany({
      where: { barbershopId: input.barbershopId },
      orderBy: { campaignType: 'asc' },
    }),
    prisma.campaignAutomationRun.findUnique({
      where: {
        barbershopId_localDateIso: {
          barbershopId: input.barbershopId,
          localDateIso,
        },
      },
      select: {
        id: true,
        localDateIso: true,
        status: true,
        startedAt: true,
        completedAt: true,
        summary: true,
      },
    }),
    prisma.campaignAutomationRun.findFirst({
      where: { barbershopId: input.barbershopId },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        localDateIso: true,
        status: true,
        startedAt: true,
        completedAt: true,
        summary: true,
      },
    }),
    prisma.campaignAutomationDelivery.findMany({
      where: {
        barbershopId: input.barbershopId,
        run: { localDateIso },
      },
      select: {
        campaignType: true,
        status: true,
        usedAi: true,
      },
    }),
    prisma.campaignAutomationDelivery.findMany({
      where: { barbershopId: input.barbershopId },
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
      take: 8,
      select: {
        id: true,
        campaignType: true,
        benefitDescription: true,
        status: true,
        sentAt: true,
        createdAt: true,
        usedAi: true,
        generatedMessage: true,
        fallbackMessage: true,
        customer: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.campaignAutomationDelivery.findMany({
      where: {
        barbershopId: input.barbershopId,
        status: CampaignAutomationDeliveryStatus.SENT,
        sentAt: {
          gte: new Date(referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      select: {
        customerId: true,
        sentAt: true,
      },
    }),
  ])

  const configByType = new Map(configs.map((config) => [config.campaignType, config]))
  const todayResultsByType = extractCampaignResultsFromRunSummary(todayRun?.summary)

  const campaignSummaries = await Promise.all(
    MANAGEMENT_CAMPAIGN_TYPES.map(async (campaignType) => {
      const config = configByType.get(campaignType)
      const defaultConfig = DEFAULT_CAMPAIGN_CONFIGS[campaignType]
      const summaryResult = todayResultsByType.get(campaignType)
      const deliveries = todayDeliveries.filter((delivery) => delivery.campaignType === campaignType)
      const sent = deliveries.filter((delivery) => delivery.status === CampaignAutomationDeliveryStatus.SENT).length
      const failed = deliveries.filter((delivery) => delivery.status === CampaignAutomationDeliveryStatus.FAILED).length
      const skippedByDeliveryStatus = deliveries.filter((delivery) => delivery.status === CampaignAutomationDeliveryStatus.SKIPPED).length
      const usedAiCount = deliveries.filter((delivery) => delivery.usedAi).length
      const fallbackCount = deliveries.filter((delivery) => (
        delivery.status === CampaignAutomationDeliveryStatus.SENT && !delivery.usedAi
      )).length

      const eligibleCustomers = summaryResult
        ? summaryResult.eligibleCustomers
        : await countEligibleCustomersForManagementPanel({
            barbershopId: input.barbershopId,
            campaignType,
            localDateIso,
            localYear: localNow.year,
            cooldownDays: config?.cooldownDays ?? defaultConfig.cooldownDays,
            timezone,
            referenceDate,
          })

      return {
        campaignType,
        active: config?.active ?? defaultConfig.active,
        benefitDescription: config?.benefitDescription ?? defaultConfig.benefitDescription,
        eligibleCustomers,
        deliveriesCreated: summaryResult?.deliveriesCreated ?? deliveries.length,
        deliveriesSent: sent,
        deliveriesFailed: failed,
        deliveriesSkipped: summaryResult?.deliveriesSkipped ?? skippedByDeliveryStatus,
        deliveryRate: calculateDeliveryRate(sent, failed),
        usedAiCount,
        fallbackCount,
      }
    })
  )

  const todayTotals = campaignSummaries.reduce(
    (accumulator, item) => ({
      eligibleCustomers: accumulator.eligibleCustomers + item.eligibleCustomers,
      deliveriesCreated: accumulator.deliveriesCreated + item.deliveriesCreated,
      deliveriesSent: accumulator.deliveriesSent + item.deliveriesSent,
      deliveriesFailed: accumulator.deliveriesFailed + item.deliveriesFailed,
      deliveriesSkipped: accumulator.deliveriesSkipped + item.deliveriesSkipped,
      deliveryRate: null,
    }),
    {
      eligibleCustomers: 0,
      deliveriesCreated: 0,
      deliveriesSent: 0,
      deliveriesFailed: 0,
      deliveriesSkipped: 0,
      deliveryRate: null as number | null,
    }
  )
  todayTotals.deliveryRate = calculateDeliveryRate(todayTotals.deliveriesSent, todayTotals.deliveriesFailed)

  const activeConfigs = campaignSummaries.filter((summary) => summary.active).length
  const enabled = isCampaignAutomationEnabled()
  const status: CampaignAutomationManagementData['status'] = !enabled || activeConfigs === 0
    ? 'inactive'
    : todayRun?.status === CampaignAutomationRunStatus.FAILED
      ? 'attention'
      : 'active'
  const statusLabel = status === 'active'
    ? 'Ativa'
    : status === 'attention'
      ? 'Atenção'
      : 'Inativa'
  const statusDescription = status === 'active'
    ? 'A rotina diaria esta habilitada e pronta para relacionamento automatico.'
    : status === 'attention'
      ? 'A ultima execucao de hoje falhou e merece revisao antes da proxima janela.'
      : 'A automacao nao esta habilitada para disparos diarios agora.'

  const latestRunTotals = latestRun ? extractRunTotalsFromSummary(latestRun.summary) : null
  const earliestSentAtByCustomerId = new Map<string, Date>()
  recentSentDeliveries.forEach((delivery) => {
    if (!delivery.sentAt) {
      return
    }

    const current = earliestSentAtByCustomerId.get(delivery.customerId)
    if (!current || delivery.sentAt < current) {
      earliestSentAtByCustomerId.set(delivery.customerId, delivery.sentAt)
    }
  })

  const impactedCustomerIds = Array.from(earliestSentAtByCustomerId.keys())
  const impactWindowStart = new Date(referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000)
  const [responseEvents, rebookedAppointments] = impactedCustomerIds.length > 0
    ? await Promise.all([
        prisma.messagingEvent.findMany({
          where: {
            barbershopId: input.barbershopId,
            customerId: { in: impactedCustomerIds },
            direction: MessagingDirection.INBOUND,
            createdAt: { gte: impactWindowStart },
          },
          select: {
            customerId: true,
            createdAt: true,
          },
        }),
        prisma.appointment.findMany({
          where: {
            barbershopId: input.barbershopId,
            customerId: { in: impactedCustomerIds },
            source: AppointmentSource.WHATSAPP,
            createdAt: { gte: impactWindowStart },
          },
          select: {
            customerId: true,
            createdAt: true,
          },
        }),
      ])
    : [[], []] as const

  const respondedCustomers = new Set<string>()
  responseEvents.forEach((event) => {
    if (!event.customerId) {
      return
    }

    const firstCampaignSentAt = earliestSentAtByCustomerId.get(event.customerId)
    if (firstCampaignSentAt && event.createdAt >= firstCampaignSentAt) {
      respondedCustomers.add(event.customerId)
    }
  })

  const rebookedCustomers = new Set<string>()
  rebookedAppointments.forEach((appointment) => {
    const firstCampaignSentAt = earliestSentAtByCustomerId.get(appointment.customerId)
    if (firstCampaignSentAt && appointment.createdAt >= firstCampaignSentAt) {
      rebookedCustomers.add(appointment.customerId)
    }
  })

  return {
    enabled,
    status,
    statusLabel,
    statusDescription,
    executionTimeLabel: '09:00',
    localDateIso,
    timezone,
    lastRun: latestRun
      ? {
          localDateIso: latestRun.localDateIso,
          status: latestRun.status,
          startedAt: latestRun.startedAt,
          completedAt: latestRun.completedAt,
          deliveriesSent: latestRunTotals?.deliveriesSent ?? 0,
          deliveriesFailed: latestRunTotals?.deliveriesFailed ?? 0,
          deliveriesSkipped: latestRunTotals?.deliveriesSkipped ?? 0,
        }
      : null,
    nextWindow: buildNextAutomationWindow({
      localDateIso,
      dueToday,
      alreadyRanToday: Boolean(todayRun),
    }),
    todayTotals,
    campaignSummaries,
    recentDeliveries: recentDeliveries.map((delivery) => ({
      id: delivery.id,
      customerName: delivery.customer.name,
      campaignType: delivery.campaignType,
      benefitDescription: delivery.benefitDescription,
      status: delivery.status,
      sentAt: delivery.sentAt,
      createdAt: delivery.createdAt,
      usedAi: delivery.usedAi,
      usedFallback: !delivery.usedAi && Boolean(delivery.generatedMessage ?? delivery.fallbackMessage),
    })),
    estimatedImpact: {
      windowDays: 30,
      respondedCustomers: respondedCustomers.size,
      rebookedCustomers: rebookedCustomers.size,
    },
  }
}

async function executeDailyRunForBarbershop(input: {
  barbershop: {
    id: string
    name: string
    slug: string
    timezone: string
    active: boolean
  }
  referenceDate: Date
  trigger: CampaignAutomationTrigger
}) {
  const timezone = resolveBusinessTimezone(input.barbershop.timezone)
  const localNow = getCurrentDateTimeInTimezone(timezone, input.referenceDate)

  if (!shouldRunDailyCampaignAtLocalTime(localNow)) {
    return {
      outcome: 'skipped' as const,
      reason: 'not_due_yet',
      localDateIso: localNow.dateIso,
      timezone,
    }
  }

  const run = await createDailyRunRecord({
    barbershopId: input.barbershop.id,
    localDateIso: localNow.dateIso,
    timezone,
    trigger: input.trigger,
  })

  if (!run.created) {
    return {
      outcome: 'skipped' as const,
      reason: describeExistingDailyRunReason(run.status),
      localDateIso: localNow.dateIso,
      timezone,
    }
  }

  logCampaign('run_started', {
    barbershopSlug: input.barbershop.slug,
    localDateIso: localNow.dateIso,
    timezone,
  })

  try {
    const configs = await ensureCampaignConfigsForBarbershop(input.barbershop.id)
    const activeConfigs = configs.filter((config) => config.active)

    if (activeConfigs.length === 0) {
      await prisma.campaignAutomationRun.update({
        where: { id: run.id },
        data: {
          status: CampaignAutomationRunStatus.SKIPPED,
          completedAt: new Date(),
          summary: {
            reason: 'no_active_configs',
            localDateIso: localNow.dateIso,
          } as Prisma.InputJsonValue,
        },
      })

      return {
        outcome: 'skipped' as const,
        reason: 'no_active_configs',
        localDateIso: localNow.dateIso,
        timezone,
      }
    }

    const results = []
    for (const config of activeConfigs) {
      results.push(await processCampaignType({
        runId: run.id,
        config,
        barbershop: {
          id: input.barbershop.id,
          name: input.barbershop.name,
          slug: input.barbershop.slug,
          timezone,
        },
        localDateIso: localNow.dateIso,
        localYear: localNow.year,
        referenceDate: input.referenceDate,
      }))
    }

    const totals = results.reduce(
      (accumulator, result) => ({
        deliveriesCreated: accumulator.deliveriesCreated + result.deliveriesCreated,
        deliveriesSent: accumulator.deliveriesSent + result.deliveriesSent,
        deliveriesFailed: accumulator.deliveriesFailed + result.deliveriesFailed,
        deliveriesSkipped: accumulator.deliveriesSkipped + result.deliveriesSkipped,
        eligibleCustomers: accumulator.eligibleCustomers + result.eligibleCustomers,
      }),
      {
        deliveriesCreated: 0,
        deliveriesSent: 0,
        deliveriesFailed: 0,
        deliveriesSkipped: 0,
        eligibleCustomers: 0,
      }
    )

    await prisma.campaignAutomationRun.update({
      where: { id: run.id },
      data: {
        status: CampaignAutomationRunStatus.COMPLETED,
        completedAt: new Date(),
        summary: {
          totals,
          campaignResults: results,
        } as Prisma.InputJsonValue,
      },
    })

    logCampaign('run_completed', {
      barbershopSlug: input.barbershop.slug,
      localDateIso: localNow.dateIso,
      totals,
    })

    return {
      outcome: 'processed' as const,
      reason: 'processed',
      localDateIso: localNow.dateIso,
      timezone,
      totals,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await prisma.campaignAutomationRun.update({
      where: { id: run.id },
      data: {
        status: CampaignAutomationRunStatus.FAILED,
        completedAt: new Date(),
        lastError: message,
      },
    })

    logCampaignError('run_failed', {
      barbershopSlug: input.barbershop.slug,
      localDateIso: localNow.dateIso,
      error: message,
    })

    return {
      outcome: 'failed' as const,
      reason: message,
      localDateIso: localNow.dateIso,
      timezone,
    }
  }
}

export async function runDueCustomerCampaignAutomation(input?: {
  referenceDate?: Date
  trigger?: CampaignAutomationTrigger
}) {
  const referenceDate = input?.referenceDate ?? new Date()
  const trigger = input?.trigger ?? CampaignAutomationTrigger.SCHEDULER

  if (!isCampaignAutomationEnabled()) {
    return {
      checkedBarbershops: 0,
      dueBarbershops: 0,
      createdRuns: 0,
      skippedRuns: 0,
      failedRuns: 0,
      deliveriesCreated: 0,
      deliveriesSent: 0,
      deliveriesFailed: 0,
      deliveriesSkipped: 0,
      barbershops: [],
    } satisfies CampaignAutomationRunSummary
  }

  const barbershops = await prisma.barbershop.findMany({
    where: {
      active: true,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      active: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  })

  const summary: CampaignAutomationRunSummary = {
    checkedBarbershops: barbershops.length,
    dueBarbershops: 0,
    createdRuns: 0,
    skippedRuns: 0,
    failedRuns: 0,
    deliveriesCreated: 0,
    deliveriesSent: 0,
    deliveriesFailed: 0,
    deliveriesSkipped: 0,
    barbershops: [],
  }

  for (const barbershop of barbershops) {
    const localNow = getCurrentDateTimeInTimezone(barbershop.timezone, referenceDate)
    const due = shouldRunDailyCampaignAtLocalTime(localNow)

    if (due) {
      summary.dueBarbershops += 1
    }

    const result = await executeDailyRunForBarbershop({
      barbershop,
      referenceDate,
      trigger,
    })

    if (result.outcome === 'processed' && result.totals) {
      summary.createdRuns += 1
      summary.deliveriesCreated += result.totals.deliveriesCreated
      summary.deliveriesSent += result.totals.deliveriesSent
      summary.deliveriesFailed += result.totals.deliveriesFailed
      summary.deliveriesSkipped += result.totals.deliveriesSkipped
    } else if (result.outcome === 'failed') {
      summary.failedRuns += 1
    } else {
      summary.skippedRuns += 1
    }

    summary.barbershops.push({
      barbershopId: barbershop.id,
      barbershopSlug: barbershop.slug,
      localDateIso: result.localDateIso,
      timezone: result.timezone,
      outcome: result.outcome,
      reason: result.reason,
      totals: result.outcome === 'processed' ? result.totals : undefined,
    })
  }

  return summary
}
