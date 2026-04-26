import { cn, formatCurrency, formatPercent } from '@/lib/utils'
import { Crown, Medal, TrendingUp } from 'lucide-react'

interface RankingEntry {
  id: string
  name: string
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

  return (
    <section className="dashboard-panel p-6">
      <div className="flex flex-col gap-4 border-b border-[rgba(255,255,255,0.06)] pb-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h3 className="mt-2 text-[1.55rem] font-semibold tracking-tight text-foreground">Ranking dos profissionais</h3>
          <p className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
            Uma leitura mais executiva do time, com peso de receita, proximidade da meta e relevancia na operacao.
          </p>
        </div>
        {data[0] && (
          <p className="text-sm text-muted-foreground">
            Lider do periodo: <span className="font-semibold text-foreground">{data[0].name}</span>
          </p>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {data.map((entry) => {
          const hasGoal = entry.goal > 0
          const goalProgress = hasGoal ? (entry.revenue / entry.goal) * 100 : 0
          const barProgress = hasGoal ? Math.min(100, goalProgress) : maxRevenue > 0 ? (entry.revenue / maxRevenue) * 100 : 0
          const shareOfTeam = totalRevenue > 0 ? (entry.revenue / totalRevenue) * 100 : 0

          return (
            <article
              key={entry.id}
              className="rounded-[1.35rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.98),rgba(15,17,21,0.96))] p-5 shadow-[0_20px_40px_-30px_rgba(2,6,23,0.72)]"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[1rem] border border-[rgba(91,33,182,0.08)] bg-[rgba(91,33,182,0.08)] text-primary">
                  {positionIcon(entry.position)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-foreground">{entry.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {hasGoal
                          ? `Meta individual: ${formatCurrency(entry.goal)}`
                          : `${formatPercent(shareOfTeam, 0)} do faturamento da equipe`}
                      </p>
                    </div>

                    <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3.5 py-2.5 text-right shadow-[0_14px_26px_-22px_rgba(2,6,23,0.56)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Receita</p>
                      <p className="mt-1 text-base font-semibold tabular-nums text-foreground">
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
                    <span className="rounded-full bg-[rgba(91,33,182,0.06)] px-2.5 py-1 font-medium text-foreground">
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
    </section>
  )
}
