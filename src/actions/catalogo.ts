'use server'

import { OperationalCategoryType } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { AuthorizationError, assertRoleAllowed, requireSession } from '@/lib/auth'

type ActionResult = { success: true } | { success: false; error: string }

const nullableCuid = z.string().cuid().optional().nullable()

const decimalInput = (message: string, maxMessage = message) => z.string()
  .trim()
  .transform((value) => value.replace(',', '.'))
  .pipe(z.coerce.number({ invalid_type_error: message }).nonnegative(message).max(999999, maxMessage))

const positiveDecimalInput = (message: string, maxMessage = message) => z.string()
  .trim()
  .transform((value) => value.replace(',', '.'))
  .pipe(z.coerce.number({ invalid_type_error: message }).positive(message).max(999999, maxMessage))

const CategorySchema = z.object({
  id: nullableCuid,
  name: z.string().trim().min(2, 'Nome da categoria obrigatorio').max(80, 'Nome muito longo'),
  type: z.nativeEnum(OperationalCategoryType),
  active: z.boolean().default(true),
})

const SupplySchema = z.object({
  id: nullableCuid,
  name: z.string().trim().min(2, 'Nome do insumo obrigatorio').max(120, 'Nome muito longo'),
  unit: z.string().trim().min(1, 'Unidade obrigatoria').max(20, 'Unidade muito longa'),
  unitCost: positiveDecimalInput('Custo unitario deve ser positivo', 'Custo invalido'),
  stockQuantity: decimalInput('Quantidade deve ser numerica', 'Quantidade invalida').optional().nullable(),
  categoryId: nullableCuid,
  active: z.boolean().default(true),
})

const ServiceSchema = z.object({
  id: nullableCuid,
  name: z.string().trim().min(2, 'Nome do servico obrigatorio').max(120, 'Nome muito longo'),
  description: z.string().trim().max(240, 'Descricao muito longa').optional().nullable(),
  price: positiveDecimalInput('Preco deve ser positivo', 'Preco invalido'),
  duration: z.coerce.number({ invalid_type_error: 'Duracao invalida' }).int().positive('Duracao deve ser positiva').max(720, 'Duracao muito longa'),
  categoryId: nullableCuid,
  active: z.boolean().default(true),
})

const CatalogWriteRoles = ['OWNER', 'MANAGER'] as const

function toStringValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function toOptionalStringValue(formData: FormData, key: string) {
  const value = toStringValue(formData, key).trim()
  return value.length > 0 ? value : null
}

function toBooleanValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return value === 'on' || value === 'true' || value === '1'
}

function blockCatalogWrite(role: string): ActionResult | null {
  try {
    assertRoleAllowed(
      role,
      [...CatalogWriteRoles],
      'Sem permissao para alterar catalogo operacional da barbearia.'
    )
    return null
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { success: false, error: error.message }
    }

    throw error
  }
}

function revalidateCatalog() {
  revalidatePath('/precificacao')
  revalidatePath('/precificacao/servicos')
  revalidatePath('/precificacao/insumos')
  revalidatePath('/precificacao/resultado')
  revalidatePath('/dashboard')
}

function assertActionSuccess(result: ActionResult) {
  if (!result.success) {
    throw new Error(result.error)
  }
}

async function ensureOperationalCategory(
  barbershopId: string,
  categoryId: string | null | undefined,
  type: OperationalCategoryType
) {
  if (!categoryId) return null

  const category = await prisma.operationalCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, barbershopId: true, type: true },
  })

  if (!category || category.barbershopId !== barbershopId || category.type !== type) {
    throw new AuthorizationError('Categoria operacional invalida para este cadastro.')
  }

  return category.id
}

