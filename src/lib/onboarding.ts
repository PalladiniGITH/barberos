import { prisma } from '@/lib/prisma'

export const BRAZIL_TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília (GMT-3)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (GMT-3)' },
  { value: 'America/Recife', label: 'Recife (GMT-3)' },
  { value: 'America/Bahia', label: 'Salvador (GMT-3)' },
  { value: 'America/Manaus', label: 'Manaus (GMT-4)' },
  { value: 'America/Campo_Grande', label: 'Campo Grande (GMT-4)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (GMT-4)' },
  { value: 'America/Porto_Velho', label: 'Porto Velho (GMT-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (GMT-5)' },
]

export function getMonthYearInTimezone(timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'numeric',
    year: 'numeric',
  })

  const parts = formatter.formatToParts(new Date())
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? new Date().getMonth() + 1)
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? new Date().getFullYear())

  return { month, year }
}

export async function getOnboardingState(barbershopId: string) {
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      email: true,
      address: true,
      timezone: true,
      onboardingStep: true,
      onboardingCompletedAt: true,
    },
  })

  if (!barbershop) {
    throw new Error('Barbearia não encontrada')
  }

  const { month, year } = getMonthYearInTimezone(barbershop.timezone)

  const [professionalsCount, servicesCount, monthlyGoal] = await Promise.all([
    prisma.professional.count({ where: { barbershopId } }),
    prisma.service.count({ where: { barbershopId } }),
    prisma.monthlyGoal.findUnique({
      where: { barbershopId_month_year: { barbershopId, month, year } },
      select: { id: true },
    }),
  ])

  const checklist = [
    {
      id: 'profile',
      label: 'Perfil da barbearia',
      done: Boolean(barbershop.name && barbershop.timezone),
      detail: 'Nome, contato e timezone prontos para o dia a dia.',
    },
    {
      id: 'team',
      label: 'Equipe inicial',
      done: professionalsCount > 0,
      detail: professionalsCount > 0
        ? `${professionalsCount} profissional${professionalsCount > 1 ? 'is' : ''} cadastrado${professionalsCount > 1 ? 's' : ''}.`
        : 'Cadastre pelo menos 1 profissional para gerar ranking e meta.',
    },
    {
      id: 'services',
      label: 'Serviços principais',
      done: servicesCount > 0,
      detail: servicesCount > 0
        ? `${servicesCount} serviço${servicesCount > 1 ? 's' : ''} pronto${servicesCount > 1 ? 's' : ''} para precificação.`
        : 'Cadastre 1 ou mais serviços para ligar receita, margem e ticket.',
    },
    {
      id: 'goal',
      label: 'Meta do mês',
      done: Boolean(monthlyGoal),
      detail: monthlyGoal
        ? 'Meta mensal configurada para o período atual.'
        : 'Defina a meta para transformar números em direção.',
    },
  ]

  const completedSteps = checklist.filter((item) => item.done).length

  return {
    barbershop,
    checklist,
    completedSteps,
    currentMonth: month,
    currentYear: year,
    isComplete: Boolean(barbershop.onboardingCompletedAt),
    professionalsCount,
    servicesCount,
  }
}
