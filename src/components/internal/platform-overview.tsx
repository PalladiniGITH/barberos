import Link from 'next/link'
import { ArrowUpRight, Bot, Building2, MessageSquareMore, RadioTower, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { type PlatformOverviewData } from '@/lib/platform-admin'
import { BARBERSHOP_SUBSCRIPTION_STATUS_LABELS, formatCurrency, formatUsdCurrency } from '@/lib/utils'

function SummaryCard({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string
  value: string
  helper: string
  icon: typeof Building2
}) {
  return (
    <article className="executive-metric">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[1rem] border border-[rgba(124,58,237,0.24)] bg-[rgba(124,58,237,0.12)] text-primary">
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{helper}</p>
    </article>
  )
}

function StatusBadge({
  subscriptionStatus,
  operationalActive,
}: {
  subscriptionStatus: string
  operationalActive: boolean
}) {
  const tone = subscriptionStatus === 'ACTIVE'
    ? 'border-emerald-500/20 bg-emerald-500/12 text-emerald-200'
    : subscriptionStatus === 'TRIAL'
      ? 'border-violet-500/20 bg-violet-500/12 text-violet-200'
      : subscriptionStatus === 'PAST_DUE'
        ? 'border-amber-500/20 bg-amber-500/12 text-amber-200'
        : 'border-rose-500/20 bg-rose-500/12 text-rose-200'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${tone}`}>
        {BARBERSHOP_SUBSCRIPTION_STATUS_LABELS[subscriptionStatus] ?? subscriptionStatus}
      </span>
      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
        operationalActive
          ? 'border-sky-500/20 bg-sky-500/12 text-sky-200'
          : 'border-slate-500/20 bg-slate-500/12 text-slate-300'
      }`}>
        {operationalActive ? 'Operando' : 'Pausada'}
      </span>
    </div>
  )
}