export async function saveOperationalCategory(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const blocked = blockCatalogWrite(session.user.role)

  if (blocked) return blocked

  const parsed = CategorySchema.safeParse({
    id: toOptionalStringValue(formData, 'id'),
    name: toStringValue(formData, 'name'),
    type: toStringValue(formData, 'type'),
    active: toBooleanValue(formData, 'active'),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const { id, name, type, active } = parsed.data
  const barbershopId = session.user.barbershopId
  const existingDuplicate = await prisma.operationalCategory.findFirst({
    where: {
      barbershopId,
      type,
      name,
      ...(id ? { id: { not: id } } : {}),
    },
    select: { id: true },
  })

  if (existingDuplicate) {
    return { success: false, error: 'Ja existe uma categoria com esse nome.' }
  }

  if (id) {
    const existing = await prisma.operationalCategory.findUnique({
      where: { id },
      select: { barbershopId: true },
    })

    if (!existing || existing.barbershopId !== barbershopId) {
      return { success: false, error: 'Categoria nao encontrada.' }
    }

    await prisma.operationalCategory.update({
      where: { id },
      data: { name, type, active },
    })
  } else {
    await prisma.operationalCategory.create({
      data: { barbershopId, name, type, active },
    })
  }

  revalidateCatalog()
  return { success: true }
}

export async function toggleOperationalCategoryStatus(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const blocked = blockCatalogWrite(session.user.role)

  if (blocked) return blocked

  const id = toOptionalStringValue(formData, 'id')
  if (!id) return { success: false, error: 'Categoria invalida.' }

  const existing = await prisma.operationalCategory.findUnique({
    where: { id },
    select: { barbershopId: true, active: true },
  })

  if (!existing || existing.barbershopId !== session.user.barbershopId) {
    return { success: false, error: 'Categoria nao encontrada.' }
  }

  await prisma.operationalCategory.update({
    where: { id },
    data: { active: !existing.active },
  })

  revalidateCatalog()
  return { success: true }
}

export async function saveSupply(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const blocked = blockCatalogWrite(session.user.role)

  if (blocked) return blocked

  const parsed = SupplySchema.safeParse({
    id: toOptionalStringValue(formData, 'id'),
    name: toStringValue(formData, 'name'),
    unit: toStringValue(formData, 'unit'),
    unitCost: toStringValue(formData, 'unitCost'),
    stockQuantity: toOptionalStringValue(formData, 'stockQuantity'),
    categoryId: toOptionalStringValue(formData, 'categoryId'),
    active: toBooleanValue(formData, 'active'),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data
  const barbershopId = session.user.barbershopId
  const categoryId = await ensureOperationalCategory(barbershopId, data.categoryId, OperationalCategoryType.SUPPLY)

  if (data.id) {
    const existing = await prisma.supply.findUnique({
      where: { id: data.id },
      select: { barbershopId: true },
    })

    if (!existing || existing.barbershopId !== barbershopId) {
      return { success: false, error: 'Insumo nao encontrado.' }
    }

    await prisma.supply.update({
      where: { id: data.id },
      data: {
        name: data.name,
        unit: data.unit,
        unitCost: data.unitCost,
        stockQuantity: data.stockQuantity ?? null,
        categoryId,
        active: data.active,
      },
    })
  } else {
    await prisma.supply.create({
      data: {
        barbershopId,
        name: data.name,
        unit: data.unit,
        unitCost: data.unitCost,
        stockQuantity: data.stockQuantity ?? null,
        categoryId,
        active: data.active,
      },
    })
  }

  revalidateCatalog()
  return { success: true }
}

export async function toggleSupplyStatus(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const blocked = blockCatalogWrite(session.user.role)

  if (blocked) return blocked

  const id = toOptionalStringValue(formData, 'id')
  if (!id) return { success: false, error: 'Insumo invalido.' }

  const existing = await prisma.supply.findUnique({
    where: { id },
    select: { barbershopId: true, active: true },
  })

  if (!existing || existing.barbershopId !== session.user.barbershopId) {
    return { success: false, error: 'Insumo nao encontrado.' }
  }

  await prisma.supply.update({
    where: { id },
    data: { active: !existing.active },
  })

  revalidateCatalog()
  return { success: true }
}

function parseServiceInputs(formData: FormData) {
  const supplyIds = formData.getAll('supplyId').filter((value): value is string => (
    typeof value === 'string' && value.length > 0
  ))
  const quantities = formData.getAll('supplyQuantity').map((value) => (
    typeof value === 'string' ? value.replace(',', '.') : ''
  ))
  const bySupply = new Map<string, number>()

  supplyIds.forEach((supplyId, index) => {
    const quantity = Number(quantities[index] ?? 0)

    if (quantity > 0) {
      bySupply.set(supplyId, quantity)
    }
  })

  return Array.from(bySupply.entries()).map(([supplyId, quantity]) => ({ supplyId, quantity }))
}

export async function saveService(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const blocked = blockCatalogWrite(session.user.role)

  if (blocked) return blocked

  const parsed = ServiceSchema.safeParse({
    id: toOptionalStringValue(formData, 'id'),
    name: toStringValue(formData, 'name'),
    description: toOptionalStringValue(formData, 'description'),
    price: toStringValue(formData, 'price'),
    duration: toStringValue(formData, 'duration'),
    categoryId: toOptionalStringValue(formData, 'categoryId'),
    active: toBooleanValue(formData, 'active'),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados invalidos' }
  }

  const data = parsed.data
  const barbershopId = session.user.barbershopId
  const categoryId = await ensureOperationalCategory(barbershopId, data.categoryId, OperationalCategoryType.SERVICE)
  const serviceInputs = parseServiceInputs(formData)

  if (serviceInputs.length > 0) {
    const validSupplies = await prisma.supply.findMany({
      where: {
        barbershopId,
        id: { in: serviceInputs.map((input) => input.supplyId) },
      },
      select: { id: true },
    })
    const validSupplyIds = new Set(validSupplies.map((supply) => supply.id))

    if (validSupplyIds.size !== serviceInputs.length) {
      return { success: false, error: 'Um dos insumos selecionados nao pertence a esta barbearia.' }
    }
  }

  const serviceId = data.id

  if (serviceId) {
    const existing = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { barbershopId: true },
    })

    if (!existing || existing.barbershopId !== barbershopId) {
      return { success: false, error: 'Servico nao encontrado.' }
    }

    await prisma.$transaction([
      prisma.service.update({
        where: { id: serviceId },
        data: {
          name: data.name,
          description: data.description ?? null,
          price: data.price,
          duration: data.duration,
          categoryId,
          active: data.active,
        },
      }),
      prisma.serviceInput.deleteMany({ where: { serviceId } }),
      ...serviceInputs.map((input) => prisma.serviceInput.create({
        data: {
          serviceId,
          supplyId: input.supplyId,
          quantity: input.quantity,
        },
      })),
    ])
  } else {
    await prisma.service.create({
      data: {
        barbershopId,
        name: data.name,
        description: data.description ?? null,
        price: data.price,
        duration: data.duration,
        categoryId,
        active: data.active,
        serviceInputs: {
          create: serviceInputs.map((input) => ({
            supplyId: input.supplyId,
            quantity: input.quantity,
          })),
        },
      },
    })
  }

  revalidateCatalog()
  return { success: true }
}

export async function toggleServiceStatus(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const blocked = blockCatalogWrite(session.user.role)

  if (blocked) return blocked

  const id = toOptionalStringValue(formData, 'id')
  if (!id) return { success: false, error: 'Servico invalido.' }

  const existing = await prisma.service.findUnique({
    where: { id },
    select: { barbershopId: true, active: true },
  })

  if (!existing || existing.barbershopId !== session.user.barbershopId) {
    return { success: false, error: 'Servico nao encontrado.' }
  }

  await prisma.service.update({
    where: { id },
    data: { active: !existing.active },
  })

  revalidateCatalog()
  return { success: true }
}

export async function saveOperationalCategoryFromForm(formData: FormData): Promise<void> {
  assertActionSuccess(await saveOperationalCategory(formData))
}

export async function toggleOperationalCategoryStatusFromForm(formData: FormData): Promise<void> {
  assertActionSuccess(await toggleOperationalCategoryStatus(formData))
}

export async function saveSupplyFromForm(formData: FormData): Promise<void> {
  assertActionSuccess(await saveSupply(formData))
}

export async function toggleSupplyStatusFromForm(formData: FormData): Promise<void> {
  assertActionSuccess(await toggleSupplyStatus(formData))
}

export async function saveServiceFromForm(formData: FormData): Promise<void> {
  assertActionSuccess(await saveService(formData))
}

export async function toggleServiceStatusFromForm(formData: FormData): Promise<void> {
  assertActionSuccess(await toggleServiceStatus(formData))
}
