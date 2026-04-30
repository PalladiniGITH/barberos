import { PlatformShell } from '@/components/internal/platform-shell'
import { requirePlatformAdmin } from '@/lib/security/guards'

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformAdmin()

  return (
    <PlatformShell
      user={{
        name: session.session.user.name,
        email: session.session.user.email,
        role: session.session.user.role,
        platformRole: session.session.user.platformRole,
        barbershopName: 'Plataforma BarberEX',
        barbershopSlug: 'barberex-platform',
      }}
    >
      {children}
    </PlatformShell>
  )
}
