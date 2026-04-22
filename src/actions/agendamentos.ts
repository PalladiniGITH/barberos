'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { assertOwnership, requireSession } from '@/lib/auth'
import { isBarberRole } from '@/lib/auth-routes'
import {
  buildBusinessDateTimeFromTimeLabel,
  formatTimeInTimezone,
  resolveBusinessTimezone,
} from '@/lib/timezone'
import { syncCustomerPreferredProfessional } from '@/lib/customers/preferred-professional'
import {
  buildOperationalBlockSourceReference,
  isOperationalBlockSourceReference,
  OPERATIONAL_BLOCK_CUSTOMER_NAME,
  OPERATIONAL_BLOCK_SERVICE_NAME,
} from '@/lib/agendamentos/operational-blocks'
import {
  canProfessionalHandleCustomerType,
  normalizeProfessionalOperationalConfig,
  resolveProfessionalServicePrice,
} from '@/lib/professionals/operational-config'
import { findSessionProfessional } from '@/lib/professionals/session-professional'

type ActionResult = { success: true } | { success: false; error: string }
type Session = Awaited<ReturnType<typeof requireSession>>
type SchedulingActorScope = {
  isBarber: boolean
  professionalId: string | null
  professionalName: string | null
}

const AppointmentSchema = z.object({
  customerId: z.string().cuid().optional().nullable(),
  customerName: z.string().min(2, 'Nome do cliente obrigatorio').max(120),
  customerPhone: z.string().max(30).optional().nullable(),
  customerEmail: z.union([z.string().email('Email invalido'), z.literal('')]).optional().nullable(),
  customerType: z.enum(['SUBSCRIPTION', 'WALK_IN']).default('WALK_IN'),
  subscriptionPrice: z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) return null
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : value
    },
    z.number().positive('Mensalidade invalida').max(9999, 'Mensalidade invalida').nullable().optional()
  ),
  professionalId: z.string().cuid('Profissional invalido'),
  serviceId: z.string().cuid('Servico invalido'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Horario invalido'),
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).default('CONFIRMED'),
  source: z.enum(['MANUAL', 'WHATSAPP']).default('MANUAL'),
  billingModel: z.enum(['AVULSO', 'SUBSCRIPTION_INCLUDED', 'SUBSCRIPTION_EXTRA']).default('AVULSO'),
  sourceReference: z.string().max(190).optional().nullable(),
  notes: z.string().max(400).optional().nullable(),
})

const AppointmentStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'])
const SlotMoveSchema = z.object({
  professionalId: z.string().cuid('Profissional invalido'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Horario invalido'),
})
const ScheduleBlockSchema = z.object({
  professionalId: z.string().cuid('Profissional invalido'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horario inicial invalido'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horario final invalido'),
  notes: z.string().max(400).optional().nullable(),
})

function normalizeOptionalText(value?: string | null) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeSubscriptionPrice(value?: number | null) {
  if (!value || value <= 0) {
    return 199.9
  }

  return Math.round(value * 100) / 100
}

function normalizeBillingModel(
  customerType: 'SUBSCRIPTION' | 'WALK_IN',
  billingModel: 'AVULSO' | 'SUBSCRIPTION_INCLUDED' | 'SUBSCRIPTION_EXTRA'
) {
  if (customerType === 'WALK_IN') {
    return 'AVULSO' as const
  }

  return billingModel === 'AVULSO' ? 'SUBSCRIPTION_INCLUDED' : billingModel
}

function normalizeCustomerSearchQuery(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normalizeDigits(value: string) {
  return value.replace(/\D/g, '')
}

function buildProfessionalScopeError(input: {
  professionalName: string
  customerType: 'SUBSCRIPTION' | 'WALK_IN'
}) {
  if (input.customerType === 'SUBSCRIPTION') {
    return `${input.professionalName} nao esta configurado para atender clientes de assinatura.`
  }

  return `${input.professionalName} nao esta configurado para atendimento avulso.`
}

async function getBarbershopTimezone(barbershopId: string) {
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: { timezone: true },
  })

  return resolveBusinessTimezone(barbershop?.timezone)
}

async function resolveSchedulingActorScope(session: Session): Promise<SchedulingActorScope> {
  if (!isBarberRole(session.user.role)) {
    return {
      isBarber: false,
      professionalId: null,
      professionalName: null,
    }
  }

  const professional = await findSessionProfessional({
    barbershopId: session.user.barbershopId,
    email: session.user.email,
    name: session.user.name,
  })

  return {
    isBarber: true,
    professionalId: professional?.id ?? null,
    professionalName: professional?.name ?? null,
  }
}

