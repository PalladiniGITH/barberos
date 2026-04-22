'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { attendanceScopeToFlags } from '@/lib/professionals/operational-config'

type ActionResult = { success: true } | { success: false; error: string }

function blockBarberAdministrativeAction(role: string) {
  if (role === 'BARBER') {
    return { success: false, error: 'Sem permissao para alterar configuracoes administrativas da equipe.' } satisfies ActionResult
  }

  return null
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
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
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

export async function createProfessional(rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const blocked = blockBarberAdministrativeAction(session.user.role)

  if (blocked) {
    return blocked
  }

  const parsed = ProfessionalSchema.safeParse(rawData)
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' }

  const {
    name,
    email,
    phone,
    commissionRate,
    haircutPrice,
    beardPrice,
    comboPrice,
    attendanceScope,
  } = parsed.data
  const attendanceFlags = attendanceScopeToFlags(attendanceScope)

  // Verifica duplicata de email no mesmo tenant
  if (email) {
    const exists = await prisma.professional.findUnique({
      where: { email_barbershopId: { email, barbershopId } },
    })
    if (exists) return { success: false, error: 'Já existe um profissional com este email' }
  }

  await prisma.professional.create({
    data: {
      name,
      email: email || null,
      phone: phone || null,
      commissionRate,
      haircutPrice,
      beardPrice,
      comboPrice,
      ...attendanceFlags,
      barbershopId,
    },
  })

  revalidatePath('/equipe/profissionais')
  revalidatePath('/agendamentos')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function updateProfessional(id: string, rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const blocked = blockBarberAdministrativeAction(session.user.role)

  if (blocked) {
    return blocked
  }

  const existing = await prisma.professional.findUnique({ where: { id }, select: { barbershopId: true } })
  if (!existing || existing.barbershopId !== barbershopId) return { success: false, error: 'Não autorizado' }

  const parsed = ProfessionalSchema.safeParse(rawData)
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' }

  const {
    name,
    email,
    phone,
    commissionRate,
    haircutPrice,
    beardPrice,
    comboPrice,
    attendanceScope,
  } = parsed.data
  const attendanceFlags = attendanceScopeToFlags(attendanceScope)

  await prisma.professional.update({
    where: { id },
    data: {
      name,
      email: email || null,
      phone: phone || null,
      commissionRate,
      haircutPrice,
      beardPrice,
      comboPrice,
      ...attendanceFlags,
    },
  })

  revalidatePath('/equipe/profissionais')
  revalidatePath('/agendamentos')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function toggleProfessionalActive(id: string): Promise<ActionResult> {
  const session = await requireSession()
  const blocked = blockBarberAdministrativeAction(session.user.role)

  if (blocked) {
    return blocked
  }

  const prof = await prisma.professional.findUnique({ where: { id }, select: { barbershopId: true, active: true } })
  if (!prof || prof.barbershopId !== session.user.barbershopId) return { success: false, error: 'Não autorizado' }
  await prisma.professional.update({ where: { id }, data: { active: !prof.active } })
  revalidatePath('/equipe/profissionais')
  revalidatePath('/agendamentos')
  revalidatePath('/dashboard')
  return { success: true }
}

// ── Metas ─────────────────────────────────────────────────

const MonthlyGoalSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2030),
  revenueGoal: z.string().transform(Number).pipe(z.number().positive()),
  revenueMin: z.string().transform(Number).pipe(z.number().positive()),
  expenseLimit: z.string().transform(Number).pipe(z.number().positive()).optional(),
  notes: z.string().max(500).optional(),
})

export async function upsertMonthlyGoal(rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const blocked = blockBarberAdministrativeAction(session.user.role)

  if (blocked) {
    return blocked
  }

  const parsed = MonthlyGoalSchema.safeParse(rawData)
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' }

  const { month, year, revenueGoal, revenueMin, expenseLimit, notes } = parsed.data

  if (revenueMin >= revenueGoal) return { success: false, error: 'Meta mínima deve ser menor que a meta principal' }

  await prisma.monthlyGoal.upsert({
    where: { barbershopId_month_year: { barbershopId, month, year } },
    create: { barbershopId, month, year, revenueGoal, revenueMin, expenseLimit: expenseLimit ?? null, notes: notes ?? null },
    update: { revenueGoal, revenueMin, expenseLimit: expenseLimit ?? null, notes: notes ?? null },
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
  const session = await requireSession()
  const { barbershopId } = session.user
  const blocked = blockBarberAdministrativeAction(session.user.role)

  if (blocked) {
    return blocked
  }

  const parsed = ProfGoalSchema.safeParse(rawData)
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' }

  const { professionalId, month, year, revenueGoal, revenueMin } = parsed.data

  // Verifica ownership do profissional
  const prof = await prisma.professional.findUnique({ where: { id: professionalId }, select: { barbershopId: true } })
  if (!prof || prof.barbershopId !== barbershopId) return { success: false, error: 'Profissional não encontrado' }

  // Garante que a meta mensal existe
  const monthlyGoal = await prisma.monthlyGoal.findUnique({
    where: { barbershopId_month_year: { barbershopId, month, year } },
  })
  if (!monthlyGoal) return { success: false, error: 'Crie a meta geral do mês antes das metas individuais' }

  await prisma.professionalGoal.upsert({
    where: { professionalId_month_year: { professionalId, month, year } },
    create: { monthlyGoalId: monthlyGoal.id, professionalId, barbershopId, revenueGoal, revenueMin, month, year },
    update: { revenueGoal, revenueMin },
  })

  revalidatePath('/equipe/metas')
  return { success: true }
}
