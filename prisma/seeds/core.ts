import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { DEMO_BARBERSHOP, DEMO_PASSWORD, DEMO_USERS, PROFESSIONAL_DEFINITIONS } from './constants'
import { createSeedId } from './helpers'
import type { SeedBarbershopRecord, SeedProfessionalRecord, SeedUserRecord } from './types'

export async function seedBarbershop(prisma: PrismaClient): Promise<SeedBarbershopRecord> {
  const barbershop = await prisma.barbershop.upsert({
    where: { slug: DEMO_BARBERSHOP.slug },
    update: {
      name: DEMO_BARBERSHOP.name,
      address: DEMO_BARBERSHOP.address,
      phone: DEMO_BARBERSHOP.phone,
      email: DEMO_BARBERSHOP.email,
      timezone: DEMO_BARBERSHOP.timezone,
      onboardingStep: DEMO_BARBERSHOP.onboardingStep,
      onboardingCompletedAt: new Date(),
      active: true,
    },
    create: {
      id: createSeedId('barbershop', DEMO_BARBERSHOP.slug),
      ...DEMO_BARBERSHOP,
      onboardingCompletedAt: new Date(),
      active: true,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
    },
  })

  return barbershop
}

export async function seedUsers(
  prisma: PrismaClient,
  barbershop: SeedBarbershopRecord
): Promise<SeedUserRecord[]> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)

  const users = await Promise.all(
    DEMO_USERS.map(async (definition) => {
      const user = await prisma.user.upsert({
        where: { email: definition.email },
        update: {
          name: definition.name,
          role: definition.role,
          active: true,
          passwordHash,
          barbershopId: barbershop.id,
        },
        create: {
          id: createSeedId('user', definition.key),
          name: definition.name,
          email: definition.email,
          role: definition.role,
          active: true,
          passwordHash,
          barbershopId: barbershop.id,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      })

      return {
        ...definition,
        id: user.id,
      }
    })
  )

  return users
}

export async function seedProfessionals(
  prisma: PrismaClient,
  barbershopId: string
): Promise<SeedProfessionalRecord[]> {
  const professionals = await Promise.all(
    PROFESSIONAL_DEFINITIONS.map(async (definition) => {
      const existing = await prisma.professional.findFirst({
        where: {
          barbershopId,
          OR: [
            { email: definition.email },
            { name: definition.name },
          ],
        },
        select: { id: true },
      })

      const professionalId = existing?.id ?? createSeedId('professional', definition.key)

      await prisma.professional.upsert({
        where: { id: professionalId },
        update: {
          name: definition.name,
          email: definition.email,
          phone: definition.phone,
          active: true,
          commissionRate: definition.commissionRate,
          haircutPrice: definition.haircutPrice,
          beardPrice: definition.beardPrice,
          comboPrice: definition.comboPrice,
          acceptsWalkIn: definition.acceptsWalkIn,
          acceptsSubscription: definition.acceptsSubscription,
          barbershopId,
        },
        create: {
          id: professionalId,
          name: definition.name,
          email: definition.email,
          phone: definition.phone,
          active: true,
          commissionRate: definition.commissionRate,
          haircutPrice: definition.haircutPrice,
          beardPrice: definition.beardPrice,
          comboPrice: definition.comboPrice,
          acceptsWalkIn: definition.acceptsWalkIn,
          acceptsSubscription: definition.acceptsSubscription,
          barbershopId,
        },
      })

      return {
        ...definition,
        id: professionalId,
      }
    })
  )

  return professionals
}
