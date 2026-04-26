import { BrainCircuit, CalendarRange, CircleDollarSign, ScanSearch, Target } from 'lucide-react'

const steps = [
  {
    title: 'Lendo o mes',
    description: 'Receita, despesas e metas entrando na leitura automatica.',
    Icon: CalendarRange,
  },
  {
    title: 'Comparando com o periodo anterior',
    description: 'O ritmo atual esta sendo confrontado com a base mais proxima.',
    Icon: CircleDollarSign,
  },
  {
    title: 'Buscando gargalos de lucro',
    description: 'Ticket, margem, despesas e equipe sendo priorizados.',
    Icon: ScanSearch,
  },
  {
    title: 'Montando prioridades de acao',
    description: 'A leitura final esta sendo organizada para decisao rapida.',
    Icon: Target,
  },
] as const

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[rgba(255,255,255,0.06)] ${className}`} />
}

export default function InteligenciaLoading() {
  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <section className="dashboard-panel overflow-hidden p-0">
        <div className="dashboard-spotlight px-6 py-7 sm:px-7">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                <BrainCircuit className="h-4 w-4 text-primary" />
                <span>Analisando o negocio e preparando prioridades.</span>
              </div>

              <SkeletonBlock className="mt-6 h-11 w-full max-w-2xl bg-[rgba(255,255,255,0.08)]" />
              <SkeletonBlock className="mt-3 h-4 w-full max-w-3xl bg-[rgba(255,255,255,0.08)]" />
              <SkeletonBlock className="mt-2 h-4 w-full max-w-2xl bg-[rgba(255,255,255,0.08)]" />

              <div className="mt-6 rounded-[1.7rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] p-5">
                <p className="text-sm font-semibold text-foreground">Analise em andamento</p>
                <div className="mt-4 grid gap-3">
                  {steps.map((step, index) => (
                    <div key={step.title} className="flex items-start gap-3 rounded-[1.35rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] p-4">
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,255,255,0.06)] text-slate-100">
                        <step.Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            Etapa {index + 1}
                          </span>
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100">
                            Processando
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-white">{step.title}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-300">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[360px] xl:grid-cols-1">
              <SkeletonBlock className="h-28 w-full bg-[rgba(255,255,255,0.08)]" />
              <SkeletonBlock className="h-28 w-full bg-[rgba(255,255,255,0.08)]" />
              <SkeletonBlock className="h-28 w-full bg-[rgba(255,255,255,0.08)]" />
              <SkeletonBlock className="h-28 w-full bg-[rgba(255,255,255,0.08)]" />
            </div>
          </div>
        </div>

        <div className="grid xl:grid-cols-[minmax(0,1.45fr)_360px]">
          <div className="space-y-6 p-6 sm:p-7">
            <div className="premium-block">
              <SkeletonBlock className="h-7 w-64" />
              <SkeletonBlock className="mt-2 h-4 w-full max-w-xl" />
              <div className="mt-5 grid gap-4">
                <SkeletonBlock className="h-40 w-full" />
                <SkeletonBlock className="h-40 w-full" />
              </div>
            </div>

            <div className="premium-block">
              <SkeletonBlock className="h-7 w-56" />
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <SkeletonBlock className="h-44 w-full" />
                <SkeletonBlock className="h-44 w-full" />
              </div>
            </div>
          </div>

          <aside className="border-t border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(17,24,39,0.86),rgba(15,23,42,0.8))] p-6 sm:p-7 xl:border-l xl:border-t-0">
            <div className="space-y-5">
              <section className="premium-rail">
                <SkeletonBlock className="h-7 w-52" />
                <div className="mt-4 space-y-3">
                  <SkeletonBlock className="h-28 w-full" />
                  <SkeletonBlock className="h-28 w-full" />
                  <SkeletonBlock className="h-28 w-full" />
                </div>
              </section>

              <section className="premium-rail">
                <SkeletonBlock className="h-7 w-44" />
                <div className="mt-4 space-y-3">
                  <SkeletonBlock className="h-24 w-full" />
                  <SkeletonBlock className="h-24 w-full" />
                  <SkeletonBlock className="h-24 w-full" />
                </div>
              </section>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}
