'use server'

import { revalidatePath } from 'next/cache'
import { BarbershopSubscriptionStatus, OperationalCategoryType, type Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { BRAZIL_TIMEZONES } from '@/lib/onboarding'
import {
  attendanceScopeToFlags,
  resolveProfessionalAttendanceScope,
} from '@/lib/professionals/operational-config'
import {
  isProfessionalAvatarUrl,
  normalizeProfessionalAvatarUrl,
} from '@/lib/professionals/avatar'
import {
  buildOperationalBlockSourceReference,
  isOperationalBlockSourceReference,
  OPERATIONAL_BLOCK_CUSTOMER_NAME,
  OPERATIONAL_BLOCK_SERVICE_NAME,
} from '@/lib/agendamentos/operational-blocks'
import {
  buildBusinessDateTimeFromTimeLabel,
  resolveBusinessTimezone,
} from '@/lib/timezone'
import {
  ensureResourceBelongsToBarbershop,
  requirePlatformAdmin,
} from '@/lib/security/guards'
import { safeLog } from '@/lib/security/safe-logger'

type ActionResult = { success: true } | { success: false; error: string }
type MutationResult = { success: true; id: string } | { success: false; error: string }

const BARBERSHOP_STATUS_VALUES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'BLOCKED', 'CANCELED'] as const
const CUSTOMER_TYPE_VALUES = ['SUBSCRIPTION', 'WALK_IN'] as const
const SUBSCRIPTION_STATUS_VALUES = ['ACTIVE', 'PAUSED', 'CANCELLED'] as const
const VALID_TIMEZONE_VALUES = new Set(BRAZIL_TIMEZONES.map((timezone) => timezone.value))

const nullableCuid = z.string().cuid().optional().nullable()

function normalizeOptionalText(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  const normalized = String(value).trim()
  return normalized.length > 0 ? normalized : null
}

function parseOptionalDecimal(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  const normalized = String(value).trim().replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : value
}

function parseOptionalDate(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  return value
}

function toDateAtUtcNoon(value: string | null | undefined) {
  if (!value) {
    return null
  }

  return new Date(`${value}T12:00:00.000Z`)
}

function toDateInputValue(value: Date | null | undefined) {
  if (!value) {
    return null
  }

  return value.toISOString().slice(0, 10)
}

function buildMutationError(error: unknown, fallbackMessage: string) {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallbackMessage,
  } satisfies ActionResult
}

async function recordPlatformMutation(input: {
  platformUserId: string
  action: string
  targetBarbershopId: string
  metadataJson?: Prisma.InputJsonValue | null
}) {
  try {
    await prisma.platformAuditLog.create({
      data: {
        platformUserId: input.platformUserId,
        action: input.action,
        targetBarbershopId: input.targetBarbershopId,
        metadataJson: input.metadataJson ?? undefined,
      },
    })
  } catch (error) {
    safeLog('warn', '[platform-admin-actions] audit_log_failed', {
      action: input.action,
      targetBarbershopId: input.targetBarbershopId,
      error,
    })
  }
}

function revalidatePlatformTenantPaths(barbershopId: string) {
  revalidatePath('/internal')
  revalidatePath(`/internal/barbershops/${barbershopId}`)
}

function revalidateOperationalTenantPaths(barbershopId: string) {
  revalidatePlatformTenantPaths(barbershopId)
  revalidatePath('/dashboard')
  revalidatePath('/agendamentos')
  revalidatePath('/equipe')
  revalidatePath('/equipe/profissionais')
  revalidatePath('/equipe/desempenho')
  revalidatePath('/equipe/metas')
  revalidatePath('/precificacao')
  revalidatePath('/precificacao/servicos')
  revalidatePath('/clientes')
  revalidatePath('/inteligencia')
  revalidatePath('/configuracoes')
}

async function requireTargetBarbershop(barbershopId: string) {
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: {
      id: true,
      slug: true,
      name: true,
      timezone: true,
      active: true,
      blockedAt: true,
    },
  })

  if (!barbershop) {
    throw new Error('Barbearia alvo nao encontrada para a operacao interna.')
  }

  return barbershop
}

