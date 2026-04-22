import { PrismaClient } from '@prisma/client'
import { CATEGORY_DEFINITIONS, SERVICE_DEFINITIONS, SUPPLY_DEFINITIONS } from './constants'
import { createSeedId } from './helpers'
import type {
  SeedCategoryRecord,
  SeedServiceRecord,
  SeedSupplyRecord,
} from './types'

export async function seedCategories(
  prisma: PrismaClient,
  barbershopId: string
): Promise<SeedCategoryRecord[]> {
  const categories = await Promise.all(
    CATEGORY_DEFINITIONS.map(async (definition) => {
      const existing = await prisma.financialCategory.findFirst({
        where: {
          barbershopId,
          name: definition.name,
          type: definition.type,
        },
        select: { id: true },
      })

      const categoryId = existing?.id ?? createSeedId('financial-category', definition.key)

      await prisma.financialCategory.upsert({
        where: { id: categoryId },
        update: {
          name: definition.name,
          type: definition.type,
          color: definition.color,
          barbershopId,
        },
        create: {
          id: categoryId,
          name: definition.name,
          type: definition.type,
          color: definition.color,
          barbershopId,
        },
      })

      return {
        ...definition,
        id: categoryId,
      }
    })
  )

  return categories
}

export async function seedSupplies(
  prisma: PrismaClient,
  barbershopId: string
): Promise<SeedSupplyRecord[]> {
  const supplies = await Promise.all(
    SUPPLY_DEFINITIONS.map(async (definition) => {
      const existing = await prisma.supply.findFirst({
        where: {
          barbershopId,
          name: definition.name,
        },
        select: { id: true },
      })

      const supplyId = existing?.id ?? createSeedId('supply', definition.key)

      await prisma.supply.upsert({
        where: { id: supplyId },
        update: {
          name: definition.name,
          unit: definition.unit,
          unitCost: definition.unitCost,
          barbershopId,
        },
        create: {
          id: supplyId,
          name: definition.name,
          unit: definition.unit,
          unitCost: definition.unitCost,
          barbershopId,
        },
      })

      return {
        ...definition,
        id: supplyId,
      }
    })
  )

  return supplies
}

export async function seedServices(
  prisma: PrismaClient,
  barbershopId: string,
  suppliesByKey: Record<string, SeedSupplyRecord>
): Promise<SeedServiceRecord[]> {
  const services = await Promise.all(
    SERVICE_DEFINITIONS.map(async (definition) => {
      const existing = await prisma.service.findFirst({
        where: {
          barbershopId,
          name: definition.name,
        },
        select: { id: true },
      })

      const serviceId = existing?.id ?? createSeedId('service', definition.key)

      await prisma.service.upsert({
        where: { id: serviceId },
        update: {
          name: definition.name,
          description: definition.description,
          price: definition.price,
          duration: definition.duration,
          active: true,
          barbershopId,
        },
        create: {
          id: serviceId,
          name: definition.name,
          description: definition.description,
          price: definition.price,
          duration: definition.duration,
          active: true,
          barbershopId,
        },
      })

      await prisma.pricingRule.upsert({
        where: { serviceId },
        update: {
          barbershopId,
          ...definition.pricing,
        },
        create: {
          serviceId,
          barbershopId,
          ...definition.pricing,
        },
      })

      await Promise.all(
        definition.inputs.map((input) =>
          prisma.serviceInput.upsert({
            where: {
              serviceId_supplyId: {
                serviceId,
                supplyId: suppliesByKey[input.supplyKey].id,
              },
            },
            update: {
              quantity: input.quantity,
            },
            create: {
              serviceId,
              supplyId: suppliesByKey[input.supplyKey].id,
              quantity: input.quantity,
            },
          })
        )
      )

      return {
        ...definition,
        id: serviceId,
      }
    })
  )

  return services
}
