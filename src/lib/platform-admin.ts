import 'server-only'

import type {
  AiChatUsageSource,
  BarbershopSubscriptionStatus,
  CustomerType,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client'
import {
  OPENAI_PRICING_SOURCE_UPDATED_AT,
  OPENAI_PRICING_VERSION,
  convertUsdToBrl,
  getConfiguredOpenAIModelNames,
  getOpenAiUsdBrlRate,
} from '@/lib/ai/openai-pricing'
import { assertPlatformRoleAllowed } from '@/lib/auth'
import { SCHEDULE_END_HOUR, SCHEDULE_START_HOUR } from '@/lib/agendamentos/availability'
import { OPERATIONAL_BLOCK_SOURCE_PREFIX } from '@/lib/agendamentos/operational-blocks'
import { BRAZIL_TIMEZONES } from '@/lib/onboarding'
import { prisma } from '@/lib/prisma'
import { resolveProfessionalAttendanceScope } from '@/lib/professionals/operational-config'
import { safeLog } from '@/lib/security/safe-logger'
import { formatDateTimeInTimezone, resolveBusinessTimezone } from '@/lib/timezone'

const RECENT_ERROR_LIMIT = 8
const RECENT_ACTIVITY_LIMIT = 8

interface PlatformSessionIdentity {
  userId: string
  platformRole?: string | null
}

export type PlatformChecklistStatus = 'complete' | 'pending' | 'attention'

export interface PlatformChecklistItem {
  id: string
  label: string
  detail: string
  status: PlatformChecklistStatus
}

export interface PlatformChecklistGroup {
  id: string
  title: string
  items: PlatformChecklistItem[]
}

export interface PlatformOverviewFilters {
  search?: string | null
  status?: string | null
  plan?: string | null
}

export interface PlatformOverviewData {
  pricing: {
    version: string
    sourceUpdatedAt: Date
    pricedModels: string[]
    usdBrlRate: number | null
  }
  warnings: string[]
  filters: {
    search: string
    status: string
    plan: string
    availablePlans: string[]
  }
  cards: {
    activeBarbershops: number
    trialBarbershops: number
    pastDueBarbershops: number
    blockedBarbershops: number
    appointmentsThisMonth: number
    whatsappMessagesThisMonth: number
    aiTokensThisMonth: number
    aiEstimatedCostCents: number | null
    aiEstimatedCostUsd: number | null
    aiEstimatedCostBrl: number | null
    automationsToday: number
    recentErrors: number
  }
  barbershops: Array<{
    id: string
    name: string
    slug: string
    operationalActive: boolean
    subscriptionPlan: string | null
    subscriptionStatus: BarbershopSubscriptionStatus
    usersCount: number
    customersCount: number
    appointmentsThisMonth: number
    whatsappMessagesThisMonth: number
    aiTokensThisMonth: number
    aiEstimatedCostCents: number | null
    aiEstimatedCostUsd: number | null
    aiEstimatedCostBrl: number | null
    aiUnpricedRequests: number
    lastActivityAt: Date | null
    lastActivityLabel: string | null
  }>
  recentErrors: Array<{
    id: string
    kind: 'AI' | 'WHATSAPP' | 'AUTOMATION'
    barbershopId: string | null
    barbershopName: string
    message: string
    createdAt: Date
    createdAtLabel: string
  }>
}

export interface PlatformBarbershopDetailData {
  pricing: {
    version: string
    sourceUpdatedAt: Date
    pricedModels: string[]
    usdBrlRate: number | null
  }
  warnings: string[]
  barbershop: {
    id: string
    name: string
    slug: string
    timezone: string
    address: string | null
    phone: string | null
    email: string | null
    operationalActive: boolean
    subscriptionPlan: string | null
    subscriptionStatus: BarbershopSubscriptionStatus
    trialEndsAt: Date | null
    billingEmail: string | null
    whatsappEnabled: boolean
    evolutionInstanceName: string | null
    whatsappLastInboundAt: Date | null
    whatsappLastOutboundAt: Date | null
    whatsappLastErrorAt: Date | null
    whatsappLastErrorMessage: string | null
    blockedAt: Date | null
    blockedReason: string | null
    createdAt: Date
    updatedAt: Date
    createdAtLabel: string
  }
  totals: {
    users: number
    professionals: number
    customers: number
    appointmentsThisMonth: number
    upcomingAppointments: number
    whatsappMessagesThisMonth: number
    aiTokensThisMonth: number
    aiEstimatedCostCents: number | null
    aiEstimatedCostUsd: number | null
    aiEstimatedCostBrl: number | null
    automationsThisMonth: number
  }
  users: Array<{
    id: string
    name: string
    email: string
    role: string
    platformRole: string
    active: boolean
    createdAt: Date
  }>
  serviceCategories: Array<{
    id: string
    name: string
    active: boolean
  }>
  professionals: Array<{
    id: string
    name: string
    email: string | null
    phone: string | null
    avatar: string | null
    active: boolean
    attendanceScope: 'BOTH' | 'SUBSCRIPTION_ONLY' | 'WALK_IN_ONLY'
    commissionRate: number | null
    haircutPrice: number | null
    beardPrice: number | null
    comboPrice: number | null
    upcomingAppointments: number
    createdAt: Date
  }>
  services: Array<{
    id: string
    name: string
    description: string | null
    price: number
    duration: number
    active: boolean
    categoryId: string | null
    categoryName: string | null
    upcomingAppointments: number
    createdAt: Date
  }>
  customers: Array<{
    id: string
    name: string
    phone: string | null
    email: string | null
    notes: string | null
    type: CustomerType
    subscriptionStatus: SubscriptionStatus | null
    subscriptionPrice: number | null
    subscriptionStartedAt: Date | null
    preferredProfessionalId: string | null
    preferredProfessionalName: string | null
    active: boolean
    marketingOptOut: boolean
    upcomingAppointments: number
    updatedAt: Date
  }>
  checklist: {
    groups: PlatformChecklistGroup[]
    summary: {
      complete: number
      pending: number
      attention: number
      total: number
    }
  }
  schedule: {
    defaultWindow: {
      startHour: number
      endHour: number
      label: string
    }
    upcomingBlocks: Array<{
      id: string
      professionalId: string
      professionalName: string
      startAt: Date
      endAt: Date
      notes: string | null
      dateInputValue: string
      startTimeValue: string
      endTimeValue: string
      dateLabel: string
      startTimeLabel: string
      endTimeLabel: string
    }>
  }
  migration: {
    documentationPath: string
    strategyCards: Array<{
      id: string
      title: string
      description: string
    }>
    csvPreview: {
      professionals: string[]
      services: string[]
      customers: string[]
      futureAppointments: string[]
    }
  }
  aiUsageBySource: Array<{
    source: AiChatUsageSource
    requests: number
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    totalTokens: number
    estimatedCostCents: number | null
    estimatedCostUsd: number | null
    estimatedCostBrl: number | null
    unpricedRequests: number
    lastUsedAt: Date | null
  }>
  integrations: {
    whatsappEnabled: boolean
    evolutionInstanceName: string | null
    evolutionApiKeyManagedPerTenant: boolean
    webhookSecretConfigured: boolean
    webhookSecretMasked: string | null
    whatsappStatusLabel: string
    whatsappLastEventAt: Date | null
    automationActiveConfigs: number
    automationLastRunAt: Date | null
    aiLastUsageAt: Date | null
  }
  recentAutomations: Array<{
    id: string
    localDateIso: string
    status: string
    startedAt: Date
    completedAt: Date | null
    lastError: string | null
  }>
  recentUsage: Array<{
    id: string
    source: AiChatUsageSource
    model: string | null
    status: string
    totalTokens: number | null
    estimatedCostCents: number | null
    estimatedCostUsd: number | null
    pricingVersion: string | null
    errorMessage: string | null
    createdAt: Date
  }>
  recentErrors: Array<{
    id: string
    kind: 'AI' | 'WHATSAPP' | 'AUTOMATION'
    message: string
    createdAt: Date
  }>
}

interface AiUsageLogColumnAvailability {
  estimatedCostUsd: boolean
  estimatedCostCents: boolean
  cachedInputTokens: boolean
  pricingVersion: boolean
  errorMessage: boolean
  status: boolean
}

type PlatformOverviewAiUsageRow = {
  barbershopId: string
  totalTokens: number
  estimatedCostCents: number | null
  estimatedCostUsd: number | null
}

type PlatformDetailAiUsageRow = {
  source: AiChatUsageSource
  requests: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostCents: number | null
  estimatedCostUsd: number | null
  lastUsedAt: Date | null
}

type PlatformRecentUsageRow = {
  id: string
  source: AiChatUsageSource
  model: string | null
  status: string
  totalTokens: number | null
  estimatedCostCents: number | null
  estimatedCostUsd: number | null
  pricingVersion: string | null
  errorMessage: string | null
  createdAt: Date
}

interface PlatformBarbershopChecklistInput {
  barbershop: {
    name: string
    slug: string
    timezone: string | null
    whatsappEnabled: boolean
    evolutionInstanceName: string | null
  }
  metrics: {
    activeProfessionals: number
    activeServices: number
    customers: number
    upcomingAppointments: number
    financialCategories: number
    whatsappLastEventAt: Date | null
  }
}

function normalizeText(value?: string | null) {
  return typeof value === 'string' ? value.trim() : ''
}

function formatDatePartsInTimezone(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'

  return {
    year,
    month,
    day,
  }
}

function formatDateInputInTimezone(date: Date, timezone: string) {
  const parts = formatDatePartsInTimezone(date, timezone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatTimeInputInTimezone(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const hour = formatter.formatToParts(date).find((part) => part.type === 'hour')?.value ?? '00'
  const minute = formatter.formatToParts(date).find((part) => part.type === 'minute')?.value ?? '00'
  return `${hour}:${minute}`
}

function normalizeNumericValue(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function buildPlatformPricingMeta() {
  return {
    version: OPENAI_PRICING_VERSION,
    sourceUpdatedAt: OPENAI_PRICING_SOURCE_UPDATED_AT,
    pricedModels: getConfiguredOpenAIModelNames(),
    usdBrlRate: getOpenAiUsdBrlRate(),
  }
}

function getDateWindows(referenceDate = new Date()) {
  const startOfMonth = new Date(referenceDate)
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const startOfDay = new Date(referenceDate)
  startOfDay.setHours(0, 0, 0, 0)

  const sevenDaysAgo = new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000)

  return {
    startOfMonth,
    startOfDay,
    sevenDaysAgo,
  }
}

function sumNullable(values: Array<number | null | undefined>) {
  return values.reduce<number>((total, value) => total + (typeof value === 'number' ? value : 0), 0)
}

function maxDate(values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, current) => {
    if (!current) {
      return latest
    }

    if (!latest || current.getTime() > latest.getTime()) {
      return current
    }

    return latest
  }, null)
}

function normalizeSubscriptionStatus(value?: string | null): BarbershopSubscriptionStatus | null {
  if (
    value === 'TRIAL'
    || value === 'ACTIVE'
    || value === 'PAST_DUE'
    || value === 'BLOCKED'
    || value === 'CANCELED'
  ) {
    return value
  }

  return null
}

function toChecklistItemStatus(done: boolean, attention = false): PlatformChecklistStatus {
  if (done) {
    return 'complete'
  }

  return attention ? 'attention' : 'pending'
}

function buildChecklistSummary(groups: PlatformChecklistGroup[]) {
  return groups
    .flatMap((group) => group.items)
    .reduce(
      (summary, item) => {
        summary.total += 1
        summary[item.status] += 1
        return summary
      },
      {
        complete: 0,
        pending: 0,
        attention: 0,
        total: 0,
      }
    )
}

function maskSecretPreview(value?: string | null) {
  const normalized = typeof value === 'string' ? value.trim() : ''

  if (!normalized) {
    return null
  }

  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`
  }

  return `${normalized.slice(0, 4)}***${normalized.slice(-4)}`
}

export function buildBarbershopOnboardingChecklist(
  input: PlatformBarbershopChecklistInput
): PlatformBarbershopDetailData['checklist'] {
  const basicConfigured = Boolean(input.barbershop.name && input.barbershop.slug)
  const timezoneConfigured = Boolean(input.barbershop.timezone)
  const hasProfessionals = input.metrics.activeProfessionals > 0
  const hasServices = input.metrics.activeServices > 0
  const hasCustomers = input.metrics.customers > 0
  const hasUpcomingAppointments = input.metrics.upcomingAppointments > 0
  const hasWhatsappInstance = Boolean(input.barbershop.evolutionInstanceName)
  const hasWhatsappEnabled = input.barbershop.whatsappEnabled
  const hasWhatsappTraffic = Boolean(input.metrics.whatsappLastEventAt)
  const hasFinancialCategories = input.metrics.financialCategories > 0

  const groups: PlatformChecklistGroup[] = [
    {
      id: 'basics',
      title: 'Dados basicos',
      items: [
        {
          id: 'name-slug',
          label: 'Nome e slug configurados',
          detail: basicConfigured
            ? 'Identidade principal do tenant pronta para operacao e URLs internas.'
            : 'Revise nome e slug antes de seguir para o piloto.',
          status: toChecklistItemStatus(basicConfigured),
        },
        {
          id: 'timezone',
          label: 'Timezone configurada',
          detail: timezoneConfigured
            ? `Operando em ${input.barbershop.timezone}.`
            : 'Defina o fuso horario oficial da barbearia.',
          status: toChecklistItemStatus(timezoneConfigured),
        },
      ],
    },
    {
      id: 'operation',
      title: 'Operacao',
      items: [
        {
          id: 'professionals',
          label: 'Profissionais ativos cadastrados',
          detail: hasProfessionals
            ? `${input.metrics.activeProfessionals} profissional${input.metrics.activeProfessionals === 1 ? '' : 'is'} ativo${input.metrics.activeProfessionals === 1 ? '' : 's'} pronto${input.metrics.activeProfessionals === 1 ? '' : 's'} para agenda.`
            : 'Cadastre ao menos 1 profissional para preparar atendimento e agenda.',
          status: toChecklistItemStatus(hasProfessionals),
        },
        {
          id: 'services',
          label: 'Servicos ativos cadastrados',
          detail: hasServices
            ? `${input.metrics.activeServices} servico${input.metrics.activeServices === 1 ? '' : 's'} ativo${input.metrics.activeServices === 1 ? '' : 's'} com precificacao pronta.`
            : 'Cadastre servicos com preco e duracao antes do piloto.',
          status: toChecklistItemStatus(hasServices),
        },
        {
          id: 'hours',
          label: 'Horarios operacionais revisados',
          detail: hasProfessionals
            ? `A janela base atual do produto e ${String(SCHEDULE_START_HOUR).padStart(2, '0')}:00-${String(SCHEDULE_END_HOUR).padStart(2, '0')}:00. Use bloqueios operacionais para indisponibilidades enquanto nao houver grade semanal persistente.`
            : 'Defina primeiro a equipe para revisar disponibilidade operacional.',
          status: toChecklistItemStatus(hasProfessionals, true),
        },
        {
          id: 'future-agenda',
          label: 'Agenda futura preparada',
          detail: hasUpcomingAppointments
            ? `${input.metrics.upcomingAppointments} horario${input.metrics.upcomingAppointments === 1 ? '' : 's'} futuro${input.metrics.upcomingAppointments === 1 ? '' : 's'} ja cadastrado${input.metrics.upcomingAppointments === 1 ? '' : 's'}.`
            : 'Ainda nao ha agenda futura cadastrada para o tenant.',
          status: toChecklistItemStatus(hasUpcomingAppointments),
        },
      ],
    },
    {
      id: 'whatsapp',
      title: 'WhatsApp',
      items: [
        {
          id: 'instance',
          label: 'Instance Evolution configurada',
          detail: hasWhatsappInstance
            ? `Instance atual: ${input.barbershop.evolutionInstanceName}.`
            : 'Defina a instance Evolution para resolver o tenant corretamente.',
          status: toChecklistItemStatus(hasWhatsappInstance),
        },
        {
          id: 'whatsapp-enabled',
          label: 'WhatsApp habilitado',
          detail: hasWhatsappEnabled
            ? 'Mensageria habilitada para este tenant.'
            : 'Ative o WhatsApp apenas quando a configuracao estiver pronta.',
          status: toChecklistItemStatus(hasWhatsappEnabled),
        },
        {
          id: 'whatsapp-traffic',
          label: 'Ultimo evento recebido',
          detail: hasWhatsappTraffic
            ? 'Ja existe trafego recente na camada de mensageria desse tenant.'
            : 'Ainda nao ha evento recente registrado; valide a integracao antes do piloto.',
          status: toChecklistItemStatus(hasWhatsappTraffic, true),
        },
      ],
    },
    {
      id: 'migration',
      title: 'Migracao',
      items: [
        {
          id: 'customers',
          label: 'Clientes principais cadastrados',
          detail: hasCustomers
            ? `${input.metrics.customers} cliente${input.metrics.customers === 1 ? '' : 's'} ja disponivel${input.metrics.customers === 1 ? '' : 'eis'} para operacao e relacionamento.`
            : 'Comece pela base principal de clientes da barbearia.',
          status: toChecklistItemStatus(hasCustomers),
        },
        {
          id: 'services-reviewed',
          label: 'Servicos revisados para implantacao',
          detail: hasServices
            ? 'Catalogo operacional ja pode sustentar migracao manual.'
            : 'Revise servicos, precos e duracoes antes da carga manual.',
          status: toChecklistItemStatus(hasServices),
        },
        {
          id: 'professionals-reviewed',
          label: 'Equipe revisada',
          detail: hasProfessionals
            ? 'Equipe inicial revisada para atendimento e agenda.'
            : 'A equipe ainda nao foi preparada para o tenant.',
          status: toChecklistItemStatus(hasProfessionals),
        },
      ],
    },
    {
      id: 'finance',
      title: 'Financeiro',
      items: [
        {
          id: 'categories',
          label: 'Categorias financeiras basicas',
          detail: hasFinancialCategories
            ? `${input.metrics.financialCategories} categoria${input.metrics.financialCategories === 1 ? '' : 's'} financeira${input.metrics.financialCategories === 1 ? '' : 's'} disponivel${input.metrics.financialCategories === 1 ? '' : 'eis'}.`
            : 'As categorias financeiras ainda nao foram configuradas para este tenant.',
          status: toChecklistItemStatus(hasFinancialCategories, true),
        },
      ],
    },
  ]

  return {
    groups,
    summary: buildChecklistSummary(groups),
  }
}

function roundUsd(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function resolveEstimatedCostUsd(input: {
  estimatedCostUsd?: Prisma.Decimal | number | null
  estimatedCostCents?: number | null
  totalTokens?: number | null
}) {
  const directUsd = normalizeNumericValue(input.estimatedCostUsd)
  if (directUsd !== null) {
    return directUsd
  }

  if (typeof input.estimatedCostCents === 'number') {
    return roundUsd(input.estimatedCostCents / 100)
  }

  return (input.totalTokens ?? 0) === 0 ? 0 : null
}

function resolveEstimatedCostCents(input: {
  estimatedCostUsd?: Prisma.Decimal | number | null
  estimatedCostCents?: number | null
  totalTokens?: number | null
}) {
  if (typeof input.estimatedCostCents === 'number') {
    return input.estimatedCostCents
  }

  const directUsd = normalizeNumericValue(input.estimatedCostUsd)
  if (directUsd !== null) {
    return Math.round(directUsd * 100)
  }

  return (input.totalTokens ?? 0) === 0 ? 0 : null
}

function buildLegacyAiUsageWarning() {
  return 'Algumas colunas novas do ledger de IA ainda nao existem neste banco. O painel segue carregando com leitura parcial; rode npm run db:push para liberar custos e diagnosticos completos.'
}

async function getAiUsageLogColumnAvailability(): Promise<AiUsageLogColumnAvailability> {
  try {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      select column_name
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'ai_chat_usage_logs'
    `

    const columns = new Set(rows.map((row) => row.column_name))

    return {
      estimatedCostUsd: columns.has('estimatedCostUsd'),
      estimatedCostCents: columns.has('estimatedCostCents'),
      cachedInputTokens: columns.has('cachedInputTokens'),
      pricingVersion: columns.has('pricingVersion'),
      errorMessage: columns.has('errorMessage'),
      status: columns.has('status'),
    }
  } catch (error) {
    safeLog('warn', '[platform-admin] usage_schema_probe_failed', { error })

    return {
      estimatedCostUsd: false,
      estimatedCostCents: false,
      cachedInputTokens: false,
      pricingVersion: false,
      errorMessage: false,
      status: false,
    }
  }
}