function buildMissingBarberProfessionalError(): ActionResult {
  return {
    success: false,
    error: 'Seu usuario BARBER nao esta vinculado a um profissional ativo. Nao foi possivel operar a agenda.',
  }
}

function ensureBarberProfessionalScope(
  scope: SchedulingActorScope,
  professionalId: string | null | undefined
): ActionResult | null {
  if (!scope.isBarber) {
    return null
  }

  if (!scope.professionalId) {
    return buildMissingBarberProfessionalError()
  }

  if (professionalId !== scope.professionalId) {
    return {
      success: false,
      error: scope.professionalName
        ? `Sem permissao para operar a agenda de outro profissional. Seu escopo esta limitado a ${scope.professionalName}.`
        : 'Sem permissao para operar a agenda de outro profissional.',
    }
  }

  return null
}

function buildStartAt(date: string, time: string, timezone: string) {
  return buildBusinessDateTimeFromTimeLabel(date, time, timezone)
}

async function resolveCustomerId(input: {
  barbershopId: string
  customerId?: string | null
  customerName: string
  customerPhone?: string | null
  customerEmail?: string | null
  customerType: 'SUBSCRIPTION' | 'WALK_IN'
  subscriptionPrice?: number | null
}) {
  function buildCustomerData(existingStartedAt?: Date | null) {
    return input.customerType === 'SUBSCRIPTION'
      ? {
          type: 'SUBSCRIPTION' as const,
          subscriptionStatus: 'ACTIVE' as const,
          subscriptionPrice: normalizeSubscriptionPrice(input.subscriptionPrice),
          subscriptionStartedAt: existingStartedAt ?? new Date(),
        }
      : {
          type: 'WALK_IN' as const,
          subscriptionStatus: null,
          subscriptionPrice: null,
          subscriptionStartedAt: null,
        }
  }

  if (input.customerId) {
    await assertOwnership(input.barbershopId, 'customer', input.customerId)

    const existingCustomer = await prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { subscriptionStartedAt: true },
    })

    await prisma.customer.update({
      where: { id: input.customerId },
      data: {
        name: input.customerName.trim(),
        phone: normalizeOptionalText(input.customerPhone),
        email: normalizeOptionalText(input.customerEmail),
        ...buildCustomerData(existingCustomer?.subscriptionStartedAt),
      },
    })

    return input.customerId
  }

  const phone = normalizeOptionalText(input.customerPhone)
  const email = normalizeOptionalText(input.customerEmail)
  const name = input.customerName.trim()
  const customerLookupConditions: Array<{
    name?: { equals: string; mode: 'insensitive' }
    phone?: string
    email?: string
  }> = [{ name: { equals: name, mode: 'insensitive' } }]

  if (phone) {
    customerLookupConditions.push({ phone })
  }

  if (email) {
    customerLookupConditions.push({ email })
  }

  const existingCustomer = await prisma.customer.findFirst({
    where: {
      barbershopId: input.barbershopId,
      OR: customerLookupConditions,
    },
    select: {
      id: true,
      subscriptionStartedAt: true,
    },
  })

  if (existingCustomer) {
    await prisma.customer.update({
      where: { id: existingCustomer.id },
      data: {
        name,
        phone,
        email,
        active: true,
        ...buildCustomerData(existingCustomer.subscriptionStartedAt),
      },
    })

    return existingCustomer.id
  }

  const customer = await prisma.customer.create({
    data: {
      barbershopId: input.barbershopId,
      name,
      phone,
      email,
      active: true,
      ...buildCustomerData(),
    },
    select: { id: true },
  })

  return customer.id
}

