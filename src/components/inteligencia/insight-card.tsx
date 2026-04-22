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
        panelClass: 'border-[rgba(244,63,94,0.14)]',
        iconClass: 'bg-[rgba(244,63,94,0.14)] text-rose-100',
        badgeClass: 'border-[rgba(244,63,94,0.18)] bg-[rgba(244,63,94,0.12)] text-rose-100',
      }
    case 'warning':
      return {
        Icon: AlertTriangle,
        badge: 'Atencao',
        panelClass: 'border-[rgba(245,158,11,0.14)]',
        iconClass: 'bg-[rgba(245,158,11,0.14)] text-amber-100',
        badgeClass: 'border-[rgba(245,158,11,0.18)] bg-[rgba(245,158,11,0.12)] text-amber-100',
      }
    case 'opportunity':
      return {
        Icon: Lightbulb,
        badge: 'Oportunidade',
        panelClass: 'border-[rgba(91,33,182,0.12)]',
        iconClass: 'bg-[rgba(91,33,182,0.14)] text-violet-100',
        badgeClass: 'border-[rgba(91,33,182,0.18)] bg-[rgba(91,33,182,0.12)] text-violet-100',
      }
    case 'positive':
    default:
      return {
        Icon: TrendingUp,
        badge: 'Bom sinal',
        panelClass: 'border-[rgba(16,185,129,0.14)]',
        iconClass: 'bg-[rgba(16,185,129,0.14)] text-emerald-100',
        badgeClass: 'border-[rgba(16,185,129,0.18)] bg-[rgba(16,185,129,0.12)] text-emerald-100',
      }
  }
}

export function IntelligenceModeBadge({ report }: { report: BusinessIntelligenceReport }) {
  const isFallbackLocal = report.runtime.userModeLabel === 'Analise local ativa no momento'
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
        'surface-inverse relative isolate overflow-hidden rounded-[1.45rem] border bg-[linear-gradient(180deg,rgba(28,32,48,0.98),rgba(15,17,21,0.96))] p-5 shadow-[0_24px_44px_-34px_rgba(2,6,23,0.72)]',
        meta.panelClass
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn('mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl', meta.iconClass)}>
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
          <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-right shadow-[0_14px_26px_-24px_rgba(2,6,23,0.56)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {insight.metric.label}
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">{insight.metric.value}</p>
          </div>
        )}
      </div>

      <p className="mt-4 text-sm leading-7 text-muted-foreground">{insight.explanation}</p>

      {!compact && (
        <div className="mt-4 rounded-[1.2rem] border border-[rgba(58,47,86,0.08)] bg-[rgba(91,33,182,0.04)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Acao recomendada
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">{insight.recommendedAction}</p>
        </div>
      )}

      <Link
        href={insight.href}
        className="mt-5 inline-flex items-center gap-1 rounded-full border border-[rgba(91,33,182,0.08)] bg-[rgba(91,33,182,0.04)] px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-[rgba(91,33,182,0.08)]"
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
      <div className="grid xl:grid-cols-[minmax(300px,390px)_minmax(0,1fr)]">
        <div className="premium-rail p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="surface-chip">
              <CircleDollarSign className="h-3.5 w-3.5" />
              Analista do negocio
            </span>
            <IntelligenceModeBadge report={report} />
          </div>

          <div className="mt-8">
            <p className="page-kicker">Resumo de alto nivel</p>
            <h2 className="mt-3 text-[1.9rem] font-semibold tracking-tight text-foreground">{report.summary.headline}</h2>
            <p className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">{report.summary.body}</p>
          </div>

          <div className="mt-8">
            <Link href="/inteligencia" className="premium-dark-button">
              Abrir analise completa
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="page-kicker">Prioridades do mes</p>
              <p className="mt-2 text-base font-semibold text-foreground">
                Os sinais mais relevantes para agir sem perder tempo.
              </p>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} compact />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
