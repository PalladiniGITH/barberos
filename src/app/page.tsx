import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import {
  AUTHENTICATED_HOME_PATH,
  buildNextAuthSignInHref,
  normalizeCallbackPath,
} from '@/lib/auth-routes'

interface HomePageProps {
  searchParams?: {
    callbackUrl?: string
    error?: string
  }
}

export default async function Home({ searchParams }: HomePageProps) {
  const session = await getSession()

  if (session?.user?.barbershopId) {
    redirect(AUTHENTICATED_HOME_PATH)
  }

  redirect(buildNextAuthSignInHref({
    callbackPath: normalizeCallbackPath(searchParams?.callbackUrl),
    error: searchParams?.error,
  }))
}
