import { PrismaClient } from '@prisma/client'
import { DEMO_PASSWORD } from './seeds/constants'
import { seedBarbershop, seedProfessionals, seedUsers } from './seeds/core'
import { seedCategories, seedServices, seedSupplies } from './seeds/catalog'
import { seedCustomers } from './seeds/customers'
import { resetDemoOperationalData, seedOperationalHistory } from './seeds/operations'
import { seedPerformanceSnapshots } from './seeds/performance'
import type { SeedReferences } from './seeds/types'

const prisma = new PrismaClient()

function indexByKey<T extends { key: string }>(items: T[]) {
  return Object.fromEntries(items.map((item) => [item.key, item])) as Record<string, T>
}

async function main() {
  console.info('[seed] rebuilding Linha Nobre official demo dataset...')

  const now = new Date()
  const barbershop = await seedBarbershop(prisma)
  const users = await seedUsers(prisma, barbershop)
  const professionals = await seedProfessionals(prisma, barbershop.id)
  const categories = await seedCategories(prisma, barbershop.id)
  const supplies = await seedSupplies(prisma, barbershop.id)
  const services = await seedServices(prisma, barbershop.id, indexByKey(supplies))
  const customers = await seedCustomers(prisma, {
    barbershopId: barbershop.id,
    professionalsByKey: indexByKey(professionals),
    now,
  })

  const refs: SeedReferences = {
    barbershop,
    users,
    professionals,
    professionalsByKey: indexByKey(professionals),
    services,
    servicesByKey: indexByKey(services),
    customers,
    customersByKey: indexByKey(customers),
    categories,
    categoriesByKey: indexByKey(categories),
    supplies,
    suppliesByKey: indexByKey(supplies),
  }

  await resetDemoOperationalData(prisma, barbershop.id)
  const operationalMetrics = await seedOperationalHistory(prisma, refs, now)
  await seedPerformanceSnapshots(prisma, refs, operationalMetrics, now)

  console.info('[seed] Linha Nobre demo ready.')
  console.info('[seed] demo access:')
  users.forEach((user) => {
    console.info(`- ${user.role}: ${user.email}`)
  })
  console.info(`[seed] password: ${DEMO_PASSWORD}`)
}

main()
  .catch((error) => {
    console.error('[seed] failed', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
