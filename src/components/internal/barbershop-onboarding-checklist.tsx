import type { PlatformBarbershopDetailData, PlatformChecklistStatus } from '@/lib/platform-admin'

function statusClasses(status: PlatformChecklistStatus) {
  if (status === 'complete') {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
  }

  if (status === 'attention') {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-200'
  }

  return 'border-slate-500/20 bg-slate-500/10 text-slate-200'
}

function statusLabel(status: PlatformChecklistStatus) {
  if (status === 'complete') {
    return 'Completo'
  }

  if (status === 'attention') {
    return 'Atencao'
  }

  return 'Pendente'
}

export function BarbershopOnboardingChecklist({
  checklist,
}: {
  checklist: PlatformBarbershopDetailData['checklist']
}) {
  return (
    <section
      id="checklist"
      className="platform-panel p-5"
    >
      <div className="flex flex-col gap-4 border-b border-[rgba(255,255,255,0.06)] pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Checklist de implantacao
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
            O que ainda falta para colocar este tenant em operacao
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            O painel calcula o que ja esta pronto com base em dados reais do tenant e sinaliza onde ainda falta
            preparacao operacional.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[1rem] border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">Completo</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{checklist.summary.complete}</p>
          </div>
          <div className="rounded-[1rem] border border-amber-500/20 bg-amber-500/10 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">Atencao</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{checklist.summary.attention}</p>
          </div>
          <div className="rounded-[1rem] border border-slate-500/20 bg-slate-500/10 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200">Pendente</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{checklist.summary.pending}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {checklist.groups.map((group) => (
          <article
            key={group.id}
            className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
          >
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">{group.title}</h3>
            <div className="mt-4 space-y-3">
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${statusClasses(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
