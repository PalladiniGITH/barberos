import Link from 'next/link'
import type { BusinessInsight, BusinessIntelligenceReport } from '@/lib/business-insights'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  ArrowUpRight,
  BrainCircuit,
  CircleDollarSign,
  Lightbulb,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react'

function getSeverityMeta(severity: BusinessInsight['severity']) {
  switch (severity) {
    case 'critical':
      return {
        Icon: ShieldAlert,
        badge: 'Prioridade alta',
        panelClass: 'border-[rgba(244,63,94,0.1)]',
        iconClass: 'bg-[rgba(244,63,94,0.14)] text-rose-100',
        badgeClass: 'border-[rgba(244,63,94,0.14)] bg-[rgba(244,63,94,0.08)] text-rose-100',
      }
    case 'warning':
      return {
        Icon: AlertTriangle,
        badge: 'Atencao',
        panelClass: 'border-[rgba(245,158,11,0.1)]',
        iconClass: 'bg-[rgba(245,158,11,0.14)] text-amber-100',
        badgeClass: 'border-[rgba(245,158,11,0.14)] bg-[rgba(245,158,11,0.08)] text-amber-100',
      }
    case 'opportunity':
      return {
        Icon: Lightbulb,
        badge: 'Oportunidade',
        panelClass: 'border-[rgba(91,33,182,0.09)]',
        iconClass: 'bg-[rgba(91,33,182,0.14)] text-violet-100',
        badgeClass: 'border-[rgba(91,33,182,0.14)] bg-[rgba(91,33,182,0.08)] text-violet-100',
      }
    case 'positive':
    default:
      return {
        Icon: TrendingUp,
        badge: 'Bom sinal',
        panelClass: 'border-[rgba(16,185,129,0.1)]',
        iconClass: 'bg-[rgba(16,185,129,0.14)] text-emerald-100',
        badgeClass: 'border-[rgba(16,185,129,0.14)] bg-[rgba(16,185,129,0.08)] text-emerald-100',
      }
  }
}

export function IntelligenceModeBadge({ report }: { report: BusinessIntelligenceReport }) {
  const isFallbackLocal = report.runtime.statusNote === 'Análise automática temporariamente indisponível'
  const toneClass = report.mode === 'ai'
    ? 'border-[rgba(91,33,182,0.18)] bg-[rgba(91,33,182,0.12)] text-violet-100'
    : isFallbackLocal
      ? 'border-[rgba(245,158,11,0.18)] bg-[rgba(245,158,11,0.12)] text-amber-100'
      : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-slate-300'

  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold', toneClass)}>
      <BrainCircuit className={cn('h-3.5 w-3.5', report.mode === 'ai' ? 'text-violet-100' : 'text-slate-300')} />
      {report.runtime.userModeLabel}
    </span>
  )
}

export function IntelligenceRuntimeDetails({
  report,
  align = 'left',
}: {
  report: BusinessIntelligenceReport
  align?: 'left' | 'right'
}) {
  const items = [
    report.runtime.statusNote,
    report.runtime.updatedAtLabel,
    report.runtime.nextRefreshLabel,
  ].filter(Boolean)

  if (items.length === 0) {
    return null
  }

  return (
    <div className={cn('space-y-1 text-xs text-muted-foreground', align === 'right' && 'text-right')}>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </div>
  )
}

export function InsightCard({
  insight,
  compact = false,
}: {
  insight: BusinessInsight
  compact?: boolean
}) {
  const meta = getSeverityMeta(insight.severity)

  return (
    <article
      className={cn(
        'surface-inverse relative isolate overflow-hidden rounded-[1.45rem] border bg-[linear-gradient(180deg,rgba(25,27,32,0.9),rgba(19,20,24,0.94))] p-5 shadow-[0_18px_32px_-34px_rgba(2,6,23,0.48)]',
        meta.panelClass
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn('mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.03)]', meta.iconClass)}>
            <meta.Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]', meta.badgeClass)}>
              {meta.badge}
            </p>
            <h3 className="mt-3 text-base font-semibold leading-6 text-foreground">{insight.title}</h3>
          </div>
        </div>

        {insight.metric && (
          <div className="tonal-note px-3 py-2 text-right shadow-none">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {insight.metric.label}
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">{insight.metric.value}</p>
          </div>
        )}
      </div>

      <p className="mt-4 text-sm leading-7 text-muted-foreground">{insight.explanation}</p>

      {!compact && (
        <div className="tonal-note mt-4 border-[rgba(255,255,255,0.02)] px-4 py-3.5">
          <p className="text-sm font-semibold text-foreground">Proximo passo</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{insight.recommendedAction}</p>
        </div>
      )}

      <Link
        href={insight.href}
        className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary transition-colors hover:text-violet-200"
      >
        Abrir pagina relacionada
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </article>
  )
}

export function DashboardInsightsPreview({ report }: { report: BusinessIntelligenceReport }) {
  const insights = report.prioritized.slice(0, 3)

  return (
    <section className="dashboard-panel overflow-hidden p-0">
      <div className="flex h-full flex-col">
        <div className="premium-rail border-b border-[rgba(255,255,255,0.03)] p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <CircleDollarSign className="h-4 w-4 text-primary" />
              BarberEX IA
            </div>
            <IntelligenceModeBadge report={report} />
          </div>
          <div className="mt-3">
            <IntelligenceRuntimeDetails report={report} />
          </div>

          <div className="mt-6">
            <h2 className="text-[1.55rem] font-semibold tracking-tight text-foreground">{report.summary.headline}</h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">{report.summary.body}</p>
          </div>

          <div className="mt-6">
            <Link href="/inteligencia" className="premium-dark-button">
              Abrir analise completa
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="p-5 pt-4">
          <div className="mb-4">
            <p className="text-sm font-semibold text-foreground">
              Os sinais mais relevantes para agir sem perder tempo.
            </p>
          </div>

          <div className="space-y-3">
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} compact />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