async function ensureServiceCategory(
  barbershopId: string,
  categoryId: string | null | undefined
) {
  if (!categoryId) {
    return null
  }

  const category = await prisma.operationalCategory.findUnique({
    where: { id: categoryId },
    select: {
      id: true,
      barbershopId: true,
      type: true,
    },
  })

  if (!category || category.barbershopId !== barbershopId || category.type !== OperationalCategoryType.SERVICE) {
    throw new Error('Categoria de servico invalida para esta barbearia.')
  }

  return category.id
}

async function ensureProfessionalForTarget(barbershopId: string, professionalId: string) {
  const professional = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: {
      id: true,
      barbershopId: true,
      avatar: true,
      email: true,
      active: true,
      acceptsSubscription: true,
      acceptsWalkIn: true,
    },
  })

  if (!professional) {
    throw new Error('Profissional nao encontrado.')
  }

  ensureResourceBelongsToBarbershop(professional.barbershopId, barbershopId, 'Profissional nao encontrado.')
  return professional
}

async function ensureServiceForTarget(barbershopId: string, serviceId: string) {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: {
      id: true,
      barbershopId: true,
    },
  })

  if (!service) {
    throw new Error('Servico nao encontrado.')
  }

  ensureResourceBelongsToBarbershop(service.barbershopId, barbershopId, 'Servico nao encontrado.')
  return service
}

async function ensureCustomerForTarget(barbershopId: string, customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      barbershopId: true,
      preferredProfessionalId: true,
    },
  })

  if (!customer) {
    throw new Error('Cliente nao encontrado.')
  }

  ensureResourceBelongsToBarbershop(customer.barbershopId, barbershopId, 'Cliente nao encontrado.')
  return customer
}

async function ensureScheduleBlockForTarget(barbershopId: string, blockId: string) {
  const block = await prisma.appointment.findUnique({
    where: { id: blockId },
    select: {
      id: true,
      barbershopId: true,
      professionalId: true,
      sourceReference: true,
      notes: true,
    },
  })

  if (!block || !isOperationalBlockSourceReference(block.sourceReference)) {
    throw new Error('Bloqueio operacional nao encontrado.')
  }

  ensureResourceBelongsToBarbershop(block.barbershopId, barbershopId, 'Bloqueio operacional nao encontrado.')
  return block
}

async function ensureOperationalBlockEntities(barbershopId: string) {
  const existingService = await prisma.service.findFirst({
    where: {
      barbershopId,
      name: OPERATIONAL_BLOCK_SERVICE_NAME,
    },
    select: { id: true },
  })

  const service = existingService
    ? await prisma.service.update({
      where: { id: existingService.id },
      data: { active: false },
      select: { id: true },
    })
    : await prisma.service.create({
      data: {
        barbershopId,
        name: OPERATIONAL_BLOCK_SERVICE_NAME,
        description: 'Marcador interno para bloqueio operacional da agenda.',
        price: 0,
        duration: 15,
        active: false,
      },
      select: { id: true },
    })

  const existingCustomer = await prisma.customer.findFirst({
    where: {
      barbershopId,
      name: OPERATIONAL_BLOCK_CUSTOMER_NAME,
    },
    select: { id: true },
  })

  const customer = existingCustomer
    ? await prisma.customer.update({
      where: { id: existingCustomer.id },
      data: { active: false },
      select: { id: true },
    })
    : await prisma.customer.create({
      data: {
        barbershopId,
        name: OPERATIONAL_BLOCK_CUSTOMER_NAME,
        active: false,
        type: 'WALK_IN',
      },
      select: { id: true },
    })

  return {
    serviceId: service.id,
    customerId: customer.id,
  }
}