export function PlatformOverview({
  data,
}: {
  data: PlatformOverviewData
}) {
  const usdBrlRateLabel = data.pricing.usdBrlRate !== null
    ? data.pricing.usdBrlRate.toFixed(2).replace('.', ',')
    : null
  const aiCostLabel = data.cards.aiEstimatedCostUsd !== null
    ? formatUsdCurrency(data.cards.aiEstimatedCostUsd)
    : 'Modelo sem preço'
  const aiCostHelper = data.cards.aiEstimatedCostUsd !== null
    ? data.cards.aiEstimatedCostBrl !== null && usdBrlRateLabel
      ? `~ ${formatCurrency(data.cards.aiEstimatedCostBrl)} com dólar a ${usdBrlRateLabel}.`
      : 'Estimativa em USD com base na tabela configurada no código.'
    : 'Quando um modelo não estiver na tabela, o custo estimado permanece indisponível.'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operação BarberEX"
        description="Gestão da plataforma, tenants, consumo de IA, WhatsApp, automações e saúde operacional em uma visão única."
      />

      {data.warnings.length > 0 && (
        <section className="rounded-[1.2rem] border border-amber-500/20 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
          <p className="font-semibold">Leitura parcial do painel master</p>
          <div className="mt-2 space-y-2">
            {data.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_340px]">
        <div className="dashboard-spotlight p-6 sm:p-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <h2 className="spotlight-title mt-0 text-[2.25rem] sm:text-[2.7rem]">
                Leitura executiva da plataforma em uma única camada.
              </h2>
              <p className="spotlight-copy mt-3 max-w-2xl">
                Tenants ativos, risco comercial, custo de IA, mensageria e saúde operacional agrupados para decidir rápido sem entrar tenant por tenant.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[320px] xl:grid-cols-1">
              <div className="surface-tier-low p-4">
                <p className="executive-label">Barbearias ativas</p>
                <p className="mt-3 text-[1.9rem] font-semibold tracking-tight text-foreground">{data.cards.activeBarbershops}</p>
                <p className="mt-2 text-sm text-muted-foreground">Tenants com operação ligada e status comercial em dia.</p>
              </div>
              <div className="surface-tier-low p-4">
                <p className="executive-label">Operação em risco</p>
                <p className="mt-3 text-[1.9rem] font-semibold tracking-tight text-foreground">
                  {data.cards.pastDueBarbershops + data.cards.blockedBarbershops}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">Soma de tenants em atraso ou bloqueados para priorização comercial.</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="hero-stat-card">
              <p className="executive-label">Trial</p>
              <p className="mt-3 text-[1.8rem] font-semibold tracking-tight text-foreground">{data.cards.trialBarbershops}</p>
              <p className="mt-2 text-sm text-muted-foreground">Contas em implantação ou avaliação inicial.</p>
            </div>
            <div className="hero-stat-card">
              <p className="executive-label">WhatsApp no mês</p>
              <p className="mt-3 text-[1.8rem] font-semibold tracking-tight text-foreground">{data.cards.whatsappMessagesThisMonth}</p>
              <p className="mt-2 text-sm text-muted-foreground">Mensagens processadas pela plataforma no período.</p>
            </div>
            <div className="hero-stat-card">
              <p className="executive-label">Agendamentos no mês</p>
              <p className="mt-3 text-[1.8rem] font-semibold tracking-tight text-foreground">{data.cards.appointmentsThisMonth}</p>
              <p className="mt-2 text-sm text-muted-foreground">Volume operacional somado entre tenants ativos.</p>
            </div>
            <div className="hero-stat-card">
              <p className="executive-label">Automações hoje</p>
              <p className="mt-3 text-[1.8rem] font-semibold tracking-tight text-foreground">{data.cards.automationsToday}</p>
              <p className="mt-2 text-sm text-muted-foreground">Execuções registradas na janela atual da plataforma.</p>
            </div>
          </div>
        </div>

        <aside className="premium-rail p-5">
          <div>
            <h3 className="text-[1.45rem] font-semibold tracking-tight text-foreground">Custos e saúde de IA</h3>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              Uma leitura curta do consumo atual para enxergar impacto financeiro, risco técnico e necessidade de intervenção.
            </p>
          </div>

          <div className="mt-5 space-y-3">
            <div className="surface-tier-low p-4">
              <p className="executive-label">Tokens IA no mês</p>
              <p className="mt-3 text-[1.85rem] font-semibold tracking-tight text-foreground">
                {new Intl.NumberFormat('pt-BR').format(data.cards.aiTokensThisMonth)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">Consumo agregado dos fluxos de IA instrumentados.</p>
            </div>
            <div className="surface-tier-low p-4">
              <p className="executive-label">Custo IA estimado</p>
              <p className="mt-3 text-[1.85rem] font-semibold tracking-tight text-foreground">{aiCostLabel}</p>
              <p className="mt-2 text-sm text-muted-foreground">{aiCostHelper}</p>
            </div>
            <div className="surface-tier-low p-4">
              <p className="executive-label">Erros recentes</p>
              <p className="mt-3 text-[1.85rem] font-semibold tracking-tight text-foreground">{data.cards.recentErrors}</p>
              <p className="mt-2 text-sm text-muted-foreground">Falhas novas de IA, mensageria ou automação que exigem fila de atenção.</p>
            </div>
          </div>
        </aside>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Barbearias em atraso"
          value={String(data.cards.pastDueBarbershops)}
          helper="Tenants que exigem acompanhamento comercial ou financeiro."
          icon={TriangleAlert}
        />
        <SummaryCard
          label="Barbearias bloqueadas"
          value={String(data.cards.blockedBarbershops)}
          helper="Contas pausadas ou bloqueadas que pedem retomada ou revisao."
          icon={TriangleAlert}
        />
        <SummaryCard
          label="Usuários"
          value={String(data.barbershops.reduce((total, item) => total + item.usersCount, 0))}
          helper="Total de contas autenticadas distribuído entre tenants filtrados."
          icon={Building2}
        />
        <SummaryCard
          label="Clientes"
          value={String(data.barbershops.reduce((total, item) => total + item.customersCount, 0))}
          helper="Base agregada de clientes dos tenants que entram nesta leitura."
          icon={Building2}
        />
        <SummaryCard
          label="Tenants sem custo"
          value={String(data.barbershops.filter((item) => item.aiEstimatedCostUsd === null && item.aiTokensThisMonth > 0).length)}
          helper="Contas com consumo de IA e modelo ainda sem preço configurado."
          icon={Bot}
        />
        <SummaryCard
          label="Tenants com última atividade"
          value={String(data.barbershops.filter((item) => item.lastActivityLabel !== null).length)}
          helper="Contas com sinal operacional recente dentro da janela carregada."
          icon={MessageSquareMore}
        />
      </section>

      <section
        id="barbershops"
        className="platform-panel table-shell p-4"
      >
        <div className="flex flex-col gap-4 border-b border-[rgba(255,255,255,0.06)] pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Leitura global das barbearias</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Busque por nome ou slug, filtre por status/plano e entre no detalhe operacional de cada conta.
            </p>
          </div>

          <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_220px_220px_auto]">
            <input
              type="search"
              name="search"
              defaultValue={data.filters.search}
              placeholder="Buscar por nome ou slug"
              className="auth-input min-w-0 rounded-[1rem] px-3.5 py-2.5 text-sm placeholder:text-muted-foreground"
            />
            <select
              name="status"
              defaultValue={data.filters.status}
              className="auth-input rounded-[1rem] px-3.5 py-2.5 text-sm"
            >
              <option value="">Todos os status</option>
              <option value="TRIAL">Trial</option>
              <option value="ACTIVE">Ativa</option>
              <option value="PAST_DUE">Em atraso</option>
              <option value="BLOCKED">Bloqueada</option>
              <option value="CANCELED">Cancelada</option>
            </select>
            <select
              name="plan"
              defaultValue={data.filters.plan}
              className="auth-input rounded-[1rem] px-3.5 py-2.5 text-sm"
            >
              <option value="">Todos os planos</option>
              {data.filters.availablePlans.map((plan) => (
                <option key={plan} value={plan}>
                  {plan}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="action-button-primary"
            >
              Aplicar
            </button>
          </form>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.06)] text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <th className="px-3 py-3">Barbearia</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Plano</th>
                <th className="px-3 py-3">Usuários</th>
                <th className="px-3 py-3">Clientes</th>
                <th className="px-3 py-3">Agenda mes</th>
                <th className="px-3 py-3">WhatsApp</th>
                <th className="px-3 py-3">IA</th>
                <th className="px-3 py-3">Última atividade</th>
                <th className="px-3 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data.barbershops.map((barbershop) => (
                <tr key={barbershop.id} className="border-b border-[rgba(255,255,255,0.04)] align-top">
                  <td className="px-3 py-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{barbershop.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">/{barbershop.slug}</p>
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <StatusBadge
                      subscriptionStatus={barbershop.subscriptionStatus}
                      operationalActive={barbershop.operationalActive}
                    />
                  </td>
                  <td className="px-3 py-4 text-sm text-foreground">
                    {barbershop.subscriptionPlan ?? 'Sem plano'}
                  </td>
                  <td className="px-3 py-4 text-sm text-foreground">{barbershop.usersCount}</td>
                  <td className="px-3 py-4 text-sm text-foreground">{barbershop.customersCount}</td>
                  <td className="px-3 py-4 text-sm text-foreground">{barbershop.appointmentsThisMonth}</td>
                  <td className="px-3 py-4 text-sm text-foreground">{barbershop.whatsappMessagesThisMonth}</td>
                  <td className="px-3 py-4">
                    <p className="text-sm font-semibold text-foreground">
                      {new Intl.NumberFormat('pt-BR').format(barbershop.aiTokensThisMonth)} tokens
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {barbershop.aiEstimatedCostUsd !== null
                        ? formatUsdCurrency(barbershop.aiEstimatedCostUsd)
                        : barbershop.aiUnpricedRequests > 0
                          ? 'Modelo sem preço configurado'
                          : 'Sem custo estimado'}
                    </p>
                    {barbershop.aiEstimatedCostBrl !== null && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        ~ {formatCurrency(barbershop.aiEstimatedCostBrl)}
                      </p>
                    )}
                    {barbershop.aiUnpricedRequests > 0 && (
                      <p className="mt-1 text-[11px] text-amber-200">
                        {barbershop.aiUnpricedRequests} registro{barbershop.aiUnpricedRequests > 1 ? 's' : ''} com modelo sem preço
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-4 text-sm text-muted-foreground">
                    {barbershop.lastActivityLabel ?? 'Sem atividade recente'}
                  </td>
                  <td className="px-3 py-4 text-right">
                    <Link
                      href={`/internal/barbershops/${barbershop.id}`}
                      className="inline-flex items-center gap-2 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)]"
                    >
                      Abrir
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.barbershops.length === 0 && (
            <div className="rounded-[1rem] border border-dashed border-[rgba(255,255,255,0.08)] px-4 py-10 text-center text-sm text-muted-foreground">
              Nenhuma barbearia encontrada com os filtros atuais.
            </div>
          )}
        </div>

        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Custo estimado com base na tabela configurada no código ({data.pricing.version}).
          {usdBrlRateLabel ? ` Conversão em BRL usando dólar a ${usdBrlRateLabel}.` : ' Conversão em BRL indisponível sem OPENAI_USD_BRL_RATE.'}
        </p>
      </section>

      <section className="platform-panel p-4">
        <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Sinais que merecem atenção</h2>
        </div>

        <div className="mt-4 space-y-3">
          {data.recentErrors.length === 0 ? (
            <div className="rounded-[1rem] border border-dashed border-[rgba(255,255,255,0.08)] px-4 py-8 text-sm text-muted-foreground">
              Nenhum erro recente relevante foi registrado nesta janela.
            </div>
          ) : (
            data.recentErrors.map((item) => (
              <article
                key={item.id}
                className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-rose-500/20 bg-rose-500/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-200">
                    {item.kind}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{item.barbershopName}</span>
                  <span className="text-xs text-muted-foreground">{item.createdAtLabel}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.message}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