export async function searchCustomersForAppointment(rawQuery: unknown) {
  const session = await requireSession()
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : ''

  if (query.length < 2) {
    return []
  }

  const normalizedQuery = normalizeCustomerSearchQuery(query)
  const digitsQuery = normalizeDigits(query)

  const customers = await prisma.customer.findMany({
    where: {
      barbershopId: session.user.barbershopId,
      active: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query } },
        { email: { contains: query, mode: 'insensitive' } },
        ...(digitsQuery.length >= 3 ? [{ phone: { contains: digitsQuery } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      type: true,
      subscriptionPrice: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 12,
  })

  return customers
    .map((customer) => {
      const normalizedName = normalizeCustomerSearchQuery(customer.name)
      const normalizedPhone = normalizeDigits(customer.phone ?? '')
      const normalizedEmail = normalizeCustomerSearchQuery(customer.email ?? '')
      const exactNameMatch = normalizedName === normalizedQuery
      const nameStartsWith = normalizedName.startsWith(normalizedQuery)
      const phoneStartsWith = digitsQuery.length >= 3 && normalizedPhone.startsWith(digitsQuery)
      const phoneContains = digitsQuery.length >= 3 && normalizedPhone.includes(digitsQuery)
      const emailStartsWith = normalizedEmail.startsWith(normalizedQuery)

      const relevance = exactNameMatch
        ? 400
        : nameStartsWith
          ? 320
          : phoneStartsWith
            ? 280
            : emailStartsWith
              ? 240
              : phoneContains
                ? 220
                : normalizedName.includes(normalizedQuery)
                  ? 180
                  : normalizedEmail.includes(normalizedQuery)
                    ? 120
                    : 0

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        type: customer.type,
        subscriptionPrice: customer.subscriptionPrice ? Number(customer.subscriptionPrice) : null,
        relevance,
      }
    })
    .filter((customer) => customer.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance || left.name.localeCompare(right.name))
}

async function ensureAppointmentSlotAvailable(input: {
  appointmentId?: string
  barbershopId: string
  professionalId: string
  startAt: Date
  endAt: Date
  timezone: string
}) {
  const conflictingAppointment = await prisma.appointment.findFirst({
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
      customer: { select: { name: true } },
    },
  })

  if (conflictingAppointment) {
    const startLabel = formatTimeInTimezone(conflictingAppointment.startAt, input.timezone)
    const endLabel = formatTimeInTimezone(conflictingAppointment.endAt, input.timezone)
    const isOperationalBlock = isOperationalBlockSourceReference(conflictingAppointment.sourceReference)

    return {
      success: false as const,
      error: isOperationalBlock
        ? `Esse intervalo esta bloqueado entre ${startLabel} e ${endLabel}${conflictingAppointment.notes ? ` (${conflictingAppointment.notes})` : ''}.`
        : `Esse barbeiro ja tem um atendimento com ${conflictingAppointment.customer.name} entre ${startLabel} e ${endLabel}.`,
    }
  }

  return { success: true as const }
}

