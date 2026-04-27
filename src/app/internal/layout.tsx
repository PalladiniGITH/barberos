import { PlatformShell } from '@/components/internal/platform-shell'
import { requirePlatformSession } from '@/lib/auth'

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformSession()

  return (
    <PlatformShell
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
    </PlatformShell>
  )
}
