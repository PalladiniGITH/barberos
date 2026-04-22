import { PrismaClient } from '@prisma/client'
import { CUSTOMER_DEFINITIONS } from './constants'
import { createSeedId } from './helpers'
import type { SeedCustomerRecord, SeedProfessionalRecord } from './types'

export async function seedCustomers(
  prisma: PrismaClient,
  input: {
    barbershopId: string
    professionalsByKey: Record<string, SeedProfessionalRecord>
    now: Date
  }
): Promise<SeedCustomerRecord[]> {
  const { barbershopId, professionalsByKey, now } = input

  const customers = await Promise.all(
    CUSTOMER_DEFINITIONS.map(async (definition, index) => {
      const existing = await prisma.customer.findFirst({
        where: {
          barbershopId,
          OR: [
            { email: definition.email },
            { phone: definition.phone },
            { name: definition.name },
          ],
        },
        select: { id: true },
      })

      const customerId = existing?.id ?? createSeedId('customer', definition.key)
      const subscriptionStartedAt = definition.type === 'SUBSCRIPTION'
        ? new Date(now.getFullYear(), now.getMonth() - 4 - (index % 2), 3 + index)
        : null

      await prisma.customer.upsert({
        where: { id: customerId },
        update: {
          name: definition.name,
          phone: definition.phone,
          email: definition.email,
          notes: definition.notes ?? null,
          type: definition.type,
          subscriptionStatus: definition.type === 'SUBSCRIPTION'
            ? definition.subscriptionStatus ?? 'ACTIVE'
            : null,
          subscriptionPrice: definition.type === 'SUBSCRIPTION'
            ? definition.subscriptionPrice ?? 199.9
            : null,
          subscriptionStartedAt,
          preferredProfessionalId: definition.preferredProfessionalKey
            ? professionalsByKey[definition.preferredProfessionalKey]?.id ?? null
            : null,
          preferredProfessionalUpdatedAt: definition.preferredProfessionalKey ? now : null,
          active: true,
          barbershopId,
        },
        create: {
          id: customerId,
          name: definition.name,
          phone: definition.phone,
          email: definition.email,
          notes: definition.notes ?? null,
          type: definition.type,
          subscriptionStatus: definition.type === 'SUBSCRIPTION'
            ? definition.subscriptionStatus ?? 'ACTIVE'
            : null,
          subscriptionPrice: definition.type === 'SUBSCRIPTION'
            ? definition.subscriptionPrice ?? 199.9
            : null,
          subscriptionStartedAt,
          preferredProfessionalId: definition.preferredProfessionalKey
            ? professionalsByKey[definition.preferredProfessionalKey]?.id ?? null
            : null,
          preferredProfessionalUpdatedAt: definition.preferredProfessionalKey ? now : null,
          active: true,
          barbershopId,
        },
      })

      return {
        ...definition,
        id: customerId,
      }
    })
  )

  return customers
}