function revalidateSchedulePaths() {
  revalidatePath('/agendamentos')
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

async function getSchedulingEntitiesForAppointment(input: {
  serviceId: string
  professionalId: string
}) {
  const [service, professional] = await Promise.all([
    prisma.service.findUnique({
      where: { id: input.serviceId },
      select: { duration: true, price: true, active: true, name: true },
    }),
    prisma.professional.findUnique({
      where: { id: input.professionalId },
      select: {
        name: true,
        commissionRate: true,
        haircutPrice: true,
        beardPrice: true,
        comboPrice: true,
        acceptsWalkIn: true,
        acceptsSubscription: true,
      },
    }),
  ])

  return {
    service,
    professional,
  }
}

export async function createAppointment(rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const scope = await resolveSchedulingActorScope(session)

  const parsed = AppointmentSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  try {
    const data = parsed.data
    const blocked = ensureBarberProfessionalScope(scope, data.professionalId)

    if (blocked) {
      return blocked
    }

    const customerName = data.customerName.trim()
    const billingModel = normalizeBillingModel(data.customerType, data.billingModel)
    const timezone = await getBarbershopTimezone(barbershopId)

    await Promise.all([
      assertOwnership(barbershopId, 'professional', data.professionalId),
      assertOwnership(barbershopId, 'service', data.serviceId),
      data.customerId ? assertOwnership(barbershopId, 'customer', data.customerId) : Promise.resolve(),
    ])

    const { service, professional } = await getSchedulingEntitiesForAppointment({
      serviceId: data.serviceId,
      professionalId: data.professionalId,
    })

    if (!service?.active) {
      return { success: false, error: 'Servico indisponivel para agendamento.' }
    }

    if (!professional) {
      return { success: false, error: 'Profissional indisponivel para agendamento.' }
    }

    if (!canProfessionalHandleCustomerType({
      customerType: data.customerType,
      professional,
    })) {
      return {
        success: false,
        error: buildProfessionalScopeError({
          professionalName: professional.name,
          customerType: data.customerType,
        }),
      }
    }

    const startAt = buildStartAt(data.date, data.time, timezone)
    const endAt = new Date(startAt.getTime() + service.duration * 60_000)
    const openAt = buildStartAt(data.date, '08:00', timezone)
    const closeAt = buildStartAt(data.date, '21:00', timezone)

    if (startAt < openAt || endAt > closeAt) {
      return { success: false, error: 'A agenda aceita horarios apenas entre 08:00 e 21:00.' }
    }

    const availability = await ensureAppointmentSlotAvailable({
      barbershopId,
      professionalId: data.professionalId,
      startAt,
      endAt,
      timezone,
    })

    if (!availability.success) {
      return availability
    }

    const customerId = await resolveCustomerId({
      barbershopId,
      customerId: data.customerId ?? null,
      customerName,
      customerPhone: data.customerPhone ?? null,
      customerEmail: data.customerEmail ?? null,
      customerType: data.customerType,
      subscriptionPrice: data.subscriptionPrice ?? null,
    })

    const resolvedPrice = resolveProfessionalServicePrice({
      serviceName: service.name,
      basePrice: Number(service.price),
      professional: normalizeProfessionalOperationalConfig(professional),
    })

    await prisma.appointment.create({
      data: {
        barbershopId,
        customerId,
        professionalId: data.professionalId,
        serviceId: data.serviceId,
        status: data.status,
        source: data.source,
        billingModel,
        sourceReference: normalizeOptionalText(data.sourceReference),
        startAt,
        endAt,
        durationMinutes: service.duration,
        priceSnapshot: resolvedPrice.price,
        notes: normalizeOptionalText(data.notes),
        confirmedAt: data.status === 'CONFIRMED' ? new Date() : null,
        cancelledAt: data.status === 'CANCELLED' ? new Date() : null,
        completedAt: data.status === 'COMPLETED' ? new Date() : null,
      },
    })

    if (data.status === 'COMPLETED') {
      await syncCustomerPreferredProfessional({
        barbershopId,
        customerId,
      })
    }

    revalidateSchedulePaths()
    return { success: true }
  } catch (error) {
    console.error('createAppointment error', error)
    return { success: false, error: 'Nao foi possivel salvar o agendamento.' }
  }
}

export async function updateAppointment(id: string, rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const scope = await resolveSchedulingActorScope(session)

  const existingAppointment = await prisma.appointment.findUnique({
    where: { id },
    select: { id: true, barbershopId: true, professionalId: true },
  })

  if (!existingAppointment || existingAppointment.barbershopId !== barbershopId) {
    return { success: false, error: 'Agendamento nao encontrado.' }
  }

  const blockedExistingScope = ensureBarberProfessionalScope(scope, existingAppointment.professionalId)

  if (blockedExistingScope) {
    return blockedExistingScope
  }

  const parsed = AppointmentSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  try {
    const data = parsed.data
    const blockedTargetScope = ensureBarberProfessionalScope(scope, data.professionalId)

    if (blockedTargetScope) {
      return blockedTargetScope
    }

    const billingModel = normalizeBillingModel(data.customerType, data.billingModel)
    const timezone = await getBarbershopTimezone(barbershopId)

    await Promise.all([
      assertOwnership(barbershopId, 'professional', data.professionalId),
      assertOwnership(barbershopId, 'service', data.serviceId),
      data.customerId ? assertOwnership(barbershopId, 'customer', data.customerId) : Promise.resolve(),
    ])

    const { service, professional } = await getSchedulingEntitiesForAppointment({
      serviceId: data.serviceId,
      professionalId: data.professionalId,
    })

    if (!service?.active) {
      return { success: false, error: 'Servico indisponivel para agendamento.' }
    }

    if (!professional) {
      return { success: false, error: 'Profissional indisponivel para agendamento.' }
    }

    if (!canProfessionalHandleCustomerType({
      customerType: data.customerType,
      professional,
    })) {
      return {
        success: false,
        error: buildProfessionalScopeError({
          professionalName: professional.name,
          customerType: data.customerType,
        }),
      }
    }

    const startAt = buildStartAt(data.date, data.time, timezone)
    const endAt = new Date(startAt.getTime() + service.duration * 60_000)
    const openAt = buildStartAt(data.date, '08:00', timezone)
    const closeAt = buildStartAt(data.date, '21:00', timezone)

    if (startAt < openAt || endAt > closeAt) {
      return { success: false, error: 'A agenda aceita horarios apenas entre 08:00 e 21:00.' }
    }

    const availability = await ensureAppointmentSlotAvailable({
      appointmentId: id,
      barbershopId,
      professionalId: data.professionalId,
      startAt,
      endAt,
      timezone,
    })

    if (!availability.success) {
      return availability
    }

    const customerId = await resolveCustomerId({
      barbershopId,
      customerId: data.customerId ?? null,
      customerName: data.customerName.trim(),
      customerPhone: data.customerPhone ?? null,
      customerEmail: data.customerEmail ?? null,
      customerType: data.customerType,
      subscriptionPrice: data.subscriptionPrice ?? null,
    })

    const resolvedPrice = resolveProfessionalServicePrice({
      serviceName: service.name,
      basePrice: Number(service.price),
      professional: normalizeProfessionalOperationalConfig(professional),
    })

    await prisma.appointment.update({
      where: { id },
      data: {
        customerId,
        professionalId: data.professionalId,
        serviceId: data.serviceId,
        status: data.status,
        source: data.source,
        billingModel,
        sourceReference: normalizeOptionalText(data.sourceReference),
        startAt,
        endAt,
        durationMinutes: service.duration,
        priceSnapshot: resolvedPrice.price,
        notes: normalizeOptionalText(data.notes),
        confirmedAt: data.status === 'CONFIRMED' ? new Date() : null,
        cancelledAt: data.status === 'CANCELLED' ? new Date() : null,
        completedAt: data.status === 'COMPLETED' ? new Date() : null,
      },
    })

    await syncCustomerPreferredProfessional({
      barbershopId,
      customerId,
    })

    revalidateSchedulePaths()
    return { success: true }
  } catch (error) {
    console.error('updateAppointment error', error)
    return { success: false, error: 'Nao foi possivel atualizar o agendamento.' }
  }
}

export async function updateAppointmentStatus(id: string, rawStatus: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const scope = await resolveSchedulingActorScope(session)

  const parsedStatus = AppointmentStatusSchema.safeParse(rawStatus)
  if (!parsedStatus.success) {
    return { success: false, error: 'Status invalido.' }
  }

  const existingAppointment = await prisma.appointment.findUnique({
    where: { id },
    select: { id: true, barbershopId: true, customerId: true, professionalId: true },
  })

  if (!existingAppointment || existingAppointment.barbershopId !== barbershopId) {
    return { success: false, error: 'Agendamento nao encontrado.' }
  }

  const blocked = ensureBarberProfessionalScope(scope, existingAppointment.professionalId)

  if (blocked) {
    return blocked
  }

  const status = parsedStatus.data

  try {
    await prisma.appointment.update({
      where: { id },
      data: {
        status,
        confirmedAt: status === 'CONFIRMED' ? new Date() : null,
        cancelledAt: status === 'CANCELLED' ? new Date() : null,
        completedAt: status === 'COMPLETED' ? new Date() : null,
      },
    })

    await syncCustomerPreferredProfessional({
      barbershopId,
      customerId: existingAppointment.customerId,
    })

    revalidateSchedulePaths()
    return { success: true }
  } catch (error) {
    console.error('updateAppointmentStatus error', error)
    return { success: false, error: 'Nao foi possivel atualizar o status.' }
  }
}

export async function moveAppointmentSlot(id: string, rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const scope = await resolveSchedulingActorScope(session)

  const parsed = SlotMoveSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const existingAppointment = await prisma.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      barbershopId: true,
      professionalId: true,
      durationMinutes: true,
      sourceReference: true,
    },
  })

  if (!existingAppointment || existingAppointment.barbershopId !== barbershopId) {
    return { success: false, error: 'Agendamento nao encontrado.' }
  }

  const blockedExistingScope = ensureBarberProfessionalScope(scope, existingAppointment.professionalId)

  if (blockedExistingScope) {
    return blockedExistingScope
  }

  if (isOperationalBlockSourceReference(existingAppointment.sourceReference)) {
    return { success: false, error: 'Use o fluxo de bloqueio para mover esse bloco.' }
  }

  try {
    const data = parsed.data
    const blockedTargetScope = ensureBarberProfessionalScope(scope, data.professionalId)

    if (blockedTargetScope) {
      return blockedTargetScope
    }

    const timezone = await getBarbershopTimezone(barbershopId)
    const startAt = buildStartAt(data.date, data.time, timezone)
    const endAt = new Date(startAt.getTime() + existingAppointment.durationMinutes * 60_000)

    await assertOwnership(barbershopId, 'professional', data.professionalId)

    const availability = await ensureAppointmentSlotAvailable({
      appointmentId: id,
      barbershopId,
      professionalId: data.professionalId,
      startAt,
      endAt,
      timezone,
    })

    if (!availability.success) {
      return availability
    }

    await prisma.appointment.update({
      where: { id },
      data: {
        professionalId: data.professionalId,
        startAt,
        endAt,
      },
    })

    revalidateSchedulePaths()
    return { success: true }
  } catch (error) {
    console.error('moveAppointmentSlot error', error)
    return { success: false, error: 'Nao foi possivel mover o agendamento.' }
  }
}

