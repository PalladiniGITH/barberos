import { headers } from 'next/headers'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { requirePlatformSession } from '@/lib/auth'

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const headerStore = headers()
  const currentPath = headerStore.get('x-pathname') ?? '/internal'
  const currentSearch = headerStore.get('x-search') ?? ''
  const session = await requirePlatformSession()

  return (
    <DashboardShell
      currentPath={currentPath}
      currentSearch={currentSearch}
      homeHref="/internal"
      user={{
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        platformRole: session.user.platformRole,
        barbershopName: 'Plataforma BarberEX',
        barbershopSlug: 'barberex-platform',
      }}
    >
      {children}
    </DashboardShell>
  )
}
