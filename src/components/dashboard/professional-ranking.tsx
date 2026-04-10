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
  if (position === 1) return <Crown className="h-4 w-4 text-amber-400" />
  if (position === 2) return <Medal className="h-4 w-4 text-slate-400" />
  if (position === 3) return <Medal className="h-4 w-4 text-amber-700" />

  return (
    <span className="w-4 text-center font-mono text-xs text-muted-foreground">
      {position}
    </span>
  )
}

export function ProfessionalRanking({ data }: ProfessionalRankingProps) {
  const totalRevenue = data.reduce((sum, entry) => sum + entry.revenue, 0)
  const maxRevenue = Math.max(...data.map((entry) => entry.revenue), 0)

  return (
    <section className="dashboard-panel overflow-hidden p-0">
      <div className="dashboard-spotlight px-6 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="spotlight-kicker">Forca comercial do time</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Ranking dos profissionais</h3>
            <p className="spotlight-copy max-w-xl">
              Quem esta puxando o faturamento deste periodo e como cada nome pesa no resultado do mes.
            </p>
          </div>
          {data[0] && (
            <span className="spotlight-chip">
              Lider: {data[0].name}
            </span>
          )}
        </div>
      </div>

      <div className="p-6">
        <div className="space-y-3">
          {data.map((entry) => {
            const hasGoal = entry.goal > 0
            const goalProgress = hasGoal ? (entry.revenue / entry.goal) * 100 : 0
            const barProgress = hasGoal
              ? Math.min(100, goalProgress)
              : maxRevenue > 0
                ? (entry.revenue / maxRevenue) * 100
                : 0
            const shareOfTeam = totalRevenue > 0 ? (entry.revenue / totalRevenue) * 100 : 0

            return (
              <div
                key={entry.id}
                className="rounded-[1.45rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(30,41,59,0.76),rgba(15,23,42,0.68))] p-4 shadow-[0_20px_44px_-34px_rgba(2,6,23,0.82)]"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[1rem] bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.92))] text-slate-100 shadow-[0_16px_30px_-20px_rgba(15,23,42,0.55)]">
                    {positionIcon(entry.position)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {entry.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {hasGoal
                            ? `Meta individual: ${formatCurrency(entry.goal)}`
                            : `${formatPercent(shareOfTeam, 0)} do faturamento da equipe`}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums text-foreground">
                          {formatCurrency(entry.revenue)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {hasGoal ? formatPercent(goalProgress, 0) : 'Sem meta'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-700',
                          hasGoal
                            ? goalProgress >= 100
                              ? 'bg-emerald-500'
                              : goalProgress >= 80
                                ? 'bg-primary'
                                : 'bg-amber-500'
                            : 'bg-sky-500'
                        )}
                        style={{ width: `${barProgress}%` }}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <TrendingUp className="h-3.5 w-3.5" />
                        {hasGoal ? 'Progresso da meta' : 'Forca relativa no ranking'}
                      </span>
                      <span>
                        {hasGoal
                          ? goalProgress >= 100
                            ? 'Meta batida'
                            : `${formatPercent(Math.max(0, 100 - goalProgress), 0)} para bater`
                          : `${formatPercent(barProgress, 0)} do lider`}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
