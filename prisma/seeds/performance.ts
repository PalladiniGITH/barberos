import { PrismaClient, ChallengeType } from '@prisma/client'
import { CAMPAIGN_METRIC_DEFINITIONS } from './constants'
import { createSeedId, monthKey, roundCurrency } from './helpers'
import type { SeedOperationalMetrics, SeedReferences } from './types'

function getProfessionalRevenue(
  metrics: SeedOperationalMetrics,
  professionalId: string,
  key: string
) {
  return roundCurrency(metrics.monthlyProfessionalRevenueTotals[`${key}:${professionalId}`] ?? 0)
}

export async function seedPerformanceSnapshots(
  prisma: PrismaClient,
  refs: SeedReferences,
  metrics: SeedOperationalMetrics,
  now: Date
) {
  const currentKey = metrics.currentMonth.key
  const previousKey = metrics.previousMonth.key
  const currentRevenue = metrics.monthlyRevenueTotals[currentKey] ?? 0
  const previousRevenue = metrics.monthlyRevenueTotals[previousKey] ?? 0
  const currentExpenses = metrics.monthlyExpenseTotals[currentKey] ?? 0
  const previousExpenses = metrics.monthlyExpenseTotals[previousKey] ?? 0

  const goalConfigs = [
    {
      month: metrics.previousMonth.month,
      year: metrics.previousMonth.year,
      key: previousKey,
      revenueGoal: roundCurrency(previousRevenue * 1.05),
      revenueMin: roundCurrency(previousRevenue * 0.92),
      expenseLimit: roundCurrency(previousExpenses * 1.06),
      notes: 'Mes anterior fechado com boa margem e espaco para elevar ticket e recorrencia.',
      multipliers: [
        { goal: 1.02, min: 0.9 },
        { goal: 1.04, min: 0.91 },
        { goal: 1.08, min: 0.88 },
      ],
    },
    {
      month: metrics.currentMonth.month,
      year: metrics.currentMonth.year,
      key: currentKey,
      revenueGoal: roundCurrency(currentRevenue * 1.22),
      revenueMin: roundCurrency(currentRevenue * 0.94),
      expenseLimit: roundCurrency(currentExpenses * 1.05),
      notes: 'Meta do mes focada em elevar retorno da base e venda premium sem travar agenda.',
      multipliers: [
        { goal: 1.16, min: 0.93 },
        { goal: 1.12, min: 0.91 },
        { goal: 1.19, min: 0.88 },
      ],
    },
  ]

  for (const goalConfig of goalConfigs) {
    const monthlyGoal = await prisma.monthlyGoal.upsert({
      where: {
        barbershopId_month_year: {
          barbershopId: refs.barbershop.id,
          month: goalConfig.month,
          year: goalConfig.year,
        },
      },
      update: {
        revenueGoal: goalConfig.revenueGoal,
        revenueMin: goalConfig.revenueMin,
        expenseLimit: goalConfig.expenseLimit,
        notes: goalConfig.notes,
      },
      create: {
        id: createSeedId('monthly-goal', refs.barbershop.slug, goalConfig.month, goalConfig.year),
        barbershopId: refs.barbershop.id,
        month: goalConfig.month,
        year: goalConfig.year,
        revenueGoal: goalConfig.revenueGoal,
        revenueMin: goalConfig.revenueMin,
        expenseLimit: goalConfig.expenseLimit,
        notes: goalConfig.notes,
      },
      select: { id: true },
    })

    for (let index = 0; index < refs.professionals.length; index += 1) {
      const professional = refs.professionals[index]
      const actualRevenue = getProfessionalRevenue(metrics, professional.id, goalConfig.key)
      const multipliers = goalConfig.multipliers[index]

      await prisma.professionalGoal.upsert({
        where: {
          professionalId_month_year: {
            professionalId: professional.id,
            month: goalConfig.month,
            year: goalConfig.year,
          },
        },
        update: {
          monthlyGoalId: monthlyGoal.id,
          barbershopId: refs.barbershop.id,
          revenueGoal: roundCurrency(actualRevenue * multipliers.goal),
          revenueMin: roundCurrency(actualRevenue * multipliers.min),
        },
        create: {
          id: createSeedId('professional-goal', professional.key, goalConfig.month, goalConfig.year),
          monthlyGoalId: monthlyGoal.id,
          professionalId: professional.id,
          barbershopId: refs.barbershop.id,
          revenueGoal: roundCurrency(actualRevenue * multipliers.goal),
          revenueMin: roundCurrency(actualRevenue * multipliers.min),
          month: goalConfig.month,
          year: goalConfig.year,
        },
      })
    }
  }

  const currentLeader = [...refs.professionals].sort(
    (left, right) => getProfessionalRevenue(metrics, right.id, currentKey) - getProfessionalRevenue(metrics, left.id, currentKey)
  )[0]
  const previousLeader = [...refs.professionals].sort(
    (left, right) => getProfessionalRevenue(metrics, right.id, previousKey) - getProfessionalRevenue(metrics, left.id, previousKey)
  )[0]

  const activeChallenge = await prisma.challenge.upsert({
    where: { id: createSeedId('challenge', 'active', currentKey) },
    update: {
      title: `Sprint de faturamento de ${metrics.currentMonth.label}`,
      description: 'Desafio do mes para empurrar premium, manter agenda cheia e subir ticket.',
      startDate: new Date(metrics.currentMonth.year, metrics.currentMonth.month - 1, 1),
      endDate: new Date(metrics.currentMonth.year, metrics.currentMonth.month, 0),
      type: ChallengeType.REVENUE,
      targetValue: roundCurrency(getProfessionalRevenue(metrics, currentLeader.id, currentKey) * 1.08),
      reward: 'Bonus de R$ 350 + destaque interno',
      active: true,
      barbershopId: refs.barbershop.id,
    },
    create: {
      id: createSeedId('challenge', 'active', currentKey),
      barbershopId: refs.barbershop.id,
      title: `Sprint de faturamento de ${metrics.currentMonth.label}`,
      description: 'Desafio do mes para empurrar premium, manter agenda cheia e subir ticket.',
      startDate: new Date(metrics.currentMonth.year, metrics.currentMonth.month - 1, 1),
      endDate: new Date(metrics.currentMonth.year, metrics.currentMonth.month, 0),
      type: ChallengeType.REVENUE,
      targetValue: roundCurrency(getProfessionalRevenue(metrics, currentLeader.id, currentKey) * 1.08),
      reward: 'Bonus de R$ 350 + destaque interno',
      active: true,
    },
  })

  const previousChallenge = await prisma.challenge.upsert({
    where: { id: createSeedId('challenge', 'closed', previousKey) },
    update: {
      title: `Corrida comercial de ${metrics.previousMonth.label}`,
      description: 'Desafio fechado para comparar desempenho e recorrencia do time.',
      startDate: new Date(metrics.previousMonth.year, metrics.previousMonth.month - 1, 1),
      endDate: new Date(metrics.previousMonth.year, metrics.previousMonth.month, 0),
      type: ChallengeType.REVENUE,
      targetValue: roundCurrency(getProfessionalRevenue(metrics, previousLeader.id, previousKey) * 0.96),
      reward: 'Vale compras profissional + mural de lideranca',
      active: false,
      barbershopId: refs.barbershop.id,
    },
    create: {
      id: createSeedId('challenge', 'closed', previousKey),
      barbershopId: refs.barbershop.id,
      title: `Corrida comercial de ${metrics.previousMonth.label}`,
      description: 'Desafio fechado para comparar desempenho e recorrencia do time.',
      startDate: new Date(metrics.previousMonth.year, metrics.previousMonth.month - 1, 1),
      endDate: new Date(metrics.previousMonth.year, metrics.previousMonth.month, 0),
      type: ChallengeType.REVENUE,
      targetValue: roundCurrency(getProfessionalRevenue(metrics, previousLeader.id, previousKey) * 0.96),
      reward: 'Vale compras profissional + mural de lideranca',
      active: false,
    },
  })

  for (const professional of refs.professionals) {
    const currentAchieved = getProfessionalRevenue(metrics, professional.id, currentKey)
    const previousAchieved = getProfessionalRevenue(metrics, professional.id, previousKey)

    await prisma.challengeResult.upsert({
      where: {
        challengeId_professionalId: {
          challengeId: activeChallenge.id,
          professionalId: professional.id,
        },
      },
      update: {
        achievedValue: currentAchieved,
        completed: currentAchieved >= Number(activeChallenge.targetValue),
        rewardGiven: false,
        notes: currentAchieved >= Number(activeChallenge.targetValue)
          ? 'Ja bateu a meta do desafio vigente.'
          : 'Segue em disputa no mes atual.',
      },
      create: {
        id: createSeedId('challenge-result', activeChallenge.id, professional.id),
        challengeId: activeChallenge.id,
        professionalId: professional.id,
        achievedValue: currentAchieved,
        completed: currentAchieved >= Number(activeChallenge.targetValue),
        rewardGiven: false,
        notes: currentAchieved >= Number(activeChallenge.targetValue)
          ? 'Ja bateu a meta do desafio vigente.'
          : 'Segue em disputa no mes atual.',
      },
    })

    await prisma.challengeResult.upsert({
      where: {
        challengeId_professionalId: {
          challengeId: previousChallenge.id,
          professionalId: professional.id,
        },
      },
      update: {
        achievedValue: previousAchieved,
        completed: previousAchieved >= Number(previousChallenge.targetValue),
        rewardGiven: previousAchieved >= Number(previousChallenge.targetValue),
        notes: previousAchieved >= Number(previousChallenge.targetValue)
          ? 'Fechou acima do alvo final.'
          : 'Ficou abaixo do objetivo do mes.',
      },
      create: {
        id: createSeedId('challenge-result', previousChallenge.id, professional.id),
        challengeId: previousChallenge.id,
        professionalId: professional.id,
        achievedValue: previousAchieved,
        completed: previousAchieved >= Number(previousChallenge.targetValue),
        rewardGiven: previousAchieved >= Number(previousChallenge.targetValue),
        notes: previousAchieved >= Number(previousChallenge.targetValue)
          ? 'Fechou acima do alvo final.'
          : 'Ficou abaixo do objetivo do mes.',
      },
    })
  }

  for (const definition of CAMPAIGN_METRIC_DEFINITIONS) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - definition.monthOffset, 1)

    await prisma.campaignMetric.upsert({
      where: { id: createSeedId('campaign-metric', definition.key, monthKey(targetDate.getMonth() + 1, targetDate.getFullYear())) },
      update: {
        barbershopId: refs.barbershop.id,
        month: targetDate.getMonth() + 1,
        year: targetDate.getFullYear(),
        campaignName: definition.campaignName,
        messagesSent: definition.messagesSent,
        messagesAnswered: definition.messagesAnswered,
        appointmentsBooked: definition.appointmentsBooked,
        newClients: definition.newClients,
        recoveredClients: definition.recoveredClients,
        notes: definition.notes,
      },
      create: {
        id: createSeedId('campaign-metric', definition.key, monthKey(targetDate.getMonth() + 1, targetDate.getFullYear())),
        barbershopId: refs.barbershop.id,
        month: targetDate.getMonth() + 1,
        year: targetDate.getFullYear(),
        campaignName: definition.campaignName,
        messagesSent: definition.messagesSent,
        messagesAnswered: definition.messagesAnswered,
        appointmentsBooked: definition.appointmentsBooked,
        newClients: definition.newClients,
        recoveredClients: definition.recoveredClients,
        notes: definition.notes,
      },
    })
  }

  const commissionMonths = [
    { month: metrics.previousMonth.month, year: metrics.previousMonth.year, key: previousKey, paid: true },
    { month: metrics.currentMonth.month, year: metrics.currentMonth.year, key: currentKey, paid: false },
  ]

  for (const commissionMonth of commissionMonths) {
    for (const professional of refs.professionals) {
      const grossRevenue = getProfessionalRevenue(metrics, professional.id, commissionMonth.key)
      const commissionAmount = roundCurrency((grossRevenue * professional.commissionRate) / 100)
      const bonus = commissionMonth.key === currentKey && professional.id === currentLeader.id
        ? 180
        : commissionMonth.key === previousKey && professional.id === previousLeader.id
          ? 120
          : 0

      await prisma.commission.upsert({
        where: {
          professionalId_month_year: {
            professionalId: professional.id,
            month: commissionMonth.month,
            year: commissionMonth.year,
          },
        },
        update: {
          barbershopId: refs.barbershop.id,
          grossRevenue,
          commissionRate: professional.commissionRate,
          commissionAmount,
          bonus,
          paid: commissionMonth.paid,
          paidAt: commissionMonth.paid
            ? new Date(commissionMonth.year, commissionMonth.month, 0, 18, 0, 0)
            : null,
        },
        create: {
          id: createSeedId('commission', professional.key, commissionMonth.month, commissionMonth.year),
          professionalId: professional.id,
          barbershopId: refs.barbershop.id,
          month: commissionMonth.month,
          year: commissionMonth.year,
          grossRevenue,
          commissionRate: professional.commissionRate,
          commissionAmount,
          bonus,
          paid: commissionMonth.paid,
          paidAt: commissionMonth.paid
            ? new Date(commissionMonth.year, commissionMonth.month, 0, 18, 0, 0)
            : null,
        },
      })
    }
  }
}
