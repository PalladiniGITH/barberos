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
    : 'Modelo sem preco'
  const aiCostHelper = data.cards.aiEstimatedCostUsd !== null
    ? data.cards.aiEstimatedCostBrl !== null && usdBrlRateLabel
      ? `~ ${formatCurrency(data.cards.aiEstimatedCostBrl)} com dolar a ${usdBrlRateLabel}.`
      : 'Estimativa em USD com base na tabela configurada em codigo.'
    : 'Quando um modelo nao estiver na tabela, o custo estimado permanece indisponivel.'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operacao BarberEX"
        description="Gestao da plataforma, tenants, consumo de IA, WhatsApp, automacoes e saude operacional em uma visao unica."
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Barbearias ativas"
          value={String(data.cards.activeBarbershops)}
          helper="Tenants com operacao ativa e status comercial em dia."
          icon={Building2}
        />
        <SummaryCard
          label="Barbearias em trial"
          value={String(data.cards.trialBarbershops)}
          helper="Contas ainda em fase de avaliacao ou implantacao inicial."
          icon={Building2}
        />
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
          label="Agendamentos no mes"
          value={String(data.cards.appointmentsThisMonth)}
          helper="Volume global de agenda considerando todos os tenants ativos."
          icon={RadioTower}
        />
        <SummaryCard
          label="WhatsApp no mes"
          value={String(data.cards.whatsappMessagesThisMonth)}
          helper="Mensagens processadas pela plataforma no periodo corrente."
          icon={MessageSquareMore}
        />
        <SummaryCard
          label="Tokens IA no mes"
          value={new Intl.NumberFormat('pt-BR').format(data.cards.aiTokensThisMonth)}
          helper="Consumo agregado de IA registrado pelos fluxos instrumentados."
          icon={Bot}
        />
        <SummaryCard
          label="Custo IA estimado"
          value={aiCostLabel}
          helper={aiCostHelper}
          icon={Bot}
        />
        <SummaryCard
          label="Automacoes hoje"
          value={String(data.cards.automationsToday)}
          helper="Execucoes de rotina registradas no dia atual da plataforma."
          icon={RadioTower}
        />
        <SummaryCard
          label="Erros recentes"
          value={String(data.cards.recentErrors)}
          helper="Falhas recentes de IA, automacao ou mensageria que merecem atencao."
          icon={TriangleAlert}
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
                <th className="px-3 py-3">Usuarios</th>
                <th className="px-3 py-3">Clientes</th>
                <th className="px-3 py-3">Agenda mes</th>
                <th className="px-3 py-3">WhatsApp</th>
                <th className="px-3 py-3">IA</th>
                <th className="px-3 py-3">Ultima atividade</th>
                <th className="px-3 py-3 text-right">Acoes</th>
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
                          ? 'Modelo sem preco configurado'
                          : 'Sem custo estimado'}
                    </p>
                    {barbershop.aiEstimatedCostBrl !== null && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        ~ {formatCurrency(barbershop.aiEstimatedCostBrl)}
                      </p>
                    )}
                    {barbershop.aiUnpricedRequests > 0 && (
                      <p className="mt-1 text-[11px] text-amber-200">
                        {barbershop.aiUnpricedRequests} registro{barbershop.aiUnpricedRequests > 1 ? 's' : ''} com modelo sem preco
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
          Custo estimado com base na tabela configurada em codigo ({data.pricing.version}).
          {usdBrlRateLabel ? ` Conversao em BRL usando dolar a ${usdBrlRateLabel}.` : ' Conversao em BRL indisponivel sem OPENAI_USD_BRL_RATE.'}
        </p>
      </section>

      <section className="platform-panel p-4">
        <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Sinais que merecem atencao</h2>
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
