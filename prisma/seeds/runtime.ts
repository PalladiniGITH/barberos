import { PrismaClient } from '@prisma/client'
import {
  CATEGORY_DEFINITIONS,
  CUSTOMER_DEFINITIONS,
  DEMO_BARBERSHOP,
  PROFESSIONAL_DEFINITIONS,
  SERVICE_DEFINITIONS,
  SUPPLY_DEFINITIONS,
  DEMO_USERS,
} from './constants'

export interface SeedRuntimeOptions {
  dryRun: boolean
  onlyLinhaNobre: boolean
  databaseTarget: string
}

export interface SeedPreviewSnapshot {
  target: {
    slug: string
    exists: boolean
    id: string | null
  }
  otherBarbershops: Array<{
    slug: string
    name: string
    active: boolean
  }>
  canonicalPlan: {
    users: number
    professionals: number
    categories: number
    supplies: number
    services: number
    customers: number
  }
  existingCanonical: {
    users: number
    professionals: number
    categories: number
    supplies: number
    services: number
    customers: number
  } | null
  resetPlan: string[]
  existingOperational: {
    appointments: number
    revenues: number
    expenses: number
    monthlyGoals: number
    professionalGoals: number
    challenges: number
    challengeResults: number
    commissions: number
    campaignMetrics: number
  } | null
}

function readBooleanEnv(name: string) {
  return process.env[name]?.trim().toLowerCase() === 'true'
}

function redactDatabaseTarget(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    return 'DATABASE_URL ausente'
  }

  try {
    const target = new URL(databaseUrl)
    const databaseName = target.pathname.replace(/^\//, '') || '(sem nome)'
    const schema = target.searchParams.get('schema')
    return `${target.protocol}//${target.hostname}${target.port ? `:${target.port}` : ''}/${databaseName}${schema ? `?schema=${schema}` : ''}`
  } catch {
    return 'DATABASE_URL invalida'
  }
}

export function readSeedRuntimeOptions(): SeedRuntimeOptions {
  return {
    dryRun: readBooleanEnv('SEED_DRY_RUN'),
    onlyLinhaNobre: readBooleanEnv('SEED_ONLY_LINHA_NOBRE'),
    databaseTarget: redactDatabaseTarget(process.env.DATABASE_URL),
  }
}

export async function collectSeedPreview(prisma: PrismaClient): Promise<SeedPreviewSnapshot> {
  const targetBarbershop = await prisma.barbershop.findUnique({
    where: { slug: DEMO_BARBERSHOP.slug },
    select: { id: true, slug: true },
  })

  const otherBarbershops = await prisma.barbershop.findMany({
    where: { slug: { not: DEMO_BARBERSHOP.slug } },
    select: {
      slug: true,
      name: true,
      active: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  })

  const existingCanonical = targetBarbershop
    ? await prisma.$transaction([
        prisma.user.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.professional.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.financialCategory.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.supply.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.service.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.customer.count({ where: { barbershopId: targetBarbershop.id } }),
      ])
    : null

  const existingOperational = targetBarbershop
    ? await prisma.$transaction([
        prisma.appointment.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.revenue.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.expense.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.monthlyGoal.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.professionalGoal.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.challenge.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.challengeResult.count({
          where: {
            challenge: {
              barbershopId: targetBarbershop.id,
            },
          },
        }),
        prisma.commission.count({ where: { barbershopId: targetBarbershop.id } }),
        prisma.campaignMetric.count({ where: { barbershopId: targetBarbershop.id } }),
      ])
    : null

  return {
    target: {
      slug: DEMO_BARBERSHOP.slug,
      exists: Boolean(targetBarbershop),
      id: targetBarbershop?.id ?? null,
    },
    otherBarbershops,
    canonicalPlan: {
      users: DEMO_USERS.length,
      professionals: PROFESSIONAL_DEFINITIONS.length,
      categories: CATEGORY_DEFINITIONS.length,
      supplies: SUPPLY_DEFINITIONS.length,
      services: SERVICE_DEFINITIONS.length,
      customers: CUSTOMER_DEFINITIONS.length,
    },
    existingCanonical: existingCanonical
      ? {
          users: existingCanonical[0],
          professionals: existingCanonical[1],
          categories: existingCanonical[2],
          supplies: existingCanonical[3],
          services: existingCanonical[4],
          customers: existingCanonical[5],
        }
      : null,
    resetPlan: [
      'challenge_results',
      'challenges',
      'commissions',
      'professional_goals',
      'monthly_goals',
      'campaign_metrics',
      'appointments',
      'revenues',
      'expenses',
    ],
    existingOperational: existingOperational
      ? {
          appointments: existingOperational[0],
          revenues: existingOperational[1],
          expenses: existingOperational[2],
          monthlyGoals: existingOperational[3],
          professionalGoals: existingOperational[4],
          challenges: existingOperational[5],
          challengeResults: existingOperational[6],
          commissions: existingOperational[7],
          campaignMetrics: existingOperational[8],
        }
      : null,
  }
}

export function assertSeedExecutionSafety(
  options: SeedRuntimeOptions,
  preview: SeedPreviewSnapshot
) {
  if (options.dryRun) {
    return
  }

  if (!options.onlyLinhaNobre) {
    throw new Error(
      'Execucao bloqueada. Defina SEED_ONLY_LINHA_NOBRE=true para permitir escrita da seed oficial da Linha Nobre.'
    )
  }

  if (!preview.target.exists && preview.otherBarbershops.length > 0) {
    throw new Error(
      'Execucao bloqueada. O banco ja possui outras barbearias e nao contem a Linha Nobre. Rode primeiro com SEED_DRY_RUN=true e confirme o alvo antes de criar o tenant demo.'
    )
  }
}

export function logSeedPlan(
  options: SeedRuntimeOptions,
  preview: SeedPreviewSnapshot
) {
  console.info('[seed] execution modes', {
    dryRun: options.dryRun,
    onlyLinhaNobre: options.onlyLinhaNobre,
  })
  console.info('[seed] database target', options.databaseTarget)

  console.info('[seed] canonical reconcile plan', preview.canonicalPlan)
  console.info('[seed] canonical current snapshot', preview.existingCanonical ?? 'Linha Nobre ainda nao existe neste banco.')
  console.info('[seed] operational reset plan', preview.resetPlan)
  console.info('[seed] operational current snapshot', preview.existingOperational ?? 'Sem historico operacional atual da Linha Nobre.')

  if (preview.target.exists) {
    console.info('[seed] target tenant will be reconciled', {
      slug: preview.target.slug,
      id: preview.target.id,
    })
  } else {
    console.info('[seed] target tenant will be created', {
      slug: preview.target.slug,
    })
  }

  if (preview.otherBarbershops.length > 0) {
    console.info('[seed] other barbershops found and left untouched', preview.otherBarbershops)
  } else {
    console.info('[seed] no additional barbershops found in this database.')
  }

  if (options.dryRun) {
    console.info('[seed] dry-run enabled: no writes will be executed.')
  } else {
    console.info('[seed] write mode enabled for tenant slug', preview.target.slug)
  }
}
