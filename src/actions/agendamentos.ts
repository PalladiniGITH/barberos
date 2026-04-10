'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { assertOwnership, requireSession } from '@/lib/auth'

type ActionResult = { success: true } | { success: false; error: string }

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

function buildStartAt(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes, 0, 0)
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

async function ensureAppointmentSlotAvailable(input: {
  appointmentId?: string
  barbershopId: string
  professionalId: string
  startAt: Date
  endAt: Date
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
      customer: { select: { name: true } },
    },
  })

  if (conflictingAppointment) {
    const startLabel = conflictingAppointment.startAt.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })
    const endLabel = conflictingAppointment.endAt.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })

    return {
      success: false as const,
      error: `Esse barbeiro ja tem um atendimento com ${conflictingAppointment.customer.name} entre ${startLabel} e ${endLabel}.`,
    }
  }

  return { success: true as const }
}

function revalidateSchedulePaths() {
  revalidatePath('/agendamentos')
}

export async function createAppointment(rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user

  const parsed = AppointmentSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  try {
    const data = parsed.data
    const customerName = data.customerName.trim()
    const billingModel = normalizeBillingModel(data.customerType, data.billingModel)

    await Promise.all([
      assertOwnership(barbershopId, 'professional', data.professionalId),
      assertOwnership(barbershopId, 'service', data.serviceId),
      data.customerId ? assertOwnership(barbershopId, 'customer', data.customerId) : Promise.resolve(),
    ])

    const service = await prisma.service.findUnique({
      where: { id: data.serviceId },
      select: { duration: true, price: true, active: true },
    })

    if (!service?.active) {
      return { success: false, error: 'Servico indisponivel para agendamento.' }
    }

    const startAt = buildStartAt(data.date, data.time)
    const endAt = new Date(startAt.getTime() + service.duration * 60_000)
    const openAt = buildStartAt(data.date, '08:00')
    const closeAt = buildStartAt(data.date, '21:00')

    if (startAt < openAt || endAt > closeAt) {
      return { success: false, error: 'A agenda aceita horarios apenas entre 08:00 e 21:00.' }
    }

    const availability = await ensureAppointmentSlotAvailable({
      barbershopId,
      professionalId: data.professionalId,
      startAt,
      endAt,
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
        priceSnapshot: Number(service.price),
        notes: normalizeOptionalText(data.notes),
        confirmedAt: data.status === 'CONFIRMED' ? new Date() : null,
        cancelledAt: data.status === 'CANCELLED' ? new Date() : null,
        completedAt: data.status === 'COMPLETED' ? new Date() : null,
      },
    })

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

  const existingAppointment = await prisma.appointment.findUnique({
    where: { id },
    select: { id: true, barbershopId: true },
  })

  if (!existingAppointment || existingAppointment.barbershopId !== barbershopId) {
    return { success: false, error: 'Agendamento nao encontrado.' }
  }

  const parsed = AppointmentSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  try {
    const data = parsed.data
    const billingModel = normalizeBillingModel(data.customerType, data.billingModel)

    await Promise.all([
      assertOwnership(barbershopId, 'professional', data.professionalId),
      assertOwnership(barbershopId, 'service', data.serviceId),
      data.customerId ? assertOwnership(barbershopId, 'customer', data.customerId) : Promise.resolve(),
    ])

    const service = await prisma.service.findUnique({
      where: { id: data.serviceId },
      select: { duration: true, price: true, active: true },
    })

    if (!service?.active) {
      return { success: false, error: 'Servico indisponivel para agendamento.' }
    }

    const startAt = buildStartAt(data.date, data.time)
    const endAt = new Date(startAt.getTime() + service.duration * 60_000)
    const openAt = buildStartAt(data.date, '08:00')
    const closeAt = buildStartAt(data.date, '21:00')

    if (startAt < openAt || endAt > closeAt) {
      return { success: false, error: 'A agenda aceita horarios apenas entre 08:00 e 21:00.' }
    }

    const availability = await ensureAppointmentSlotAvailable({
      appointmentId: id,
      barbershopId,
      professionalId: data.professionalId,
      startAt,
      endAt,
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
        priceSnapshot: Number(service.price),
        notes: normalizeOptionalText(data.notes),
        confirmedAt: data.status === 'CONFIRMED' ? new Date() : null,
        cancelledAt: data.status === 'CANCELLED' ? new Date() : null,
        completedAt: data.status === 'COMPLETED' ? new Date() : null,
      },
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

  const parsedStatus = AppointmentStatusSchema.safeParse(rawStatus)
  if (!parsedStatus.success) {
    return { success: false, error: 'Status invalido.' }
  }

  const existingAppointment = await prisma.appointment.findUnique({
    where: { id },
    select: { id: true, barbershopId: true },
  })

  if (!existingAppointment || existingAppointment.barbershopId !== barbershopId) {
    return { success: false, error: 'Agendamento nao encontrado.' }
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

    revalidateSchedulePaths()
    return { success: true }
  } catch (error) {
    console.error('updateAppointmentStatus error', error)
    return { success: false, error: 'Nao foi possivel atualizar o status.' }
  }
}