async function ensureOperationalBlockAvailability(input: {
  appointmentId?: string
  barbershopId: string
  professionalId: string
  startAt: Date
  endAt: Date
  timezone: string
}) {
  const conflict = await prisma.appointment.findFirst({
    where: {
      barbershopId: input.barbershopId,
      professionalId: input.professionalId,
      id: input.appointmentId ? { not: input.appointmentId } : undefined,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
    },
    select: {
      startAt: true,
      endAt: true,
      sourceReference: true,
      notes: true,
      customer: {
        select: {
          name: true,
        },
      },
    },
  })

  if (!conflict) {
    return
  }

  const formatTime = new Intl.DateTimeFormat('pt-BR', {
    timeZone: input.timezone,
    hour: '2-digit',
    minute: '2-digit',
  })

  const startLabel = formatTime.format(conflict.startAt)
  const endLabel = formatTime.format(conflict.endAt)

  if (isOperationalBlockSourceReference(conflict.sourceReference)) {
    throw new Error(
      `Esse intervalo ja esta bloqueado entre ${startLabel} e ${endLabel}${conflict.notes ? ` (${conflict.notes})` : ''}.`
    )
  }

  throw new Error(`Esse profissional ja possui atendimento com ${conflict.customer.name} entre ${startLabel} e ${endLabel}.`)
}

