'use server'

import { CategoryType } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireSession, assertOwnership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

const RevenueSchema = z.object({
  amount: z.string().transform((value) => parseFloat(value)).pipe(
    z.number().positive('Valor deve ser positivo').max(999999, 'Valor invalido')
  ),
  paymentMethod: z.enum(['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'OTHER']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida'),
  professionalId: z.string().cuid().optional().nullable(),
  serviceId: z.string().cuid().optional().nullable(),
  categoryId: z.string().cuid().optional().nullable(),
  description: z.string().max(200).optional().nullable(),
})

const ExpenseSchema = z.object({
  amount: z.string().transform((value) => parseFloat(value)).pipe(
    z.number().positive('Valor deve ser positivo').max(999999, 'Valor invalido')
  ),
  type: z.enum(['FIXED', 'VARIABLE']),
  description: z.string().min(1, 'Descricao obrigatoria').max(200),
  categoryId: z.string().cuid().optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  recurrent: z.boolean().optional().default(false),
  notes: z.string().max(500).optional().nullable(),
})

const CategorySchema = z.object({
  name: z.string().min(2, 'Nome obrigatorio').max(100),
  type: z.enum(['REVENUE', 'EXPENSE_FIXED', 'EXPENSE_VARIABLE']),
  color: z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Cor invalida'),
})

type ActionResult = { success: true } | { success: false; error: string }

export async function addFinancialCategory(rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user

  const parsed = CategorySchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data
  const existing = await prisma.financialCategory.findFirst({
    where: {
      barbershopId,
      type: data.type as CategoryType,
      name: data.name.trim(),
    },
    select: { id: true },
  })

  if (existing) {
    return { success: false, error: 'Categoria ja existe' }
  }

  await prisma.financialCategory.create({
    data: {
      barbershopId,
      name: data.name.trim(),
      type: data.type as CategoryType,
      color: data.color,
    },
  })

  revalidatePath('/financeiro')
  revalidatePath('/financeiro/categorias')
  revalidatePath('/financeiro/receitas')
  revalidatePath('/financeiro/despesas')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function addRevenue(rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user

  const parsed = RevenueSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data

  await Promise.all([
    assertOwnership(barbershopId, 'professional', data.professionalId),
    assertOwnership(barbershopId, 'service', data.serviceId),
    assertOwnership(barbershopId, 'financialCategory', data.categoryId),
  ])

  await prisma.revenue.create({
    data: {
      barbershopId,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      date: new Date(data.date),
      professionalId: data.professionalId ?? null,
      serviceId: data.serviceId ?? null,
      categoryId: data.categoryId ?? null,
      description: data.description ?? null,
    },
  })

  revalidatePath('/financeiro/receitas')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function updateRevenue(id: string, rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user

  const existing = await prisma.revenue.findUnique({ where: { id }, select: { barbershopId: true } })
  if (!existing || existing.barbershopId !== barbershopId) {
    return { success: false, error: 'Nao autorizado' }
  }

  const parsed = RevenueSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data
  await Promise.all([
    assertOwnership(barbershopId, 'professional', data.professionalId),
    assertOwnership(barbershopId, 'service', data.serviceId),
    assertOwnership(barbershopId, 'financialCategory', data.categoryId),
  ])

  await prisma.revenue.update({
    where: { id },
    data: {
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      date: new Date(data.date),
      professionalId: data.professionalId ?? null,
      serviceId: data.serviceId ?? null,
      categoryId: data.categoryId ?? null,
      description: data.description ?? null,
    },
  })

  revalidatePath('/financeiro/receitas')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteRevenue(id: string): Promise<ActionResult> {
  const session = await requireSession()
  const rev = await prisma.revenue.findUnique({ where: { id }, select: { barbershopId: true } })
  if (!rev || rev.barbershopId !== session.user.barbershopId) {
    return { success: false, error: 'Nao autorizado' }
  }
  await prisma.revenue.delete({ where: { id } })
  revalidatePath('/financeiro/receitas')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function addExpense(rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user

  const parsed = ExpenseSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data
  await assertOwnership(barbershopId, 'financialCategory', data.categoryId)

  await prisma.expense.create({
    data: {
      barbershopId,
      amount: data.amount,
      type: data.type,
      description: data.description,
      categoryId: data.categoryId ?? null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      recurrent: data.recurrent,
      notes: data.notes ?? null,
    },
  })

  revalidatePath('/financeiro/despesas')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function updateExpense(id: string, rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user

  const existing = await prisma.expense.findUnique({ where: { id }, select: { barbershopId: true } })
  if (!existing || existing.barbershopId !== barbershopId) {
    return { success: false, error: 'Nao autorizado' }
  }

  const parsed = ExpenseSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data
  await assertOwnership(barbershopId, 'financialCategory', data.categoryId)

  await prisma.expense.update({
    where: { id },
    data: {
      amount: data.amount,
      type: data.type,
      description: data.description,
      categoryId: data.categoryId ?? null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      recurrent: data.recurrent,
      notes: data.notes ?? null,
    },
  })

  revalidatePath('/financeiro/despesas')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  const session = await requireSession()
  const exp = await prisma.expense.findUnique({ where: { id }, select: { barbershopId: true } })
  if (!exp || exp.barbershopId !== session.user.barbershopId) {
    return { success: false, error: 'Nao autorizado' }
  }
  await prisma.expense.delete({ where: { id } })
  revalidatePath('/financeiro/despesas')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function markExpensePaid(id: string): Promise<ActionResult> {
  const session = await requireSession()
  const exp = await prisma.expense.findUnique({ where: { id }, select: { barbershopId: true } })
  if (!exp || exp.barbershopId !== session.user.barbershopId) {
    return { success: false, error: 'Nao autorizado' }
  }
  await prisma.expense.update({ where: { id }, data: { paid: true, paidAt: new Date() } })
  revalidatePath('/financeiro/despesas')
  return { success: true }
}
