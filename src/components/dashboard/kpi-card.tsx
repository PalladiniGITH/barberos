import { cn, formatCurrency } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react'

interface KpiCardProps {
  title: string
  value: string | number
  isCurrency?: boolean
  change?: number      // % variation vs last month
  icon: LucideIcon
  iconColor?: string
  description?: string
  className?: string
}

export function KpiCard({
  title, value, isCurrency = false, change, icon: Icon, iconColor = 'text-primary', description, className,
}: KpiCardProps) {
  const displayValue = isCurrency
    ? formatCurrency(typeof value === 'number' ? value : parseFloat(String(value)))
    : value

  const trendPositive = change !== undefined && change > 0
  const trendNegative = change !== undefined && change < 0

  return (
    <div className={cn('kpi-card', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{title}</p>
          <p className="mt-2 text-[2.05rem] font-semibold leading-none text-foreground tabular-nums">{displayValue}</p>
        </div>
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-[0.9rem] bg-secondary', iconColor.replace('text-', 'bg-').replace('500', '500/10').replace('400', '400/10'))}>
          <Icon className={cn('h-4.5 w-4.5', iconColor)} />
        </div>
      </div>

      {(change !== undefined || description) && (
        <div className="mt-2.5 flex items-center gap-1.5">
          {change !== undefined && (
            <span className={cn(
              'flex items-center gap-0.5 text-xs font-medium',
              trendPositive ? 'text-emerald-500' : trendNegative ? 'text-destructive' : 'text-muted-foreground'
            )}>
              {trendPositive ? <TrendingUp className="w-3 h-3" /> : trendNegative ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
              {change > 0 ? '+' : ''}{change.toFixed(1)}%
            </span>
          )}
          {description && (
            <span className="text-[12px] text-muted-foreground">{description}</span>
          )}
        </div>
      )}
    </div>
  )
}
