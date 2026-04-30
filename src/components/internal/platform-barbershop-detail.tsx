import Link from 'next/link'
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle2,
  MessageSquareMore,
  RadioTower,
  Store,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { BarbershopCustomersManager } from '@/components/internal/barbershop-customers-manager'
import { BarbershopEditor } from '@/components/internal/barbershop-editor'
import { BarbershopMigrationPanel } from '@/components/internal/barbershop-migration-panel'
import { BarbershopOnboardingChecklist } from '@/components/internal/barbershop-onboarding-checklist'
import { BarbershopProfessionalsManager } from '@/components/internal/barbershop-professionals-manager'
import { BarbershopScheduleManager } from '@/components/internal/barbershop-schedule-manager'
import { BarbershopServicesManager } from '@/components/internal/barbershop-services-manager'
import { type PlatformBarbershopDetailData } from '@/lib/platform-admin'
import {
  BARBERSHOP_SUBSCRIPTION_STATUS_LABELS,
  ROLE_LABELS,
  formatCurrency,
  formatUsdCurrency,
} from '@/lib/utils'
import { formatDateInTimezone, formatDateTimeInTimezone } from '@/lib/timezone'

function statusPillClasses(isActive: boolean) {
  return isActive
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    : 'border-slate-500/20 bg-slate-500/10 text-slate-300'
}

function OverviewMetric({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string
  value: string
  helper: string
  icon: typeof Users
}) {
  return (
    <article className="executive-metric min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
          <p className="mt-3 break-words text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-[rgba(124,58,237,0.24)] bg-[rgba(124,58,237,0.12)] text-primary">
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{helper}</p>
    </article>
  )
}

function AnchorNav({
  items,
}: {
  items: Array<{ id: string; label: string }>
}) {
  return (
    <nav className="platform-panel p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        Navegacao operacional
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground"
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  )
}

