import {
  AppointmentBillingModel,
  AppointmentSource,
  AppointmentStatus,
  CustomerType,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const prisma = new PrismaClient()

const DEFAULT_SUBSCRIPTION_PRICE = 199.9
const SAO_PAULO_UTC_OFFSET_HOURS = 3
const REPORTS_DIRECTORY = path.join(process.cwd(), 'prisma', 'backfill-reports')
const SUBSCRIPTION_CUSTOMER_NAMES = new Set([
  'Carlos Mendes',
  'Pedro Salles',
  'Thiago Rocha',
  'Renan Araujo',
  'Marcos Leite',
])
const WALK_IN_CUSTOMER_NAMES = [
  'Felipe Duarte',
  'Guilherme Prado',
  'Vinicius Amaral',
  'Rafael Nunes',
  'Joao Victor',
  'Douglas Freitas',
  'Rodrigo Sena',
]
const LEGACY_CUSTOMER_POOL = [
  'Carlos Mendes',
  'Pedro Salles',
  'Pedro Salles',
  'Thiago Rocha',
  'Thiago Rocha',
  'Renan Araujo',
  'Renan Araujo',
  'Renan Araujo',
  'Marcos Leite',
  ...WALK_IN_CUSTOMER_NAMES,
]
const SUBSCRIPTION_EXTRA_SERVICES = new Set([
  'Pigmentacao Natural',
  'Hidratacao Capilar',
])
const SERVICE_VARIATIONS = [-3, 0, 2, 4]
const MONTH_INTENSITY = [0.82, 0.88, 0.93, 0.99, 0.95, 1.05]
const LEGACY_PROFILES = [
  {
    name: 'Lucas Ribeiro',
    ticketBoost: 2,
    baseAppointments: 11,
    firstSlot: '08:30',
    rotation: ['Corte + Barba Premium', 'Degrade Signature', 'Corte Classic', 'Pigmentacao Natural'],
  },
  {
    name: 'Rafael Costa',
    ticketBoost: 1,
    baseAppointments: 9,
    firstSlot: '09:00',
    rotation: ['Corte Classic', 'Corte + Barba Premium', 'Barba Terapia', 'Hidratacao Capilar'],
  },
  {
    name: 'Matheus Lima',
    ticketBoost: -1,
    baseAppointments: 7,
    firstSlot: '09:30',
    rotation: ['Corte Classic', 'Barba Terapia', 'Degrade Signature', 'Hidratacao Capilar'],
  },
]

type LocalDateParts = {
  year: number
  month: number
  day: number
}

type LegacyServiceEvent = {
  revenueKey: string
  customerName: string
  professionalId: string
  serviceId: string
  serviceName: string
  startAt: Date
  endAt: Date
  amount: number
}

type LegacyDatasetBlueprint = {
  serviceEvents: LegacyServiceEvent[]
  revenueCounter: Map<string, number>
}

type BackfillReport = {
  startedAt: string
  finishedAt?: string
  barbershops: Array<{
    barbershopId: string
    barbershopName: string
    strategy: 'legacy-demo-deterministic' | 'conservative-minimal'
    fingerprintMatched: boolean
    fingerprintReasons: string[]
    cutoffDate: string | null
    customers: {
      subscription: number
      walkIn: number
      updatedToSubscription: string[]
      filledPrice: string[]
      filledStatus: string[]
      filledStartDate: string[]
      unchanged: string[]
    }
    appointments: {
      createdHistorical: number
      updatedExistingBillingModel: number
      skippedExistingSourceReference: number
      skippedOccupiedSlot: number
      skippedProtectedDate: number
      protectedDates: string[]
    }
    revenues: {
      linkedToCustomers: number
      keptUnlinkedSubscriptionIncluded: number
      alreadyLinkedPreserved: number
      unmatchedRevenueRows: number
    }
    analytics: {
      currentMonthCompletedAppointments: number
      currentMonthLinkedRevenues: number
      currentMonthCustomersWithVisits: number
      currentMonthSubscriptionCustomersWithVisits: number
    }
    inferred: {
      historicalAppointmentsFromLegacyRevenue: number
      customerClassificationFromDemoFingerprint: number
      subscriptionBillingModelFromServiceRules: number
    }
    undefined: {
      revenueRowsStillWithoutCustomer: number
      revenueRowsProtectedByExistingSchedule: number
      datesWithExistingAppointmentsProtected: string[]
    }
    limitations: string[]
  }>
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function toLocalUtcDate(year: number, month: number, day: number, hours = 0, minutes = 0) {
  return new Date(Date.UTC(year, month - 1, day, hours + SAO_PAULO_UTC_OFFSET_HOURS, minutes, 0, 0))
}

function parseLocalTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return { hours, minutes }
}

function getLocalParts(date: Date): LocalDateParts {
  const shifted = new Date(date.getTime() - SAO_PAULO_UTC_OFFSET_HOURS * 60 * 60 * 1000)

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function getLocalDateKey(date: Date) {
  const { year, month, day } = getLocalParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 12, 0, 0, 0)).getUTCDate()
}

