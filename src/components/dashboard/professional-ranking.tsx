import { cn, formatCurrency, formatPercent } from '@/lib/utils'
import { Crown, Medal, TrendingUp } from 'lucide-react'
import { ProfessionalAvatar } from '@/components/ui/professional-avatar'

interface RankingEntry {
  id: string
  name: string
  avatar: string | null
  revenue: number
  goal: number
  position: number
}

interface ProfessionalRankingProps {
  data: RankingEntry[]
}

function positionIcon(position: number) {
  if (position === 1) return <Crown className="h-4 w-4 text-amber-500" />
  if (position === 2) return <Medal className="h-4 w-4 text-slate-500" />
  if (position === 3) return <Medal className="h-4 w-4 text-amber-700" />

  return <span className="w-4 text-center font-mono text-xs text-muted-foreground">{position}</span>
}

export function ProfessionalRanking({ data }: ProfessionalRankingProps) {
  const totalRevenue = data.reduce((sum, entry) => sum + entry.revenue, 0)
  const maxRevenue = Math.max(...data.map((entry) => entry.revenue), 0)
  const [leader, ...rest] = data

  return (
    <section className="dashboard-panel p-5 sm:p-6">
      <div className="flex flex-col gap-4 border-b border-[rgba(255,255,255,0.03)] pb-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h3 className="mt-2 text-[1.55rem] font-semibold tracking-tight text-foreground">Ranking dos profissionais</h3>
          <p className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
            Uma leitura mais executiva do time, com peso de receita, proximidade da meta e relevancia na operacao.
          </p>
        </div>
        {leader && (
          <p className="text-sm text-muted-foreground">
            Lider do periodo: <span className="font-semibold text-foreground">{leader.name}</span>
          </p>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {leader && (() => {
          const hasGoal = leader.goal > 0
          const goalProgress = hasGoal ? (leader.revenue / leader.goal) * 100 : 0
          const barProgress = hasGoal ? Math.min(100, goalProgress) : 100
          const shareOfTeam = totalRevenue > 0 ? (leader.revenue / totalRevenue) * 100 : 0

          return (
            <article className="surface-tier-low p-4 sm:p-6">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
                <div className="min-w-0">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-[rgba(124,92,255,0.18)] bg-[rgba(124,92,255,0.14)] text-primary">
                      {positionIcon(leader.position)}
                    </span>
                    <ProfessionalAvatar
                      name={leader.name}
                      imageUrl={leader.avatar}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-100/90">Destaque do periodo</p>
                      <h4 className="mt-1 text-[clamp(1.25rem,1.02rem+0.9vw,1.7rem)] font-semibold leading-tight tracking-tight text-foreground break-words">
                        {leader.name}
                      </h4>
                    </div>
                  </div>

                  <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
                    {hasGoal
                      ? `${formatCurrency(leader.revenue)} no periodo, com ${formatPercent(goalProgress, 0)} da meta individual concluida.`
                      : `${formatCurrency(leader.revenue)} no periodo, representando ${formatPercent(shareOfTeam, 0)} do faturamento da equipe.`}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-3">
                  <div className="panel-soft">
                    <p className="executive-label">Receita</p>
                    <p className="mt-3 text-[clamp(1.05rem,0.98rem+0.55vw,1.2rem)] font-semibold leading-tight text-foreground break-words">
                      {formatCurrency(leader.revenue)}
                    </p>
                  </div>
                  <div className="panel-soft">
                    <p className="executive-label">{hasGoal ? 'Meta individual' : 'Participacao'}</p>
                    <p className="mt-3 text-[clamp(1.05rem,0.98rem+0.55vw,1.2rem)] font-semibold leading-tight text-foreground break-words">
                      {hasGoal ? formatCurrency(leader.goal) : formatPercent(shareOfTeam, 0)}
                    </p>
                  </div>
                  <div className="panel-soft">
                    <p className="executive-label">Ritmo atual</p>
                    <p className="mt-3 text-[clamp(1.05rem,0.98rem+0.55vw,1.2rem)] font-semibold leading-tight text-foreground break-words">
                      {hasGoal
                        ? goalProgress >= 100
                          ? 'Meta batida'
                          : `${formatPercent(Math.max(0, 100 - goalProgress), 0)} restante`
                        : 'Lider da equipe'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-[rgba(124,92,255,0.08)]">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-700',
                    hasGoal
                      ? goalProgress >= 100
                        ? 'bg-emerald-500'
                        : goalProgress >= 80
                          ? 'bg-primary'
                          : 'bg-amber-500'
                      : 'bg-violet-500'
                  )}
                  style={{ width: `${barProgress}%` }}
                />
              </div>
            </article>
          )
        })()}

        <div className="space-y-3">
          {rest.map((entry) => {
          const hasGoal = entry.goal > 0
          const goalProgress = hasGoal ? (entry.revenue / entry.goal) * 100 : 0
          const barProgress = hasGoal ? Math.min(100, goalProgress) : maxRevenue > 0 ? (entry.revenue / maxRevenue) * 100 : 0
          const shareOfTeam = totalRevenue > 0 ? (entry.revenue / totalRevenue) * 100 : 0

          return (
            <article
              key={entry.id}
              className="surface-tier-low p-4"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[0.95rem] border border-[rgba(91,33,182,0.08)] bg-[rgba(91,33,182,0.08)] text-primary">
                  {positionIcon(entry.position)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProfessionalAvatar
                        name={entry.name}
                        imageUrl={entry.avatar}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold leading-tight text-foreground break-words">{entry.name}</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {hasGoal
                            ? `Meta individual: ${formatCurrency(entry.goal)}`
                            : `${formatPercent(shareOfTeam, 0)} do faturamento da equipe`}
                        </p>
                      </div>
                    </div>

                    <div className="tonal-note w-full px-3.5 py-2.5 text-left lg:w-auto lg:min-w-[170px] lg:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Receita</p>
                      <p className="mt-1 text-base font-semibold tabular-nums leading-tight text-foreground break-words">
                        {formatCurrency(entry.revenue)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[rgba(91,33,182,0.08)]">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-700',
                        hasGoal
                          ? goalProgress >= 100
                            ? 'bg-emerald-500'
                            : goalProgress >= 80
                              ? 'bg-primary'
                              : 'bg-amber-500'
                          : 'bg-violet-500'
                      )}
                      style={{ width: `${barProgress}%` }}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5" />
                      {hasGoal ? 'Progresso da meta' : 'Participacao na equipe'}
                    </span>
                    <span className="rounded-full border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.028)] px-2.5 py-1 font-medium text-foreground">
                      {hasGoal
                        ? goalProgress >= 100
                          ? 'Meta batida'
                          : `${formatPercent(Math.max(0, 100 - goalProgress), 0)} para bater`
                        : `${formatPercent(barProgress, 0)} do lider`}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          )
        })}
        </div>
      </div>
    </section>
  )
}
