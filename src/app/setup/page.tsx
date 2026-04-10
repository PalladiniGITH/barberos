import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { SetupWizard } from '@/components/onboarding/setup-wizard'
import { getOnboardingState } from '@/lib/onboarding'
import { prisma } from '@/lib/prisma'
import { formatMonthYear } from '@/lib/utils'

export const metadata: Metadata = { title: 'Setup Inicial' }

const DEFAULT_SERVICES = [
  { name: 'Corte Tradicional', price: '45', duration: '30' },
  { name: 'Corte + Barba', price: '70', duration: '50' },
  { name: 'Barba', price: '35', duration: '20' },
]

function capitalize(value: string) {
  return value.replace(/^\w/, (letter) => letter.toUpperCase())
}

export default async function SetupPage() {
  const session = await requireSession()
  const state = await getOnboardingState(session.user.barbershopId)

  if (state.isComplete) {
    redirect('/dashboard')
  }

  const [professionals, services, monthlyGoal] = await Promise.all([
    prisma.professional.findMany({
      where: { barbershopId: session.user.barbershopId },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
      take: 6,
    }),
    prisma.service.findMany({
      where: { barbershopId: session.user.barbershopId },
      select: { id: true, name: true, price: true, duration: true },
      orderBy: { createdAt: 'asc' },
      take: 8,
    }),
    prisma.monthlyGoal.findUnique({
      where: {
        barbershopId_month_year: {
          barbershopId: session.user.barbershopId,
          month: state.currentMonth,
          year: state.currentYear,
        },
      },
    }),
  ])

  const initialProfessionals = professionals.length > 0
    ? professionals.map((professional) => ({ name: professional.name }))
    : [{ name: '' }]

  const initialServices = services.length > 0
    ? services.map((service) => ({
        name: service.name,
        price: Number(service.price).toString(),
        duration: String(service.duration),
      }))
    : DEFAULT_SERVICES

  const currentMonthLabel = capitalize(formatMonthYear(state.currentMonth, state.currentYear))

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary/80">
            Onboarding BarberOS
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Configure o essencial e entregue valor logo no primeiro acesso
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            O objetivo não é replicar uma planilha. É deixar a barbearia pronta para enxergar resultado, time e margem desde o começo.
          </p>
        </div>

        <SetupWizard
          currentMonthLabel={currentMonthLabel}
          checklist={state.checklist}
          initialStats={{
            completedSteps: state.completedSteps,
            professionalsCount: state.professionalsCount,
            servicesCount: state.servicesCount,
          }}
          initialData={{
            name: state.barbershop.name,
            phone: state.barbershop.phone ?? '',
            email: state.barbershop.email ?? '',
            address: state.barbershop.address ?? '',
            timezone: state.barbershop.timezone,
            professionals: initialProfessionals,
            services: initialServices,
            revenueGoal: monthlyGoal ? Number(monthlyGoal.revenueGoal).toString() : '',
            revenueMin: monthlyGoal ? Number(monthlyGoal.revenueMin).toString() : '',
            expenseLimit: monthlyGoal?.expenseLimit ? Number(monthlyGoal.expenseLimit).toString() : '',
          }}
        />
      </div>
    </div>
  )
}
