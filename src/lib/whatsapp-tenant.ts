import 'server-only'

import { prisma } from '@/lib/prisma'

export type WhatsAppTenantMatchedBy = 'instance' | 'route_slug' | 'legacy_env_slug' | null

export interface WhatsAppTenantBarbershop {
  id: string
  name: string
  slug: string
  timezone: string
  whatsappEnabled: boolean
  evolutionInstanceName: string | null
}

export interface WhatsAppTenantResolutionResult {
  status: 'resolved' | 'ignored' | 'error'
  barbershop: WhatsAppTenantBarbershop | null
  barbershopId: string | null
  barbershopSlug: string | null
  barbershopName: string | null
  integrationId: string | null
  instanceName: string | null
  instanceNameReceived: string | null
  routeSlug: string | null
  matchedBy: WhatsAppTenantMatchedBy
  reason: string
}

export interface WhatsAppOutboundIntegrationResult {
  status: 'resolved' | 'missing'
  barbershop: WhatsAppTenantBarbershop | null
  barbershopId: string
  barbershopSlug: string | null
  barbershopName: string | null
  instanceName: string | null
  matchedBy: 'configured_instance' | 'legacy_env_slug' | null
  reason: string
}

type BarbershopConfigRow = {
  id: string
  name: string
  slug: string
  timezone: string
  active: boolean
  whatsappEnabled: boolean
  evolutionInstanceName: string | null
}

function normalizeTenantKey(value?: string | null) {
  if (!value) {
    return null
  }

  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseBooleanEnvFlag(value?: string | null) {
  return value?.trim().toLowerCase() === 'true'
}

function getLegacyFallbackFlag() {
  return parseBooleanEnvFlag(process.env.EVOLUTION_ALLOW_LEGACY_SINGLE_TENANT_FALLBACK)
}

function getLegacyBarbershopSlug() {
  const slug = process.env.EVOLUTION_BARBERSHOP_SLUG?.trim()
  return slug || null
}

function getLegacyInstanceName() {
  const instance = process.env.EVOLUTION_INSTANCE?.trim()
  return instance || null
}

function toTenantBarbershop(row: BarbershopConfigRow): WhatsAppTenantBarbershop {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    whatsappEnabled: row.whatsappEnabled,
    evolutionInstanceName: row.evolutionInstanceName,
  }
}

function buildResolutionResult(input: {
  status: WhatsAppTenantResolutionResult['status']
  barbershop: BarbershopConfigRow | null
  instanceName: string | null
  instanceNameReceived: string | null
  routeSlug: string | null
  matchedBy: WhatsAppTenantMatchedBy
  reason: string
}): WhatsAppTenantResolutionResult {
  const barbershop = input.barbershop ? toTenantBarbershop(input.barbershop) : null

  return {
    status: input.status,
    barbershop,
    barbershopId: barbershop?.id ?? null,
    barbershopSlug: barbershop?.slug ?? null,
    barbershopName: barbershop?.name ?? null,
    integrationId: barbershop?.id ?? null,
    instanceName: input.instanceName,
    instanceNameReceived: input.instanceNameReceived,
    routeSlug: input.routeSlug,
    matchedBy: input.matchedBy,
    reason: input.reason,
  }
}

async function loadActiveBarbershopConfigs() {
  return prisma.barbershop.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      active: true,
      whatsappEnabled: true,
      evolutionInstanceName: true,
    },
  })
}

function findBarbershopBySlug(rows: BarbershopConfigRow[], slug: string | null) {
  const normalizedSlug = normalizeTenantKey(slug)
  if (!normalizedSlug) {
    return null
  }

  return rows.find((row) => normalizeTenantKey(row.slug) === normalizedSlug) ?? null
}

function findBarbershopByInstance(rows: BarbershopConfigRow[], instanceName: string | null) {
  const normalizedInstanceName = normalizeTenantKey(instanceName)
  if (!normalizedInstanceName) {
    return null
  }

  return rows.find((row) =>
    row.whatsappEnabled
    && normalizeTenantKey(row.evolutionInstanceName) === normalizedInstanceName
  ) ?? null
}

function canUseLegacyFallbackForBarbershop(barbershop: Pick<BarbershopConfigRow, 'slug'>) {
  const legacyFallbackEnabled = getLegacyFallbackFlag()
  const legacyBarbershopSlug = getLegacyBarbershopSlug()
  const legacyInstanceName = getLegacyInstanceName()

  return Boolean(
    legacyFallbackEnabled
    && legacyBarbershopSlug
    && legacyInstanceName
    && normalizeTenantKey(barbershop.slug) === normalizeTenantKey(legacyBarbershopSlug)
  )
}