const PlatformBarbershopSchema = z.object({
  barbershopId: z.string().cuid('Barbearia invalida'),
  name: z.string().trim().min(2, 'Nome obrigatorio').max(120, 'Nome muito longo'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug deve usar apenas minusculas, numeros e hifens'),
  timezone: z
    .string()
    .trim()
    .refine((value) => VALID_TIMEZONE_VALUES.has(value), 'Timezone invalida para operacao no Brasil'),
  active: z.boolean(),
  phone: z.string().trim().max(30, 'Telefone muito longo').optional().or(z.literal('')),
  email: z.string().trim().email('Email invalido').optional().or(z.literal('')),
  address: z.string().trim().max(200, 'Endereco muito longo').optional().or(z.literal('')),
  billingEmail: z.string().trim().email('Email de cobranca invalido').optional().or(z.literal('')),
  subscriptionPlan: z.string().trim().max(60, 'Plano muito longo').optional().or(z.literal('')),
  subscriptionStatus: z.enum(BARBERSHOP_STATUS_VALUES),
  trialEndsAt: z.preprocess(
    parseOptionalDate,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de trial invalida').nullable().optional()
  ),
  blockedReason: z.string().trim().max(240, 'Motivo de bloqueio muito longo').optional().or(z.literal('')),
  whatsappEnabled: z.boolean(),
  evolutionInstanceName: z
    .string()
    .trim()
    .max(80, 'Instance muito longa')
    .optional()
    .or(z.literal(''))
    .refine(
      (value) => !value || /^[A-Za-z0-9._-]+$/.test(value),
      'Instance deve usar apenas letras, numeros, ponto, underline ou hifen'
    ),
})

const PlatformProfessionalSchema = z.object({
  barbershopId: z.string().cuid('Barbearia invalida'),
  name: z.string().trim().min(2, 'Nome deve ter ao menos 2 caracteres').max(100),
  email: z.string().trim().email('Email invalido').optional().or(z.literal('')),
  phone: z.string().trim().max(20, 'Telefone muito longo').optional().or(z.literal('')),
  avatar: z.string().trim().max(500, 'URL da foto muito longa').optional().or(z.literal('')).refine(
    (value) => !value || isProfessionalAvatarUrl(value),
    'URL da foto invalida'
  ),
  commissionRate: z.preprocess(
    parseOptionalDecimal,
    z.number().min(0, 'Comissao invalida').max(100, 'Comissao invalida').nullable().optional()
  ),
  haircutPrice: z.preprocess(
    parseOptionalDecimal,
    z.number().positive('Preco do corte invalido').max(9999, 'Preco do corte invalido').nullable().optional()
  ),
  beardPrice: z.preprocess(
    parseOptionalDecimal,
    z.number().positive('Preco da barba invalido').max(9999, 'Preco da barba invalido').nullable().optional()
  ),
  comboPrice: z.preprocess(
    parseOptionalDecimal,
    z.number().positive('Preco do combo invalido').max(9999, 'Preco do combo invalido').nullable().optional()
  ),
  attendanceScope: z.enum(['BOTH', 'SUBSCRIPTION_ONLY', 'WALK_IN_ONLY']).default('BOTH'),
  active: z.boolean().default(true),
})

const PlatformServiceSchema = z.object({
  barbershopId: z.string().cuid('Barbearia invalida'),
  name: z.string().trim().min(2, 'Nome do servico obrigatorio').max(120, 'Nome muito longo'),
  description: z.string().trim().max(240, 'Descricao muito longa').optional().or(z.literal('')),
  price: z.preprocess(
    parseOptionalDecimal,
    z.number().positive('Preco deve ser positivo').max(999999, 'Preco invalido')
  ),
  duration: z.coerce.number({ invalid_type_error: 'Duracao invalida' })
    .int('Duracao invalida')
    .positive('Duracao deve ser positiva')
    .max(720, 'Duracao muito longa'),
  categoryId: nullableCuid.or(z.literal('')),
  active: z.boolean().default(true),
})

const PlatformCustomerSchema = z.object({
  barbershopId: z.string().cuid('Barbearia invalida'),
  name: z.string().trim().min(2, 'Nome obrigatorio (min. 2 caracteres)').max(120, 'Nome muito longo'),
  phone: z
    .string()
    .trim()
    .max(30, 'Telefone muito longo')
    .optional()
    .or(z.literal(''))
    .refine((value) => !value || value.replace(/\D/g, '').length >= 10, 'Telefone invalido'),
  email: z
    .string()
    .trim()
    .email('Email invalido')
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().max(1000, 'Observacoes muito longas').optional().or(z.literal('')),
  type: z.enum(CUSTOMER_TYPE_VALUES),
  preferredProfessionalId: z.string().cuid('Barbeiro preferido invalido').optional().or(z.literal('')),
  active: z.boolean().default(true),
  marketingOptOut: z.boolean().default(false),
  subscriptionStatus: z.enum(SUBSCRIPTION_STATUS_VALUES).optional().or(z.literal('')),
  subscriptionPrice: z.preprocess(
    parseOptionalDecimal,
    z.number().min(0, 'Valor da assinatura invalido').max(9999, 'Valor da assinatura invalido').nullable().optional()
  ),
  subscriptionStartedAt: z.preprocess(
    parseOptionalDate,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de inicio invalida').nullable().optional()
  ),
})

const PlatformScheduleBlockSchema = z.object({
  barbershopId: z.string().cuid('Barbearia invalida'),
  professionalId: z.string().cuid('Profissional invalido'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horario inicial invalido'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horario final invalido'),
  notes: z.string().trim().max(400, 'Observacao muito longa').optional().or(z.literal('')),
})

export async function updatePlatformBarbershop(rawData: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const parsed = PlatformBarbershopSchema.safeParse(rawData)

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data

  try {
    const existing = await requireTargetBarbershop(data.barbershopId)

    const duplicateSlug = await prisma.barbershop.findFirst({
      where: {
        slug: data.slug,
        id: { not: data.barbershopId },
      },
      select: { id: true },
    })

    if (duplicateSlug) {
      return { success: false, error: 'Ja existe outra barbearia com este slug.' }
    }

    if (data.evolutionInstanceName) {
      const duplicateInstance = await prisma.barbershop.findFirst({
        where: {
          evolutionInstanceName: data.evolutionInstanceName,
          id: { not: data.barbershopId },
        },
        select: { id: true },
      })

      if (duplicateInstance) {
        return { success: false, error: 'Essa instance ja esta vinculada a outro tenant.' }
      }
    }

    const trialEndsAt = toDateAtUtcNoon(data.trialEndsAt)
    const shouldMarkBlocked = data.subscriptionStatus === 'BLOCKED'

    await prisma.barbershop.update({
      where: { id: data.barbershopId },
      data: {
        name: data.name,
        slug: data.slug,
        timezone: resolveBusinessTimezone(data.timezone),
        active: data.active,
        phone: normalizeOptionalText(data.phone),
        email: normalizeOptionalText(data.email)?.toLowerCase() ?? null,
        address: normalizeOptionalText(data.address),
        billingEmail: normalizeOptionalText(data.billingEmail)?.toLowerCase() ?? null,
        subscriptionPlan: normalizeOptionalText(data.subscriptionPlan),
        subscriptionStatus: data.subscriptionStatus as BarbershopSubscriptionStatus,
        trialEndsAt,
        blockedReason: shouldMarkBlocked ? normalizeOptionalText(data.blockedReason) : null,
        blockedAt: shouldMarkBlocked ? (existing.blockedAt ?? new Date()) : null,
        whatsappEnabled: data.whatsappEnabled,
        evolutionInstanceName: normalizeOptionalText(data.evolutionInstanceName),
      },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.barbershop.update',
      targetBarbershopId: data.barbershopId,
      metadataJson: {
        slugBefore: existing.slug,
        slugAfter: data.slug,
        timezone: data.timezone,
        subscriptionStatus: data.subscriptionStatus,
        whatsappEnabled: data.whatsappEnabled,
      },
    })

    revalidateOperationalTenantPaths(data.barbershopId)
    return { success: true }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] update_barbershop_failed', {
      userId: admin.userId,
      targetBarbershopId: data.barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel atualizar a barbearia.')
  }
}

