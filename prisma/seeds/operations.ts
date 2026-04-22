import {
  AppointmentBillingModel,
  AppointmentSource,
  AppointmentStatus,
  ExpenseType,
  PaymentMethod,
  Prisma,
  PrismaClient,
  RevenueOrigin,
} from '@prisma/client'
import {
  FIXED_EXPENSE_TEMPLATES,
  HISTORY_MONTHS,
  PAYMENT_METHODS,
  SERVICE_VARIATIONS,
  SUBSCRIPTION_CUSTOMER_POOL,
  TODAY_AND_FUTURE_SCHEDULE,
  VARIABLE_EXPENSE_TEMPLATES,
  WALK_IN_CUSTOMER_POOL,
} from './constants'
import {
  addMinutes,
  atTime,
  buildAppointmentTimestamps,
  buildSafeDate,
  createSeedId,
  dayOffset,
  ensureOpenDay,
  isOpenDay,
  listRecentMonths,
  monthKey,
  resolveOperationalPrice,
  roundCurrency,
} from './helpers'
import type {
  RevenueEntryInput,
  SeedCategoryRecord,
  SeedCustomerRecord,
  SeedOperationalMetrics,
  SeedProfessionalRecord,
  SeedReferences,
  SeedServiceRecord,
} from './types'

function buildRevenueDescription(service: SeedServiceRecord, billingModel: AppointmentBillingModel) {
  if (billingModel === AppointmentBillingModel.SUBSCRIPTION_EXTRA) {
    return `${service.name} extra do plano`
  }

  return service.name
}

function resolveBillingModel(customer: SeedCustomerRecord, service: SeedServiceRecord) {
  if (customer.type === 'WALK_IN') {
    return AppointmentBillingModel.AVULSO
  }

  const extraServices = new Set(['corte-barba-premium', 'pigmentacao-natural', 'hidratacao-capilar'])
  return extraServices.has(service.key)
    ? AppointmentBillingModel.SUBSCRIPTION_EXTRA
    : AppointmentBillingModel.SUBSCRIPTION_INCLUDED
}

function resolveRevenueCategoryKey(service: SeedServiceRecord) {
  return service.key === 'corte-barba-premium' ? 'combo-premium' : 'servicos'
}

function buildRevenueEntry(input: RevenueEntryInput): Prisma.RevenueCreateManyInput {
  return {
    id: input.id,
    barbershopId: input.barbershopId,
    customerId: input.customerId,
    professionalId: input.professionalId,
    serviceId: input.serviceId,
    categoryId: input.categoryId,
    amount: input.amount,
    origin: input.origin,
    paymentMethod: input.paymentMethod,
    date: input.date,
    description: input.description,
    notes: input.notes,
  }
}

function resolvePoolCustomerKey(input: {
  professional: SeedProfessionalRecord
  professionalIndex: number
  monthIndex: number
  day: number
  appointmentIndex: number
}) {
  const { professional, professionalIndex, monthIndex, day, appointmentIndex } = input

  if (professional.acceptsSubscription && !professional.acceptsWalkIn) {
    return SUBSCRIPTION_CUSTOMER_POOL[
      (day + appointmentIndex + professionalIndex + monthIndex) % SUBSCRIPTION_CUSTOMER_POOL.length
    ]
  }

  if (!professional.acceptsSubscription && professional.acceptsWalkIn) {
    return WALK_IN_CUSTOMER_POOL[
      (day + appointmentIndex + professionalIndex + monthIndex) % WALK_IN_CUSTOMER_POOL.length
    ]
  }

  const prefersSubscription = (day + appointmentIndex + professionalIndex + monthIndex) % 4 === 0
  const pool = prefersSubscription ? SUBSCRIPTION_CUSTOMER_POOL : WALK_IN_CUSTOMER_POOL
  return pool[(day + appointmentIndex + professionalIndex + monthIndex * 2) % pool.length]
}

export async function resetDemoOperationalData(prisma: PrismaClient, barbershopId: string) {
  await prisma.challengeResult.deleteMany({
    where: {
      challenge: {
        barbershopId,
      },
    },
  })
  await prisma.challenge.deleteMany({ where: { barbershopId } })
  await prisma.commission.deleteMany({ where: { barbershopId } })
  await prisma.professionalGoal.deleteMany({ where: { barbershopId } })
  await prisma.monthlyGoal.deleteMany({ where: { barbershopId } })
  await prisma.campaignMetric.deleteMany({ where: { barbershopId } })
  await prisma.appointment.deleteMany({ where: { barbershopId } })
  await prisma.revenue.deleteMany({ where: { barbershopId } })
  await prisma.expense.deleteMany({ where: { barbershopId } })
}

