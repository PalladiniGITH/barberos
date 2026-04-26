import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireSession } from '@/lib/auth'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { prisma } from '@/lib/prisma'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const headerStore = headers()
  const currentPath = headerStore.get('x-pathname') ?? '/dashboard'
  const currentSearch = headerStore.get('x-search') ?? ''
  const session = await requireSession()

  const barbershop = await prisma.barbershop.findUnique({
    where: { id: session.user.barbershopId },
    select: { onboardingCompletedAt: true },
  })

  if (!barbershop?.onboardingCompletedAt && session.user.role !== 'BARBER') {
    redirect('/onboarding')
  }

  return (
    <DashboardShell
      currentPath={currentPath}
      currentSearch={currentSearch}
      user={{
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        platformRole: session.user.platformRole,
        barbershopName: session.user.barbershopName,
        barbershopSlug: session.user.barbershopSlug,
      }}
    >
      {children}
    </DashboardShell>
  )
}