export async function createScheduleBlock(rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const scope = await resolveSchedulingActorScope(session)

  const parsed = ScheduleBlockSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  try {
    const data = parsed.data
    const blocked = ensureBarberProfessionalScope(scope, data.professionalId)

    if (blocked) {
      return blocked
    }

    const timezone = await getBarbershopTimezone(barbershopId)
    const startAt = buildStartAt(data.date, data.startTime, timezone)
    const endAt = buildStartAt(data.date, data.endTime, timezone)

    if (endAt <= startAt) {
      return { success: false, error: 'O fim do bloqueio precisa ser depois do inicio.' }
    }

    await assertOwnership(barbershopId, 'professional', data.professionalId)

    const availability = await ensureAppointmentSlotAvailable({
      barbershopId,
      professionalId: data.professionalId,
      startAt,
      endAt,
      timezone,
    })

    if (!availability.success) {
      return availability
    }

    const blockEntities = await ensureOperationalBlockEntities(barbershopId)

    await prisma.appointment.create({
      data: {
        barbershopId,
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
    })

    revalidateSchedulePaths()
    return { success: true }
  } catch (error) {
    console.error('createScheduleBlock error', error)
    return { success: false, error: 'Nao foi possivel bloquear esse intervalo.' }
  }
}

export async function moveScheduleBlock(id: string, rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const scope = await resolveSchedulingActorScope(session)

  const parsed = ScheduleBlockSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const existingBlock = await prisma.appointment.findUnique({
    where: { id },
    select: { id: true, barbershopId: true, professionalId: true, sourceReference: true, notes: true },
  })

  if (!existingBlock || existingBlock.barbershopId !== barbershopId || !isOperationalBlockSourceReference(existingBlock.sourceReference)) {
    return { success: false, error: 'Bloqueio nao encontrado.' }
  }

  const blockedExistingScope = ensureBarberProfessionalScope(scope, existingBlock.professionalId)

  if (blockedExistingScope) {
    return blockedExistingScope
  }

  try {
    const data = parsed.data
    const blockedTargetScope = ensureBarberProfessionalScope(scope, data.professionalId)

    if (blockedTargetScope) {
      return blockedTargetScope
    }

    const timezone = await getBarbershopTimezone(barbershopId)
    const startAt = buildStartAt(data.date, data.startTime, timezone)
    const endAt = buildStartAt(data.date, data.endTime, timezone)

    if (endAt <= startAt) {
      return { success: false, error: 'O fim do bloqueio precisa ser depois do inicio.' }
    }

    await assertOwnership(barbershopId, 'professional', data.professionalId)

    const availability = await ensureAppointmentSlotAvailable({
      appointmentId: id,
      barbershopId,
      professionalId: data.professionalId,
      startAt,
      endAt,
      timezone,
    })

    if (!availability.success) {
      return availability
    }

    await prisma.appointment.update({
      where: { id },
      data: {
        professionalId: data.professionalId,
        startAt,
        endAt,
        durationMinutes: Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
        notes: normalizeOptionalText(data.notes) ?? existingBlock.notes,
      },
    })

    revalidateSchedulePaths()
    return { success: true }
  } catch (error) {
    console.error('moveScheduleBlock error', error)
    return { success: false, error: 'Nao foi possivel mover o bloqueio.' }
  }
}

export async function removeScheduleBlock(id: string): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const scope = await resolveSchedulingActorScope(session)

  const existingBlock = await prisma.appointment.findUnique({
    where: { id },
    select: { id: true, barbershopId: true, professionalId: true, sourceReference: true },
  })

  if (!existingBlock || existingBlock.barbershopId !== barbershopId || !isOperationalBlockSourceReference(existingBlock.sourceReference)) {
    return { success: false, error: 'Bloqueio nao encontrado.' }
  }

  const blocked = ensureBarberProfessionalScope(scope, existingBlock.professionalId)

  if (blocked) {
    return blocked
  }

  try {
    await prisma.appointment.delete({ where: { id } })
    revalidateSchedulePaths()
    return { success: true }
  } catch (error) {
    console.error('removeScheduleBlock error', error)
    return { success: false, error: 'Nao foi possivel remover o bloqueio.' }
  }
}