export async function resolveWhatsAppTenantFromEvolutionPayload(input: {
  instanceName?: string | null
  routeBarbershopSlug?: string | null
}) {
  const instanceNameReceived = input.instanceName?.trim() || null
  const routeSlug = input.routeBarbershopSlug?.trim() || null

  console.info('[whatsapp-tenant] resolving started', {
    instanceNameReceived,
    routeSlug,
  })

  const barbershops = await loadActiveBarbershopConfigs()
  const routeBarbershop = findBarbershopBySlug(barbershops, routeSlug)

  if (routeSlug && !routeBarbershop) {
    const result = buildResolutionResult({
      status: 'error',
      barbershop: null,
      instanceName: instanceNameReceived,
      instanceNameReceived,
      routeSlug,
      matchedBy: null,
      reason: 'route_slug_not_found',
    })

    console.error('[whatsapp-tenant] slug_instance_mismatch', {
      instanceNameReceived,
      routeSlug,
      matchedBy: result.matchedBy,
      finalReason: result.reason,
    })

    return result
  }

  if (instanceNameReceived) {
    const instanceBarbershop = findBarbershopByInstance(barbershops, instanceNameReceived)

    if (!instanceBarbershop) {
      const result = buildResolutionResult({
        status: 'ignored',
        barbershop: null,
        instanceName: instanceNameReceived,
        instanceNameReceived,
        routeSlug,
        matchedBy: null,
        reason: 'unknown_instance',
      })

      console.warn('[whatsapp-tenant] unknown_instance', {
        instanceNameReceived,
        routeSlug,
        matchedBy: result.matchedBy,
        finalReason: result.reason,
      })

      return result
    }

    if (routeBarbershop && routeBarbershop.id !== instanceBarbershop.id) {
      const result = buildResolutionResult({
        status: 'error',
        barbershop: instanceBarbershop,
        instanceName: instanceBarbershop.evolutionInstanceName ?? instanceNameReceived,
        instanceNameReceived,
        routeSlug,
        matchedBy: null,
        reason: 'slug_instance_mismatch',
      })

      console.error('[whatsapp-tenant] slug_instance_mismatch', {
        instanceNameReceived,
        routeSlug,
        barbershopId: instanceBarbershop.id,
        barbershopSlug: instanceBarbershop.slug,
        matchedBy: result.matchedBy,
        finalReason: result.reason,
      })

      return result
    }

    const result = buildResolutionResult({
      status: 'resolved',
      barbershop: instanceBarbershop,
      instanceName: instanceBarbershop.evolutionInstanceName ?? instanceNameReceived,
      instanceNameReceived,
      routeSlug,
      matchedBy: 'instance',
      reason: 'resolved_by_instance',
    })

    console.info('[whatsapp-tenant] resolved_by_instance', {
      instanceNameReceived,
      routeSlug,
      barbershopId: result.barbershopId,
      barbershopSlug: result.barbershopSlug,
      matchedBy: result.matchedBy,
      finalReason: result.reason,
    })

    return result
  }

  if (routeBarbershop?.whatsappEnabled && routeBarbershop.evolutionInstanceName) {
    const result = buildResolutionResult({
      status: 'resolved',
      barbershop: routeBarbershop,
      instanceName: routeBarbershop.evolutionInstanceName,
      instanceNameReceived,
      routeSlug,
      matchedBy: 'route_slug',
      reason: 'resolved_by_slug',
    })

    console.info('[whatsapp-tenant] resolved_by_slug', {
      instanceNameReceived,
      routeSlug,
      barbershopId: result.barbershopId,
      barbershopSlug: result.barbershopSlug,
      matchedBy: result.matchedBy,
      finalReason: result.reason,
    })

    return result
  }

  if (routeBarbershop && canUseLegacyFallbackForBarbershop(routeBarbershop)) {
    const legacyInstanceName = getLegacyInstanceName()
    const result = buildResolutionResult({
      status: 'resolved',
      barbershop: routeBarbershop,
      instanceName: legacyInstanceName,
      instanceNameReceived,
      routeSlug,
      matchedBy: 'legacy_env_slug',
      reason: 'legacy_fallback_used',
    })

    console.warn('[whatsapp-tenant] legacy_fallback_used', {
      instanceNameReceived,
      routeSlug,
      barbershopId: result.barbershopId,
      barbershopSlug: result.barbershopSlug,
      matchedBy: result.matchedBy,
      finalReason: result.reason,
    })

    return result
  }

  if (getLegacyFallbackFlag()) {
    const legacyBarbershop = findBarbershopBySlug(barbershops, getLegacyBarbershopSlug())
    const legacyInstanceName = getLegacyInstanceName()

    if (legacyBarbershop && legacyInstanceName) {
      const result = buildResolutionResult({
        status: 'resolved',
        barbershop: legacyBarbershop,
        instanceName: legacyInstanceName,
        instanceNameReceived,
        routeSlug,
        matchedBy: 'legacy_env_slug',
        reason: 'legacy_fallback_used',
      })

      console.warn('[whatsapp-tenant] legacy_fallback_used', {
        instanceNameReceived,
        routeSlug,
        barbershopId: result.barbershopId,
        barbershopSlug: result.barbershopSlug,
        matchedBy: result.matchedBy,
        finalReason: result.reason,
      })

      return result
    }
  }

  return buildResolutionResult({
    status: 'ignored',
    barbershop: routeBarbershop,
    instanceName: null,
    instanceNameReceived,
    routeSlug,
    matchedBy: null,
    reason: routeBarbershop ? 'route_slug_without_integration' : 'tenant_not_resolved',
  })
}