function createEmptyPlatformOverviewData(
  filters: PlatformOverviewFilters,
  warnings: string[] = []
): PlatformOverviewData {
  return {
    pricing: buildPlatformPricingMeta(),
    warnings,
    filters: {
      search: normalizeText(filters.search),
      status: normalizeText(filters.status),
      plan: normalizeText(filters.plan),
      availablePlans: [],
    },
    cards: {
      activeBarbershops: 0,
      trialBarbershops: 0,
      pastDueBarbershops: 0,
      blockedBarbershops: 0,
      appointmentsThisMonth: 0,
      whatsappMessagesThisMonth: 0,
      aiTokensThisMonth: 0,
      aiEstimatedCostCents: 0,
      aiEstimatedCostUsd: 0,
      aiEstimatedCostBrl: convertUsdToBrl(0, getOpenAiUsdBrlRate()),
      automationsToday: 0,
      recentErrors: 0,
    },
    barbershops: [],
    recentErrors: [],
  }
}

async function recordPlatformAuditLog(input: {
  platformUserId: string
  action: string
  targetBarbershopId?: string | null
  metadataJson?: Prisma.InputJsonValue | null
}) {
  try {
    await prisma.platformAuditLog.create({
      data: {
        platformUserId: input.platformUserId,
        action: input.action,
        targetBarbershopId: input.targetBarbershopId ?? null,
        metadataJson: input.metadataJson ?? undefined,
      },
    })
  } catch (error) {
    safeLog('warn', '[platform-admin] audit_log_failed', {
      action: input.action,
      error,
    })
  }
}

