'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { attendanceScopeToFlags } from '@/lib/professionals/operational-config'
import {
  isProfessionalAvatarUrl,
  normalizeProfessionalAvatarUrl,
} from '@/lib/professionals/avatar'
import { deleteProfessionalAvatarFile } from '@/lib/professionals/avatar-storage'
import { revalidateProfessionalSurfaces } from '@/lib/professionals/revalidation'
import {
  assertCanManageProfessional,
  ensureResourceBelongsToBarbershop,
  requireAuthenticatedUser,
} from '@/lib/security/guards'

type ActionResult = { success: true } | { success: false; error: string }
type ProfessionalMutationResult =
  | { success: true; professionalId: string }
  | { success: false; error: string }

function blockBarberAdministrativeAction(role: string) {
  try {
    assertCanManageProfessional(role)
    return null
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { success: false, error: error.message } satisfies ActionResult
    }

    throw error
  }
}

function parseOptionalDecimal(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : value
}

const ProfessionalSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres').max(100),
  email: z.string().email('Email invalido').optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
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
})

export async function createProfessional(rawData: unknown): Promise<ProfessionalMutationResult> {
  const session = await requireAuthenticatedUser()
  const { barbershopId } = session
  const blocked = blockBarberAdministrativeAction(session.role)

  if (blocked) {
    return blocked
  }

  const parsed = ProfessionalSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const {
    name,
    email,
    phone,
    avatar,
    commissionRate,
    haircutPrice,
    beardPrice,
    comboPrice,
    attendanceScope,
  } = parsed.data
  const attendanceFlags = attendanceScopeToFlags(attendanceScope)

  if (email) {
    const exists = await prisma.professional.findUnique({
      where: { email_barbershopId: { email, barbershopId } },
    })
    if (exists) {
      return { success: false, error: 'Ja existe um profissional com este email' }
    }
  }

  const createdProfessional = await prisma.professional.create({
    data: {
      name,
      email: email || null,
      phone: phone || null,
      avatar: normalizeProfessionalAvatarUrl(avatar),
      commissionRate,
      haircutPrice,
      beardPrice,
      comboPrice,
      ...attendanceFlags,
      barbershopId,
    },
  })

  revalidateProfessionalSurfaces()
  return { success: true, professionalId: createdProfessional.id }
}

export async function updateProfessional(id: string, rawData: unknown): Promise<ProfessionalMutationResult> {
  const session = await requireAuthenticatedUser()
  const { barbershopId } = session
  const blocked = blockBarberAdministrativeAction(session.role)

  if (blocked) {
    return blocked
  }

  const existing = await prisma.professional.findUnique({
    where: { id },
    select: { barbershopId: true, avatar: true },
  })

  if (!existing) {
    return { success: false, error: 'Nao autorizado' }
  }

  try {
    ensureResourceBelongsToBarbershop(existing.barbershopId, barbershopId, 'Nao autorizado')
  } catch {
    return { success: false, error: 'Nao autorizado' }
  }

  const parsed = ProfessionalSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const {
    name,
    email,
    phone,
    avatar,
    commissionRate,
    haircutPrice,
    beardPrice,
    comboPrice,
    attendanceScope,
  } = parsed.data
  const attendanceFlags = attendanceScopeToFlags(attendanceScope)
  const normalizedAvatar = normalizeProfessionalAvatarUrl(avatar)

  await prisma.professional.update({
    where: { id },
    data: {
      name,
      email: email || null,
      phone: phone || null,
      avatar: normalizedAvatar,
      commissionRate,
      haircutPrice,
      beardPrice,
      comboPrice,
      ...attendanceFlags,
    },
  })

  if (existing.avatar && existing.avatar !== normalizedAvatar) {
    await deleteProfessionalAvatarFile(existing.avatar).catch(() => null)
  }

  revalidateProfessionalSurfaces()
  return { success: true, professionalId: id }
}