function getUtcWeekday(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)).getUTCDay()
}

function isOpenDay(year: number, month: number, day: number) {
  return getUtcWeekday(year, month, day) !== 0
}

function getMonthMeta(referenceYear: number, referenceMonth: number, offsetFromCurrent: number) {
  const base = new Date(Date.UTC(referenceYear, referenceMonth - 1 - offsetFromCurrent, 1, 12, 0, 0, 0))

  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    daysInMonth: getDaysInMonth(base.getUTCFullYear(), base.getUTCMonth() + 1),
    isCurrent: offsetFromCurrent === 0,
  }
}

function buildRevenueKey(date: Date, professionalId: string | null, serviceId: string | null, amount: number) {
  return [
    date.toISOString(),
    professionalId ?? 'product',
    serviceId ?? 'product',
    amount.toFixed(2),
  ].join('|')
}

function sameItems(actualItems: string[], expectedItems: string[]) {
  if (actualItems.length !== expectedItems.length) {
    return false
  }

  const sortedActual = [...actualItems].sort((left, right) => left.localeCompare(right))
  const sortedExpected = [...expectedItems].sort((left, right) => left.localeCompare(right))

  return sortedActual.every((item, index) => item === sortedExpected[index])
}

function resolveHistoricalBillingModel(customerName: string, serviceName: string) {
  if (!SUBSCRIPTION_CUSTOMER_NAMES.has(customerName)) {
    return AppointmentBillingModel.AVULSO
  }

  if (SUBSCRIPTION_EXTRA_SERVICES.has(serviceName)) {
    return AppointmentBillingModel.SUBSCRIPTION_EXTRA
  }

  return AppointmentBillingModel.SUBSCRIPTION_INCLUDED
}