export async function createPlatformProfessional(rawData: unknown): Promise<MutationResult> {
  const admin = await requirePlatformAdmin()
  const parsed = PlatformProfessionalSchema.safeParse(rawData)

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data

  try {
    await requireTargetBarbershop(data.barbershopId)

    const normalizedEmail = normalizeOptionalText(data.email)?.toLowerCase() ?? null
    if (normalizedEmail) {
      const duplicate = await prisma.professional.findUnique({
        where: {
          email_barbershopId: {
            email: normalizedEmail,
            barbershopId: data.barbershopId,
          },
        },
        select: { id: true },
      })

      if (duplicate) {
        return { success: false, error: 'Ja existe um profissional com este email.' }
      }
    }

    const attendanceFlags = attendanceScopeToFlags(data.attendanceScope)
    const created = await prisma.professional.create({
      data: {
        barbershopId: data.barbershopId,
        name: data.name,
        email: normalizedEmail,
        phone: normalizeOptionalText(data.phone),
        avatar: normalizeProfessionalAvatarUrl(data.avatar),
        commissionRate: data.commissionRate ?? null,
        haircutPrice: data.haircutPrice ?? null,
        beardPrice: data.beardPrice ?? null,
        comboPrice: data.comboPrice ?? null,
        active: data.active,
        ...attendanceFlags,
      },
      select: { id: true },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.professional.create',
      targetBarbershopId: data.barbershopId,
      metadataJson: {
        professionalId: created.id,
        name: data.name,
      },
    })

    revalidateOperationalTenantPaths(data.barbershopId)
    return { success: true, id: created.id }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] create_professional_failed', {
      userId: admin.userId,
      targetBarbershopId: data.barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel criar o profissional.')
  }
}

export async function updatePlatformProfessional(professionalId: string, rawData: unknown): Promise<MutationResult> {
  const admin = await requirePlatformAdmin()
  const parsed = PlatformProfessionalSchema.safeParse(rawData)

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data

  try {
    const existing = await ensureProfessionalForTarget(data.barbershopId, professionalId)
    const normalizedEmail = normalizeOptionalText(data.email)?.toLowerCase() ?? null

    if (normalizedEmail && normalizedEmail !== existing.email) {
      const duplicate = await prisma.professional.findUnique({
        where: {
          email_barbershopId: {
            email: normalizedEmail,
            barbershopId: data.barbershopId,
          },
        },
        select: { id: true },
      })

      if (duplicate && duplicate.id !== professionalId) {
        return { success: false, error: 'Ja existe um profissional com este email.' }
      }
    }

    const attendanceFlags = attendanceScopeToFlags(data.attendanceScope)
    await prisma.professional.update({
      where: { id: professionalId },
      data: {
        name: data.name,
        email: normalizedEmail,
        phone: normalizeOptionalText(data.phone),
        avatar: normalizeProfessionalAvatarUrl(data.avatar),
        commissionRate: data.commissionRate ?? null,
        haircutPrice: data.haircutPrice ?? null,
        beardPrice: data.beardPrice ?? null,
        comboPrice: data.comboPrice ?? null,
        active: data.active,
        ...attendanceFlags,
      },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.professional.update',
      targetBarbershopId: data.barbershopId,
      metadataJson: {
        professionalId,
        name: data.name,
        attendanceScope: data.attendanceScope,
      },
    })

    revalidateOperationalTenantPaths(data.barbershopId)
    return { success: true, id: professionalId }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] update_professional_failed', {
      userId: admin.userId,
      professionalId,
      targetBarbershopId: data.barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel atualizar o profissional.')
  }
}

