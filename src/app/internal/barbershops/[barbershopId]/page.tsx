import { requirePlatformSession } from '@/lib/auth'
import { getPlatformBarbershopDetailData } from '@/lib/platform-admin'
import { PlatformBarbershopDetail } from '@/components/internal/platform-barbershop-detail'

interface PlatformBarbershopDetailPageProps {
  params: {
    barbershopId: string
  }
}

export default async function PlatformBarbershopDetailPage({
  params,
}: PlatformBarbershopDetailPageProps) {
  const session = await requirePlatformSession()
  const data = await getPlatformBarbershopDetailData(
    {
      userId: session.user.id,
      platformRole: session.user.platformRole,
    },
    params.barbershopId
  )

  return <PlatformBarbershopDetail data={data} />
}
