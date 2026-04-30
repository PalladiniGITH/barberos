import type { PlatformBarbershopDetailData } from '@/lib/platform-admin'

export function BarbershopMigrationPanel({
  migration,
  totals,
}: {
  migration: PlatformBarbershopDetailData['migration']
  totals: PlatformBarbershopDetailData['totals']
}) {
  return (
    <section
      id="migracao"
      className="platform-panel p-5"
    >
      <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Migracao e implantacao
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          Playbook manual para preparar tenants novos ou legados
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Esta fase do painel master prepara a migracao no-code: equipe, servicos, clientes e agenda futura podem ser
          alimentados direto aqui enquanto o importador CSV/API ainda esta em preparacao.
        </p>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_0.95fr]">
        <section className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-3">
            {migration.strategyCards.map((card) => (
              <article
                key={card.id}
                className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Estrategia
                </p>
                <h3 className="mt-2 text-base font-semibold text-foreground">{card.title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{card.description}</p>
              </article>
            ))}
          </div>

          <article className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Playbook operacional
                </p>
                <h3 className="mt-2 text-base font-semibold text-foreground">Documento guia da migracao</h3>
              </div>
              <code className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-3 py-2 text-xs text-muted-foreground">
                {migration.documentationPath}
              </code>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Profissionais</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{totals.professionals}</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Clientes</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{totals.customers}</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agenda futura</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{totals.upcomingAppointments}</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Usuarios</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{totals.users}</p>
              </div>
            </div>
          </article>
        </section>

        <section className="space-y-4">
          <article className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Importacao CSV
            </p>
            <h3 className="mt-2 text-base font-semibold text-foreground">Em preparacao</h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              O importador automatico ainda nao esta liberado, mas este painel ja mostra os campos esperados para
              estruturar planilhas vindas de Cash Barber ou outro sistema legado.
            </p>

            <div className="mt-4 space-y-3">
              {Object.entries(migration.csvPreview).map(([key, columns]) => (
                <div
                  key={key}
                  className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] p-3"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {key}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {columns.map((column) => (
                      <code
                        key={column}
                        className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[11px] text-muted-foreground"
                      >
                        {column}
                      </code>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[1.15rem] border border-dashed border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.02)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Proximos passos
            </p>
            <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              <p>1. Revisar equipe, servicos e categorias antes de qualquer carga automatica.</p>
              <p>2. Validar clientes principais e agenda futura pelo painel master.</p>
              <p>3. Definir o layout de CSV e o mapeamento para um futuro importador Cash Barber/API.</p>
            </div>
          </article>
        </section>
      </div>
    </section>
  )
}