function buildBarbershopWhere(filters: PlatformOverviewFilters): Prisma.BarbershopWhereInput {
  const search = normalizeText(filters.search)
  const status = normalizeSubscriptionStatus(filters.status)
  const plan = normalizeText(filters.plan)

  const where: Prisma.BarbershopWhereInput = {}

  if (search) {
    where.OR = [
      {
        name: {
          contains: search,
          mode: 'insensitive',
        },
      },
      {
        slug: {
          contains: search,
          mode: 'insensitive',
        },
      },
    ]
  }

  if (status) {
    where.subscriptionStatus = status
  }

  if (plan) {
    where.subscriptionPlan = plan
  }

  return where
}

async function loadOverviewAiUsageData(input: {
  startOfMonth: Date
  sevenDaysAgo: Date
  warnings: string[]
}) {
  const columns = await getAiUsageLogColumnAvailability()

  if (!columns.estimatedCostUsd || !columns.cachedInputTokens || !columns.pricingVersion || !columns.status) {
    input.warnings.push(buildLegacyAiUsageWarning())
  }

  try {
    const usageSum: Prisma.AiChatUsageLogSumAggregateInputType = {
      totalTokens: true,
      ...(columns.estimatedCostCents ? { estimatedCostCents: true } : {}),
      ...(columns.estimatedCostUsd ? { estimatedCostUsd: true } : {}),
    }

    const [usageGroups, unpricedGroups, aiActivity, failedAiUsage] = await Promise.all([
      prisma.aiChatUsageLog.groupBy({
        by: ['barbershopId'],
        where: {
          createdAt: {
            gte: input.startOfMonth,
          },
        },
        _sum: usageSum,
      }),
      columns.estimatedCostUsd
        ? prisma.aiChatUsageLog.groupBy({
          by: ['barbershopId'],
          where: {
            createdAt: {
              gte: input.startOfMonth,
            },
            model: {
              not: null,
            },
            totalTokens: {
              gt: 0,
            },
            estimatedCostUsd: null,
          },
          _count: {
            _all: true,
          },
        })
        : Promise.resolve([]),
      prisma.aiChatUsageLog.groupBy({
        by: ['barbershopId'],
        _max: {
          createdAt: true,
        },
      }),
      columns.status
        ? prisma.aiChatUsageLog.findMany({
          where: {
            status: 'FAILED',
            createdAt: {
              gte: input.sevenDaysAgo,
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: RECENT_ERROR_LIMIT,
          select: {
            id: true,
            ...(columns.errorMessage ? { errorMessage: true } : {}),
            createdAt: true,
            barbershop: {
              select: {
                id: true,
                name: true,
                timezone: true,
              },
            },
          },
        })
        : Promise.resolve([]),
    ])

    return {
      columns,
      usageGroups: usageGroups.map((group) => ({
        barbershopId: group.barbershopId,
        totalTokens: group._sum.totalTokens ?? 0,
        estimatedCostCents: resolveEstimatedCostCents({
          estimatedCostUsd: columns.estimatedCostUsd ? (group._sum as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (group._sum as any).estimatedCostCents ?? null : null,
          totalTokens: group._sum.totalTokens ?? 0,
        }),
        estimatedCostUsd: resolveEstimatedCostUsd({
          estimatedCostUsd: columns.estimatedCostUsd ? (group._sum as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (group._sum as any).estimatedCostCents ?? null : null,
          totalTokens: group._sum.totalTokens ?? 0,
        }),
      }) as PlatformOverviewAiUsageRow),
      unpricedGroups,
      aiActivity,
      failedAiUsage,
    }
  } catch (error) {
    safeLog('error', '[platform-admin] usage loaded failed', {
      stage: 'overview',
      error,
    })
    input.warnings.push('Nao foi possivel carregar todas as metricas de IA desta visao. O restante do painel continua disponivel.')
    return {
      columns,
      usageGroups: [] as PlatformOverviewAiUsageRow[],
      unpricedGroups: [] as Array<{ barbershopId: string; _count: { _all: number } }>,
      aiActivity: [] as Array<{ barbershopId: string; _max: { createdAt: Date | null } }>,
      failedAiUsage: [] as Array<{
        id: string
        errorMessage?: string | null
        createdAt: Date
        barbershop: {
          id: string
          name: string
          timezone: string
        }
      }>,
    }
  }
}

async function loadDetailAiUsageData(input: {
  barbershopId: string
  startOfMonth: Date
  sevenDaysAgo: Date
  warnings: string[]
}) {
  const columns = await getAiUsageLogColumnAvailability()

  if (!columns.estimatedCostUsd || !columns.cachedInputTokens || !columns.pricingVersion || !columns.status) {
    input.warnings.push(buildLegacyAiUsageWarning())
  }

  try {
    const usageSum: Prisma.AiChatUsageLogSumAggregateInputType = {
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      ...(columns.cachedInputTokens ? { cachedInputTokens: true } : {}),
      ...(columns.estimatedCostCents ? { estimatedCostCents: true } : {}),
      ...(columns.estimatedCostUsd ? { estimatedCostUsd: true } : {}),
    }

    const [usageBySource, unpricedUsageBySource, recentUsage, aiLastUsage, failedAiUsage] = await Promise.all([
      prisma.aiChatUsageLog.groupBy({
        by: ['source'],
        where: {
          barbershopId: input.barbershopId,
          createdAt: {
            gte: input.startOfMonth,
          },
        },
        _count: {
          _all: true,
        },
        _sum: usageSum,
        _max: {
          createdAt: true,
        },
      }),
      columns.estimatedCostUsd
        ? prisma.aiChatUsageLog.groupBy({
          by: ['source'],
          where: {
            barbershopId: input.barbershopId,
            createdAt: {
              gte: input.startOfMonth,
            },
            model: {
              not: null,
            },
            totalTokens: {
              gt: 0,
            },
            estimatedCostUsd: null,
          },
          _count: {
            _all: true,
          },
        })
        : Promise.resolve([]),
      prisma.aiChatUsageLog.findMany({
        where: {
          barbershopId: input.barbershopId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: RECENT_ACTIVITY_LIMIT,
        select: {
          id: true,
          source: true,
          model: true,
          ...(columns.status ? { status: true } : {}),
          totalTokens: true,
          ...(columns.estimatedCostCents ? { estimatedCostCents: true } : {}),
          ...(columns.estimatedCostUsd ? { estimatedCostUsd: true } : {}),
          ...(columns.pricingVersion ? { pricingVersion: true } : {}),
          ...(columns.errorMessage ? { errorMessage: true } : {}),
          createdAt: true,
        },
      }),
      prisma.aiChatUsageLog.findFirst({
        where: {
          barbershopId: input.barbershopId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          createdAt: true,
        },
      }),
      columns.status
        ? prisma.aiChatUsageLog.findMany({
          where: {
            barbershopId: input.barbershopId,
            status: 'FAILED',
            createdAt: {
              gte: input.sevenDaysAgo,
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: RECENT_ERROR_LIMIT,
          select: {
            id: true,
            ...(columns.errorMessage ? { errorMessage: true } : {}),
            createdAt: true,
          },
        })
        : Promise.resolve([]),
    ])

    return {
      columns,
      usageBySource: usageBySource.map((item) => ({
        source: item.source,
        requests: item._count._all,
        inputTokens: item._sum.inputTokens ?? 0,
        cachedInputTokens: columns.cachedInputTokens ? ((item._sum as any).cachedInputTokens ?? 0) : 0,
        outputTokens: item._sum.outputTokens ?? 0,
        totalTokens: item._sum.totalTokens ?? 0,
        estimatedCostCents: resolveEstimatedCostCents({
          estimatedCostUsd: columns.estimatedCostUsd ? (item._sum as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (item._sum as any).estimatedCostCents ?? null : null,
          totalTokens: item._sum.totalTokens ?? 0,
        }),
        estimatedCostUsd: resolveEstimatedCostUsd({
          estimatedCostUsd: columns.estimatedCostUsd ? (item._sum as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (item._sum as any).estimatedCostCents ?? null : null,
          totalTokens: item._sum.totalTokens ?? 0,
        }),
        lastUsedAt: item._max.createdAt ?? null,
      }) as PlatformDetailAiUsageRow),
      unpricedUsageBySource,
      recentUsage: recentUsage.map((item) => ({
        id: item.id,
        source: item.source,
        model: item.model,
        status: columns.status ? ((item as any).status ?? 'SUCCESS') : 'SUCCESS',
        totalTokens: item.totalTokens,
        estimatedCostCents: resolveEstimatedCostCents({
          estimatedCostUsd: columns.estimatedCostUsd ? (item as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (item as any).estimatedCostCents ?? null : null,
          totalTokens: item.totalTokens ?? 0,
        }),
        estimatedCostUsd: resolveEstimatedCostUsd({
          estimatedCostUsd: columns.estimatedCostUsd ? (item as any).estimatedCostUsd : null,
          estimatedCostCents: columns.estimatedCostCents ? (item as any).estimatedCostCents ?? null : null,
          totalTokens: item.totalTokens ?? 0,
        }),
        pricingVersion: columns.pricingVersion ? ((item as any).pricingVersion ?? null) : null,
        errorMessage: columns.errorMessage ? ((item as any).errorMessage ?? null) : null,
        createdAt: item.createdAt,
      }) as PlatformRecentUsageRow),
      aiLastUsage,
      failedAiUsage,
    }
  } catch (error) {
    safeLog('error', '[platform-admin] usage loaded failed', {
      stage: 'detail',
      barbershopId: input.barbershopId,
      error,
    })
    input.warnings.push('Parte da telemetria de IA desta barbearia nao ficou disponivel nesta leitura. O restante do detalhe continua carregado.')
    return {
      columns,
      usageBySource: [] as PlatformDetailAiUsageRow[],
      unpricedUsageBySource: [] as Array<{ source: AiChatUsageSource; _count: { _all: number } }>,
      recentUsage: [] as PlatformRecentUsageRow[],
      aiLastUsage: null as { createdAt: Date } | null,
      failedAiUsage: [] as Array<{ id: string; errorMessage?: string | null; createdAt: Date }>,
    }
  }
}

export async function getPlatformOverviewData(
  session: PlatformSessionIdentity,
  filters: PlatformOverviewFilters
): Promise<PlatformOverviewData> {
  assertPlatformRoleAllowed(session.platformRole)
  safeLog('info', '[platform-admin] overview started', {
    userId: session.userId,
    filters: {
      search: normalizeText(filters.search) || null,
      status: normalizeText(filters.status) || null,
      plan: normalizeText(filters.plan) || null,
    },
  })

  try {
    const where = buildBarbershopWhere(filters)
    const { startOfMonth, startOfDay, sevenDaysAgo } = getDateWindows()
    const pricing = buildPlatformPricingMeta()
    const warnings: string[] = []

    const [
      barbershops,
      allPlans,
      appointmentGroups,
      messagingGroups,
      appointmentActivity,
      messagingActivity,
      automationActivity,
      automationToday,
      failedMessaging,
      failedAutomation,
    ] = await Promise.all([
      prisma.barbershop.findMany({
        where,
        orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          active: true,
          timezone: true,
          subscriptionPlan: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          _count: {
            select: {
              users: true,
              customers: true,
            },
          },
        },
      }),
      prisma.barbershop.findMany({
        select: {
          subscriptionPlan: true,
        },
        distinct: ['subscriptionPlan'],
        orderBy: {
          subscriptionPlan: 'asc',
        },
      }),
      prisma.appointment.groupBy({
        by: ['barbershopId'],
        where: {
          startAt: {
            gte: startOfMonth,
          },
        },
        _count: {
          _all: true,
        },
      }),
      prisma.messagingEvent.groupBy({
        by: ['barbershopId'],
        where: {
          createdAt: {
            gte: startOfMonth,
          },
        },
        _count: {
          _all: true,
        },
      }),
      prisma.appointment.groupBy({
        by: ['barbershopId'],
        _max: {
          updatedAt: true,
        },
      }),
      prisma.messagingEvent.groupBy({
        by: ['barbershopId'],
        _max: {
          createdAt: true,
        },
      }),
      prisma.campaignAutomationRun.groupBy({
        by: ['barbershopId'],
        _max: {
          startedAt: true,
        },
      }),
      prisma.campaignAutomationRun.count({
        where: {
          startedAt: {
            gte: startOfDay,
          },
        },
      }),
      prisma.messagingEvent.findMany({
        where: {
          status: 'FAILED',
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: RECENT_ERROR_LIMIT,
        select: {
          id: true,
          lastError: true,
          createdAt: true,
          barbershop: {
            select: {
              id: true,
              name: true,
              timezone: true,
            },
          },
        },
      }),
      prisma.campaignAutomationRun.findMany({
        where: {
          status: 'FAILED',
          startedAt: {
            gte: sevenDaysAgo,
          },
        },
        orderBy: {
          startedAt: 'desc',
        },
        take: RECENT_ERROR_LIMIT,
        select: {
          id: true,
          lastError: true,
          startedAt: true,
          barbershop: {
            select: {
              id: true,
              name: true,
              timezone: true,
            },
          },
        },
      }),
    ])

    safeLog('info', '[platform-admin] tenants loaded', {
      count: barbershops.length,
    })

    const {
      usageGroups,
      unpricedGroups,
      aiActivity,
      failedAiUsage,
    } = await loadOverviewAiUsageData({
      startOfMonth,
      sevenDaysAgo,
      warnings,
    })

    safeLog('info', '[platform-admin] usage loaded', {
      tenantsWithUsage: usageGroups.length,
      warnings: warnings.length,
    })

    const appointmentsByBarbershop = new Map(appointmentGroups.map((group) => [group.barbershopId, group._count._all]))
    const messagesByBarbershop = new Map(messagingGroups.map((group) => [group.barbershopId, group._count._all]))
    const aiUsageByBarbershop = new Map(usageGroups.map((group) => [group.barbershopId, group]))
    const unpricedAiUsageByBarbershop = new Map(
      unpricedGroups.map((group) => [group.barbershopId, group._count._all])
    )
    const appointmentActivityByBarbershop = new Map(appointmentActivity.map((item) => [item.barbershopId, item._max.updatedAt ?? null]))
    const messagingActivityByBarbershop = new Map(messagingActivity.map((item) => [item.barbershopId, item._max.createdAt ?? null]))
    const aiActivityByBarbershop = new Map(aiActivity.map((item) => [item.barbershopId, item._max.createdAt ?? null]))
    const automationActivityByBarbershop = new Map(automationActivity.map((item) => [item.barbershopId, item._max.startedAt ?? null]))

    const rows = barbershops.map((barbershop) => {
      const timezone = resolveBusinessTimezone(barbershop.timezone)
      const lastActivityAt = maxDate([
        appointmentActivityByBarbershop.get(barbershop.id),
        messagingActivityByBarbershop.get(barbershop.id),
        aiActivityByBarbershop.get(barbershop.id),
        automationActivityByBarbershop.get(barbershop.id),
      ])
      const aiUsage = aiUsageByBarbershop.get(barbershop.id)
      const aiTokensThisMonth = aiUsage?.totalTokens ?? 0
      const aiEstimatedCostCents = aiUsage?.estimatedCostCents ?? 0
      const aiEstimatedCostUsd = aiUsage?.estimatedCostUsd ?? 0

      return {
        id: barbershop.id,
        name: barbershop.name,
        slug: barbershop.slug,
        operationalActive: barbershop.active,
        subscriptionPlan: barbershop.subscriptionPlan,
        subscriptionStatus: barbershop.subscriptionStatus,
        usersCount: barbershop._count.users,
        customersCount: barbershop._count.customers,
        appointmentsThisMonth: appointmentsByBarbershop.get(barbershop.id) ?? 0,
        whatsappMessagesThisMonth: messagesByBarbershop.get(barbershop.id) ?? 0,
        aiTokensThisMonth,
        aiEstimatedCostCents,
        aiEstimatedCostUsd,
        aiEstimatedCostBrl: convertUsdToBrl(aiEstimatedCostUsd, pricing.usdBrlRate),
        aiUnpricedRequests: unpricedAiUsageByBarbershop.get(barbershop.id) ?? 0,
        lastActivityAt,
        lastActivityLabel: lastActivityAt ? formatDateTimeInTimezone(lastActivityAt, timezone) : null,
      }
    })

    const recentErrors = [
      ...failedAiUsage.map((item) => ({
        id: `ai:${item.id}`,
        kind: 'AI' as const,
        barbershopId: item.barbershop.id,
        barbershopName: item.barbershop.name,
        message: item.errorMessage ?? 'Falha de IA sem mensagem detalhada.',
        createdAt: item.createdAt,
        createdAtLabel: formatDateTimeInTimezone(item.createdAt, item.barbershop.timezone),
      })),
      ...failedMessaging.map((item) => ({
        id: `msg:${item.id}`,
        kind: 'WHATSAPP' as const,
        barbershopId: item.barbershop.id,
        barbershopName: item.barbershop.name,
        message: item.lastError ?? 'Falha de mensagem sem detalhe adicional.',
        createdAt: item.createdAt,
        createdAtLabel: formatDateTimeInTimezone(item.createdAt, item.barbershop.timezone),
      })),
      ...failedAutomation.map((item) => ({
        id: `automation:${item.id}`,
        kind: 'AUTOMATION' as const,
        barbershopId: item.barbershop.id,
        barbershopName: item.barbershop.name,
        message: item.lastError ?? 'Execucao automatica falhou sem detalhe adicional.',
        createdAt: item.startedAt,
        createdAtLabel: formatDateTimeInTimezone(item.startedAt, item.barbershop.timezone),
      })),
    ]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, RECENT_ERROR_LIMIT)

    safeLog('info', '[platform-admin] costs computed', {
      tokens: rows.reduce((sum, item) => sum + item.aiTokensThisMonth, 0),
      estimatedCostUsd: rows.reduce((sum, item) => sum + item.aiEstimatedCostUsd, 0),
    })

    await recordPlatformAuditLog({
      platformUserId: session.userId,
      action: 'platform.overview.view',
      metadataJson: {
        filters: {
          search: normalizeText(filters.search) || null,
          status: normalizeText(filters.status) || null,
          plan: normalizeText(filters.plan) || null,
        },
        visibleBarbershops: rows.length,
      },
    })

    return {
      pricing,
      warnings: Array.from(new Set(warnings)),
      filters: {
        search: normalizeText(filters.search),
        status: normalizeText(filters.status),
        plan: normalizeText(filters.plan),
        availablePlans: allPlans
          .map((item) => item.subscriptionPlan)
          .filter((value): value is string => Boolean(value)),
      },
      cards: {
        activeBarbershops: rows.filter((item) => item.subscriptionStatus === 'ACTIVE' && item.operationalActive).length,
        trialBarbershops: rows.filter((item) => item.subscriptionStatus === 'TRIAL').length,
        pastDueBarbershops: rows.filter((item) => item.subscriptionStatus === 'PAST_DUE').length,
        blockedBarbershops: rows.filter((item) => item.subscriptionStatus === 'BLOCKED').length,
        appointmentsThisMonth: rows.reduce((sum, item) => sum + item.appointmentsThisMonth, 0),
        whatsappMessagesThisMonth: rows.reduce((sum, item) => sum + item.whatsappMessagesThisMonth, 0),
        aiTokensThisMonth: rows.reduce((sum, item) => sum + item.aiTokensThisMonth, 0),
        aiEstimatedCostCents: sumNullable(rows.map((item) => item.aiEstimatedCostCents)),
        aiEstimatedCostUsd: sumNullable(rows.map((item) => item.aiEstimatedCostUsd)),
        aiEstimatedCostBrl: sumNullable(rows.map((item) => item.aiEstimatedCostBrl)),
        automationsToday: automationToday,
        recentErrors: recentErrors.length,
      },
      barbershops: rows,
      recentErrors,
    }
  } catch (error) {
    safeLog('error', '[platform-admin] overview failed', {
      userId: session.userId,
      error,
    })

    return createEmptyPlatformOverviewData(filters, [
      'Nao foi possivel carregar a visao completa da plataforma agora. Verifique o schema do banco e tente novamente em instantes.',
    ])
  }
}

export async function getPlatformBarbershopDetailData(
  session: PlatformSessionIdentity,
  barbershopId: string
): Promise<PlatformBarbershopDetailData> {
  assertPlatformRoleAllowed(session.platformRole)

  const { startOfMonth, sevenDaysAgo } = getDateWindows()
  const now = new Date()
  const pricing = buildPlatformPricingMeta()
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      address: true,
      phone: true,
      email: true,
      active: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      billingEmail: true,
      whatsappEnabled: true,
      evolutionInstanceName: true,
      whatsappLastInboundAt: true,
      whatsappLastOutboundAt: true,
      whatsappLastErrorAt: true,
      whatsappLastErrorMessage: true,
      blockedAt: true,
      blockedReason: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          users: true,
          professionals: true,
          customers: true,
        },
      },
    },
  })

  if (!barbershop) {
    throw new Error('Barbearia nao encontrada para a operacao interna.')
  }

  const timezone = resolveBusinessTimezone(barbershop.timezone)
  const warnings: string[] = []

  const [
    users,
    professionals,
    services,
    customers,
    serviceCategories,
    appointmentsThisMonth,
    futureAppointmentsCount,
    whatsappMessagesThisMonth,
    recentAutomations,
    automationsThisMonthCount,
    automationActiveConfigs,
    messagingLastEvent,
    automationLastRun,
    financialCategoriesCount,
    upcomingBlocks,
    professionalUpcomingCounts,
    serviceUpcomingCounts,
    customerUpcomingCounts,
    failedMessaging,
    failedAutomation,
  ] = await Promise.all([
    prisma.user.findMany({
      where: {
        barbershopId,
      },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        platformRole: true,
        active: true,
        createdAt: true,
      },
    }),
    prisma.professional.findMany({
      where: {
        barbershopId,
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        active: true,
        commissionRate: true,
        haircutPrice: true,
        beardPrice: true,
        comboPrice: true,
        acceptsWalkIn: true,
        acceptsSubscription: true,
        createdAt: true,
      },
    }),
    prisma.service.findMany({
      where: {
        barbershopId,
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        duration: true,
        active: true,
        categoryId: true,
        createdAt: true,
        category: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.customer.findMany({
      where: {
        barbershopId,
      },
      orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
      take: 24,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        notes: true,
        type: true,
        subscriptionStatus: true,
        subscriptionPrice: true,
        subscriptionStartedAt: true,
        active: true,
        marketingOptOutAt: true,
        updatedAt: true,
        preferredProfessionalId: true,
        preferredProfessional: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.operationalCategory.findMany({
      where: {
        barbershopId,
        type: 'SERVICE',
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        active: true,
      },
    }),
    prisma.appointment.count({
      where: {
        barbershopId,
        startAt: {
          gte: startOfMonth,
        },
      },
    }),
    prisma.appointment.count({
      where: {
        barbershopId,
        status: {
          in: ['PENDING', 'CONFIRMED'],
        },
        startAt: {
          gte: now,
        },
        NOT: {
          sourceReference: {
            startsWith: OPERATIONAL_BLOCK_SOURCE_PREFIX,
          },
        },
      },
    }),
    prisma.messagingEvent.count({
      where: {
        barbershopId,
        createdAt: {
          gte: startOfMonth,
        },
      },
    }),
    prisma.campaignAutomationRun.findMany({
      where: {
        barbershopId,
      },
      orderBy: {
        startedAt: 'desc',
      },
      take: RECENT_ACTIVITY_LIMIT,
      select: {
        id: true,
        localDateIso: true,
        status: true,
        startedAt: true,
        completedAt: true,
        lastError: true,
      },
    }),
    prisma.campaignAutomationRun.count({
      where: {
        barbershopId,
        startedAt: {
          gte: startOfMonth,
        },
      },
    }),
    prisma.campaignAutomationConfig.count({
      where: {
        barbershopId,
        active: true,
      },
    }),
    prisma.messagingEvent.findFirst({
      where: {
        barbershopId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        createdAt: true,
      },
    }),
    prisma.campaignAutomationRun.findFirst({
      where: {
        barbershopId,
      },
      orderBy: {
        startedAt: 'desc',
      },
      select: {
        startedAt: true,
      },
    }),
    prisma.financialCategory.count({
      where: {
        barbershopId,
      },
    }),
    prisma.appointment.findMany({
      where: {
        barbershopId,
        status: {
          in: ['PENDING', 'CONFIRMED'],
        },
        sourceReference: {
          startsWith: OPERATIONAL_BLOCK_SOURCE_PREFIX,
        },
        endAt: {
          gte: now,
        },
      },
      orderBy: {
        startAt: 'asc',
      },
      take: 18,
      select: {
        id: true,
        professionalId: true,
        startAt: true,
        endAt: true,
        notes: true,
        professional: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.appointment.groupBy({
      by: ['professionalId'],
      where: {
        barbershopId,
        status: {
          in: ['PENDING', 'CONFIRMED'],
        },
        startAt: {
          gte: now,
        },
        NOT: {
          sourceReference: {
            startsWith: OPERATIONAL_BLOCK_SOURCE_PREFIX,
          },
        },
      },
      _count: {
        _all: true,
      },
    }),
    prisma.appointment.groupBy({
      by: ['serviceId'],
      where: {
        barbershopId,
        status: {
          in: ['PENDING', 'CONFIRMED'],
        },
        startAt: {
          gte: now,
        },
        NOT: {
          sourceReference: {
            startsWith: OPERATIONAL_BLOCK_SOURCE_PREFIX,
          },
        },
      },
      _count: {
        _all: true,
      },
    }),
    prisma.appointment.groupBy({
      by: ['customerId'],
      where: {
        barbershopId,
        status: {
          in: ['PENDING', 'CONFIRMED'],
        },
        startAt: {
          gte: now,
        },
        NOT: {
          sourceReference: {
            startsWith: OPERATIONAL_BLOCK_SOURCE_PREFIX,
          },
        },
      },
      _count: {
        _all: true,
      },
    }),
    prisma.messagingEvent.findMany({
      where: {
        barbershopId,
        status: 'FAILED',
        createdAt: {
          gte: sevenDaysAgo,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: RECENT_ERROR_LIMIT,
      select: {
        id: true,
        lastError: true,
        createdAt: true,
      },
    }),
    prisma.campaignAutomationRun.findMany({
      where: {
        barbershopId,
        status: 'FAILED',
        startedAt: {
          gte: sevenDaysAgo,
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
      take: RECENT_ERROR_LIMIT,
      select: {
        id: true,
        lastError: true,
        startedAt: true,
      },
    }),
  ])

  const {
    usageBySource,
    unpricedUsageBySource,
    recentUsage,
    aiLastUsage,
    failedAiUsage,
  } = await loadDetailAiUsageData({
    barbershopId,
    startOfMonth,
    sevenDaysAgo,
    warnings,
  })

  const aiTotals = usageBySource.reduce(
    (accumulator, item) => ({
      totalTokens: accumulator.totalTokens + item.totalTokens,
      estimatedCostCents: accumulator.estimatedCostCents + (item.estimatedCostCents ?? 0),
      estimatedCostUsd: accumulator.estimatedCostUsd + (item.estimatedCostUsd ?? 0),
    }),
    {
      totalTokens: 0,
      estimatedCostCents: 0,
      estimatedCostUsd: 0,
    }
  )
  const hasEstimatedAiCost = usageBySource.some((item) => item.estimatedCostUsd !== null)
  const unpricedAiUsageBySourceMap = new Map(
    unpricedUsageBySource.map((item) => [item.source, item._count._all])
  )
  const professionalUpcomingMap = new Map(
    professionalUpcomingCounts.map((item) => [item.professionalId, item._count._all])
  )
  const serviceUpcomingMap = new Map(
    serviceUpcomingCounts.map((item) => [item.serviceId, item._count._all])
  )
  const customerUpcomingMap = new Map(
    customerUpcomingCounts.map((item) => [item.customerId, item._count._all])
  )
  const activeProfessionalsCount = professionals.filter((professional) => professional.active).length
  const activeServicesCount = services.filter((service) => service.active).length
  const checklist = buildBarbershopOnboardingChecklist({
    barbershop: {
      name: barbershop.name,
      slug: barbershop.slug,
      timezone,
      whatsappEnabled: barbershop.whatsappEnabled,
      evolutionInstanceName: barbershop.evolutionInstanceName,
    },
    metrics: {
      activeProfessionals: activeProfessionalsCount,
      activeServices: activeServicesCount,
      customers: barbershop._count.customers,
      upcomingAppointments: futureAppointmentsCount,
      financialCategories: financialCategoriesCount,
      whatsappLastEventAt: messagingLastEvent?.createdAt ?? null,
    },
  })

  const recentErrors = [
    ...failedAiUsage.map((item) => ({
      id: `ai:${item.id}`,
      kind: 'AI' as const,
      message: item.errorMessage ?? 'Falha de IA sem detalhe adicional.',
      createdAt: item.createdAt,
    })),
    ...failedMessaging.map((item) => ({
      id: `msg:${item.id}`,
      kind: 'WHATSAPP' as const,
      message: item.lastError ?? 'Falha de WhatsApp sem detalhe adicional.',
      createdAt: item.createdAt,
    })),
    ...failedAutomation.map((item) => ({
      id: `automation:${item.id}`,
      kind: 'AUTOMATION' as const,
      message: item.lastError ?? 'Falha de automacao sem detalhe adicional.',
      createdAt: item.startedAt,
    })),
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, RECENT_ERROR_LIMIT)

  await recordPlatformAuditLog({
    platformUserId: session.userId,
    action: 'platform.barbershop.view',
    targetBarbershopId: barbershopId,
    metadataJson: {
      slug: barbershop.slug,
    },
  })

  return {
    pricing,
    warnings: Array.from(new Set(warnings)),
    barbershop: {
      id: barbershop.id,
      name: barbershop.name,
      slug: barbershop.slug,
      timezone,
      address: barbershop.address,
      phone: barbershop.phone,
      email: barbershop.email,
      operationalActive: barbershop.active,
      subscriptionPlan: barbershop.subscriptionPlan,
      subscriptionStatus: barbershop.subscriptionStatus,
      trialEndsAt: barbershop.trialEndsAt,
      billingEmail: barbershop.billingEmail,
      whatsappEnabled: barbershop.whatsappEnabled,
      evolutionInstanceName: barbershop.evolutionInstanceName,
      whatsappLastInboundAt: barbershop.whatsappLastInboundAt,
      whatsappLastOutboundAt: barbershop.whatsappLastOutboundAt,
      whatsappLastErrorAt: barbershop.whatsappLastErrorAt,
      whatsappLastErrorMessage: barbershop.whatsappLastErrorMessage,
      blockedAt: barbershop.blockedAt,
      blockedReason: barbershop.blockedReason,
      createdAt: barbershop.createdAt,
      updatedAt: barbershop.updatedAt,
      createdAtLabel: formatDateTimeInTimezone(barbershop.createdAt, timezone),
    },
    totals: {
      users: barbershop._count.users,
      professionals: barbershop._count.professionals,
      customers: barbershop._count.customers,
      appointmentsThisMonth,
      upcomingAppointments: futureAppointmentsCount,
      whatsappMessagesThisMonth,
      aiTokensThisMonth: aiTotals.totalTokens,
      aiEstimatedCostCents: hasEstimatedAiCost ? aiTotals.estimatedCostCents : (aiTotals.totalTokens === 0 ? 0 : null),
      aiEstimatedCostUsd: hasEstimatedAiCost ? aiTotals.estimatedCostUsd : (aiTotals.totalTokens === 0 ? 0 : null),
      aiEstimatedCostBrl: hasEstimatedAiCost
        ? convertUsdToBrl(aiTotals.estimatedCostUsd, pricing.usdBrlRate)
        : aiTotals.totalTokens === 0
          ? convertUsdToBrl(0, pricing.usdBrlRate)
          : null,
      automationsThisMonth: automationsThisMonthCount,
    },
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      platformRole: user.platformRole,
      active: user.active,
      createdAt: user.createdAt,
    })),
    serviceCategories,
    professionals: professionals.map((professional) => ({
      id: professional.id,
      name: professional.name,
      email: professional.email,
      phone: professional.phone,
      avatar: professional.avatar,
      active: professional.active,
      attendanceScope: resolveProfessionalAttendanceScope({
        acceptsSubscription: professional.acceptsSubscription,
        acceptsWalkIn: professional.acceptsWalkIn,
      }),
      commissionRate: normalizeNumericValue(professional.commissionRate),
      haircutPrice: normalizeNumericValue(professional.haircutPrice),
      beardPrice: normalizeNumericValue(professional.beardPrice),
      comboPrice: normalizeNumericValue(professional.comboPrice),
      upcomingAppointments: professionalUpcomingMap.get(professional.id) ?? 0,
      createdAt: professional.createdAt,
    })),
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      price: normalizeNumericValue(service.price) ?? 0,
      duration: service.duration,
      active: service.active,
      categoryId: service.categoryId,
      categoryName: service.category?.name ?? null,
      upcomingAppointments: serviceUpcomingMap.get(service.id) ?? 0,
      createdAt: service.createdAt,
    })),
    customers: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      notes: customer.notes,
      type: customer.type,
      subscriptionStatus: customer.subscriptionStatus,
      subscriptionPrice: normalizeNumericValue(customer.subscriptionPrice),
      subscriptionStartedAt: customer.subscriptionStartedAt,
      preferredProfessionalId: customer.preferredProfessionalId,
      preferredProfessionalName: customer.preferredProfessional?.name ?? null,
      active: customer.active,
      marketingOptOut: Boolean(customer.marketingOptOutAt),
      upcomingAppointments: customerUpcomingMap.get(customer.id) ?? 0,
      updatedAt: customer.updatedAt,
    })),
    checklist,
    schedule: {
      defaultWindow: {
        startHour: SCHEDULE_START_HOUR,
        endHour: SCHEDULE_END_HOUR,
        label: `${String(SCHEDULE_START_HOUR).padStart(2, '0')}:00 - ${String(SCHEDULE_END_HOUR).padStart(2, '0')}:00`,
      },
      upcomingBlocks: upcomingBlocks.map((block) => ({
        id: block.id,
        professionalId: block.professionalId,
        professionalName: block.professional.name,
        startAt: block.startAt,
        endAt: block.endAt,
        notes: block.notes,
        dateInputValue: formatDateInputInTimezone(block.startAt, timezone),
        startTimeValue: formatTimeInputInTimezone(block.startAt, timezone),
        endTimeValue: formatTimeInputInTimezone(block.endAt, timezone),
        dateLabel: new Intl.DateTimeFormat('pt-BR', {
          timeZone: timezone,
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(block.startAt),
        startTimeLabel: new Intl.DateTimeFormat('pt-BR', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
        }).format(block.startAt),
        endTimeLabel: new Intl.DateTimeFormat('pt-BR', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
        }).format(block.endAt),
      })),
    },
    migration: {
      documentationPath: 'docs/migration-playbook.md',
      strategyCards: [
        {
          id: 'greenfield',
          title: 'Sem sistema anterior',
          description: 'Comece pela barbearia, equipe, servicos e disponibilidade. Depois cadastre clientes-chave e agenda futura.',
        },
        {
          id: 'cash-barber',
          title: 'Cash Barber',
          description: 'Use esta fase para revisar equipe, servicos, precos, clientes principais e compromissos futuros antes do piloto.',
        },
        {
          id: 'manual',
          title: 'Migracao manual assistida',
          description: 'Alimente profissionais, servicos, clientes e bloqueios operacionais direto pelo painel master enquanto o importador automatico nao chega.',
        },
      ],
      csvPreview: {
        professionals: ['name', 'email', 'phone', 'attendanceScope', 'commissionRate'],
        services: ['name', 'price', 'duration', 'description', 'category'],
        customers: ['name', 'phone', 'email', 'type', 'subscriptionStatus'],
        futureAppointments: ['customerName', 'professionalName', 'serviceName', 'date', 'time'],
      },
    },
    aiUsageBySource: usageBySource.map((item) => ({
      source: item.source,
      requests: item.requests,
      inputTokens: item.inputTokens,
      cachedInputTokens: item.cachedInputTokens,
      outputTokens: item.outputTokens,
      totalTokens: item.totalTokens,
      estimatedCostCents: item.estimatedCostCents,
      estimatedCostUsd: item.estimatedCostUsd,
      estimatedCostBrl: convertUsdToBrl(item.estimatedCostUsd, pricing.usdBrlRate),
      unpricedRequests: unpricedAiUsageBySourceMap.get(item.source) ?? 0,
      lastUsedAt: item.lastUsedAt,
    })),
    integrations: {
      whatsappEnabled: barbershop.whatsappEnabled,
      evolutionInstanceName: barbershop.evolutionInstanceName,
      evolutionApiKeyManagedPerTenant: false,
      webhookSecretConfigured: Boolean(process.env.EVOLUTION_WEBHOOK_SECRET),
      webhookSecretMasked: maskSecretPreview(process.env.EVOLUTION_WEBHOOK_SECRET),
      whatsappStatusLabel: barbershop.whatsappEnabled
        ? barbershop.evolutionInstanceName
          ? 'Configurado'
          : 'Atenção: falta instance'
        : 'Desabilitado',
      whatsappLastEventAt: messagingLastEvent?.createdAt ?? null,
      automationActiveConfigs,
      automationLastRunAt: automationLastRun?.startedAt ?? null,
      aiLastUsageAt: aiLastUsage?.createdAt ?? null,
    },
    recentAutomations,
    recentUsage,
    recentErrors,
  }
}
