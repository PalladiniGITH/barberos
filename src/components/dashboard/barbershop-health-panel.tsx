import Link from 'next/link'
import { Activity, ArrowUpRight, Repeat2, ShieldCheck, UserRoundCheck, Users } from 'lucide-react'
import type { BarbershopHealthSnapshot } from '@/lib/barbershop-health'
import { cn, formatPercent } from '@/lib/utils'

function HealthMetricCard({
  title,
  value,
  helper,
  icon: Icon,
}: {
  title: string
  value: string
  helper: string
  icon: typeof Users
}) {
  return (
    <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-[rgba(91,33,182,0.12)] bg-[rgba(91,33,182,0.08)] text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{helper}</p>
    </div>
  )
}

export function BarbershopHealthPanel({ health }: { health: BarbershopHealthSnapshot }) {
  const toneClass = {
    healthy: 'border-[rgba(22,163,74,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(22,163,74,0.16),transparent_35%),linear-gradient(180deg,rgba(20,36,29,0.98),rgba(21,24,33,0.98))]',
    attention: 'border-[rgba(245,158,11,0.22)] bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_35%),linear-gradient(180deg,rgba(39,31,22,0.98),rgba(21,24,33,0.98))]',
    cooling: 'border-[rgba(244,63,94,0.22)] bg-[radial-gradient(circle_at_top_left,rgba(244,63,94,0.16),transparent_35%),linear-gradient(180deg,rgba(39,24,31,0.98),rgba(21,24,33,0.98))]',
  }[health.healthStatus]

  return (
    <section className={cn('dashboard-panel overflow-hidden p-5 sm:p-6', toneClass)}>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_340px]">
        <div>
          <p className="page-kicker">Saude da base</p>
          <h2 className="mt-2 text-[1.5rem] font-semibold tracking-tight text-foreground">
            {health.healthLabel}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">{health.summary}</p>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <HealthMetricCard
              title="Assinantes ativos"
              value={`${health.activeSubscribers}`}
              helper={`${health.subscribersWithVisits} voltaram no periodo.`}
              icon={Users}
            />
            <HealthMetricCard
              title="Retorno assinatura"
              value={formatPercent(health.subscriberReturnRate, 0)}
              helper={`${health.averageVisitsPerSubscriber.toFixed(1)} visita(s) por assinante.`}
              icon={UserRoundCheck}
            />
            <HealthMetricCard
              title="Retorno avulso"
              value={formatPercent(health.walkInReturnRate, 0)}
              helper={`${health.returningWalkInCustomers} clientes avulsos repetiram no periodo.`}
              icon={Repeat2}
            />
            <HealthMetricCard
              title="Pulso da base"
              value={formatPercent(health.healthScore, 0)}
              helper={`${formatPercent(health.riskSubscriberPercent, 0)} dos assinantes estao em risco.`}
              icon={Activity}
            />
          </div>
        </div>

        <aside className="premium-rail p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="page-kicker">Leitura executiva</p>
              <h3 className="mt-2 text-[1.35rem] font-semibold tracking-tight text-foreground">Como estamos medindo</h3>
            </div>
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>

          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
              <p className="font-semibold text-foreground">Retorno dos assinantes</p>
              <p className="mt-2 leading-6">{health.methodology.subscriberReturnRate}</p>
            </div>
            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
              <p className="font-semibold text-foreground">Retorno dos avulsos</p>
              <p className="mt-2 leading-6">{health.methodology.walkInReturnRate}</p>
            </div>
            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
              <p className="font-semibold text-foreground">Score de saude</p>
              <p className="mt-2 leading-6">{health.methodology.healthScore}</p>
            </div>
          </div>

          <Link href="/clientes" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary">
            Abrir leitura detalhada de clientes
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </aside>
      </div>
    </section>
  )
}