export function PlatformBarbershopDetail({
  data,
}: {
  data: PlatformBarbershopDetailData
}) {
  const usdBrlRateLabel = data.pricing.usdBrlRate !== null
    ? data.pricing.usdBrlRate.toFixed(2).replace('.', ',')
    : null
  const aiCostLabel = data.totals.aiEstimatedCostUsd !== null
    ? formatUsdCurrency(data.totals.aiEstimatedCostUsd)
    : 'Modelo sem preco'
  const aiCostHelper = data.totals.aiEstimatedCostUsd !== null
    ? data.totals.aiEstimatedCostBrl !== null && usdBrlRateLabel
      ? `~ ${formatCurrency(data.totals.aiEstimatedCostBrl)} com dolar a ${usdBrlRateLabel}.`
      : 'Estimativa em USD calculada pelo ledger de uso.'
    : 'Modelos sem preco configurado permanecem sem custo estimado.'

  const sectionItems = [
    { id: 'visao-geral', label: 'Visao geral' },
    { id: 'checklist', label: 'Checklist' },
    { id: 'dados', label: 'Dados da barbearia' },
    { id: 'profissionais', label: 'Profissionais' },
    { id: 'servicos', label: 'Servicos' },
    { id: 'horarios', label: 'Horarios' },
    { id: 'clientes', label: 'Clientes' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'migracao', label: 'Migracao' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.barbershop.name}
        description="Painel master operacional para implantar, revisar e migrar este tenant com validacao server-side."
        action={(
          <Link href="/internal" className="action-button">
            <ArrowLeft className="h-4 w-4" />
            Voltar ao painel master
          </Link>
        )}
      />

      {data.warnings.length > 0 && (
        <section className="rounded-[1.2rem] border border-amber-500/20 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
          <p className="font-semibold">Leitura parcial deste tenant</p>
          <div className="mt-2 space-y-2">
            {data.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </section>
      )}

      <section id="visao-geral" className="platform-panel p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-200">
                {BARBERSHOP_SUBSCRIPTION_STATUS_LABELS[data.barbershop.subscriptionStatus] ?? data.barbershop.subscriptionStatus}
              </span>
              <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">
                {data.barbershop.subscriptionPlan ?? 'Sem plano'}
              </span>
              <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {data.barbershop.slug}
              </span>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusPillClasses(data.barbershop.operationalActive)}`}>
                {data.barbershop.operationalActive ? 'Operacao ativa' : 'Operacao pausada'}
              </span>
            </div>

            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
              Implantacao operacional de {data.barbershop.name}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Use este detalhe para preparar o tenant alvo sem mexer direto no banco: dados gerais, catalogo,
              equipe, disponibilidade, clientes e contexto de migracao ficam todos centralizados aqui.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[360px]">
            <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Timezone</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{data.barbershop.timezone}</p>
            </div>
            <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">WhatsApp</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{data.integrations.whatsappStatusLabel}</p>
            </div>
            <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Criada em</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{data.barbershop.createdAtLabel}</p>
            </div>
            <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Agenda futura</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{data.totals.upcomingAppointments}</p>
            </div>
          </div>
        </div>

        {data.barbershop.blockedAt && (
          <div className="mt-4 rounded-[1rem] border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <p className="font-semibold">
              Conta bloqueada em {formatDateTimeInTimezone(data.barbershop.blockedAt, data.barbershop.timezone)}
            </p>
            <p className="mt-1 text-rose-200/90">{data.barbershop.blockedReason ?? 'Sem motivo registrado.'}</p>
          </div>
        )}
      </section>

      <AnchorNav items={sectionItems} />

      <BarbershopOnboardingChecklist checklist={data.checklist} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewMetric label="Usuarios" value={String(data.totals.users)} helper="Contas autenticadas ligadas a este tenant." icon={Users} />
        <OverviewMetric label="Profissionais" value={String(data.totals.professionals)} helper="Equipe operacional preparada para agenda e atendimento." icon={Users} />
        <OverviewMetric label="Clientes" value={String(data.totals.customers)} helper="Base manual ou migrada disponivel para operacao." icon={Store} />
        <OverviewMetric label="Agenda no mes" value={String(data.totals.appointmentsThisMonth)} helper="Agendamentos contabilizados no mes corrente." icon={CalendarClock} />
        <OverviewMetric label="WhatsApp no mes" value={String(data.totals.whatsappMessagesThisMonth)} helper="Mensagens registradas para este tenant." icon={MessageSquareMore} />
        <OverviewMetric label="Custo IA" value={aiCostLabel} helper={aiCostHelper} icon={Bot} />
        <OverviewMetric label="Automacoes" value={String(data.totals.automationsThisMonth)} helper="Execucoes de campanhas e rotinas recentes." icon={RadioTower} />
        <OverviewMetric label="Checklist pronto" value={`${data.checklist.summary.complete}/${data.checklist.summary.total}`} helper="Itens ja completos para piloto ou operacao assistida." icon={CheckCircle2} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="platform-panel table-shell p-4">
          <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Equipe e acessos</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Usuarios do tenant</h2>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.06)] text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-3 py-3">Usuario</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Ativo</th>
                  <th className="px-3 py-3">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id} className="border-b border-[rgba(255,255,255,0.04)]">
                    <td className="px-3 py-4">
                      <p className="text-sm font-semibold text-foreground">{user.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
                    </td>
                    <td className="px-3 py-4 text-sm text-foreground">
                      {ROLE_LABELS[user.platformRole !== 'NONE' ? user.platformRole : user.role] ?? user.role}
                    </td>
                    <td className="px-3 py-4 text-sm text-muted-foreground">{user.active ? 'Sim' : 'Nao'}</td>
                    <td className="px-3 py-4 text-sm text-muted-foreground">
                      {formatDateTimeInTimezone(user.createdAt, data.barbershop.timezone)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <section className="platform-panel p-4">
            <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Saude da operacao</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Integracoes e sinais</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                <p className="font-semibold text-foreground">WhatsApp / Evolution</p>
                <p className="mt-1">
                  {data.integrations.whatsappLastEventAt
                    ? `Ultimo evento em ${formatDateTimeInTimezone(data.integrations.whatsappLastEventAt, data.barbershop.timezone)}.`
                    : 'Sem eventos recentes registrados.'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Instance: {data.integrations.evolutionInstanceName ?? 'nao configurada'}
                </p>
              </div>
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                <p className="font-semibold text-foreground">Campanhas automaticas</p>
                <p className="mt-1">
                  {data.integrations.automationActiveConfigs} configuracoes ativas
                  {data.integrations.automationLastRunAt
                    ? ` - ultima execucao em ${formatDateTimeInTimezone(data.integrations.automationLastRunAt, data.barbershop.timezone)}`
                    : ' - sem execucao recente'}
                </p>
              </div>
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                <p className="font-semibold text-foreground">IA BarberEX</p>
                <p className="mt-1">
                  {data.integrations.aiLastUsageAt
                    ? `Ultimo uso em ${formatDateTimeInTimezone(data.integrations.aiLastUsageAt, data.barbershop.timezone)}`
                    : 'Sem uso recente de IA registrado neste tenant.'}
                </p>
              </div>
            </div>
          </section>

          <section className="platform-panel p-4">
            <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Contexto do tenant</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Dados basicos carregados</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                <p className="font-semibold text-foreground">Endereco</p>
                <p className="mt-1">{data.barbershop.address ?? 'Nao informado'}</p>
              </div>
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                <p className="font-semibold text-foreground">Contato</p>
                <p className="mt-1">{data.barbershop.phone ?? 'Sem telefone'}</p>
                <p className="mt-1">{data.barbershop.email ?? 'Sem email'}</p>
              </div>
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                <p className="font-semibold text-foreground">Trial e cobranca</p>
                <p className="mt-1">
                  {data.barbershop.trialEndsAt
                    ? `Trial ate ${formatDateInTimezone(data.barbershop.trialEndsAt, data.barbershop.timezone)}`
                    : 'Sem trial ativo'}
                </p>
                <p className="mt-1">{data.barbershop.billingEmail ?? 'Sem billing email'}</p>
              </div>
            </div>
          </section>
        </div>
      </section>

      <BarbershopEditor barbershop={data.barbershop} integrations={data.integrations} />

      <BarbershopProfessionalsManager
        barbershopId={data.barbershop.id}
        professionals={data.professionals}
      />

      <BarbershopServicesManager
        barbershopId={data.barbershop.id}
        services={data.services}
        categories={data.serviceCategories}
      />

      <BarbershopScheduleManager
        barbershopId={data.barbershop.id}
        timezone={data.barbershop.timezone}
        schedule={data.schedule}
        professionals={data.professionals}
      />

      <BarbershopCustomersManager
        barbershopId={data.barbershop.id}
        customers={data.customers}
        professionals={data.professionals}
      />

      <BarbershopMigrationPanel migration={data.migration} totals={data.totals} />

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="platform-panel p-4">
          <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Uso de IA</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Consumo por fonte</h2>
          </div>
          <div className="mt-4 space-y-3">
            {data.aiUsageBySource.map((item) => (
              <article key={item.source} className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.source}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.requests} registros - {new Intl.NumberFormat('pt-BR').format(item.totalTokens)} tokens
                      {item.cachedInputTokens > 0 ? ` - ${new Intl.NumberFormat('pt-BR').format(item.cachedInputTokens)} em cache` : ''}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>
                      {item.estimatedCostUsd !== null
                        ? formatUsdCurrency(item.estimatedCostUsd)
                        : item.unpricedRequests > 0
                          ? 'Modelo sem preco configurado'
                          : 'Sem custo estimado'}
                    </p>
                    {item.estimatedCostBrl !== null && <p>~ {formatCurrency(item.estimatedCostBrl)}</p>}
                    <p>{item.lastUsedAt ? formatDateTimeInTimezone(item.lastUsedAt, data.barbershop.timezone) : 'Sem uso recente'}</p>
                  </div>
                </div>
                {item.unpricedRequests > 0 && (
                  <p className="mt-2 text-[11px] text-amber-200">
                    {item.unpricedRequests} registro{item.unpricedRequests > 1 ? 's' : ''} com modelo sem preco configurado.
                  </p>
                )}
              </article>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Custo estimado com base na tabela configurada no codigo ({data.pricing.version}).
            {usdBrlRateLabel ? ` Conversao em BRL usando dolar a ${usdBrlRateLabel}.` : ' Conversao em BRL indisponivel sem OPENAI_USD_BRL_RATE.'}
          </p>
        </div>

        <div className="space-y-6">
          <section className="platform-panel p-4">
            <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Atividade recente</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">IA e automacoes</h2>
            </div>
            <div className="mt-4 space-y-3">
              {data.recentUsage.map((item) => (
                <article key={item.id} className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.source}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.model ?? 'modelo nao informado'} - {item.totalTokens ? `${new Intl.NumberFormat('pt-BR').format(item.totalTokens)} tokens` : 'sem tokens'}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{item.estimatedCostUsd !== null ? formatUsdCurrency(item.estimatedCostUsd) : item.model ? 'Modelo sem preco' : item.status}</p>
                      <p>{formatDateTimeInTimezone(item.createdAt, data.barbershop.timezone)}</p>
                    </div>
                  </div>
                  {item.pricingVersion && (
                    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">Pricing {item.pricingVersion}</p>
                  )}
                  {item.errorMessage && (
                    <p className="mt-2 text-xs leading-5 text-rose-200">{item.errorMessage}</p>
                  )}
                </article>
              ))}

              {data.recentAutomations.map((item) => (
                <article key={item.id} className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Campanha {item.localDateIso}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.status} - inicio {formatDateTimeInTimezone(item.startedAt, data.barbershop.timezone)}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{item.completedAt ? formatDateTimeInTimezone(item.completedAt, data.barbershop.timezone) : 'Em andamento'}</p>
                    </div>
                  </div>
                  {item.lastError && (
                    <p className="mt-2 text-xs leading-5 text-rose-200">{item.lastError}</p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="platform-panel p-4">
            <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Erros recentes</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Fila de atencao</h2>
            </div>
            <div className="mt-4 space-y-3">
              {data.recentErrors.length === 0 ? (
                <div className="rounded-[1rem] border border-dashed border-[rgba(255,255,255,0.08)] px-4 py-8 text-sm text-muted-foreground">
                  Nenhum erro relevante foi registrado para esta conta na janela atual.
                </div>
              ) : (
                data.recentErrors.map((item) => (
                  <article key={item.id} className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-200">
                        {item.kind}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTimeInTimezone(item.createdAt, data.barbershop.timezone)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.message}</p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