export async function togglePlatformProfessionalActive(
  barbershopId: string,
  professionalId: string
): Promise<MutationResult> {
  const admin = await requirePlatformAdmin()

  try {
    const existing = await ensureProfessionalForTarget(barbershopId, professionalId)

    await prisma.professional.update({
      where: { id: professionalId },
      data: {
        active: !existing.active,
      },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.professional.toggle_active',
      targetBarbershopId: barbershopId,
      metadataJson: {
        professionalId,
      },
    })

    revalidateOperationalTenantPaths(barbershopId)
    return { success: true, id: professionalId }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] toggle_professional_failed', {
      userId: admin.userId,
      professionalId,
      targetBarbershopId: barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel alterar o status do profissional.')
  }
}

export async function createPlatformService(rawData: unknown): Promise<MutationResult> {
  const admin = await requirePlatformAdmin()
  const parsed = PlatformServiceSchema.safeParse(rawData)

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data

  try {
    await requireTargetBarbershop(data.barbershopId)
    const categoryId = await ensureServiceCategory(data.barbershopId, data.categoryId)

    const created = await prisma.service.create({
      data: {
        barbershopId: data.barbershopId,
        name: data.name,
        description: normalizeOptionalText(data.description),
        price: data.price,
        duration: data.duration,
        categoryId,
        active: data.active,
      },
      select: { id: true },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.service.create',
      targetBarbershopId: data.barbershopId,
      metadataJson: {
        serviceId: created.id,
        name: data.name,
      },
    })

    revalidateOperationalTenantPaths(data.barbershopId)
    return { success: true, id: created.id }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] create_service_failed', {
      userId: admin.userId,
      targetBarbershopId: data.barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel criar o servico.')
  }
}

export async function updatePlatformService(serviceId: string, rawData: unknown): Promise<MutationResult> {
  const admin = await requirePlatformAdmin()
  const parsed = PlatformServiceSchema.safeParse(rawData)

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data

  try {
    await ensureServiceForTarget(data.barbershopId, serviceId)
    const categoryId = await ensureServiceCategory(data.barbershopId, data.categoryId)

    await prisma.service.update({
      where: { id: serviceId },
      data: {
        name: data.name,
        description: normalizeOptionalText(data.description),
        price: data.price,
        duration: data.duration,
        categoryId,
        active: data.active,
      },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.service.update',
      targetBarbershopId: data.barbershopId,
      metadataJson: {
        serviceId,
        name: data.name,
      },
    })

    revalidateOperationalTenantPaths(data.barbershopId)
    return { success: true, id: serviceId }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] update_service_failed', {
      userId: admin.userId,
      serviceId,
      targetBarbershopId: data.barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel atualizar o servico.')
  }
}

export async function togglePlatformServiceActive(barbershopId: string, serviceId: string): Promise<MutationResult> {
  const admin = await requirePlatformAdmin()

  try {
    await ensureServiceForTarget(barbershopId, serviceId)
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { active: true },
    })

    await prisma.service.update({
      where: { id: serviceId },
      data: {
        active: !service?.active,
      },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.service.toggle_active',
      targetBarbershopId: barbershopId,
      metadataJson: {
        serviceId,
      },
    })

    revalidateOperationalTenantPaths(barbershopId)
    return { success: true, id: serviceId }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] toggle_service_failed', {
      userId: admin.userId,
      serviceId,
      targetBarbershopId: barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel alterar o status do servico.')
  }
}

