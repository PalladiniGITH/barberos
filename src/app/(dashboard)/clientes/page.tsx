import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import {
  ArrowUpRight,
  BadgeDollarSign,
  CalendarRange,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { resolvePeriod } from '@/lib/period'
import {
  getCustomersDirectoryData,
  resolveCustomerDirectoryFilters,
  type CustomerFrequencyFilter,
  type CustomerValueFilter,
} from '@/lib/clientes'
import type { CustomerTypeFilter } from '@/lib/business-insights'
import { PageHeader } from '@/components/layout/page-header'
import { PeriodSelector } from '@/components/shared/period-selector'
import {
  CUSTOMER_TYPE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  cn,
  formatCurrency,
  formatDate,
  formatPercent,
} from '@/lib/utils'

export const metadata: Metadata = { title: 'Clientes' }

interface Props {
  searchParams: {
    month?: string
    year?: string
    professionalId?: string
    customerType?: string
    frequency?: string
    value?: string
  }
}

function buildClientesHref(input: {
  month: number
  year: number
  professionalId?: string | null
  customerType?: CustomerTypeFilter
  frequency?: CustomerFrequencyFilter
  value?: CustomerValueFilter
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('month', String(input.month))
  searchParams.set('year', String(input.year))

  if (input.professionalId) searchParams.set('professionalId', input.professionalId)
  if (input.customerType && input.customerType !== 'all') searchParams.set('customerType', input.customerType)
  if (input.frequency && input.frequency !== 'all') searchParams.set('frequency', input.frequency)
  if (input.value && input.value !== 'all') searchParams.set('value', input.value)

  return `/clientes?${searchParams.toString()}`
}

function buildCustomerProfileHref(input: {
  customerId: string
  month: number
  year: number
  professionalId?: string | null
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('month', String(input.month))
  searchParams.set('year', String(input.year))

  if (input.professionalId) {
    searchParams.set('professionalId', input.professionalId)
  }

  return `/clientes/${input.customerId}?${searchParams.toString()}`
}

function FilterLink({
  active,
  href,
  label,
}: {
  active: boolean
  href: string
  label: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
        active
          ? 'border-[rgba(91,33,182,0.18)] bg-[rgba(91,33,182,0.1)] text-[rgba(87,42,173,0.96)]'
          : 'border-[rgba(58,47,86,0.12)] bg-[rgba(255,255,255,0.72)] text-[rgba(87,79,109,0.92)] hover:bg-[rgba(91,33,182,0.06)] hover:text-foreground'
      )}
    >
      {label}
    </Link>
  )
}

function SummaryCard({
  title,
  value,
  helper,
  icon: Icon,
  tone = 'neutral',
}: {
  title: string
  value: string
  helper: string
  icon: typeof Users
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  const toneClass = {
    neutral: 'border-[rgba(58,47,86,0.12)] bg-[rgba(255,255,255,0.74)]',
    positive: 'border-[rgba(52,211,153,0.18)] bg-[rgba(16,185,129,0.08)]',
    warning: 'border-[rgba(251,191,36,0.18)] bg-[rgba(251,191,36,0.08)]',
  }[tone]

  return (
    <div className={cn('surface-light rounded-[1.1rem] border p-4 shadow-[0_22px_44px_-34px_rgba(2,6,23,0.82)]', toneClass)}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-[rgba(91,33,182,0.12)] bg-[rgba(91,33,182,0.08)] text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{title}</p>
          <p className="mt-1.5 text-[1.85rem] font-semibold leading-none text-foreground">{value}</p>
        </div>
      </div>
      <p className="mt-2.5 text-[13px] leading-5 text-muted-foreground">{helper}</p>
    </div>
  )
}

function ToneBadge({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  const toneClass = {
    neutral: 'border-[rgba(58,47,86,0.12)] bg-[rgba(255,255,255,0.72)] text-[rgba(87,79,109,0.92)]',
    positive: 'border-[rgba(52,211,153,0.18)] bg-[rgba(16,185,129,0.12)] text-emerald-700',
    warning: 'border-[rgba(251,191,36,0.18)] bg-[rgba(251,191,36,0.12)] text-amber-700',
  }[tone]

  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold', toneClass)}>
      {label}
    </span>
  )
}

export default async function ClientesPage({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const filters = resolveCustomerDirectoryFilters(searchParams)
  const professionalId = searchParams.professionalId ?? null
  const directory = await getCustomersDirectoryData({
    barbershopId: session.user.barbershopId,
    month,
    year,
    professionalId,
    customerType: filters.customerType,
    frequency: filters.frequency,
    value: filters.value,
  })

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Clientes"
        description="Base executiva da carteira com comportamento, valor, frequencia e sinais de risco para operacao e estrategia."
        action={(
          <Suspense>
            <PeriodSelector
              month={month}
              year={year}
              pathname="/clientes"
              queryParams={{
                professionalId,
                customerType: filters.customerType === 'all' ? null : filters.customerType,
                frequency: filters.frequency === 'all' ? null : filters.frequency,
                value: filters.value === 'all' ? null : filters.value,
              }}
            />
          </Suspense>
        )}
      />

      <section className="dashboard-panel dashboard-spotlight px-5 py-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_340px]">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="spotlight-chip">
                <CalendarRange className="h-3.5 w-3.5 text-sky-200" />
                {directory.summary.customers} clientes no recorte
              </span>
              <span className="spotlight-chip">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {directory.summary.atRiskCustomers} em observacao
              </span>
            </div>

            <p className="spotlight-kicker mt-6">Base de relacionamento</p>
            <h2 className="mt-3 text-3xl font-semibold text-white sm:text-[2.6rem]">
              Quem sustenta o caixa, quem consome operacao e onde agir primeiro.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              A lista abaixo cruza valor gerado, custo estimado, ticket, frequencia e o barbeiro mais recorrente para transformar clientes em uma camada real de gestao.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <FilterLink
                active={directory.filters.customerType === 'all'}
                href={buildClientesHref({
                  month,
                  year,
                  professionalId,
                  customerType: 'all',
                  frequency: directory.filters.frequency,
                  value: directory.filters.value,
                })}
                label="Todos"
              />
              <FilterLink
                active={directory.filters.customerType === 'subscription'}
                href={buildClientesHref({
                  month,
                  year,
                  professionalId,
                  customerType: 'subscription',
                  frequency: directory.filters.frequency,
                  value: directory.filters.value,
                })}
                label="Assinatura"
              />
              <FilterLink
                active={directory.filters.customerType === 'walk_in'}
                href={buildClientesHref({
                  month,
                  year,
                  professionalId,
                  customerType: 'walk_in',
                  frequency: directory.filters.frequency,
                  value: directory.filters.value,
                })}
                label="Avulso"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="spotlight-stat">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Receita no recorte</p>
              <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(directory.summary.totalRevenue)}</p>
              <p className="mt-1 text-sm text-slate-300">
                {directory.summary.estimatedRevenue > 0
                  ? `${formatCurrency(directory.summary.estimatedRevenue)} vem de estimativa operacional.`
                  : 'Leitura ancorada em registros reais no recorte.'}
              </p>
            </div>
            <div className="spotlight-stat">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Margem estimada</p>
              <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(directory.summary.totalMargin)}</p>
              <p className="mt-1 text-sm text-slate-300">
                {directory.summary.profitableCustomers} cliente{directory.summary.profitableCustomers === 1 ? '' : 's'} com saldo positivo no filtro atual.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Clientes visiveis"
          value={`${directory.summary.customers}`}
          helper="Carteira que realmente entrou no corte de periodo e filtros."
          icon={Users}
        />
        <SummaryCard
          title="Ticket medio"
          value={formatCurrency(directory.summary.averageTicket)}
          helper="Media por cliente do recorte atual, util para leitura comercial."
          icon={BadgeDollarSign}
        />
        <SummaryCard
          title="Em observacao"
          value={`${directory.summary.atRiskCustomers}`}
          helper="Clientes com baixa margem ou pressao operacional merecendo acompanhamento."
          icon={ShieldAlert}
          tone={directory.summary.atRiskCustomers > 0 ? 'warning' : 'positive'}
        />
        <SummaryCard
          title="Leitura estimada"
          value={formatPercent(directory.summary.totalRevenue > 0 ? (directory.summary.estimatedRevenue / directory.summary.totalRevenue) * 100 : 0, 0)}
          helper="Parcela da receita que depende de estimativa por falta de lancamento direto."
          icon={Sparkles}
          tone={directory.summary.estimatedRevenue > 0 ? 'warning' : 'positive'}
        />
      </div>

      <section className="dashboard-panel p-5 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="page-kicker">Filtros operacionais</p>
            <h2 className="mt-2 text-xl font-semibold text-foreground">Refine a carteira por barbeiro, frequencia e valor</h2>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <FilterLink
                active={!professionalId}
                href={buildClientesHref({
                  month,
                  year,
                  customerType: directory.filters.customerType,
                  frequency: directory.filters.frequency,
                  value: directory.filters.value,
                })}
                label="Equipe"
              />
              {directory.professionals.map((professional) => (
                <FilterLink
                  key={professional.id}
                  active={professionalId === professional.id}
                  href={buildClientesHref({
                    month,
                    year,
                    professionalId: professional.id,
                    customerType: directory.filters.customerType,
                    frequency: directory.filters.frequency,
                    value: directory.filters.value,
                  })}
                  label={professional.name}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: 'all' as const, label: 'Frequencia: todas' },
                { key: 'high' as const, label: 'Alta frequencia' },
                { key: 'medium' as const, label: 'Media frequencia' },
                { key: 'low' as const, label: 'Baixa frequencia' },
              ].map((option) => (
                <FilterLink
                  key={option.key}
                  active={directory.filters.frequency === option.key}
                  href={buildClientesHref({
                    month,
                    year,
                    professionalId,
                    customerType: directory.filters.customerType,
                    frequency: option.key,
                    value: directory.filters.value,
                  })}
                  label={option.label}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: 'all' as const, label: 'Valor: todos' },
                { key: 'high' as const, label: 'Maior valor' },
                { key: 'medium' as const, label: 'Valor medio' },
                { key: 'low' as const, label: 'Menor valor' },
              ].map((option) => (
                <FilterLink
                  key={option.key}
                  active={directory.filters.value === option.key}
                  href={buildClientesHref({
                    month,
                    year,
                    professionalId,
                    customerType: directory.filters.customerType,
                    frequency: directory.filters.frequency,
                    value: option.key,
                  })}
                  label={option.label}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="dashboard-panel p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="page-kicker">Carteira detalhada</p>
              <h2 className="mt-2 text-xl font-semibold text-foreground">Lista executiva de clientes</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Nome, tipo, barbeiro dominante, recorrencia, receita, ticket, ultima visita e sinalizacao em uma unica leitura.
              </p>
            </div>
            <span className="surface-chip">{directory.rows.length} clientes</span>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.08)] text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="pb-3 pr-4">Cliente</th>
                  <th className="pb-3 pr-4">Tipo</th>
                  <th className="pb-3 pr-4">Barbeiro</th>
                  <th className="pb-3 pr-4">Atendimentos</th>
                  <th className="pb-3 pr-4">Gerado</th>
                  <th className="pb-3 pr-4">Ticket medio</th>
                  <th className="pb-3 pr-4">Ultima visita</th>
                  <th className="pb-3">Sinalizacao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                {directory.rows.length > 0 ? directory.rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="py-4 pr-4">
                      <div className="min-w-[220px]">
                        <Link
                          href={buildCustomerProfileHref({
                            customerId: row.id,
                            month,
                            year,
                            professionalId,
                          })}
                          className="inline-flex items-center gap-2 font-semibold text-foreground transition-colors hover:text-primary"
                        >
                          {row.name}
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.phone ?? row.email ?? 'Sem contato cadastrado'}
                        </p>
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="flex flex-col gap-2">
                        <ToneBadge label={CUSTOMER_TYPE_LABELS[row.type]} tone={row.type === 'SUBSCRIPTION' ? 'positive' : 'neutral'} />
                        {row.subscriptionStatus && (
                          <ToneBadge
                            label={SUBSCRIPTION_STATUS_LABELS[row.subscriptionStatus]}
                            tone={row.subscriptionStatus === 'ACTIVE' ? 'positive' : 'warning'}
                          />
                        )}
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-foreground">{row.mostFrequentProfessionalName ?? 'Sem padrao'}</td>
                    <td className="py-4 pr-4 text-foreground">{row.visits}</td>
                    <td className="py-4 pr-4">
                      <div>
                        <p className="font-semibold text-foreground">{formatCurrency(row.totalRevenue)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.estimatedRevenue > 0 ? `${formatCurrency(row.estimatedRevenue)} estimado` : `${formatCurrency(row.realRevenue)} real`}
                        </p>
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-foreground">{formatCurrency(row.ticketAverage)}</td>
                    <td className="py-4 pr-4 text-foreground">{row.lastVisitAt ? formatDate(row.lastVisitAt) : 'Sem visita'}</td>
                    <td className="py-4">
                      <div className="flex min-w-[190px] flex-wrap gap-2">
                        <ToneBadge
                          label={row.riskLabel}
                          tone={row.riskLevel === 'warning' || row.riskLevel === 'loss' ? 'warning' : row.riskLevel === 'underused' ? 'positive' : 'neutral'}
                        />
                        <ToneBadge
                          label={row.revenueConfidenceLabel}
                          tone={row.revenueConfidence === 'real' ? 'positive' : 'neutral'}
                        />
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      Ainda nao ha clientes suficientes nesse filtro para montar a listagem.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="premium-rail">
            <p className="page-kicker">Como ler esta base</p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">Metodologia do recorte</h3>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
                <p className="font-semibold text-foreground">Receita real</p>
                <p className="mt-2 leading-6">{directory.methodology.realRevenueDefinition}</p>
              </div>
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
                <p className="font-semibold text-foreground">Receita estimada</p>
                <p className="mt-2 leading-6">{directory.methodology.estimatedRevenueDefinition}</p>
              </div>
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
                <p className="font-semibold text-foreground">Margem</p>
                <p className="mt-2 leading-6">{directory.methodology.marginDefinition}</p>
              </div>
            </div>
          </section>

          <section className="premium-block">
            <p className="page-kicker">Leitura rapida</p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">Sinais da carteira</h3>

            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
                <p className="font-semibold text-foreground">Cliente mais valioso do filtro</p>
                <p className="mt-2 leading-6">
                  {directory.rows[0]
                    ? `${directory.rows.slice().sort((a, b) => b.margin - a.margin)[0].name} aparece com a melhor margem estimada do recorte.`
                    : 'Ainda sem base suficiente.'}
                </p>
              </div>
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
                <p className="font-semibold text-foreground">Peso das estimativas</p>
                <p className="mt-2 leading-6">
                  {directory.summary.estimatedRevenue > 0
                    ? `${formatCurrency(directory.summary.estimatedRevenue)} do valor do recorte depende de inferencia baseada em assinatura e consumo.`
                    : 'A leitura atual nao depende de estimativa relevante de receita.'}
                </p>
              </div>
              <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
                <p className="font-semibold text-foreground">Cautela analitica</p>
                <p className="mt-2 leading-6">{directory.methodology.caution}</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
