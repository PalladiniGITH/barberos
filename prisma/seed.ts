import { PrismaClient } from '@prisma/client'
import { DEMO_PASSWORD } from './seeds/constants'
import { seedBarbershop, seedProfessionals, seedUsers } from './seeds/core'
import { seedCategories, seedServices, seedSupplies } from './seeds/catalog'
import { seedCustomers } from './seeds/customers'
import { resetDemoOperationalData, seedOperationalHistory } from './seeds/operations'
import { seedPerformanceSnapshots } from './seeds/performance'
import {
  assertSeedExecutionSafety,
  collectSeedPreview,
  logSeedPlan,
  readSeedRuntimeOptions,
} from './seeds/runtime'
import type { SeedReferences } from './seeds/types'

const prisma = new PrismaClient()

function indexByKey<T extends { key: string }>(items: T[]) {
  return Object.fromEntries(items.map((item) => [item.key, item])) as Record<string, T>
}

function logSeedStep(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[seed] ${message}`, details)
    return
  }

  console.info(`[seed] ${message}`)
}

async function main() {
  console.info('[seed] rebuilding Linha Nobre official demo dataset...')

  const runtimeOptions = readSeedRuntimeOptions()
  const preview = await collectSeedPreview(prisma)

  logSeedPlan(runtimeOptions, preview)
  assertSeedExecutionSafety(runtimeOptions, preview)

  if (runtimeOptions.dryRun) {
    logSeedStep('dry-run completed successfully. review the plan above before enabling write mode.')
    return
  }

  const now = new Date()

  logSeedStep('reconciling canonical tenant', { slug: 'linha-nobre' })
  const barbershop = await seedBarbershop(prisma)

  logSeedStep('reconciling users', { total: preview.canonicalPlan.users })
  const users = await seedUsers(prisma, barbershop)

  logSeedStep('reconciling professionals', { total: preview.canonicalPlan.professionals })
  const professionals = await seedProfessionals(prisma, barbershop.id)

  logSeedStep('reconciling financial categories', { total: preview.canonicalPlan.categories })
  const categories = await seedCategories(prisma, barbershop.id)

  logSeedStep('reconciling supplies', { total: preview.canonicalPlan.supplies })
  const supplies = await seedSupplies(prisma, barbershop.id)

  logSeedStep('reconciling services and pricing rules', { total: preview.canonicalPlan.services })
  const services = await seedServices(prisma, barbershop.id, indexByKey(supplies))

  logSeedStep('reconciling customers', { total: preview.canonicalPlan.customers })
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

  logSeedStep('cleaning volatile operational modules before rebuild', {
    models: preview.resetPlan,
  })
  await resetDemoOperationalData(prisma, barbershop.id)

  logSeedStep('recreating appointments, revenues and expenses')
  const operationalMetrics = await seedOperationalHistory(prisma, refs, now)

  logSeedStep('recreating goals, challenges, campaign metrics and commissions')
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
