import { requirePlatformSession } from '@/lib/auth'
import { getPlatformOverviewData } from '@/lib/platform-admin'
import { PlatformOverview } from '@/components/internal/platform-overview'

interface InternalPageProps {
  searchParams?: {
    search?: string
    status?: string
    plan?: string
  }
}

export default async function InternalPage({ searchParams }: InternalPageProps) {
  const session = await requirePlatformSession()
  const data = await getPlatformOverviewData(
    {
      userId: session.user.id,
      platformRole: session.user.platformRole,
    },
    {
      search: searchParams?.search,
      status: searchParams?.status,
      plan: searchParams?.plan,
    }
  )

  return <PlatformOverview data={data} />
}
