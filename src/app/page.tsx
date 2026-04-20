import { getSession } from '@/lib/auth'
import { normalizeCallbackPath } from '@/lib/auth-routes'
import { AuthEntryCard } from '@/components/auth/auth-entry-card'

interface HomePageProps {
  searchParams?: {
    callbackUrl?: string
    error?: string
  }
}

export default async function Home({ searchParams }: HomePageProps) {
  const session = await getSession()

  return (
    <AuthEntryCard
      callbackUrl={normalizeCallbackPath(searchParams?.callbackUrl)}
      error={searchParams?.error ?? null}
      isAuthenticated={Boolean(session?.user?.barbershopId)}
      userName={session?.user?.name ?? null}
    />
  )
}
