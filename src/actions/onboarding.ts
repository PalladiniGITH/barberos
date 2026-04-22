'use server'

import { revalidatePath } from 'next/cache'
import { CategoryType } from '@prisma/client'
import { z } from 'zod'
import { requireSession, assertAdministrativeRole, AuthorizationError } from '@/lib/auth'
import { getMonthYearInTimezone } from '@/lib/onboarding'
import { prisma } from '@/lib/prisma'

type ActionResult = { success: true } | { success: false; error: string }

function blockBarberOnboardingAction(role: string) {
  try {
    assertAdministrativeRole(role, 'Sem permissao para concluir o onboarding da barbearia.')
    return null
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { success: false, error: error.message } satisfies ActionResult
    }

    throw error
  }
}

const ProfessionalInputSchema = z.object({
  name: z.string().min(2, 'Cada profissional precisa ter ao menos 2 caracteres').max(100),
})

const ServiceInputSchema = z.object({
  name: z.string().min(2, 'Cada serviço precisa ter ao menos 2 caracteres').max(100),
  price: z.string().transform(Number).pipe(z.number().positive('Preço precisa ser maior que zero')),
  duration: z.string().transform(Number).pipe(z.number().int().min(5, 'Duração mínima de 5 minutos').max(240, 'Duração inválida')),
})

const OnboardingSchema = z.object({
  name: z.string().min(2, 'Nome da barbearia obrigatório').max(120),
  phone: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  address: z.string().max(160).optional().or(z.literal('')),
  timezone: z.string().min(1, 'Selecione o timezone da barbearia'),
  professionals: z.array(ProfessionalInputSchema).min(1, 'Cadastre pelo menos 1 profissional').max(6),
  services: z.array(ServiceInputSchema).min(1, 'Cadastre pelo menos 1 serviço').max(8),
  revenueGoal: z.string().transform(Number).pipe(z.number().positive('Defina uma meta de faturamento')),
  revenueMin: z.string().transform(Number).pipe(z.number().positive('Defina uma meta mínima')),
  expenseLimit: z.string().optional().or(z.literal('')).transform((value) => {
    if (!value) return null
    return Number(value)
  }).pipe(z.number().positive('Limite de despesas precisa ser positivo').nullable()),
})

const DEFAULT_CATEGORIES = [
  { name: 'Serviços', type: CategoryType.REVENUE, color: '#10b981' },
  { name: 'Produtos', type: CategoryType.REVENUE, color: '#3b82f6' },
  { name: 'Outros', type: CategoryType.REVENUE, color: '#8b5cf6' },
  { name: 'Aluguel', type: CategoryType.EXPENSE_FIXED, color: '#f59e0b' },
  { name: 'Equipe', type: CategoryType.EXPENSE_FIXED, color: '#ef4444' },
  { name: 'Energia', type: CategoryType.EXPENSE_FIXED, color: '#f97316' },
  { name: 'Internet', type: CategoryType.EXPENSE_FIXED, color: '#06b6d4' },
  { name: 'Insumos', type: CategoryType.EXPENSE_VARIABLE, color: '#84cc16' },
  { name: 'Marketing', type: CategoryType.EXPENSE_VARIABLE, color: '#ec4899' },
  { name: 'Manutenção', type: CategoryType.EXPENSE_VARIABLE, color: '#a78bfa' },
]

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

async function ensureDefaultCategories(
  db: Pick<typeof prisma, 'financialCategory'>,
  barbershopId: string
) {
  const existing = await db.financialCategory.findMany({
    where: { barbershopId },
    select: { name: true, type: true },
  })

  const existingKeys = new Set(existing.map((item) => `${item.type}:${item.name.toLowerCase()}`))

  const missing = DEFAULT_CATEGORIES.filter((category) => (
    !existingKeys.has(`${category.type}:${category.name.toLowerCase()}`)
  ))

  if (missing.length === 0) return

  await db.financialCategory.createMany({
    data: missing.map((category) => ({ ...category, barbershopId })),
  })
}

