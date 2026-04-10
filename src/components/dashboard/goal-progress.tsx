import { formatCurrency, formatPercent, calcGoalProgress, getGoalStatus } from '@/lib/utils'
import { Target, TrendingUp, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GoalProgressProps {
  achieved: number
  goal: number
  min: number
  month: string
}

export function GoalProgress({ achieved, goal, min, month }: GoalProgressProps) {
  const progress = calcGoalProgress(achieved, goal)
  const status = getGoalStatus(achieved, goal, min)
  const remaining = Math.max(0, goal - achieved)

  const statusConfig = {
    exceeded: { label: 'Meta batida!', color: 'text-emerald-500', bg: 'bg-emerald-500', Icon: TrendingUp },
    'on-track': { label: 'No caminho', color: 'text-amber-500', bg: 'bg-amber-500', Icon: Target },
    below: { label: 'Abaixo da mínima', color: 'text-destructive', bg: 'bg-destructive', Icon: AlertTriangle },
  }[status]

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-foreground">Meta do Mês</h3>
        <span className="text-xs text-muted-foreground">{month}</span>
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        <statusConfig.Icon className={cn('w-3.5 h-3.5', statusConfig.color)} />
        <span className={cn('text-xs font-medium', statusConfig.color)}>{statusConfig.label}</span>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
          <span>Realizado</span>
          <span>{formatPercent(progress, 0)}</span>
        </div>
        <div className="h-2.5 bg-secondary rounded-full overflow-hidden relative">
          {/* Min marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-500/60 z-10"
            style={{ left: `${calcGoalProgress(min, goal)}%` }}
          />
          <div
            className={cn('h-full rounded-full transition-all duration-700', statusConfig.bg)}
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1.5">
          <span className="text-muted-foreground">Meta mín: {formatCurrency(min)}</span>
          <span className="text-muted-foreground">Meta: {formatCurrency(goal)}</span>
        </div>
      </div>

      {/* Numbers */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-secondary rounded-lg">
          <p className="text-xs text-muted-foreground">Realizado</p>
          <p className="text-lg font-bold text-foreground tabular-nums">{formatCurrency(achieved)}</p>
        </div>
        <div className="p-3 bg-secondary rounded-lg">
          <p className="text-xs text-muted-foreground">
            {status === 'exceeded' ? 'Superado em' : 'Falta'}
          </p>
          <p className={cn('text-lg font-bold tabular-nums', status === 'exceeded' ? 'text-emerald-500' : 'text-foreground')}>
            {formatCurrency(status === 'exceeded' ? achieved - goal : remaining)}
          </p>
        </div>
      </div>
    </div>
  )
}
