import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { prisma } from '@/lib/prisma'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  const headerStore = headers()
  const currentPath = headerStore.get('x-pathname') ?? '/dashboard'
  const currentSearch = headerStore.get('x-search') ?? ''

  const barbershop = await prisma.barbershop.findUnique({
    where: { id: session.user.barbershopId },
    select: { onboardingCompletedAt: true },
  })

  if (!barbershop?.onboardingCompletedAt) {
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
        barbershopName: session.user.barbershopName,
        barbershopSlug: session.user.barbershopSlug,
      }}
    >
      {children}
    </DashboardShell>
  )
}
