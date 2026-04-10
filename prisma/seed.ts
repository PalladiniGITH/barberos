import {
  AppointmentBillingModel,
  AppointmentSource,
  AppointmentStatus,
  CategoryType,
  ChallengeType,
  CustomerType,
  ExpenseType,
  PaymentMethod,
  PrismaClient,
  RevenueOrigin,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const NOW = new Date()
const CURRENT_YEAR = NOW.getFullYear()
const CURRENT_MONTH = NOW.getMonth() + 1

const PAYMENT_METHODS = [
  PaymentMethod.PIX,
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.DEBIT_CARD,
  PaymentMethod.CASH,
]

const SERVICE_VARIATIONS = [-3, 0, 2, 4]
const SUBSCRIPTION_CUSTOMER_POOL = [
  'Carlos Mendes',
  'Pedro Salles',
  'Pedro Salles',
  'Thiago Rocha',
  'Thiago Rocha',
  'Renan Araujo',
  'Renan Araujo',
  'Renan Araujo',
  'Marcos Leite',
]
const WALK_IN_CUSTOMER_POOL = [
  'Felipe Duarte',
  'Guilherme Prado',
  'Vinicius Amaral',
  'Rafael Nunes',
  'Joao Victor',
  'Douglas Freitas',
  'Rodrigo Sena',
]

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function monthKey(month: number, year: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function getMonthMeta(offsetFromCurrent: number) {
  const date = new Date(CURRENT_YEAR, CURRENT_MONTH - 1 - offsetFromCurrent, 1)

  return {
    month: date.getMonth() + 1,
    year: date.getFullYear(),
    daysInMonth: new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(),
    isCurrent: offsetFromCurrent === 0,
    key: monthKey(date.getMonth() + 1, date.getFullYear()),
  }
}

function isOpenDay(date: Date) {
  return date.getDay() !== 0
}

async function main() {
  console.log('Starting premium demo seed...')

  const barbershopPayload = {
    name: 'Barbearia Linha Nobre',
    slug: 'linha-nobre',
    address: 'Rua Augusta, 1450 - Consolacao, Sao Paulo',
    phone: '(11) 99888-4400',
    email: 'contato@linhanobre.com.br',
    timezone: 'America/Sao_Paulo',
    onboardingStep: 4,
    onboardingCompletedAt: new Date(),
    active: true,
  }

  const existingBarbershop = await prisma.barbershop.findFirst({
    where: {
      OR: [
        { slug: 'linha-nobre' },
        { slug: 'konoha' },
      ],
    },
  })

  const barbershop = existingBarbershop
    ? await prisma.barbershop.update({
        where: { id: existingBarbershop.id },
        data: barbershopPayload,
      })
    : await prisma.barbershop.create({ data: barbershopPayload })

  await prisma.commission.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.campaignMetric.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.challengeResult.deleteMany({
    where: { challenge: { barbershopId: barbershop.id } },
  })
  await prisma.challenge.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.professionalGoal.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.monthlyGoal.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.appointment.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.revenue.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.customer.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.expense.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.service.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.supply.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.financialCategory.deleteMany({ where: { barbershopId: barbershop.id } })
  await prisma.professional.deleteMany({ where: { barbershopId: barbershop.id } })

  const passwordHash = await bcrypt.hash('demo123456', 12)
  const demoUsers = [
    {
      name: 'Bruno Almeida',
      email: 'gestao@linhanobre.com.br',
      role: UserRole.OWNER,
    },
    {
      name: 'Camila Torres',
      email: 'gerencia@linhanobre.com.br',
      role: UserRole.MANAGER,
    },
    {
      name: 'Juliana Martins',
      email: 'financeiro@linhanobre.com.br',
      role: UserRole.FINANCIAL,
    },
  ]

  await prisma.user.updateMany({
    where: {
      barbershopId: barbershop.id,
      email: { notIn: demoUsers.map((user) => user.email) },
    },
    data: { active: false },
  })

  await Promise.all(
    demoUsers.map((user) =>
      prisma.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name,
          passwordHash,
          role: user.role,
          active: true,
          barbershopId: barbershop.id,
        },
        create: {
          name: user.name,
          email: user.email,
          passwordHash,
          role: user.role,
          active: true,
          barbershopId: barbershop.id,
        },
      })
    )
  )

  const professionalProfiles = [
    {
      name: 'Lucas Ribeiro',
      email: 'lucas@linhanobre.com.br',
      phone: '(11) 99111-2201',
      baseAppointments: 11,
      ticketBoost: 2,
      rotation: ['Corte + Barba Premium', 'Degrade Signature', 'Corte Classic', 'Pigmentacao Natural'],
    },
    {
      name: 'Rafael Costa',
      email: 'rafael@linhanobre.com.br',
      phone: '(11) 99222-3302',
      baseAppointments: 9,
      ticketBoost: 1,
      rotation: ['Corte Classic', 'Corte + Barba Premium', 'Barba Terapia', 'Hidratacao Capilar'],
    },
    {
      name: 'Matheus Lima',
      email: 'matheus@linhanobre.com.br',
      phone: '(11) 99333-4403',
      baseAppointments: 7,
      ticketBoost: -1,
      rotation: ['Corte Classic', 'Barba Terapia', 'Degrade Signature', 'Hidratacao Capilar'],
    },
  ]

  const professionals = await Promise.all(
    professionalProfiles.map((profile) =>
      prisma.professional.create({
        data: {
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          barbershopId: barbershop.id,
        },
      })
    )
  )
  const professionalByName = Object.fromEntries(professionals.map((professional) => [professional.name, professional]))

  const categoryData = [
    { name: 'Servicos', type: CategoryType.REVENUE, color: '#10b981' },
    { name: 'Assinaturas', type: CategoryType.REVENUE, color: '#34d399' },
    { name: 'Produtos', type: CategoryType.REVENUE, color: '#60a5fa' },
    { name: 'Combo Premium', type: CategoryType.REVENUE, color: '#f59e0b' },
    { name: 'Aluguel', type: CategoryType.EXPENSE_FIXED, color: '#f97316' },
    { name: 'Folha e pro-labore', type: CategoryType.EXPENSE_FIXED, color: '#ef4444' },
    { name: 'Energia e agua', type: CategoryType.EXPENSE_FIXED, color: '#eab308' },
    { name: 'Internet e software', type: CategoryType.EXPENSE_FIXED, color: '#22d3ee' },
    { name: 'Insumos', type: CategoryType.EXPENSE_VARIABLE, color: '#84cc16' },
    { name: 'Marketing local', type: CategoryType.EXPENSE_VARIABLE, color: '#ec4899' },
    { name: 'Manutencao', type: CategoryType.EXPENSE_VARIABLE, color: '#a78bfa' },
  ]

  const categories = await Promise.all(
    categoryData.map((category) =>
      prisma.financialCategory.create({
        data: {
          ...category,
          barbershopId: barbershop.id,
        },
      })
    )
  )

  const categoryIdByName = Object.fromEntries(categories.map((category) => [category.name, category.id]))

  const supplyCatalog = [
    { name: 'Pomada Modeladora Premium', unit: 'un', unitCost: 18.0 },
    { name: 'Oleo de Barba', unit: 'ml', unitCost: 0.19 },
    { name: 'Shampoo Premium', unit: 'ml', unitCost: 0.07 },
    { name: 'Lamina Descartavel', unit: 'un', unitCost: 1.4 },
    { name: 'Pigmento Natural', unit: 'g', unitCost: 0.35 },
    { name: 'Oxidante Suave', unit: 'ml', unitCost: 0.05 },
    { name: 'Mascara Capilar', unit: 'ml', unitCost: 0.18 },
    { name: 'Toalha Premium', unit: 'un', unitCost: 0.9 },
  ]

  const supplies = await Promise.all(
    supplyCatalog.map((supply) =>
      prisma.supply.create({
        data: {
          ...supply,
          barbershopId: barbershop.id,
        },
      })
    )
  )

  const supplyIdByName = Object.fromEntries(supplies.map((supply) => [supply.name, supply.id]))

  const serviceCatalog = [
    {
      name: 'Corte Classic',
      description: 'O corte mais pedido da casa, com boa margem e giro rapido.',
      price: 55,
      duration: 35,
      pricing: { cardFeePercent: 3.2, taxPercent: 0, commissionPercent: 38, directCost: 2.5, suggestedPrice: 58 },
      inputs: [
        { supply: 'Shampoo Premium', quantity: 8 },
        { supply: 'Pomada Modeladora Premium', quantity: 0.12 },
        { supply: 'Toalha Premium', quantity: 1 },
      ],
    },
    {
      name: 'Corte + Barba Premium',
      description: 'Combo de maior ticket para aumentar faturamento sem lotar agenda.',
      price: 88,
      duration: 60,
      pricing: { cardFeePercent: 3.2, taxPercent: 0, commissionPercent: 40, directCost: 4.5, suggestedPrice: 92 },
      inputs: [
        { supply: 'Shampoo Premium', quantity: 10 },
        { supply: 'Oleo de Barba', quantity: 4 },
        { supply: 'Lamina Descartavel', quantity: 1 },
        { supply: 'Pomada Modeladora Premium', quantity: 0.18 },
        { supply: 'Toalha Premium', quantity: 1 },
      ],
    },
    {
      name: 'Barba Terapia',
      description: 'Servico de alta recorrencia que ajuda a sustentar o ticket medio.',
      price: 42,
      duration: 25,
      pricing: { cardFeePercent: 3.2, taxPercent: 0, commissionPercent: 36, directCost: 1.5, suggestedPrice: 45 },
      inputs: [
        { supply: 'Oleo de Barba', quantity: 5 },
        { supply: 'Lamina Descartavel', quantity: 1 },
        { supply: 'Toalha Premium', quantity: 1 },
      ],
    },
    {
      name: 'Degrade Signature',
      description: 'Servico premium para clientes recorrentes e agenda valorizada.',
      price: 65,
      duration: 45,
      pricing: { cardFeePercent: 3.2, taxPercent: 0, commissionPercent: 39, directCost: 3, suggestedPrice: 69 },
      inputs: [
        { supply: 'Shampoo Premium', quantity: 9 },
        { supply: 'Pomada Modeladora Premium', quantity: 0.15 },
        { supply: 'Toalha Premium', quantity: 1 },
      ],
    },
    {
      name: 'Pigmentacao Natural',
      description: 'Servico de alto valor para puxar ticket e mostrar versatilidade.',
      price: 95,
      duration: 55,
      pricing: { cardFeePercent: 3.2, taxPercent: 0, commissionPercent: 42, directCost: 6, suggestedPrice: 104 },
      inputs: [
        { supply: 'Shampoo Premium', quantity: 6 },
        { supply: 'Pigmento Natural', quantity: 12 },
        { supply: 'Oxidante Suave', quantity: 25 },
        { supply: 'Toalha Premium', quantity: 1 },
      ],
    },
    {
      name: 'Hidratacao Capilar',
      description: 'Upsell simples para elevar margem nos dias de maior fluxo.',
      price: 48,
      duration: 30,
      pricing: { cardFeePercent: 3.2, taxPercent: 0, commissionPercent: 37, directCost: 3.2, suggestedPrice: 52 },
      inputs: [
        { supply: 'Mascara Capilar', quantity: 20 },
        { supply: 'Shampoo Premium', quantity: 6 },
        { supply: 'Toalha Premium', quantity: 1 },
      ],
    },
  ]

  const services = await Promise.all(
    serviceCatalog.map((service) =>
      prisma.service.create({
        data: {
          name: service.name,
          description: service.description,
          price: service.price,
          duration: service.duration,
          barbershopId: barbershop.id,
        },
      })
    )
  )

  const serviceIdByName = Object.fromEntries(services.map((service) => [service.name, service.id]))
  const serviceByName = Object.fromEntries(services.map((service) => [service.name, service]))

  await Promise.all(
    serviceCatalog.flatMap((service) =>
      service.inputs.map((input) =>
        prisma.serviceInput.create({
          data: {
            serviceId: serviceIdByName[service.name],
            supplyId: supplyIdByName[input.supply],
            quantity: input.quantity,
          },
        })
      )
    )
  )

  await Promise.all(
    serviceCatalog.map((service) =>
      prisma.pricingRule.create({
        data: {
          serviceId: serviceIdByName[service.name],
          barbershopId: barbershop.id,
          ...service.pricing,
        },
      })
    )
  )

  const customerProfiles = [
    { name: 'Carlos Mendes', phone: '(11) 99123-1101', email: 'carlos.mendes@email.com', type: CustomerType.SUBSCRIPTION, subscriptionPrice: 199.9, subscriptionStatus: SubscriptionStatus.ACTIVE },
    { name: 'Pedro Salles', phone: '(11) 99123-1102', email: 'pedro.salles@email.com', type: CustomerType.SUBSCRIPTION, subscriptionPrice: 199.9, subscriptionStatus: SubscriptionStatus.ACTIVE },
    { name: 'Thiago Rocha', phone: '(11) 99123-1103', email: 'thiago.rocha@email.com', type: CustomerType.SUBSCRIPTION, subscriptionPrice: 199.9, subscriptionStatus: SubscriptionStatus.ACTIVE },
    { name: 'Renan Araujo', phone: '(11) 99123-1104', email: 'renan.araujo@email.com', type: CustomerType.SUBSCRIPTION, subscriptionPrice: 199.9, subscriptionStatus: SubscriptionStatus.ACTIVE },
    { name: 'Felipe Duarte', phone: '(11) 99123-1105', email: 'felipe.duarte@email.com', type: CustomerType.WALK_IN },
    { name: 'Guilherme Prado', phone: '(11) 99123-1106', email: 'guilherme.prado@email.com', type: CustomerType.WALK_IN },
    { name: 'Vinicius Amaral', phone: '(11) 99123-1107', email: 'vinicius.amaral@email.com', type: CustomerType.WALK_IN },
    { name: 'Rafael Nunes', phone: '(11) 99123-1108', email: 'rafael.nunes@email.com', type: CustomerType.WALK_IN },
    { name: 'Joao Victor', phone: '(11) 99123-1109', email: 'joao.victor@email.com', type: CustomerType.WALK_IN },
    { name: 'Douglas Freitas', phone: '(11) 99123-1110', email: 'douglas.freitas@email.com', type: CustomerType.WALK_IN },
    { name: 'Marcos Leite', phone: '(11) 99123-1111', email: 'marcos.leite@email.com', type: CustomerType.SUBSCRIPTION, subscriptionPrice: 199.9, subscriptionStatus: SubscriptionStatus.ACTIVE },
    { name: 'Rodrigo Sena', phone: '(11) 99123-1112', email: 'rodrigo.sena@email.com', type: CustomerType.WALK_IN },
  ]

  const customers = await Promise.all(
    customerProfiles.map((customer) =>
      prisma.customer.create({
        data: {
          ...customer,
          barbershopId: barbershop.id,
          subscriptionStartedAt: customer.type === CustomerType.SUBSCRIPTION ? new Date(CURRENT_YEAR, CURRENT_MONTH - 4, 3) : null,
        },
      })
    )
  )
  const customerByName = Object.fromEntries(customers.map((customer) => [customer.name, customer]))

  function dayOffset(baseDate: Date, offset: number) {
    const target = new Date(baseDate)
    target.setDate(baseDate.getDate() + offset)
    target.setHours(0, 0, 0, 0)
    return target
  }

  function atTime(baseDate: Date, time: string) {
    const [hours, minutes] = time.split(':').map(Number)
    const target = new Date(baseDate)
    target.setHours(hours, minutes, 0, 0)
    return target
  }

  const today = new Date(CURRENT_YEAR, CURRENT_MONTH - 1, NOW.getDate())

  const appointmentBlueprints = [
    { day: -1, time: '09:00', professional: 'Lucas Ribeiro', customer: 'Carlos Mendes', service: 'Corte Classic', status: AppointmentStatus.COMPLETED, source: AppointmentSource.MANUAL },
    { day: -1, time: '10:30', professional: 'Rafael Costa', customer: 'Pedro Salles', service: 'Corte + Barba Premium', status: AppointmentStatus.COMPLETED, source: AppointmentSource.MANUAL },
    { day: -1, time: '14:00', professional: 'Matheus Lima', customer: 'Thiago Rocha', service: 'Barba Terapia', status: AppointmentStatus.NO_SHOW, source: AppointmentSource.WHATSAPP },
    { day: 0, time: '09:00', professional: 'Lucas Ribeiro', customer: 'Renan Araujo', service: 'Corte Classic', status: AppointmentStatus.COMPLETED, source: AppointmentSource.MANUAL },
    { day: 0, time: '09:30', professional: 'Rafael Costa', customer: 'Felipe Duarte', service: 'Degrade Signature', status: AppointmentStatus.COMPLETED, source: AppointmentSource.MANUAL },
    { day: 0, time: '10:00', professional: 'Matheus Lima', customer: 'Guilherme Prado', service: 'Barba Terapia', status: AppointmentStatus.COMPLETED, source: AppointmentSource.MANUAL },
    { day: 0, time: '11:00', professional: 'Lucas Ribeiro', customer: 'Vinicius Amaral', service: 'Corte + Barba Premium', status: AppointmentStatus.CONFIRMED, source: AppointmentSource.MANUAL },
    { day: 0, time: '11:30', professional: 'Rafael Costa', customer: 'Rafael Nunes', service: 'Hidratacao Capilar', status: AppointmentStatus.PENDING, source: AppointmentSource.WHATSAPP },
    { day: 0, time: '13:00', professional: 'Matheus Lima', customer: 'Joao Victor', service: 'Corte Classic', status: AppointmentStatus.CONFIRMED, source: AppointmentSource.MANUAL },
    { day: 0, time: '15:00', professional: 'Lucas Ribeiro', customer: 'Douglas Freitas', service: 'Pigmentacao Natural', status: AppointmentStatus.PENDING, source: AppointmentSource.MANUAL },
    { day: 0, time: '16:00', professional: 'Rafael Costa', customer: 'Marcos Leite', service: 'Corte Classic', status: AppointmentStatus.CONFIRMED, source: AppointmentSource.MANUAL },
    { day: 0, time: '18:00', professional: 'Matheus Lima', customer: 'Rodrigo Sena', service: 'Degrade Signature', status: AppointmentStatus.CONFIRMED, source: AppointmentSource.MANUAL },
    { day: 1, time: '09:30', professional: 'Lucas Ribeiro', customer: 'Carlos Mendes', service: 'Corte Classic', status: AppointmentStatus.CONFIRMED, source: AppointmentSource.MANUAL },
    { day: 1, time: '10:00', professional: 'Rafael Costa', customer: 'Pedro Salles', service: 'Corte + Barba Premium', status: AppointmentStatus.CANCELLED, source: AppointmentSource.WHATSAPP },
    { day: 1, time: '11:00', professional: 'Matheus Lima', customer: 'Thiago Rocha', service: 'Hidratacao Capilar', status: AppointmentStatus.CONFIRMED, source: AppointmentSource.MANUAL },
    { day: 1, time: '14:30', professional: 'Lucas Ribeiro', customer: 'Renan Araujo', service: 'Degrade Signature', status: AppointmentStatus.PENDING, source: AppointmentSource.WHATSAPP },
    { day: 1, time: '15:30', professional: 'Rafael Costa', customer: 'Felipe Duarte', service: 'Barba Terapia', status: AppointmentStatus.CONFIRMED, source: AppointmentSource.MANUAL },
    { day: 2, time: '09:00', professional: 'Matheus Lima', customer: 'Guilherme Prado', service: 'Corte Classic', status: AppointmentStatus.CONFIRMED, source: AppointmentSource.MANUAL },
    { day: 2, time: '10:00', professional: 'Lucas Ribeiro', customer: 'Vinicius Amaral', service: 'Corte + Barba Premium', status: AppointmentStatus.CONFIRMED, source: AppointmentSource.MANUAL },
    { day: 2, time: '13:00', professional: 'Rafael Costa', customer: 'Rafael Nunes', service: 'Pigmentacao Natural', status: AppointmentStatus.PENDING, source: AppointmentSource.WHATSAPP },
  ]

  await prisma.appointment.createMany({
    data: appointmentBlueprints.map((appointment, index) => {
      const baseDate = dayOffset(today, appointment.day)
      const service = serviceByName[appointment.service]
      const startAt = atTime(baseDate, appointment.time)
      const endAt = new Date(startAt.getTime() + Number(service.duration) * 60 * 1000)

      return {
        barbershopId: barbershop.id,
        customerId: customerByName[appointment.customer].id,
        professionalId: professionalByName[appointment.professional].id,
        serviceId: service.id,
        status: appointment.status,
        source: appointment.source,
        billingModel: customerByName[appointment.customer].type === CustomerType.SUBSCRIPTION
          ? AppointmentBillingModel.SUBSCRIPTION_INCLUDED
          : AppointmentBillingModel.AVULSO,
        startAt,
        endAt,
        durationMinutes: Number(service.duration),
        priceSnapshot: Number(service.price),
        notes: appointment.source === AppointmentSource.WHATSAPP ? 'Cliente vindo do WhatsApp para confirmar.' : 'Horario inserido manualmente pela recepcao.',
        sourceReference: appointment.source === AppointmentSource.WHATSAPP ? `evo-demo-${String(index + 1).padStart(3, '0')}` : null,
        confirmedAt: appointment.status === AppointmentStatus.CONFIRMED ? new Date(startAt.getTime() - 2 * 60 * 60 * 1000) : null,
        cancelledAt: appointment.status === AppointmentStatus.CANCELLED ? new Date(startAt.getTime() - 90 * 60 * 1000) : null,
        completedAt: appointment.status === AppointmentStatus.COMPLETED ? endAt : null,
      }
    }),
  })

  const months = Array.from({ length: 6 }, (_, index) => getMonthMeta(5 - index))
  const monthIntensity = [0.82, 0.88, 0.93, 0.99, 0.95, 1.05]
  const monthlyRevenueTotals: Record<string, number> = {}
  const monthlyProfessionalRevenueTotals: Record<string, number> = {}
  const revenueEntries: any[] = []
  const historicalAppointments: any[] = []

  function pickCustomerName(monthIndex: number, day: number, professionalIndex: number, appointmentIndex: number) {
    const prefersSubscription = (day + appointmentIndex + professionalIndex + monthIndex) % 4 === 0
    const pool = prefersSubscription ? SUBSCRIPTION_CUSTOMER_POOL : WALK_IN_CUSTOMER_POOL
    return pool[(day + appointmentIndex + professionalIndex + (monthIndex * 2)) % pool.length]
  }

  months.forEach((monthMeta, monthIndex) => {
    const lastDay = monthMeta.isCurrent ? NOW.getDate() : monthMeta.daysInMonth

    customerProfiles
      .filter((customer) => customer.type === CustomerType.SUBSCRIPTION)
      .forEach((customer, customerIndex) => {
        const paymentDate = new Date(monthMeta.year, monthMeta.month - 1, Math.min(3 + customerIndex, lastDay))
        const amount = roundCurrency(customer.subscriptionPrice ?? 199.9)

        revenueEntries.push({
          barbershopId: barbershop.id,
          customerId: customerByName[customer.name].id,
          professionalId: null,
          serviceId: null,
          categoryId: categoryIdByName['Assinaturas'],
          amount,
          origin: RevenueOrigin.SUBSCRIPTION,
          paymentMethod: PaymentMethod.PIX,
          date: paymentDate,
          description: `Mensalidade ${customer.name}`,
          notes: 'Receita recorrente do plano assinatura.',
        })

        monthlyRevenueTotals[monthMeta.key] = roundCurrency((monthlyRevenueTotals[monthMeta.key] ?? 0) + amount)
      })

    for (let day = 1; day <= lastDay; day += 1) {
      const date = new Date(monthMeta.year, monthMeta.month - 1, day)

      if (!isOpenDay(date)) continue

      professionalProfiles.forEach((profile, professionalIndex) => {
        const professional = professionals[professionalIndex]
        const weekdayAdjust = date.getDay() === 6 ? 1 : date.getDay() === 1 ? -1 : 0
        const baseAppointments = profile.baseAppointments + weekdayAdjust
        const appointments = Math.max(
          4,
          Math.round((baseAppointments + ((day + professionalIndex + monthIndex) % 3) - 1) * monthIntensity[monthIndex])
        )
        let slotCursor = atTime(date, professionalIndex === 0 ? '08:30' : professionalIndex === 1 ? '09:00' : '09:30')

        for (let appointmentIndex = 0; appointmentIndex < appointments; appointmentIndex += 1) {
          const serviceName = profile.rotation[(day + appointmentIndex + monthIndex) % profile.rotation.length]
          const service = serviceByName[serviceName]
          const customerName = pickCustomerName(monthIndex, day, professionalIndex, appointmentIndex)
          const customer = customerByName[customerName]
          const isSubscriptionCustomer = customer.type === CustomerType.SUBSCRIPTION
          const isPremiumExtra = isSubscriptionCustomer
            && (
              serviceName === 'Pigmentacao Natural'
              || serviceName === 'Hidratacao Capilar'
              || ((day + appointmentIndex + professionalIndex + monthIndex) % 6 === 0)
            )
          const billingModel = isSubscriptionCustomer
            ? (isPremiumExtra ? AppointmentBillingModel.SUBSCRIPTION_EXTRA : AppointmentBillingModel.SUBSCRIPTION_INCLUDED)
            : AppointmentBillingModel.AVULSO
          const variation = SERVICE_VARIATIONS[(day + appointmentIndex + professionalIndex + monthIndex) % SERVICE_VARIATIONS.length]
          const amount = roundCurrency(Number(service.price) + variation + profile.ticketBoost)
          const startAt = new Date(slotCursor)
          const endAt = new Date(startAt.getTime() + Number(service.duration) * 60 * 1000)

          if (endAt.getHours() > 21 || (endAt.getHours() === 21 && endAt.getMinutes() > 0)) {
            break
          }

          historicalAppointments.push({
            barbershopId: barbershop.id,
            customerId: customer.id,
            professionalId: professional.id,
            serviceId: service.id,
            status: AppointmentStatus.COMPLETED,
            source: AppointmentSource.MANUAL,
            billingModel,
            startAt,
            endAt,
            durationMinutes: Number(service.duration),
            priceSnapshot: Number(service.price),
            notes: isSubscriptionCustomer
              ? 'Atendimento recorrente de cliente assinatura.'
              : 'Atendimento avulso concluido.',
            completedAt: endAt,
          })

          slotCursor = new Date(endAt.getTime() + 10 * 60 * 1000)

          if (billingModel === AppointmentBillingModel.SUBSCRIPTION_INCLUDED) {
            continue
          }

          revenueEntries.push({
            barbershopId: barbershop.id,
            customerId: customer.id,
            professionalId: professional.id,
            serviceId: service.id,
            categoryId: categoryIdByName['Servicos'],
            amount,
            origin: RevenueOrigin.SERVICE,
            paymentMethod: PAYMENT_METHODS[(day + appointmentIndex + professionalIndex) % PAYMENT_METHODS.length],
            date,
            description: service.name,
            notes: billingModel === AppointmentBillingModel.SUBSCRIPTION_EXTRA
              ? 'Servico cobrado a parte do assinante.'
              : appointmentIndex % 4 === 0
                ? 'Cliente recorrente'
                : null,
          })

          monthlyRevenueTotals[monthMeta.key] = roundCurrency((monthlyRevenueTotals[monthMeta.key] ?? 0) + amount)

          const professionalKey = `${monthMeta.key}:${professional.id}`
          monthlyProfessionalRevenueTotals[professionalKey] = roundCurrency(
            (monthlyProfessionalRevenueTotals[professionalKey] ?? 0) + amount
          )
        }
      })

      if ((day + monthIndex) % 4 === 0) {
        const productAmount = roundCurrency(34 + ((day + monthIndex) % 3) * 6)

        revenueEntries.push({
          barbershopId: barbershop.id,
          customerId: null,
          professionalId: null,
          serviceId: null,
          categoryId: categoryIdByName['Produtos'],
          amount: productAmount,
          origin: RevenueOrigin.PRODUCT,
          paymentMethod: PAYMENT_METHODS[(day + monthIndex) % PAYMENT_METHODS.length],
          date,
          description: day % 2 === 0 ? 'Pomada modeladora premium' : 'Oleo de barba premium',
          notes: 'Venda de balcão',
        })

        monthlyRevenueTotals[monthMeta.key] = roundCurrency((monthlyRevenueTotals[monthMeta.key] ?? 0) + productAmount)
      }
    }
  })

  await prisma.appointment.createMany({ data: historicalAppointments })
  await prisma.revenue.createMany({ data: revenueEntries })

  const monthlyExpenseTotals: Record<string, number> = {}
  const expenseEntries: any[] = []

  months.forEach((monthMeta, monthIndex) => {
    const fixedExpenses = [
      {
        description: 'Aluguel da unidade',
        amount: 4200,
        categoryId: categoryIdByName['Aluguel'],
        dueDay: 5,
        paid: true,
        recurrent: true,
      },
      {
        description: 'Pro-labore da operacao',
        amount: 1800,
        categoryId: categoryIdByName['Folha e pro-labore'],
        dueDay: 6,
        paid: true,
        recurrent: true,
      },
      {
        description: 'Energia e agua',
        amount: roundCurrency(620 + monthIndex * 18),
        categoryId: categoryIdByName['Energia e agua'],
        dueDay: 10,
        paid: !monthMeta.isCurrent,
        recurrent: true,
      },
      {
        description: 'Internet, agenda e software',
        amount: 289,
        categoryId: categoryIdByName['Internet e software'],
        dueDay: 8,
        paid: !monthMeta.isCurrent,
        recurrent: true,
      },
    ]

    fixedExpenses.forEach((expense) => {
      const dueDate = new Date(monthMeta.year, monthMeta.month - 1, expense.dueDay)
      const paidAt = expense.paid ? dueDate : null

      expenseEntries.push({
        barbershopId: barbershop.id,
        categoryId: expense.categoryId,
        amount: expense.amount,
        type: ExpenseType.FIXED,
        recurrent: expense.recurrent,
        dueDate,
        paidAt,
        paid: expense.paid,
        description: expense.description,
        notes: expense.paid ? 'Conta regular da operação' : 'Em aberto para o financeiro',
      })

      monthlyExpenseTotals[monthMeta.key] = roundCurrency((monthlyExpenseTotals[monthMeta.key] ?? 0) + expense.amount)
    })

    const variableExpenses = [
      {
        description: 'Reposicao de insumos premium',
        amount: roundCurrency(760 + monthIndex * 55),
        categoryId: categoryIdByName['Insumos'],
        dueDay: monthMeta.isCurrent ? 4 : 14,
        paid: !monthMeta.isCurrent,
      },
      {
        description: 'Campanha local de Instagram',
        amount: roundCurrency(420 + (monthIndex % 3) * 90),
        categoryId: categoryIdByName['Marketing local'],
        dueDay: monthMeta.isCurrent ? 6 : 12,
        paid: !monthMeta.isCurrent,
      },
      {
        description: 'Manutencao preventiva das maquinas',
        amount: roundCurrency(monthIndex % 2 === 0 ? 240 : 180),
        categoryId: categoryIdByName['Manutencao'],
        dueDay: monthMeta.isCurrent ? 16 : 18,
        paid: !monthMeta.isCurrent,
      },
    ]

    variableExpenses.forEach((expense) => {
      const dueDate = new Date(monthMeta.year, monthMeta.month - 1, expense.dueDay)
      const paidAt = expense.paid ? dueDate : null

      expenseEntries.push({
        barbershopId: barbershop.id,
        categoryId: expense.categoryId,
        amount: expense.amount,
        type: ExpenseType.VARIABLE,
        recurrent: false,
        dueDate,
        paidAt,
        paid: expense.paid,
        description: expense.description,
        notes: expense.paid ? 'Despesa operacional registrada' : 'Pendente para gerar alerta de acao',
      })

      monthlyExpenseTotals[monthMeta.key] = roundCurrency((monthlyExpenseTotals[monthMeta.key] ?? 0) + expense.amount)
    })
  })

  await prisma.expense.createMany({ data: expenseEntries })

  const previousMonthMeta = getMonthMeta(1)
  const currentKey = monthKey(CURRENT_MONTH, CURRENT_YEAR)
  const previousKey = previousMonthMeta.key

  const monthlyGoals = [
    {
      month: previousMonthMeta.month,
      year: previousMonthMeta.year,
      revenueGoal: roundCurrency((monthlyRevenueTotals[previousKey] ?? 0) * 1.04),
      revenueMin: roundCurrency((monthlyRevenueTotals[previousKey] ?? 0) * 0.93),
      expenseLimit: roundCurrency((monthlyExpenseTotals[previousKey] ?? 0) * 1.08),
      notes: 'Mes anterior fechado com boa margem e espaço para melhorar ticket.',
    },
    {
      month: CURRENT_MONTH,
      year: CURRENT_YEAR,
      revenueGoal: roundCurrency((monthlyRevenueTotals[currentKey] ?? 0) * 1.12),
      revenueMin: roundCurrency((monthlyRevenueTotals[currentKey] ?? 0) * 0.95),
      expenseLimit: roundCurrency((monthlyExpenseTotals[currentKey] ?? 0) * 1.06),
      notes: 'Meta agressiva para manter ritmo forte e reforcar venda de combos premium.',
    },
  ]

  const goalMultipliers = {
    current: [
      { goal: 1.09, min: 0.93 },
      { goal: 1.05, min: 0.9 },
      { goal: 1.18, min: 0.87 },
    ],
    previous: [
      { goal: 0.98, min: 0.9 },
      { goal: 1.04, min: 0.92 },
      { goal: 1.1, min: 0.88 },
    ],
  }

  for (const goalConfig of monthlyGoals) {
    const monthlyGoal = await prisma.monthlyGoal.create({
      data: {
        barbershopId: barbershop.id,
        month: goalConfig.month,
        year: goalConfig.year,
        revenueGoal: goalConfig.revenueGoal,
        revenueMin: goalConfig.revenueMin,
        expenseLimit: goalConfig.expenseLimit,
        notes: goalConfig.notes,
      },
    })

    const key = monthKey(goalConfig.month, goalConfig.year)
    const multiplierSet = key === currentKey ? goalMultipliers.current : goalMultipliers.previous

    for (let index = 0; index < professionals.length; index += 1) {
      const professional = professionals[index]
      const actualRevenue = monthlyProfessionalRevenueTotals[`${key}:${professional.id}`] ?? 0
      const multipliers = multiplierSet[index]

      await prisma.professionalGoal.create({
        data: {
          monthlyGoalId: monthlyGoal.id,
          professionalId: professional.id,
          barbershopId: barbershop.id,
          revenueGoal: roundCurrency(actualRevenue * multipliers.goal),
          revenueMin: roundCurrency(actualRevenue * multipliers.min),
          month: goalConfig.month,
          year: goalConfig.year,
        },
      })
    }
  }

  const currentMonthName = new Date(CURRENT_YEAR, CURRENT_MONTH - 1, 1).toLocaleDateString('pt-BR', { month: 'long' })
  const previousMonthName = new Date(previousMonthMeta.year, previousMonthMeta.month - 1, 1).toLocaleDateString('pt-BR', { month: 'long' })

  const activeChallenge = await prisma.challenge.create({
    data: {
      barbershopId: barbershop.id,
      title: `Sprint de faturamento de ${currentMonthName}`,
      description: 'Quem puxar mais venda premium no mes leva destaque e bonus no fechamento.',
      startDate: new Date(CURRENT_YEAR, CURRENT_MONTH - 1, 1),
      endDate: new Date(CURRENT_YEAR, CURRENT_MONTH, 0),
      type: ChallengeType.REVENUE,
      targetValue: roundCurrency((monthlyProfessionalRevenueTotals[`${currentKey}:${professionals[0].id}`] ?? 0) * 1.08),
      reward: 'Bonus de R$ 350 + vitrine de destaque na recepcao',
      active: true,
    },
  })

  const closedChallenge = await prisma.challenge.create({
    data: {
      barbershopId: barbershop.id,
      title: `Corrida comercial de ${previousMonthName}`,
      description: 'Desafio usado para empurrar combos e servicos premium no mes anterior.',
      startDate: new Date(previousMonthMeta.year, previousMonthMeta.month - 1, 1),
      endDate: new Date(previousMonthMeta.year, previousMonthMeta.month, 0),
      type: ChallengeType.REVENUE,
      targetValue: roundCurrency((monthlyProfessionalRevenueTotals[`${previousKey}:${professionals[0].id}`] ?? 0) * 0.95),
      reward: 'Vale compras profissional + mural de lideranca',
      active: false,
    },
  })

  for (const professional of professionals) {
    const currentAchieved = monthlyProfessionalRevenueTotals[`${currentKey}:${professional.id}`] ?? 0
    const previousAchieved = monthlyProfessionalRevenueTotals[`${previousKey}:${professional.id}`] ?? 0

    await prisma.challengeResult.create({
      data: {
        challengeId: activeChallenge.id,
        professionalId: professional.id,
        achievedValue: currentAchieved,
        completed: currentAchieved >= Number(activeChallenge.targetValue),
        notes: currentAchieved >= Number(activeChallenge.targetValue) ? 'Liderando com ritmo forte no mes.' : 'Ainda em disputa.',
      },
    })

    await prisma.challengeResult.create({
      data: {
        challengeId: closedChallenge.id,
        professionalId: professional.id,
        achievedValue: previousAchieved,
        completed: previousAchieved >= Number(closedChallenge.targetValue),
        rewardGiven: previousAchieved >= Number(closedChallenge.targetValue),
        notes: previousAchieved >= Number(closedChallenge.targetValue) ? 'Resultado fechado acima da meta.' : 'Ficou abaixo do alvo final.',
      },
    })
  }

  await prisma.campaignMetric.createMany({
    data: [
      {
        barbershopId: barbershop.id,
        month: previousMonthMeta.month,
        year: previousMonthMeta.year,
        campaignName: 'Reativacao de clientes parados',
        messagesSent: 164,
        messagesAnswered: 63,
        appointmentsBooked: 38,
        newClients: 11,
        recoveredClients: 27,
        notes: 'Campanha que ajudou a encher agenda nos dias de segunda e terca.',
      },
      {
        barbershopId: barbershop.id,
        month: CURRENT_MONTH,
        year: CURRENT_YEAR,
        campaignName: 'Combo premium de inicio de mes',
        messagesSent: 118,
        messagesAnswered: 49,
        appointmentsBooked: 29,
        newClients: 9,
        recoveredClients: 16,
        notes: 'Ajudou a puxar ticket medio e acelerar o faturamento do mes.',
      },
    ],
  })

  console.log('Seed completed successfully.')
  console.log('Demo access:')
  demoUsers.forEach((user) => {
    console.log(`- ${user.role}: ${user.email}`)
  })
  console.log('Password: demo123456')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
