import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { prisma } from '@/lib/prisma'
import { buildAuthEntryHref } from '@/lib/auth-routes'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const headerStore = headers()
  const currentPath = headerStore.get('x-pathname') ?? '/dashboard'
  const currentSearch = headerStore.get('x-search') ?? ''
  const session = await getSession()
  if (!session) redirect(buildAuthEntryHref(`${currentPath}${currentSearch}`))

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