export async function createPlatformCustomer(rawData: unknown): Promise<MutationResult> {
  const admin = await requirePlatformAdmin()
  const parsed = PlatformCustomerSchema.safeParse(rawData)

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data

  try {
    await requireTargetBarbershop(data.barbershopId)

    const preferredProfessionalId = data.preferredProfessionalId || null
    if (preferredProfessionalId) {
      await ensureProfessionalForTarget(data.barbershopId, preferredProfessionalId)
    }

    const shouldKeepSubscriptionFields = data.type === 'SUBSCRIPTION'
    const created = await prisma.customer.create({
      data: {
        barbershopId: data.barbershopId,
        name: data.name,
        phone: normalizeOptionalText(data.phone),
        email: normalizeOptionalText(data.email)?.toLowerCase() ?? null,
        notes: normalizeOptionalText(data.notes),
        type: data.type,
        preferredProfessionalId,
        preferredProfessionalUpdatedAt: preferredProfessionalId ? new Date() : null,
        active: data.active,
        marketingOptOutAt: data.marketingOptOut ? new Date() : null,
        subscriptionStatus: shouldKeepSubscriptionFields
          ? data.subscriptionStatus === ''
            ? 'ACTIVE'
            : data.subscriptionStatus ?? 'ACTIVE'
          : null,
        subscriptionPrice: shouldKeepSubscriptionFields ? data.subscriptionPrice ?? null : null,
        subscriptionStartedAt: shouldKeepSubscriptionFields
          ? toDateAtUtcNoon(data.subscriptionStartedAt)
          : null,
      },
      select: { id: true },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.customer.create',
      targetBarbershopId: data.barbershopId,
      metadataJson: {
        customerId: created.id,
        name: data.name,
      },
    })

    revalidateOperationalTenantPaths(data.barbershopId)
    return { success: true, id: created.id }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] create_customer_failed', {
      userId: admin.userId,
      targetBarbershopId: data.barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel criar o cliente.')
  }
}

export async function updatePlatformCustomer(customerId: string, rawData: unknown): Promise<MutationResult> {
  const admin = await requirePlatformAdmin()
  const parsed = PlatformCustomerSchema.safeParse(rawData)

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data

  try {
    const existing = await ensureCustomerForTarget(data.barbershopId, customerId)
    const preferredProfessionalId = data.preferredProfessionalId || null

    if (preferredProfessionalId) {
      await ensureProfessionalForTarget(data.barbershopId, preferredProfessionalId)
    }

    const shouldKeepSubscriptionFields = data.type === 'SUBSCRIPTION'
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        name: data.name,
        phone: normalizeOptionalText(data.phone),
        email: normalizeOptionalText(data.email)?.toLowerCase() ?? null,
        notes: normalizeOptionalText(data.notes),
        type: data.type,
        preferredProfessionalId,
        preferredProfessionalUpdatedAt: preferredProfessionalId !== existing.preferredProfessionalId
          ? new Date()
          : undefined,
        active: data.active,
        marketingOptOutAt: data.marketingOptOut ? new Date() : null,
        subscriptionStatus: shouldKeepSubscriptionFields
          ? data.subscriptionStatus === ''
            ? 'ACTIVE'
            : data.subscriptionStatus ?? 'ACTIVE'
          : null,
        subscriptionPrice: shouldKeepSubscriptionFields ? data.subscriptionPrice ?? null : null,
        subscriptionStartedAt: shouldKeepSubscriptionFields
          ? toDateAtUtcNoon(data.subscriptionStartedAt)
          : null,
      },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.customer.update',
      targetBarbershopId: data.barbershopId,
      metadataJson: {
        customerId,
        name: data.name,
      },
    })

    revalidateOperationalTenantPaths(data.barbershopId)
    return { success: true, id: customerId }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] update_customer_failed', {
      userId: admin.userId,
      customerId,
      targetBarbershopId: data.barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel atualizar o cliente.')
  }
}