export async function toggleProfessionalActive(id: string): Promise<ProfessionalMutationResult> {
  const session = await requireAuthenticatedUser()
  const blocked = blockBarberAdministrativeAction(session.role)

  if (blocked) {
    return blocked
  }

  const professional = await prisma.professional.findUnique({
    where: { id },
    select: { barbershopId: true, active: true },
  })

  if (!professional) {
    return { success: false, error: 'Nao autorizado' }
  }

  try {
    ensureResourceBelongsToBarbershop(professional.barbershopId, session.barbershopId, 'Nao autorizado')
  } catch {
    return { success: false, error: 'Nao autorizado' }
  }

  await prisma.professional.update({
    where: { id },
    data: { active: !professional.active },
  })

  revalidateProfessionalSurfaces()
  return { success: true, professionalId: id }
}

const MonthlyGoalSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2030),
  revenueGoal: z.string().transform(Number).pipe(z.number().positive()),
  revenueMin: z.string().transform(Number).pipe(z.number().positive()),
  expenseLimit: z.string().transform(Number).pipe(z.number().positive()).optional(),
  notes: z.string().max(500).optional(),
})

export async function upsertMonthlyGoal(rawData: unknown): Promise<ActionResult> {
  const session = await requireAuthenticatedUser()
  const { barbershopId } = session
  const blocked = blockBarberAdministrativeAction(session.role)

  if (blocked) {
    return blocked
  }

  const parsed = MonthlyGoalSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const { month, year, revenueGoal, revenueMin, expenseLimit, notes } = parsed.data

  if (revenueMin >= revenueGoal) {
    return { success: false, error: 'Meta minima deve ser menor que a meta principal' }
  }

  await prisma.monthlyGoal.upsert({
    where: { barbershopId_month_year: { barbershopId, month, year } },
    create: {
      barbershopId,
      month,
      year,
      revenueGoal,
      revenueMin,
      expenseLimit: expenseLimit ?? null,
      notes: notes ?? null,
    },
    update: {
      revenueGoal,
      revenueMin,
      expenseLimit: expenseLimit ?? null,
      notes: notes ?? null,
    },
  })

  revalidatePath('/equipe/metas')
  revalidatePath('/dashboard')
  return { success: true }
}

const ProfGoalSchema = z.object({
  professionalId: z.string().cuid(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2030),
  revenueGoal: z.string().transform(Number).pipe(z.number().positive()),
  revenueMin: z.string().transform(Number).pipe(z.number().positive()),
})

export async function upsertProfessionalGoal(rawData: unknown): Promise<ActionResult> {
  const session = await requireAuthenticatedUser()
  const { barbershopId } = session
  const blocked = blockBarberAdministrativeAction(session.role)

  if (blocked) {
    return blocked
  }

  const parsed = ProfGoalSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const { professionalId, month, year, revenueGoal, revenueMin } = parsed.data

  const professional = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: { barbershopId: true },
  })

  if (!professional) {
    return { success: false, error: 'Profissional nao encontrado' }
  }

  try {
    ensureResourceBelongsToBarbershop(professional.barbershopId, barbershopId, 'Profissional nao encontrado')
  } catch {
    return { success: false, error: 'Profissional nao encontrado' }
  }

  const monthlyGoal = await prisma.monthlyGoal.findUnique({
    where: { barbershopId_month_year: { barbershopId, month, year } },
  })

  if (!monthlyGoal) {
    return { success: false, error: 'Crie a meta geral do mes antes das metas individuais' }
  }

  await prisma.professionalGoal.upsert({
    where: { professionalId_month_year: { professionalId, month, year } },
    create: {
      monthlyGoalId: monthlyGoal.id,
      professionalId,
      barbershopId,
      revenueGoal,
      revenueMin,
      month,
      year,
    },
    update: { revenueGoal, revenueMin },
  })

  revalidatePath('/equipe/metas')
  return { success: true }
}
