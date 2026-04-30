import { getPlatformOverviewData } from '@/lib/platform-admin'
import { PlatformOverview } from '@/components/internal/platform-overview'
import { requirePlatformAdmin } from '@/lib/security/guards'

interface InternalPageProps {
  searchParams?: {
    search?: string
    status?: string
    plan?: string
  }
}

export default async function InternalPage({ searchParams }: InternalPageProps) {
  const session = await requirePlatformAdmin()
  const data = await getPlatformOverviewData(
    {
      userId: session.userId,
      platformRole: session.platformRole,
    },
    {
      search: searchParams?.search,
      status: searchParams?.status,
      plan: searchParams?.plan,
    }
  )

  return <PlatformOverview data={data} />
}
