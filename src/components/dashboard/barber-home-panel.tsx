import Link from 'next/link'
import {
  ArrowUpRight,
  CalendarClock,
  Package,
  Scissors,
  Target,
  Trophy,
  Wallet,
} from 'lucide-react'
import type { BarberDashboardData } from '@/lib/barber-dashboard'
import { cn, formatCurrency, formatPercent } from '@/lib/utils'

function BarberMetric({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string
  value: string
  helper: string
  icon: typeof Wallet
}) {
  return (
    <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-[rgba(91,33,182,0.12)] bg-[rgba(91,33,182,0.08)] text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
          <p className="mt-1 text-[1.8rem] font-semibold tracking-tight text-foreground">{value}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{helper}</p>
    </div>
  )
}

export function BarberHomePanel({ data }: { data: BarberDashboardData }) {
  const formatChallengeMetric = (value: number) => (
    data.activeChallenge?.valueFormat === 'currency' ? formatCurrency(value) : `${value}`
  )

  return (
    <div className="page-section flex flex-col gap-5">
      <section className="dashboard-spotlight overflow-hidden p-5 sm:p-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_340px]">
          <div>
            <p className="spotlight-kicker">Painel do barbeiro</p>
            <h1 className="mt-3 text-[2.3rem] font-semibold tracking-tight text-foreground sm:text-[2.8rem]">
              {data.professionalName}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              Sua agenda, seu ritmo e sua leitura de desempenho em um painel direto para o dia a dia.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="spotlight-chip">{data.attendanceScopeLabel}</span>
              <span className="spotlight-chip">{data.todayLabel}</span>
              <span className="spotlight-chip">{data.upcomingToday.length} proximos atendimentos</span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="hero-stat-card">
                <p className="executive-label">Hoje agendado</p>
                <p className="mt-3 text-[1.9rem] font-semibold tracking-tight text-foreground">
                  {data.scheduledTodayCount}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">Clientes confirmados ou pendentes na sua agenda.</p>
              </div>
              <div className="hero-stat-card">
                <p className="executive-label">Concluidos hoje</p>
                <p className="mt-3 text-[1.9rem] font-semibold tracking-tight text-foreground">
                  {data.completedTodayCount}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">Atendimentos que ja viraram entrega real no dia.</p>
              </div>
              <div className="hero-stat-card">
                <p className="executive-label">Meta do periodo</p>
                <p className="mt-3 text-[1.9rem] font-semibold tracking-tight text-foreground">
                  {data.goalValue > 0 ? formatPercent(data.goalProgress, 0) : 'Sem meta'}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {data.goalValue > 0 ? `${formatCurrency(data.monthRevenue)} de ${formatCurrency(data.goalValue)}` : 'A casa ainda nao definiu meta individual.'}
                </p>
              </div>
            </div>
          </div>

          <aside className="premium-rail p-5">
            <p className="page-kicker">Resultado do periodo</p>
            <h2 className="mt-2 text-[1.45rem] font-semibold tracking-tight text-foreground">{data.periodLabel}</h2>
            <div className="mt-5 space-y-3">
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="executive-label">Faturamento gerado</p>
                <p className="mt-3 text-[1.9rem] font-semibold tracking-tight text-foreground">
                  {formatCurrency(data.monthRevenue)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {data.appointmentsCompletedInPeriod} atendimento(s) concluidos no periodo.
                </p>
              </div>

              <div className="rounded-[0.95rem] border border-[rgba(91,33,182,0.16)] bg-[rgba(91,33,182,0.08)] p-4">
                <p className="executive-label">Comissao estimada</p>
                <p className="mt-3 text-[1.65rem] font-semibold tracking-tight text-foreground">
                  {formatCurrency(data.estimatedCommission)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {data.actualCommission !== null
                    ? 'Valor fechado no periodo pelo controle de comissoes.'
                    : `Projecao usando ${formatPercent(data.commissionRatePercent, 0)} sobre a receita comissionavel.`}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        <BarberMetric
          label="Ticket medio"
          value={formatCurrency(data.averageTicket)}
          helper="Quanto cada atendimento concluido esta deixando no seu periodo."
          icon={Scissors}
        />
        <BarberMetric
          label="Receita comissionavel"
          value={formatCurrency(data.commissionableRevenue)}
          helper="Base usada para estimar comissao quando o fechamento ainda nao existe."
          icon={Wallet}
        />
        <BarberMetric
          label="Produtos vendidos"
          value={`${data.productSalesCount}`}
          helper={`${formatCurrency(data.productRevenue)} em vendas de produto vinculadas a voce.`}
          icon={Package}
        />
        <BarberMetric
          label="Ritmo de meta"
          value={data.goalValue > 0 ? formatPercent(data.goalProgress, 0) : 'Sem meta'}
          helper="Leitura simples para saber se o periodo esta acima, no ritmo ou abaixo."
          icon={Target}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="page-kicker">Agenda do dia</p>
              <h2 className="mt-2 text-[1.35rem] font-semibold tracking-tight text-foreground">Seus proximos horarios</h2>
            </div>
            <Link href="/agendamentos" className="surface-chip">
              Abrir agenda
            </Link>
          </div>

          <div className="mt-5 space-y-3">
            {data.upcomingToday.length > 0 ? data.upcomingToday.map((appointment) => (
              <div
                key={appointment.id}
                className="flex items-center justify-between gap-3 rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{appointment.customerName}</p>
                  <p className="truncate text-sm text-muted-foreground">{appointment.serviceName}</p>
                </div>
                <span className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-semibold',
                  appointment.status === 'CONFIRMED'
                    ? 'bg-[rgba(16,185,129,0.12)] text-emerald-300'
                    : 'bg-[rgba(245,158,11,0.12)] text-amber-300'
                )}>
                  {appointment.timeLabel}
                </span>
              </div>
            )) : (
              <div className="rounded-[1rem] border border-dashed border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-5 text-sm text-muted-foreground">
                Sua agenda de hoje esta livre no momento. Abra a agenda para encaixes e novos horarios.
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="premium-rail p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="page-kicker">Desafio ativo</p>
                <h2 className="mt-2 text-[1.3rem] font-semibold tracking-tight text-foreground">
                  {data.activeChallenge?.title ?? 'Sem campanha ativa'}
                </h2>
              </div>
              <Trophy className="h-5 w-5 text-primary" />
            </div>

            {data.activeChallenge ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                  <p className="executive-label">{data.activeChallenge.typeLabel}</p>
                  <p className="mt-3 text-[1.7rem] font-semibold tracking-tight text-foreground">
                    {formatPercent(data.activeChallenge.progress, 0)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatChallengeMetric(data.activeChallenge.achievedValue)} de {formatChallengeMetric(data.activeChallenge.targetValue)}
                  </p>
                </div>
                <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4 text-sm text-muted-foreground">
                  {data.activeChallenge.reward
                    ? `Recompensa ativa: ${data.activeChallenge.reward}.`
                    : 'Sem recompensa cadastrada para esse desafio.'}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-[0.95rem] border border-dashed border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 text-sm text-muted-foreground">
                Quando a barbearia ativar uma campanha, seu progresso aparece aqui de forma direta.
              </div>
            )}
          </section>

          <section className="dashboard-panel p-5">
            <p className="page-kicker">Acoes rapidas</p>
            <div className="mt-4 space-y-3">
              <Link href="/agendamentos" className="action-button flex justify-between">
                Abrir minha agenda
                <CalendarClock className="h-4 w-4 text-primary" />
              </Link>
              <Link href="/equipe/desempenho" className="action-button flex justify-between">
                Ver desempenho completo
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