function buildLegacyDatasetBlueprint(input: {
  referenceDate: Date
  servicesByName: Map<string, { id: string; price: number; duration: number }>
  professionalsByName: Map<string, { id: string }>
}): LegacyDatasetBlueprint {
  const referenceParts = getLocalParts(input.referenceDate)
  const months = Array.from({ length: 6 }, (_, index) =>
    getMonthMeta(referenceParts.year, referenceParts.month, 5 - index)
  )
  const serviceEvents: LegacyServiceEvent[] = []
  const revenueCounter = new Map<string, number>()

  months.forEach((monthMeta, monthIndex) => {
    const lastDay = monthMeta.isCurrent ? referenceParts.day : monthMeta.daysInMonth

    for (let day = 1; day <= lastDay; day += 1) {
      if (!isOpenDay(monthMeta.year, monthMeta.month, day)) {
        continue
      }

      LEGACY_PROFILES.forEach((profile, professionalIndex) => {
        const professional = input.professionalsByName.get(profile.name)

        if (!professional) {
          return
        }

        const weekday = getUtcWeekday(monthMeta.year, monthMeta.month, day)
        const weekdayAdjust = weekday === 6 ? 1 : weekday === 1 ? -1 : 0
        const baseAppointments = profile.baseAppointments + weekdayAdjust
        const appointments = Math.max(
          4,
          Math.round(
            (baseAppointments + ((day + professionalIndex + monthIndex) % 3) - 1)
            * MONTH_INTENSITY[monthIndex]
          )
        )

        const firstSlot = parseLocalTime(profile.firstSlot)
        let slotCursor = toLocalUtcDate(monthMeta.year, monthMeta.month, day, firstSlot.hours, firstSlot.minutes)

        for (let appointmentIndex = 0; appointmentIndex < appointments; appointmentIndex += 1) {
          const serviceName = profile.rotation[(day + appointmentIndex + monthIndex) % profile.rotation.length]
          const service = input.servicesByName.get(serviceName)

          if (!service) {
            continue
          }

          const endAt = new Date(slotCursor.getTime() + service.duration * 60 * 1000)
          const localEnd = new Date(endAt.getTime() - SAO_PAULO_UTC_OFFSET_HOURS * 60 * 60 * 1000)

          if (localEnd.getUTCHours() > 21 || (localEnd.getUTCHours() === 21 && localEnd.getUTCMinutes() > 0)) {
            break
          }

          const customerName = LEGACY_CUSTOMER_POOL[
            (day + appointmentIndex + professionalIndex + (monthIndex * 2)) % LEGACY_CUSTOMER_POOL.length
          ]
          const amount = roundCurrency(
            service.price
            + SERVICE_VARIATIONS[(day + appointmentIndex + professionalIndex + monthIndex) % SERVICE_VARIATIONS.length]
            + profile.ticketBoost
          )
          const revenueDate = toLocalUtcDate(monthMeta.year, monthMeta.month, day)
          const revenueKey = buildRevenueKey(revenueDate, professional.id, service.id, amount)

          revenueCounter.set(revenueKey, (revenueCounter.get(revenueKey) ?? 0) + 1)
          serviceEvents.push({
            revenueKey,
            customerName,
            professionalId: professional.id,
            serviceId: service.id,
            serviceName,
            startAt: slotCursor,
            endAt,
            amount,
          })

          slotCursor = new Date(endAt.getTime() + 10 * 60 * 1000)
        }
      })

      if ((day + monthIndex) % 4 === 0) {
        const amount = roundCurrency(34 + ((day + monthIndex) % 3) * 6)
        const revenueDate = toLocalUtcDate(monthMeta.year, monthMeta.month, day)
        const productKey = buildRevenueKey(revenueDate, null, null, amount)

        revenueCounter.set(productKey, (revenueCounter.get(productKey) ?? 0) + 1)
      }
    }
  })

  return {
    serviceEvents,
    revenueCounter,
  }
}

function buildActualRevenueCounter(revenues: Array<{
  date: Date
  professionalId: string | null
  serviceId: string | null
  amount: number
}>) {
  const revenueCounter = new Map<string, number>()

  revenues.forEach((revenue) => {
    const key = buildRevenueKey(revenue.date, revenue.professionalId, revenue.serviceId, revenue.amount)
    revenueCounter.set(key, (revenueCounter.get(key) ?? 0) + 1)
  })

  return revenueCounter
}

function countersMatch(left: Map<string, number>, right: Map<string, number>) {
  if (left.size !== right.size) {
    return false
  }

  for (const [key, value] of Array.from(left.entries())) {
    if ((right.get(key) ?? 0) !== value) {
      return false
    }
  }

  return true
}

function getCounterDelta(left: Map<string, number>, right: Map<string, number>) {
  const keys = new Set([
    ...Array.from(left.keys()),
    ...Array.from(right.keys()),
  ])
  let mismatchedKeys = 0
  let absoluteDifference = 0

  keys.forEach((key) => {
    const difference = Math.abs((left.get(key) ?? 0) - (right.get(key) ?? 0))

    if (difference > 0) {
      mismatchedKeys += 1
      absoluteDifference += difference
    }
  })

  return {
    mismatchedKeys,
    absoluteDifference,
  }
}

