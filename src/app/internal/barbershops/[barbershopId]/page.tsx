import Link from 'next/link'
import { requirePlatformSession } from '@/lib/auth'
import { getPlatformBarbershopDetailData } from '@/lib/platform-admin'
import { PageHeader } from '@/components/layout/page-header'
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

  try {
    const data = await getPlatformBarbershopDetailData(
      {
        userId: session.user.id,
        platformRole: session.user.platformRole,
      },
      params.barbershopId
    )

    return <PlatformBarbershopDetail data={data} />
  } catch (error) {
    console.error('[platform-admin] detail failed', {
      userId: session.user.id,
      barbershopId: params.barbershopId,
      error: error instanceof Error ? error.message : String(error),
    })

    return (
      <div className="space-y-6">
        <PageHeader
          title="Unidade indisponível"
          description="Não foi possível carregar os detalhes desta barbearia agora. O restante da operação da plataforma continua acessível."
          action={(
            <Link
              href="/internal"
              className="inline-flex items-center gap-2 rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)]"
            >
              Voltar para a plataforma
            </Link>
          )}
        />

        <section className="rounded-[1.2rem] border border-amber-500/20 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
          <p className="font-semibold">Leitura temporariamente indisponível</p>
          <p className="mt-2">
            Revise a atualização desta implantação e tente novamente em instantes.
          </p>
        </section>
      </div>
    )
  }
}