export async function completeOnboarding(rawData: unknown): Promise<ActionResult> {
  const session = await requireSession()
  const { barbershopId } = session.user
  const blocked = blockBarberOnboardingAction(session.user.role)

  if (blocked) {
    return blocked
  }

  const parsed = OnboardingSchema.safeParse(rawData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' }
  }

  const data = parsed.data

  if (data.revenueMin >= data.revenueGoal) {
    return { success: false, error: 'A meta mínima precisa ser menor que a meta principal' }
  }

  const professionals = data.professionals
    .map((professional) => ({ name: normalizeName(professional.name) }))
    .filter((professional) => professional.name.length > 0)

  const services = data.services
    .map((service) => ({
      name: normalizeName(service.name),
      price: service.price,
      duration: service.duration,
    }))
    .filter((service) => service.name.length > 0)

  if (professionals.length === 0) {
    return { success: false, error: 'Cadastre pelo menos 1 profissional' }
  }

  if (services.length === 0) {
    return { success: false, error: 'Cadastre pelo menos 1 serviço' }
  }

  const uniqueProfessionalNames = new Set(professionals.map((professional) => professional.name.toLowerCase()))
  if (uniqueProfessionalNames.size !== professionals.length) {
    return { success: false, error: 'Existem profissionais duplicados no onboarding' }
  }

  const uniqueServiceNames = new Set(services.map((service) => service.name.toLowerCase()))
  if (uniqueServiceNames.size !== services.length) {
    return { success: false, error: 'Existem serviços duplicados no onboarding' }
  }

  const { month, year } = getMonthYearInTimezone(data.timezone)

  try {
    await prisma.$transaction(async (tx) => {
      await tx.barbershop.update({
        where: { id: barbershopId },
        data: {
          name: normalizeName(data.name),
          phone: data.phone || null,
          email: data.email || null,
          address: data.address || null,
          timezone: data.timezone,
          onboardingStep: 4,
          onboardingCompletedAt: new Date(),
        },
      })

      await ensureDefaultCategories({ financialCategory: tx.financialCategory }, barbershopId)

      const existingProfessionals = await tx.professional.findMany({
        where: { barbershopId },
        select: { name: true },
      })

      const existingProfessionalNames = new Set(
        existingProfessionals.map((professional) => professional.name.trim().toLowerCase())
      )

      const newProfessionals = professionals.filter((professional) => (
        !existingProfessionalNames.has(professional.name.toLowerCase())
      ))

      if (newProfessionals.length > 0) {
        await tx.professional.createMany({
          data: newProfessionals.map((professional) => ({
            barbershopId,
            name: professional.name,
          })),
        })
      }

      await Promise.all(
        professionals.map((professional) => (
          tx.professional.updateMany({
            where: {
              barbershopId,
              name: professional.name,
            },
            data: { active: true },
          })
        ))
      )

      const existingServices = await tx.service.findMany({
        where: { barbershopId },
        select: { id: true, name: true },
      })

      const existingServicesByName = new Map(
        existingServices.map((service) => [service.name.trim().toLowerCase(), service])
      )

      for (const service of services) {
        const existingService = existingServicesByName.get(service.name.toLowerCase())

        if (existingService) {
          await tx.service.update({
            where: { id: existingService.id },
            data: {
              price: service.price,
              duration: service.duration,
              active: true,
            },
          })
          continue
        }

        await tx.service.create({
          data: {
            barbershopId,
            name: service.name,
            price: service.price,
            duration: service.duration,
          },
        })
      }

      await tx.monthlyGoal.upsert({
        where: { barbershopId_month_year: { barbershopId, month, year } },
        create: {
          barbershopId,
          month,
          year,
          revenueGoal: data.revenueGoal,
          revenueMin: data.revenueMin,
          expenseLimit: data.expenseLimit,
        },
        update: {
          revenueGoal: data.revenueGoal,
          revenueMin: data.revenueMin,
          expenseLimit: data.expenseLimit,
        },
      })
    })
  } catch (error) {
    console.error('Erro ao concluir onboarding:', error)
    return { success: false, error: 'Não foi possível concluir o onboarding agora' }
  }

  revalidatePath('/onboarding')
  revalidatePath('/setup')
  revalidatePath('/dashboard')
  revalidatePath('/equipe/profissionais')
  revalidatePath('/equipe/metas')
  revalidatePath('/precificacao/servicos')
  revalidatePath('/configuracoes')

  return { success: true }
}
