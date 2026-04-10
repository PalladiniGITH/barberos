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
        panelClass: 'border-[rgba(251,113,133,0.18)]',
        accentClass: 'from-rose-500 to-rose-300',
        iconClass: 'bg-[rgba(251,113,133,0.12)] text-rose-200',
        badgeClass: 'border-[rgba(251,113,133,0.2)] bg-[rgba(251,113,133,0.1)] text-rose-200',
      }
    case 'warning':
      return {
        Icon: AlertTriangle,
        badge: 'Atencao',
        panelClass: 'border-[rgba(251,191,36,0.18)]',
        accentClass: 'from-amber-400 to-orange-300',
        iconClass: 'bg-[rgba(251,191,36,0.12)] text-amber-200',
        badgeClass: 'border-[rgba(251,191,36,0.2)] bg-[rgba(251,191,36,0.1)] text-amber-200',
      }
    case 'opportunity':
      return {
        Icon: Lightbulb,
        badge: 'Oportunidade',
        panelClass: 'border-[rgba(56,189,248,0.18)]',
        accentClass: 'from-sky-400 to-cyan-300',
        iconClass: 'bg-[rgba(56,189,248,0.12)] text-sky-200',
        badgeClass: 'border-[rgba(56,189,248,0.2)] bg-[rgba(56,189,248,0.1)] text-sky-200',
      }
    case 'positive':
    default:
      return {
        Icon: TrendingUp,
        badge: 'Bom sinal',
        panelClass: 'border-[rgba(52,211,153,0.18)]',
        accentClass: 'from-emerald-400 to-teal-300',
        iconClass: 'bg-[rgba(52,211,153,0.12)] text-emerald-200',
        badgeClass: 'border-[rgba(52,211,153,0.2)] bg-[rgba(52,211,153,0.1)] text-emerald-200',
      }
  }
}

export function IntelligenceModeBadge({ report }: { report: BusinessIntelligenceReport }) {
  const isFallbackLocal = report.runtime.userModeLabel === 'Analise local ativa no momento'
  const toneClass = report.mode === 'ai'
    ? 'border-[rgba(52,211,153,0.18)] bg-[rgba(15,23,42,0.82)] text-slate-100 shadow-[0_16px_34px_-22px_rgba(2,6,23,0.72)]'
    : isFallbackLocal
      ? 'border-[rgba(251,191,36,0.2)] bg-[rgba(251,191,36,0.1)] text-amber-200'
      : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground'

  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold', toneClass)}>
      <BrainCircuit className={cn('h-3.5 w-3.5', report.mode === 'ai' ? 'text-emerald-300' : 'text-primary')} />
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
        'relative isolate overflow-hidden rounded-[1.6rem] border p-5',
        'bg-[linear-gradient(180deg,rgba(30,41,59,0.88),rgba(15,23,42,0.74))]',
        'shadow-[0_24px_54px_-36px_rgba(2,6,23,0.84)]',
        meta.panelClass
      )}
    >
      <div className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r opacity-90', meta.accentClass)} />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn('mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl', meta.iconClass)}>
            <meta.Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]',
                meta.badgeClass
              )}
            >
              {meta.badge}
            </p>
            <h3 className="mt-3 text-base font-semibold text-foreground">{insight.title}</h3>
          </div>
        </div>

        {insight.metric && (
          <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {insight.metric.label}
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">{insight.metric.value}</p>
          </div>
        )}
      </div>

      <p className="mt-4 text-sm leading-6 text-muted-foreground">{insight.explanation}</p>

      {!compact && (
        <div className="mt-4 rounded-[1.35rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Acao recomendada
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">{insight.recommendedAction}</p>
        </div>
      )}

      <Link
        href={insight.href}
        className="mt-4 inline-flex items-center gap-1 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-[rgba(255,255,255,0.06)]"
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
      <div className="grid xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <div className="dashboard-spotlight p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="spotlight-chip">
              <CircleDollarSign className="h-3.5 w-3.5" />
              Analista do negocio
            </span>
            <IntelligenceModeBadge report={report} />
          </div>

          <div className="mt-8">
            <p className="spotlight-kicker">Resumo de alto nivel</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">{report.summary.headline}</h2>
            <p className="spotlight-copy max-w-sm">{report.summary.body}</p>
          </div>

          <div className="mt-8">
            <Link href="/inteligencia" className="premium-dark-button">
              Abrir analise completa
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="page-kicker">Prioridades do mes</p>
              <p className="mt-2 text-base font-semibold text-foreground">
                Os sinais mais relevantes para agir rapido.
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