async function writeReport(report: BackfillReport) {
  await mkdir(REPORTS_DIRECTORY, { recursive: true })

  const fileName = `customer-intelligence-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const filePath = path.join(REPORTS_DIRECTORY, fileName)

  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  return filePath
}

async function main() {
  const report: BackfillReport = {
    startedAt: new Date().toISOString(),
    barbershops: [],
  }

  const barbershops = await prisma.barbershop.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  })

  for (const barbershop of barbershops) {
    const [
      customers,
      professionals,
      services,
      revenues,
      appointments,
    ] = await Promise.all([
      prisma.customer.findMany({
        where: { barbershopId: barbershop.id },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          type: true,
          subscriptionStatus: true,
          subscriptionPrice: true,
          subscriptionStartedAt: true,
          active: true,
        },
      }),
      prisma.professional.findMany({
        where: { barbershopId: barbershop.id },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.service.findMany({
        where: { barbershopId: barbershop.id },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          price: true,
          duration: true,
        },
      }),
      prisma.revenue.findMany({
        where: { barbershopId: barbershop.id },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          date: true,
          professionalId: true,
          serviceId: true,
          customerId: true,
          amount: true,
        },
      }),
      prisma.appointment.findMany({
        where: { barbershopId: barbershop.id },
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          customerId: true,
          professionalId: true,
          serviceId: true,
          billingModel: true,
          startAt: true,
          endAt: true,
          status: true,
          sourceReference: true,
        },
      }),
    ])

    const servicesByName = new Map(
      services.map((service) => [
        service.name,
        {
          id: service.id,
          price: Number(service.price),
          duration: service.duration,
        },
      ])
    )
    const professionalsByName = new Map(professionals.map((professional) => [professional.name, { id: professional.id }]))
    const actualRevenueRows = revenues.map((revenue) => ({
      id: revenue.id,
      date: revenue.date,
      professionalId: revenue.professionalId,
      serviceId: revenue.serviceId,
      customerId: revenue.customerId,
      amount: Number(revenue.amount),
    }))
    const latestServiceRevenue = actualRevenueRows
      .filter((revenue) => revenue.professionalId && revenue.serviceId)
      .slice(-1)[0]
    const actualRevenueCounter = buildActualRevenueCounter(actualRevenueRows)
    const fingerprintReasons: string[] = []
    const rosterMatches =
      sameItems(customers.map((customer) => customer.name), [
        ...Array.from(SUBSCRIPTION_CUSTOMER_NAMES),
        ...WALK_IN_CUSTOMER_NAMES,
      ])
      && sameItems(professionals.map((professional) => professional.name), LEGACY_PROFILES.map((profile) => profile.name))
      && sameItems(services.map((service) => service.name), [
        'Barba Terapia',
        'Corte + Barba Premium',
        'Corte Classic',
        'Degrade Signature',
        'Hidratacao Capilar',
        'Pigmentacao Natural',
      ])

    if (!rosterMatches) {
      fingerprintReasons.push('O cadastro atual nao bate com a demo legada conhecida.')
    }

    let legacyBlueprint: LegacyDatasetBlueprint | null = null

    if (latestServiceRevenue && rosterMatches) {
      legacyBlueprint = buildLegacyDatasetBlueprint({
        referenceDate: latestServiceRevenue.date,
        servicesByName,
        professionalsByName,
      })

      const counterDelta = getCounterDelta(legacyBlueprint.revenueCounter, actualRevenueCounter)

      if (
        !countersMatch(legacyBlueprint.revenueCounter, actualRevenueCounter)
        && (counterDelta.mismatchedKeys > 2 || counterDelta.absoluteDifference > 2)
      ) {
        fingerprintReasons.push(
          `As receitas historicas nao batem com o fingerprint deterministico da demo legada (desvio ${counterDelta.absoluteDifference} em ${counterDelta.mismatchedKeys} chave(s)).`
        )
      }
    } else if (!latestServiceRevenue) {
      fingerprintReasons.push('Nao existe receita historica suficiente para validar o fingerprint.')
    }

    const fingerprintMatched = fingerprintReasons.length === 0 && Boolean(legacyBlueprint)
    const customersByName = new Map(customers.map((customer) => [customer.name, customer]))
    const nativeAppointments = appointments.filter(
      (appointment) => !appointment.sourceReference?.startsWith('legacy-revenue:')
    )
    const existingSourceReferences = new Set(
      appointments
        .map((appointment) => appointment.sourceReference)
        .filter((sourceReference): sourceReference is string => Boolean(sourceReference))
    )
    const occupiedSlots = new Set(appointments.map((appointment) => `${appointment.professionalId}|${appointment.startAt.toISOString()}`))
    const protectedDates = Array.from(
      new Set(nativeAppointments.map((appointment) => getLocalDateKey(appointment.startAt)))
    ).sort((left, right) => left.localeCompare(right))
    const protectedDateSet = new Set(protectedDates)
    const cutoffParts = nativeAppointments.length > 0 ? getLocalParts(nativeAppointments[0].startAt) : null
    const cutoffDate = cutoffParts
      ? toLocalUtcDate(cutoffParts.year, cutoffParts.month, cutoffParts.day)
      : null
    const strategy = fingerprintMatched ? 'legacy-demo-deterministic' : 'conservative-minimal'
    const currentMonthRange = latestServiceRevenue ? getLocalParts(latestServiceRevenue.date) : null

    const customerUpdates: Array<ReturnType<typeof prisma.customer.update>> = []
    const updatedToSubscription: string[] = []
    const filledPrice: string[] = []
    const filledStatus: string[] = []
    const filledStartDate: string[] = []
    const unchanged: string[] = []
    const earliestTouchByCustomer = new Map<string, Date>()

    legacyBlueprint?.serviceEvents.forEach((event) => {
      const currentEarliest = earliestTouchByCustomer.get(event.customerName)
      if (!currentEarliest || event.startAt < currentEarliest) {
        earliestTouchByCustomer.set(event.customerName, event.startAt)
      }
    })

    customers.forEach((customer) => {
      if (!SUBSCRIPTION_CUSTOMER_NAMES.has(customer.name)) {
        unchanged.push(customer.name)
        return
      }

      const nextData: {
        type?: CustomerType
        subscriptionStatus?: SubscriptionStatus
        subscriptionPrice?: number
        subscriptionStartedAt?: Date
      } = {}

      if (customer.type !== CustomerType.SUBSCRIPTION) {
        nextData.type = CustomerType.SUBSCRIPTION
        updatedToSubscription.push(customer.name)
      }

      if (!customer.subscriptionStatus) {
        nextData.subscriptionStatus = SubscriptionStatus.ACTIVE
        filledStatus.push(customer.name)
      }

      if (customer.subscriptionPrice == null) {
        nextData.subscriptionPrice = DEFAULT_SUBSCRIPTION_PRICE
        filledPrice.push(customer.name)
      }

      if (!customer.subscriptionStartedAt && earliestTouchByCustomer.has(customer.name)) {
        nextData.subscriptionStartedAt = earliestTouchByCustomer.get(customer.name)
        filledStartDate.push(customer.name)
      }

      if (Object.keys(nextData).length === 0) {
        unchanged.push(customer.name)
        return
      }

      customerUpdates.push(prisma.customer.update({
        where: { id: customer.id },
        data: nextData,
      }))
    })

    for (const batch of chunkArray(customerUpdates, 50)) {
      if (batch.length > 0) {
        await prisma.$transaction(batch)
      }
    }

    const currentAppointmentUpdates = appointments
      .filter((appointment) => {
        const customer = customers.find((candidate) => candidate.id === appointment.customerId)
        return Boolean(customer && SUBSCRIPTION_CUSTOMER_NAMES.has(customer.name) && appointment.billingModel === AppointmentBillingModel.AVULSO)
      })
      .map((appointment) =>
        prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            billingModel: AppointmentBillingModel.SUBSCRIPTION_INCLUDED,
          },
        })
      )

    for (const batch of chunkArray(currentAppointmentUpdates, 100)) {
      if (batch.length > 0) {
        await prisma.$transaction(batch)
      }
    }

    let createdHistorical = 0
    let skippedExistingSourceReference = 0
    let skippedOccupiedSlot = 0
    let skippedProtectedDate = 0
    let linkedToCustomers = 0
    let keptUnlinkedSubscriptionIncluded = 0
    let alreadyLinkedPreserved = 0
    let unmatchedRevenueRows = 0
    let revenueRowsProtectedByExistingSchedule = 0

    if (fingerprintMatched && legacyBlueprint) {
      const serviceRevenueQueues = new Map<string, typeof actualRevenueRows>()

      actualRevenueRows
        .filter((revenue) => revenue.professionalId && revenue.serviceId)
        .forEach((revenue) => {
          const key = buildRevenueKey(revenue.date, revenue.professionalId, revenue.serviceId, revenue.amount)
          const existingQueue = serviceRevenueQueues.get(key) ?? []
          existingQueue.push(revenue)
          serviceRevenueQueues.set(key, existingQueue)
        })

      const appointmentCreates: Prisma.AppointmentCreateManyInput[] = []
      const revenueLinkUpdates: Array<ReturnType<typeof prisma.revenue.update>> = []

      for (const event of legacyBlueprint.serviceEvents) {
        const queue = serviceRevenueQueues.get(event.revenueKey)
        const matchedRevenue = queue?.shift()

        if (!matchedRevenue) {
          unmatchedRevenueRows += 1
          continue
        }

        const sourceReference = `legacy-revenue:${matchedRevenue.id}`
        if (existingSourceReferences.has(sourceReference)) {
          skippedExistingSourceReference += 1
          continue
        }

        const eventDateKey = getLocalDateKey(event.startAt)
        if (protectedDateSet.has(eventDateKey)) {
          skippedProtectedDate += 1
          revenueRowsProtectedByExistingSchedule += 1
          continue
        }

        if (cutoffDate && event.startAt >= cutoffDate) {
          skippedProtectedDate += 1
          revenueRowsProtectedByExistingSchedule += 1
          continue
        }

        const slotKey = `${event.professionalId}|${event.startAt.toISOString()}`
        if (occupiedSlots.has(slotKey)) {
          skippedOccupiedSlot += 1
          revenueRowsProtectedByExistingSchedule += 1
          continue
        }

        const customer = customersByName.get(event.customerName)
        if (!customer) {
          unmatchedRevenueRows += 1
          continue
        }

        const billingModel = resolveHistoricalBillingModel(event.customerName, event.serviceName)
        const shouldLinkRevenue = billingModel !== AppointmentBillingModel.SUBSCRIPTION_INCLUDED

        appointmentCreates.push({
          barbershopId: barbershop.id,
          customerId: customer.id,
          professionalId: event.professionalId,
          serviceId: event.serviceId,
          status: AppointmentStatus.COMPLETED,
          source: AppointmentSource.MANUAL,
          billingModel,
          startAt: event.startAt,
          endAt: event.endAt,
          durationMinutes: Math.round((event.endAt.getTime() - event.startAt.getTime()) / (60 * 1000)),
          priceSnapshot: event.amount,
          notes: `Backfill seguro a partir da receita legada ${matchedRevenue.id}.`,
          sourceReference,
          completedAt: event.endAt,
        })
        existingSourceReferences.add(sourceReference)
        occupiedSlots.add(slotKey)
        createdHistorical += 1

        if (!shouldLinkRevenue) {
          keptUnlinkedSubscriptionIncluded += 1
          continue
        }

        if (matchedRevenue.customerId && matchedRevenue.customerId !== customer.id) {
          alreadyLinkedPreserved += 1
          continue
        }

        if (matchedRevenue.customerId === customer.id) {
          alreadyLinkedPreserved += 1
          continue
        }

        revenueLinkUpdates.push(prisma.revenue.update({
          where: { id: matchedRevenue.id },
          data: { customerId: customer.id },
        }))
        linkedToCustomers += 1
      }

      for (const batch of chunkArray(appointmentCreates, 250)) {
        if (batch.length > 0) {
          await prisma.appointment.createMany({ data: batch })
        }
      }

      for (const batch of chunkArray(revenueLinkUpdates, 100)) {
        if (batch.length > 0) {
          await prisma.$transaction(batch)
        }
      }

      for (const queue of Array.from(serviceRevenueQueues.values())) {
        unmatchedRevenueRows += queue.length
      }
    }

    const refreshedCustomers = await prisma.customer.findMany({
      where: { barbershopId: barbershop.id },
      select: {
        id: true,
        name: true,
        type: true,
      },
    })
    const refreshedAppointments = await prisma.appointment.findMany({
      where: { barbershopId: barbershop.id, status: AppointmentStatus.COMPLETED },
      select: {
        customerId: true,
        startAt: true,
      },
    })
    const refreshedRevenues = await prisma.revenue.findMany({
      where: { barbershopId: barbershop.id, customerId: { not: null } },
      select: {
        customerId: true,
        date: true,
      },
    })

    const subscriptionCustomers = refreshedCustomers.filter((customer) => customer.type === CustomerType.SUBSCRIPTION)
    const walkInCustomers = refreshedCustomers.filter((customer) => customer.type === CustomerType.WALK_IN)

    let currentMonthCompletedAppointments = 0
    let currentMonthLinkedRevenues = 0
    let currentMonthCustomersWithVisits = 0
    let currentMonthSubscriptionCustomersWithVisits = 0

    if (currentMonthRange) {
      const monthStart = toLocalUtcDate(currentMonthRange.year, currentMonthRange.month, 1)
      const monthEnd = toLocalUtcDate(
        currentMonthRange.year,
        currentMonthRange.month,
        getDaysInMonth(currentMonthRange.year, currentMonthRange.month),
        23,
        59
      )
      const customersWithVisits = new Set<string>()
      const subscriptionCustomerIds = new Set(subscriptionCustomers.map((customer) => customer.id))
      const subscriptionCustomersWithVisits = new Set<string>()

      refreshedAppointments.forEach((appointment) => {
        if (appointment.startAt < monthStart || appointment.startAt > monthEnd) {
          return
        }

        currentMonthCompletedAppointments += 1
        customersWithVisits.add(appointment.customerId)
        if (subscriptionCustomerIds.has(appointment.customerId)) {
          subscriptionCustomersWithVisits.add(appointment.customerId)
        }
      })

      refreshedRevenues.forEach((revenue) => {
        if (revenue.date >= monthStart && revenue.date <= monthEnd) {
          currentMonthLinkedRevenues += 1
        }
      })

      currentMonthCustomersWithVisits = customersWithVisits.size
      currentMonthSubscriptionCustomersWithVisits = subscriptionCustomersWithVisits.size
    }

    report.barbershops.push({
      barbershopId: barbershop.id,
      barbershopName: barbershop.name,
      strategy,
      fingerprintMatched,
      fingerprintReasons,
      cutoffDate: cutoffDate ? cutoffDate.toISOString() : null,
      customers: {
        subscription: subscriptionCustomers.length,
        walkIn: walkInCustomers.length,
        updatedToSubscription,
        filledPrice,
        filledStatus,
        filledStartDate,
        unchanged,
      },
      appointments: {
        createdHistorical,
        updatedExistingBillingModel: currentAppointmentUpdates.length,
        skippedExistingSourceReference,
        skippedOccupiedSlot,
        skippedProtectedDate,
        protectedDates,
      },
      revenues: {
        linkedToCustomers,
        keptUnlinkedSubscriptionIncluded,
        alreadyLinkedPreserved,
        unmatchedRevenueRows,
      },
      analytics: {
        currentMonthCompletedAppointments,
        currentMonthLinkedRevenues,
        currentMonthCustomersWithVisits,
        currentMonthSubscriptionCustomersWithVisits,
      },
      inferred: {
        historicalAppointmentsFromLegacyRevenue: createdHistorical,
        customerClassificationFromDemoFingerprint: updatedToSubscription.length,
        subscriptionBillingModelFromServiceRules: createdHistorical + currentAppointmentUpdates.length,
      },
      undefined: {
        revenueRowsStillWithoutCustomer: await prisma.revenue.count({
          where: {
            barbershopId: barbershop.id,
            customerId: null,
            professionalId: { not: null },
            serviceId: { not: null },
          },
        }),
        revenueRowsProtectedByExistingSchedule,
        datesWithExistingAppointmentsProtected: protectedDates,
      },
      limitations: fingerprintMatched
        ? [
            'Receitas historicas antigas foram preservadas como estavam no financeiro; a leitura de assinatura usa atendimentos backfilled e estimativa de mensalidade quando nao existe lancamento real.',
            'Datas que ja tinham agenda registrada foram protegidas para evitar colisao ou sobrescrita de agendamentos validos.',
            'Servicos de assinatura so foram marcados como extra quando havia evidencia forte pelo tipo de servico premium; o restante ficou em fallback conservador como incluso.',
          ]
        : [
            'O fingerprint da demo legada nao bateu, entao o script ficou no modo conservador e evitou inferencias estruturais.',
          ],
    })
  }

  report.finishedAt = new Date().toISOString()
  const reportPath = await writeReport(report)

  console.log(JSON.stringify({ reportPath, report }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