export async function seedOperationalHistory(
  prisma: PrismaClient,
  refs: SeedReferences,
  now: Date
): Promise<SeedOperationalMetrics> {
  const monthMetas = listRecentMonths(now, HISTORY_MONTHS)
  const currentMonth = monthMetas[monthMetas.length - 1]
  const previousMonth = monthMetas[monthMetas.length - 2]

  const appointments: Prisma.AppointmentCreateManyInput[] = []
  const revenues: Prisma.RevenueCreateManyInput[] = []
  const expenses: Prisma.ExpenseCreateManyInput[] = []

  const monthlyRevenueTotals: Record<string, number> = {}
  const monthlyExpenseTotals: Record<string, number> = {}
  const monthlyProfessionalRevenueTotals: Record<string, number> = {}

  const subscriptionCustomers = refs.customers.filter((customer) => customer.type === 'SUBSCRIPTION')
  const today = ensureOpenDay(new Date(now))

  monthMetas.forEach((monthMeta, monthIndex) => {
    const lastHistoricalDay = monthMeta.isCurrent
      ? Math.max(0, now.getDate() - 1)
      : monthMeta.daysInMonth

    subscriptionCustomers.forEach((customer, customerIndex) => {
      const paymentDate = buildSafeDate(
        monthMeta.year,
        monthMeta.month,
        monthMeta.isCurrent
          ? Math.max(1, Math.min(now.getDate(), 3 + customerIndex))
          : Math.min(3 + customerIndex, monthMeta.daysInMonth)
      )
      const amount = roundCurrency(customer.subscriptionPrice ?? 199.9)

      revenues.push(buildRevenueEntry({
        id: createSeedId('revenue', 'subscription', monthMeta.key, customer.key),
        barbershopId: refs.barbershop.id,
        customerId: customer.id,
        professionalId: null,
        serviceId: null,
        categoryId: refs.categoriesByKey.assinaturas.id,
        amount,
        origin: RevenueOrigin.SUBSCRIPTION,
        paymentMethod: PaymentMethod.PIX,
        date: paymentDate,
        description: `Mensalidade ${customer.name}`,
        notes: 'Receita recorrente do plano assinatura.',
      }))

      monthlyRevenueTotals[monthMeta.key] = roundCurrency((monthlyRevenueTotals[monthMeta.key] ?? 0) + amount)
    })

    for (let day = 1; day <= lastHistoricalDay; day += 1) {
      const baseDate = new Date(monthMeta.year, monthMeta.month - 1, day)

      if (!isOpenDay(baseDate)) {
        continue
      }

      refs.professionals.forEach((professional, professionalIndex) => {
        const weekdayAdjust = baseDate.getDay() === 6 ? 1 : baseDate.getDay() === 1 ? -1 : 0
        const baseAppointments = professional.baseAppointments + weekdayAdjust
        const monthIntensity = 0.86 + monthIndex * 0.04
        const totalAppointments = Math.max(
          4,
          Math.round((baseAppointments + ((day + professionalIndex + monthIndex) % 3) - 1) * monthIntensity)
        )

        let slotCursor = atTime(
          baseDate,
          professionalIndex === 0 ? '08:30' : professionalIndex === 1 ? '09:00' : '09:30'
        )

        for (let appointmentIndex = 0; appointmentIndex < totalAppointments; appointmentIndex += 1) {
          const serviceKey = professional.rotation[(day + appointmentIndex + monthIndex) % professional.rotation.length]
          const service = refs.servicesByKey[serviceKey]
          const customerKey = resolvePoolCustomerKey({
            professional,
            professionalIndex,
            monthIndex,
            day,
            appointmentIndex,
          })
          const customer = refs.customersByKey[customerKey]
          const billingModel = resolveBillingModel(customer, service)
          const priceSnapshot = resolveOperationalPrice(service, professional)
          const amount = roundCurrency(
            priceSnapshot + SERVICE_VARIATIONS[(day + appointmentIndex + professionalIndex + monthIndex) % SERVICE_VARIATIONS.length] + professional.ticketBoost
          )

          const startAt = new Date(slotCursor)
          const endAt = addMinutes(startAt, service.duration)

          if (endAt.getHours() > 21 || (endAt.getHours() === 21 && endAt.getMinutes() > 0)) {
            break
          }

          appointments.push({
            id: createSeedId('appointment', monthMeta.key, professional.key, day, appointmentIndex, customer.key),
            barbershopId: refs.barbershop.id,
            customerId: customer.id,
            professionalId: professional.id,
            serviceId: service.id,
            status: AppointmentStatus.COMPLETED,
            source: AppointmentSource.MANUAL,
            billingModel,
            startAt,
            endAt,
            durationMinutes: service.duration,
            priceSnapshot,
            notes: customer.type === 'SUBSCRIPTION'
              ? 'Atendimento recorrente de cliente assinatura.'
              : 'Atendimento avulso concluido.',
            ...buildAppointmentTimestamps({
              status: 'COMPLETED',
              startAt,
              endAt,
            }),
          })

          slotCursor = addMinutes(endAt, 10)

          if (billingModel === AppointmentBillingModel.SUBSCRIPTION_INCLUDED) {
            continue
          }

          revenues.push(buildRevenueEntry({
            id: createSeedId('revenue', 'service', monthMeta.key, professional.key, day, appointmentIndex, customer.key),
            barbershopId: refs.barbershop.id,
            customerId: customer.id,
            professionalId: professional.id,
            serviceId: service.id,
            categoryId: refs.categoriesByKey[resolveRevenueCategoryKey(service)].id,
            amount,
            origin: RevenueOrigin.SERVICE,
            paymentMethod: PAYMENT_METHODS[(day + appointmentIndex + professionalIndex) % PAYMENT_METHODS.length],
            date: startAt,
            description: buildRevenueDescription(service, billingModel),
            notes: billingModel === AppointmentBillingModel.SUBSCRIPTION_EXTRA
              ? 'Servico cobrado a parte do assinante.'
              : appointmentIndex % 4 === 0
                ? 'Cliente recorrente'
                : null,
          }))

          monthlyRevenueTotals[monthMeta.key] = roundCurrency((monthlyRevenueTotals[monthMeta.key] ?? 0) + amount)
          const professionalRevenueKey = `${monthMeta.key}:${professional.id}`
          monthlyProfessionalRevenueTotals[professionalRevenueKey] = roundCurrency(
            (monthlyProfessionalRevenueTotals[professionalRevenueKey] ?? 0) + amount
          )
        }
      })

      if ((day + monthIndex) % 4 === 0) {
        const assignedProfessional = refs.professionals[(day + monthIndex) % refs.professionals.length]
        const productAmount = roundCurrency(34 + ((day + monthIndex) % 3) * 6)

        revenues.push(buildRevenueEntry({
          id: createSeedId('revenue', 'product', monthMeta.key, day, assignedProfessional.key),
          barbershopId: refs.barbershop.id,
          customerId: null,
          professionalId: assignedProfessional.id,
          serviceId: null,
          categoryId: refs.categoriesByKey.produtos.id,
          amount: productAmount,
          origin: RevenueOrigin.PRODUCT,
          paymentMethod: PAYMENT_METHODS[(day + monthIndex) % PAYMENT_METHODS.length],
          date: baseDate,
          description: day % 2 === 0 ? 'Pomada modeladora premium' : 'Oleo de barba premium',
          notes: 'Venda de balcao vinculada ao barbeiro do turno.',
        }))

        monthlyRevenueTotals[monthMeta.key] = roundCurrency((monthlyRevenueTotals[monthMeta.key] ?? 0) + productAmount)
        const professionalRevenueKey = `${monthMeta.key}:${assignedProfessional.id}`
        monthlyProfessionalRevenueTotals[professionalRevenueKey] = roundCurrency(
          (monthlyProfessionalRevenueTotals[professionalRevenueKey] ?? 0) + productAmount
        )
      }
    }

    FIXED_EXPENSE_TEMPLATES.forEach((template, index) => {
      const dueDate = buildSafeDate(monthMeta.year, monthMeta.month, template.dueDay)
      const amount = roundCurrency(template.amount + (index === 2 ? monthIndex * 18 : 0))
      const isPaid = monthMeta.isCurrent ? template.paid && dueDate < today : true

      expenses.push({
        id: createSeedId('expense', 'fixed', monthMeta.key, template.description),
        barbershopId: refs.barbershop.id,
        categoryId: refs.categoriesByKey[template.categoryKey].id,
        amount,
        type: ExpenseType.FIXED,
        recurrent: template.recurrent,
        dueDate,
        paidAt: isPaid ? dueDate : null,
        paid: isPaid,
        description: template.description,
        notes: isPaid ? 'Conta regular da operacao.' : 'Pendente para o financeiro.',
      })

      monthlyExpenseTotals[monthMeta.key] = roundCurrency((monthlyExpenseTotals[monthMeta.key] ?? 0) + amount)
    })

    VARIABLE_EXPENSE_TEMPLATES.forEach((template, index) => {
      const dueDate = buildSafeDate(monthMeta.year, monthMeta.month, template.dueDay)
      const amount = roundCurrency(template.amount + monthIndex * (index === 0 ? 55 : index === 1 ? 40 : 20))
      const isPaid = monthMeta.isCurrent ? false : true

      expenses.push({
        id: createSeedId('expense', 'variable', monthMeta.key, template.description),
        barbershopId: refs.barbershop.id,
        categoryId: refs.categoriesByKey[template.categoryKey].id,
        amount,
        type: ExpenseType.VARIABLE,
        recurrent: template.recurrent,
        dueDate,
        paidAt: isPaid ? dueDate : null,
        paid: isPaid,
        description: template.description,
        notes: isPaid ? 'Despesa operacional registrada.' : 'Despesa em aberto para a rotina financeira.',
      })

      monthlyExpenseTotals[monthMeta.key] = roundCurrency((monthlyExpenseTotals[monthMeta.key] ?? 0) + amount)
    })
  })

  TODAY_AND_FUTURE_SCHEDULE.forEach((blueprint, index) => {
    const rawDate = dayOffset(today, blueprint.dayOffset)
    const baseDate = ensureOpenDay(rawDate)
    const professional = refs.professionalsByKey[blueprint.professionalKey]
    const customer = refs.customersByKey[blueprint.customerKey]
    const service = refs.servicesByKey[blueprint.serviceKey]
    const billingModel = blueprint.billingModel ?? resolveBillingModel(customer, service)
    const priceSnapshot = resolveOperationalPrice(service, professional)
    const startAt = atTime(baseDate, blueprint.time)
    const endAt = addMinutes(startAt, service.duration)

    appointments.push({
      id: createSeedId('appointment', 'schedule', blueprint.key),
      barbershopId: refs.barbershop.id,
      customerId: customer.id,
      professionalId: professional.id,
      serviceId: service.id,
      status: blueprint.status,
      source: blueprint.source,
      billingModel,
      startAt,
      endAt,
      durationMinutes: service.duration,
      priceSnapshot,
      notes: blueprint.notes ?? (
        blueprint.source === AppointmentSource.WHATSAPP
          ? 'Agendamento vindo do fluxo do WhatsApp.'
          : 'Agendamento inserido manualmente pela recepcao.'
      ),
      sourceReference: blueprint.source === AppointmentSource.WHATSAPP
        ? `seed-wa-${String(index + 1).padStart(3, '0')}`
        : null,
      ...buildAppointmentTimestamps({
        status: blueprint.status,
        startAt,
        endAt,
      }),
    })

    if (blueprint.status !== AppointmentStatus.COMPLETED || billingModel === AppointmentBillingModel.SUBSCRIPTION_INCLUDED) {
      return
    }

    const revenueKey = monthKey(startAt.getMonth() + 1, startAt.getFullYear())
    const amount = roundCurrency(priceSnapshot + professional.ticketBoost)

    revenues.push(buildRevenueEntry({
      id: createSeedId('revenue', 'schedule', blueprint.key),
      barbershopId: refs.barbershop.id,
      customerId: customer.id,
      professionalId: professional.id,
      serviceId: service.id,
      categoryId: refs.categoriesByKey[resolveRevenueCategoryKey(service)].id,
      amount,
      origin: RevenueOrigin.SERVICE,
      paymentMethod: PAYMENT_METHODS[index % PAYMENT_METHODS.length],
      date: startAt,
      description: buildRevenueDescription(service, billingModel),
      notes: blueprint.source === AppointmentSource.WHATSAPP
        ? 'Receita confirmada de agendamento vindo do WhatsApp.'
        : 'Receita do atendimento concluido no dia.',
    }))

    monthlyRevenueTotals[revenueKey] = roundCurrency((monthlyRevenueTotals[revenueKey] ?? 0) + amount)
    const professionalRevenueKey = `${revenueKey}:${professional.id}`
    monthlyProfessionalRevenueTotals[professionalRevenueKey] = roundCurrency(
      (monthlyProfessionalRevenueTotals[professionalRevenueKey] ?? 0) + amount
    )
  })

  await prisma.appointment.createMany({ data: appointments })
  await prisma.revenue.createMany({ data: revenues })
  await prisma.expense.createMany({ data: expenses })

  return {
    monthMetas,
    currentMonth,
    previousMonth,
    monthlyRevenueTotals,
    monthlyExpenseTotals,
    monthlyProfessionalRevenueTotals,
  }
}
