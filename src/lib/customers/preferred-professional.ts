import 'server-only'

import { prisma } from '@/lib/prisma'

interface CompletedAppointmentHistoryRow {
  professionalId: string
  professionalName: string
  completedAt: Date | null
  startAt: Date
}

export interface PreferredProfessionalResolution {
  professionalId: string | null
  professionalName: string | null
  completedAppointmentsCount: number
  reason: 'history_top_frequency' | 'history_latest_tiebreaker' | 'single_completed' | 'none'
}

function choosePreferredProfessionalFromHistory(history: CompletedAppointmentHistoryRow[]): PreferredProfessionalResolution {
  if (history.length === 0) {
    return {
      professionalId: null,
      professionalName: null,
      completedAppointmentsCount: 0,
      reason: 'none',
    }
  }

  const aggregates = new Map<string, {
    professionalId: string
    professionalName: string
    completedAppointmentsCount: number
    lastCompletedAt: number
  }>()

  history.forEach((appointment) => {
    const current = aggregates.get(appointment.professionalId)
    const completedAt = (appointment.completedAt ?? appointment.startAt).getTime()

    if (!current) {
      aggregates.set(appointment.professionalId, {
        professionalId: appointment.professionalId,
        professionalName: appointment.professionalName,
        completedAppointmentsCount: 1,
        lastCompletedAt: completedAt,
      })
      return
    }

    current.completedAppointmentsCount += 1
    current.lastCompletedAt = Math.max(current.lastCompletedAt, completedAt)
  })

  const ranked = Array.from(aggregates.values()).sort((left, right) => {
    if (right.completedAppointmentsCount !== left.completedAppointmentsCount) {
      return right.completedAppointmentsCount - left.completedAppointmentsCount
    }

    return right.lastCompletedAt - left.lastCompletedAt
  })

  const winner = ranked[0]
  const runnerUp = ranked[1] ?? null
  const reason = ranked.length === 1
    ? 'single_completed'
    : runnerUp && winner.completedAppointmentsCount === runnerUp.completedAppointmentsCount
      ? 'history_latest_tiebreaker'
      : 'history_top_frequency'

  return {
    professionalId: winner.professionalId,
    professionalName: winner.professionalName,
    completedAppointmentsCount: winner.completedAppointmentsCount,
    reason,
  }
}

async function loadCompletedAppointmentHistory(input: {
  barbershopId: string
  customerId: string
}) {
  const appointments = await prisma.appointment.findMany({
    where: {
      barbershopId: input.barbershopId,
      customerId: input.customerId,
      status: 'COMPLETED',
    },
    orderBy: [{ completedAt: 'desc' }, { startAt: 'desc' }],
    select: {
      professionalId: true,
      completedAt: true,
      startAt: true,
      professional: {
        select: {
          name: true,
        },
      },
    },
  })

  return appointments.map((appointment) => ({
    professionalId: appointment.professionalId,
    professionalName: appointment.professional.name,
    completedAt: appointment.completedAt,
    startAt: appointment.startAt,
  }))
}

export async function syncCustomerPreferredProfessional(input: {
  barbershopId: string
  customerId: string
}) {
  const history = await loadCompletedAppointmentHistory(input)
  const resolution = choosePreferredProfessionalFromHistory(history)

  await prisma.customer.update({
    where: { id: input.customerId },
    data: {
      preferredProfessionalId: resolution.professionalId,
      preferredProfessionalUpdatedAt: resolution.professionalId ? new Date() : null,
    },
  })

  return resolution
}

export async function resolveCustomerPreferredProfessional(input: {
  barbershopId: string
  customerId: string
}) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: input.customerId,
      barbershopId: input.barbershopId,
    },
    select: {
      preferredProfessionalId: true,
      preferredProfessional: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })

  if (customer?.preferredProfessionalId && customer.preferredProfessional) {
    return {
      professionalId: customer.preferredProfessional.id,
      professionalName: customer.preferredProfessional.name,
      completedAppointmentsCount: 0,
      reason: 'history_top_frequency' as const,
    }
  }

  return syncCustomerPreferredProfessional(input)
}

export const __testing = {
  choosePreferredProfessionalFromHistory,
}