export async function createPlatformScheduleBlock(rawData: unknown): Promise<MutationResult> {
  const admin = await requirePlatformAdmin()
  const parsed = PlatformScheduleBlockSchema.safeParse(rawData)

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data

  try {
    const barbershop = await requireTargetBarbershop(data.barbershopId)
    await ensureProfessionalForTarget(data.barbershopId, data.professionalId)

    const timezone = resolveBusinessTimezone(barbershop.timezone)
    const startAt = buildBusinessDateTimeFromTimeLabel(data.date, data.startTime, timezone)
    const endAt = buildBusinessDateTimeFromTimeLabel(data.date, data.endTime, timezone)

    if (endAt <= startAt) {
      return { success: false, error: 'O horario final precisa ser maior que o inicial.' }
    }

    await ensureOperationalBlockAvailability({
      barbershopId: data.barbershopId,
      professionalId: data.professionalId,
      startAt,
      endAt,
      timezone,
    })

    const blockEntities = await ensureOperationalBlockEntities(data.barbershopId)
    const created = await prisma.appointment.create({
      data: {
        barbershopId: data.barbershopId,
        customerId: blockEntities.customerId,
        professionalId: data.professionalId,
        serviceId: blockEntities.serviceId,
        status: 'CONFIRMED',
        source: 'MANUAL',
        billingModel: 'AVULSO',
        sourceReference: buildOperationalBlockSourceReference(),
        startAt,
        endAt,
        durationMinutes: Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
        priceSnapshot: 0,
        notes: normalizeOptionalText(data.notes) ?? 'Bloqueio operacional',
        confirmedAt: new Date(),
      },
      select: { id: true },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.schedule_block.create',
      targetBarbershopId: data.barbershopId,
      metadataJson: {
        blockId: created.id,
        professionalId: data.professionalId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
      },
    })

    revalidateOperationalTenantPaths(data.barbershopId)
    return { success: true, id: created.id }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] create_block_failed', {
      userId: admin.userId,
      targetBarbershopId: data.barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel criar o bloqueio operacional.')
  }
}

export async function updatePlatformScheduleBlock(blockId: string, rawData: unknown): Promise<MutationResult> {
  const admin = await requirePlatformAdmin()
  const parsed = PlatformScheduleBlockSchema.safeParse(rawData)

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data

  try {
    const barbershop = await requireTargetBarbershop(data.barbershopId)
    await ensureProfessionalForTarget(data.barbershopId, data.professionalId)
    await ensureScheduleBlockForTarget(data.barbershopId, blockId)

    const timezone = resolveBusinessTimezone(barbershop.timezone)
    const startAt = buildBusinessDateTimeFromTimeLabel(data.date, data.startTime, timezone)
    const endAt = buildBusinessDateTimeFromTimeLabel(data.date, data.endTime, timezone)

    if (endAt <= startAt) {
      return { success: false, error: 'O horario final precisa ser maior que o inicial.' }
    }

    await ensureOperationalBlockAvailability({
      appointmentId: blockId,
      barbershopId: data.barbershopId,
      professionalId: data.professionalId,
      startAt,
      endAt,
      timezone,
    })

    await prisma.appointment.update({
      where: { id: blockId },
      data: {
        professionalId: data.professionalId,
        startAt,
        endAt,
        durationMinutes: Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
        notes: normalizeOptionalText(data.notes) ?? 'Bloqueio operacional',
      },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.schedule_block.update',
      targetBarbershopId: data.barbershopId,
      metadataJson: {
        blockId,
        professionalId: data.professionalId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
      },
    })

    revalidateOperationalTenantPaths(data.barbershopId)
    return { success: true, id: blockId }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] update_block_failed', {
      userId: admin.userId,
      blockId,
      targetBarbershopId: data.barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel atualizar o bloqueio operacional.')
  }
}

export async function removePlatformScheduleBlock(
  barbershopId: string,
  blockId: string
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()

  try {
    await ensureScheduleBlockForTarget(barbershopId, blockId)
    await prisma.appointment.delete({
      where: { id: blockId },
    })

    await recordPlatformMutation({
      platformUserId: admin.userId,
      action: 'platform.schedule_block.remove',
      targetBarbershopId: barbershopId,
      metadataJson: {
        blockId,
      },
    })

    revalidateOperationalTenantPaths(barbershopId)
    return { success: true }
  } catch (error) {
    safeLog('error', '[platform-admin-actions] remove_block_failed', {
      userId: admin.userId,
      blockId,
      targetBarbershopId: barbershopId,
      error,
    })
    return buildMutationError(error, 'Nao foi possivel remover o bloqueio operacional.')
  }
}

export const __testing = {
  resolveProfessionalAttendanceScope,
  toDateInputValue,
}