export async function resolveWhatsAppOutboundIntegration(input: {
  barbershopId: string
}) : Promise<WhatsAppOutboundIntegrationResult> {
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: input.barbershopId },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      active: true,
      whatsappEnabled: true,
      evolutionInstanceName: true,
    },
  })

  if (!barbershop || !barbershop.active) {
    const result: WhatsAppOutboundIntegrationResult = {
      status: 'missing',
      barbershop: barbershop ? toTenantBarbershop(barbershop) : null,
      barbershopId: input.barbershopId,
      barbershopSlug: barbershop?.slug ?? null,
      barbershopName: barbershop?.name ?? null,
      instanceName: null,
      matchedBy: null,
      reason: 'barbershop_not_found',
    }

    console.warn('[whatsapp-tenant] outbound_integration_missing', result)
    return result
  }

  if (barbershop.whatsappEnabled && barbershop.evolutionInstanceName) {
    const result: WhatsAppOutboundIntegrationResult = {
      status: 'resolved',
      barbershop: toTenantBarbershop(barbershop),
      barbershopId: barbershop.id,
      barbershopSlug: barbershop.slug,
      barbershopName: barbershop.name,
      instanceName: barbershop.evolutionInstanceName,
      matchedBy: 'configured_instance',
      reason: 'configured_instance',
    }

    console.info('[whatsapp-tenant] outbound_integration_loaded', result)
    return result
  }

  if (canUseLegacyFallbackForBarbershop(barbershop)) {
    const result: WhatsAppOutboundIntegrationResult = {
      status: 'resolved',
      barbershop: toTenantBarbershop(barbershop),
      barbershopId: barbershop.id,
      barbershopSlug: barbershop.slug,
      barbershopName: barbershop.name,
      instanceName: getLegacyInstanceName(),
      matchedBy: 'legacy_env_slug',
      reason: 'legacy_fallback_used',
    }

    console.warn('[whatsapp-tenant] legacy_fallback_used', result)
    console.info('[whatsapp-tenant] outbound_integration_loaded', result)
    return result
  }

  const result: WhatsAppOutboundIntegrationResult = {
    status: 'missing',
    barbershop: toTenantBarbershop(barbershop),
    barbershopId: barbershop.id,
    barbershopSlug: barbershop.slug,
    barbershopName: barbershop.name,
    instanceName: null,
    matchedBy: null,
    reason: 'outbound_integration_missing',
  }

  console.warn('[whatsapp-tenant] outbound_integration_missing', result)
  return result
}

async function updateWhatsAppStatus(barbershopId: string, data: {
  whatsappLastInboundAt?: Date
  whatsappLastOutboundAt?: Date
  whatsappLastErrorAt?: Date | null
  whatsappLastErrorMessage?: string | null
}) {
  try {
    await prisma.barbershop.update({
      where: { id: barbershopId },
      data,
    })
  } catch (error) {
    console.warn('[whatsapp-tenant] status_update_failed', {
      barbershopId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function markWhatsAppInboundReceived(barbershopId: string) {
  await updateWhatsAppStatus(barbershopId, {
    whatsappLastInboundAt: new Date(),
  })
}

export async function markWhatsAppOutboundDelivered(barbershopId: string) {
  await updateWhatsAppStatus(barbershopId, {
    whatsappLastOutboundAt: new Date(),
    whatsappLastErrorAt: null,
    whatsappLastErrorMessage: null,
  })
}

export async function markWhatsAppIntegrationError(input: {
  barbershopId: string
  message: string
}) {
  await updateWhatsAppStatus(input.barbershopId, {
    whatsappLastErrorAt: new Date(),
    whatsappLastErrorMessage: input.message.slice(0, 500),
  })
}

export const __testing = {
  normalizeTenantKey,
  getLegacyFallbackFlag,
  getLegacyBarbershopSlug,
  getLegacyInstanceName,
}
