'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { assertOwnership, assertRoleAllowed, requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type ActionResult = { success: true } | { success: false; error: string }

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
  if (!value) return null
  return new Date(`${value}T12:00:00.000Z`)
}

const CustomerProfileSchema = z.object({
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
  birthDate: z.preprocess(
    parseOptionalDate,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de nascimento invalida')
      .nullable()
      .optional()
  ),
  notes: z.string().trim().max(1000, 'Observacoes muito longas').optional().or(z.literal('')),
  type: z.enum(['SUBSCRIPTION', 'WALK_IN']),
  preferredProfessionalId: z
    .string()
    .cuid('Barbeiro preferido invalido')
    .optional()
    .or(z.literal('')),
  active: z.boolean(),
  marketingOptOut: z.boolean().default(false),
  subscriptionStatus: z
    .enum(['ACTIVE', 'PAUSED', 'CANCELLED'])
    .optional()
    .or(z.literal('')),
  subscriptionPrice: z.preprocess(
    parseOptionalDecimal,
    z.number().min(0, 'Valor da assinatura invalido').max(9999, 'Valor da assinatura invalido').nullable().optional()
  ),
  subscriptionStartedAt: z.preprocess(
    parseOptionalDate,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de inicio invalida')
      .nullable()
      .optional()
  ),
})

function blockCustomerEditByRole(role: string | null | undefined) {
  try {
    assertRoleAllowed(role, ['OWNER', 'MANAGER'], 'Sem permissao para editar clientes.')
    return null
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Sem permissao para editar clientes.',
    } satisfies ActionResult
  }
}

export async function updateCustomerProfile(customerId: string, rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const blocked = blockCustomerEditByRole(session.user.role)

  if (blocked) {
    return blocked
  }

  const parsed = CustomerProfileSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const { barbershopId } = session.user
  const existingCustomer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      barbershopId: true,
      preferredProfessionalId: true,
    },
  })

  if (!existingCustomer || existingCustomer.barbershopId !== barbershopId) {
    return { success: false, error: 'Cliente nao encontrado.' }
  }

  const data = parsed.data
  const preferredProfessionalId = data.preferredProfessionalId || null

  try {
    await assertOwnership(barbershopId, 'customer', customerId)

    if (preferredProfessionalId) {
      await assertOwnership(barbershopId, 'professional', preferredProfessionalId)
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nao foi possivel validar o cliente informado.',
    }
  }

  const shouldKeepSubscriptionFields = data.type === 'SUBSCRIPTION'
  const subscriptionStatus = shouldKeepSubscriptionFields
    ? data.subscriptionStatus === ''
      ? 'ACTIVE'
      : data.subscriptionStatus ?? 'ACTIVE'
    : null

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      name: data.name,
      phone: data.phone || null,
      email: data.email ? data.email.toLowerCase() : null,
      birthDate: toDateAtUtcNoon(data.birthDate),
      notes: data.notes || null,
      type: data.type,
      preferredProfessionalId,
      preferredProfessionalUpdatedAt: preferredProfessionalId !== existingCustomer.preferredProfessionalId
        ? new Date()
        : undefined,
      active: data.active,
      marketingOptOutAt: data.marketingOptOut ? new Date() : null,
      subscriptionStatus,
      subscriptionPrice: shouldKeepSubscriptionFields ? data.subscriptionPrice ?? null : null,
      subscriptionStartedAt: shouldKeepSubscriptionFields
        ? toDateAtUtcNoon(data.subscriptionStartedAt)
        : null,
    },
  })

  revalidatePath('/clientes')
  revalidatePath(`/clientes/${customerId}`)
  revalidatePath('/agendamentos')
  revalidatePath('/dashboard')
  revalidatePath('/inteligencia')

  return { success: true }
}
