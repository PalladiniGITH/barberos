import 'server-only'

import { prisma } from '@/lib/prisma'

export async function findSessionProfessional(input: {
  barbershopId: string
  name?: string | null
  email?: string | null
}) {
  const clauses: Array<{ email?: string; name?: string }> = []

  if (input.email) {
    clauses.push({ email: input.email })
  }

  if (input.name) {
    clauses.push({ name: input.name })
  }

  if (clauses.length === 0) {
    return null
  }

  return prisma.professional.findFirst({
    where: {
      barbershopId: input.barbershopId,
      active: true,
      OR: clauses,
    },
    select: {
      id: true,
      name: true,
      commissionRate: true,
      haircutPrice: true,
      beardPrice: true,
      comboPrice: true,
      acceptsWalkIn: true,
      acceptsSubscription: true,
    },
  })
}
