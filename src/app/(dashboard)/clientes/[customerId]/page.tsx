import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  BadgeDollarSign,
  CalendarClock,
  ShieldAlert,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { resolvePeriod } from '@/lib/period'
import { getCustomerProfileData } from '@/lib/clientes'
import { CustomerProfileEditModal } from '@/components/clientes/customer-profile-edit-modal'
import { PageHeader } from '@/components/layout/page-header'
import { PeriodSelector } from '@/components/shared/period-selector'
import {
  APPOINTMENT_BILLING_MODEL_LABELS,
  APPOINTMENT_STATUS_LABELS,
  CUSTOMER_TYPE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  cn,
  formatCurrency,
  formatDate,
  formatPercent,
  formatTime,
} from '@/lib/utils'

export const metadata: Metadata = { title: 'Perfil do cliente' }

interface Props {
  params: {
    customerId: string
  }
  searchParams: {
    month?: string
    year?: string
    professionalId?: string
  }
}

function buildProfileHref(input: {
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

function buildDirectoryHref(input: {
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

  return `/clientes?${searchParams.toString()}`
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
        'filter-pill',
        active ? 'filter-pill-active' : ''
      )}
    >
      {label}
    </Link>
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
    neutral: 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-slate-300',
    positive: 'border-[rgba(52,211,153,0.16)] bg-[rgba(16,185,129,0.1)] text-emerald-100',
    warning: 'border-[rgba(251,191,36,0.16)] bg-[rgba(251,191,36,0.1)] text-amber-100',
  }[tone]

  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold', toneClass)}>
      {label}
    </span>
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
  icon: typeof UserRound
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  const toneClass = {
    neutral: 'border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.98),rgba(21,24,33,0.98))]',
    positive: 'border-[rgba(22,163,74,0.2)] bg-[radial-gradient(circle_at_top_left,rgba(22,163,74,0.16),transparent_38%),linear-gradient(180deg,rgba(24,38,32,0.98),rgba(21,24,33,0.98))]',
    warning: 'border-[rgba(245,158,11,0.22)] bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_38%),linear-gradient(180deg,rgba(40,31,24,0.98),rgba(21,24,33,0.98))]',
  }[tone]

  return (
    <div className={cn('surface-inverse rounded-[1.1rem] border p-4 shadow-[0_22px_44px_-34px_rgba(2,6,23,0.82)]', toneClass)}>
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

export default async function ClienteProfilePage({ params, searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const professionalId = searchParams.professionalId ?? null
  const canEditCustomer = session.user.role === 'OWNER' || session.user.role === 'MANAGER'
  const profile = await getCustomerProfileData({
    barbershopId: session.user.barbershopId,
    customerId: params.customerId,
    month,
    year,
    professionalId,
    viewerRole: session.user.role,
  })

  if (!profile) {
    notFound()
  }

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={buildDirectoryHref({ month, year, professionalId })}
          className="inline-flex items-center gap-2 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para clientes
        </Link>

        <div className="flex flex-wrap gap-2">
          <ToneBadge label={CUSTOMER_TYPE_LABELS[profile.customer.type]} tone={profile.customer.type === 'SUBSCRIPTION' ? 'positive' : 'neutral'} />
          <ToneBadge label={profile.customer.active ? 'Cadastro ativo' : 'Cadastro inativo'} tone={profile.customer.active ? 'positive' : 'warning'} />
          {profile.customer.subscriptionStatus && (
            <ToneBadge
              label={SUBSCRIPTION_STATUS_LABELS[profile.customer.subscriptionStatus]}
              tone={profile.customer.subscriptionStatus === 'ACTIVE' ? 'positive' : 'warning'}
            />
          )}
          {profile.customer.marketingOptOut && (
            <ToneBadge label="Campanhas bloqueadas" tone="warning" />
          )}
          <ToneBadge
            label={profile.snapshot.revenueConfidenceLabel}
            tone={profile.snapshot.revenueConfidence === 'real' ? 'positive' : 'neutral'}
          />
        </div>
      </div>

      <PageHeader
        title={profile.customer.name}
        description="Historico, frequencia, valor gerado, margem estimada e comportamento recente para leitura operacional e comercial."
        action={(
          <>
            {canEditCustomer ? (
              <CustomerProfileEditModal
                customer={profile.customer}
                professionals={profile.preferredProfessionalOptions}
              />
            ) : null}
            <Suspense>
              <PeriodSelector
                month={month}
                year={year}
                pathname={`/clientes/${params.customerId}`}
                queryParams={{ professionalId }}
              />
            </Suspense>
          </>
        )}
      />

      <section className="dashboard-panel dashboard-spotlight px-6 py-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_340px]">
          <div>
            <h2 className="text-3xl font-semibold text-white sm:text-[2.6rem]">
              {profile.customer.type === 'SUBSCRIPTION'
                ? 'Leitura completa da assinatura e do consumo operacional.'
                : 'Leitura completa do cliente avulso e da contribuicao para o caixa.'}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              {profile.recentBehavior[0] ?? 'Sem leitura comportamental relevante para este recorte ainda.'}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <FilterLink
                active={!professionalId}
                href={buildProfileHref({ customerId: params.customerId, month, year })}
                label="Equipe"
              />
              {profile.professionals.map((professional) => (
                <FilterLink
                  key={professional.id}
                  active={professionalId === professional.id}
                  href={buildProfileHref({
                    customerId: params.customerId,
                    month,
                    year,
                    professionalId: professional.id,
                  })}
                  label={professional.name}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="spotlight-stat">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Valor gerado</p>
              <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(profile.periodSummary.totalRevenue)}</p>
              <p className="mt-1 text-sm text-slate-300">
                {profile.periodSummary.estimatedRevenue > 0
                  ? `${formatCurrency(profile.periodSummary.estimatedRevenue)} depende de estimativa.`
                  : 'Receita ancorada em registros reais no recorte.'}
              </p>
            </div>
            <div className="spotlight-stat">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Margem estimada</p>
              <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(profile.periodSummary.margin)}</p>
              <p className="mt-1 text-sm text-slate-300">{profile.snapshot.riskLabel}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Visitas"
          value={`${profile.periodSummary.completedVisits}`}
          helper="Atendimentos concluidos no recorte selecionado."
          icon={CalendarClock}
        />
        <SummaryCard
          title="Ticket medio"
          value={formatCurrency(profile.periodSummary.ticketAverage)}
          helper="Receita media por visita do cliente neste recorte."
          icon={BadgeDollarSign}
        />
        <SummaryCard
          title="Custo estimado"
          value={formatCurrency(profile.periodSummary.estimatedCost)}
          helper="Custo operacional estimado para sustentar o atendimento."
          icon={Sparkles}
          tone="warning"
        />
        <SummaryCard
          title="Sinalizacao"
          value={profile.snapshot.riskLabel}
          helper="Leitura atual de risco ou oportunidade no relacionamento."
          icon={ShieldAlert}
          tone={profile.snapshot.riskLevel === 'warning' || profile.snapshot.riskLevel === 'loss' ? 'warning' : 'positive'}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-5">
          <section className="dashboard-panel p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Receita, margem, recorrencia e lifetime</h2>
              </div>
              {profile.customer.subscriptionPrice && (
                <ToneBadge label={`Plano ${formatCurrency(profile.customer.subscriptionPrice)}`} tone="positive" />
              )}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="surface-soft p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Periodo atual</p>
                <div className="mt-4 space-y-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400">Receita real</span>
                    <span className="font-medium">{formatCurrency(profile.periodSummary.realRevenue)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400">Receita estimada</span>
                    <span className="font-medium">{formatCurrency(profile.periodSummary.estimatedRevenue)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400">Margem estimada</span>
                    <span className="font-medium">{formatCurrency(profile.periodSummary.margin)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400">Ultima visita</span>
                    <span className="font-medium">{profile.snapshot.lastVisitAt ? formatDate(profile.snapshot.lastVisitAt) : 'Sem visita'}</span>
                  </div>
                </div>
              </div>

              <div className="surface-soft p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lifetime</p>
                <div className="mt-4 space-y-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400">Atendimentos concluidos</span>
                    <span className="font-medium">{profile.lifetimeSummary.completedVisits}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400">Receita vinculada</span>
                    <span className="font-medium">{formatCurrency(profile.lifetimeSummary.linkedRevenue)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400">Primeira visita</span>
                    <span className="font-medium">{profile.lifetimeSummary.firstVisitAt ? formatDate(profile.lifetimeSummary.firstVisitAt) : 'Sem base'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400">Barbeiro dominante</span>
                    <span className="font-medium">{profile.snapshot.mostFrequentProfessionalName ?? 'Sem padrao'}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="dashboard-panel p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Atendimentos recentes</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Visao completa do comportamento recente do cliente, com servico, barbeiro, cobranca e status.
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {profile.appointmentHistory.length} registro{profile.appointmentHistory.length === 1 ? '' : 's'}
              </p>
            </div>

            <div className="mt-5 space-y-3">
              {profile.appointmentHistory.length > 0 ? profile.appointmentHistory.map((appointment) => (
                <div key={appointment.id} className="tonal-note">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{appointment.serviceName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {appointment.professionalName} / {formatDate(appointment.startAt)} / {formatTime(appointment.startAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ToneBadge label={APPOINTMENT_STATUS_LABELS[appointment.status]} tone={appointment.status === 'COMPLETED' ? 'positive' : appointment.status === 'CANCELLED' ? 'warning' : 'neutral'} />
                      <ToneBadge label={APPOINTMENT_BILLING_MODEL_LABELS[appointment.billingModel]} tone={appointment.billingModel === 'AVULSO' ? 'neutral' : 'positive'} />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{formatCurrency(appointment.priceSnapshot)}</span>
                    {appointment.notes && <span>{appointment.notes}</span>}
                  </div>
                </div>
              )) : (
                <div className="empty-state-shell-subtle p-5 text-sm text-muted-foreground">
                  Ainda não há atendimentos no recorte escolhido para este cliente.
                </div>
              )}
            </div>
          </section>
        </section>

        <aside className="space-y-5">
          <section className="premium-rail p-5">
            <h3 className="text-lg font-semibold text-foreground">Leituras prontas para gestao</h3>
            <div className="mt-4 space-y-3">
              {profile.recentBehavior.map((message) => (
                <div key={message} className="tonal-note text-sm leading-6 text-muted-foreground">
                  {message}
                </div>
              ))}
            </div>
          </section>

          <section className="premium-block p-5">
            <h3 className="text-lg font-semibold text-foreground">Servicos e barbeiros dominantes</h3>

            <div className="mt-4 space-y-4">
              <div className="tonal-note">
                <p className="text-sm font-semibold text-foreground">Servicos mais usados</p>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {profile.favoriteServices.length > 0 ? profile.favoriteServices.map((service) => (
                    <div key={service.name} className="flex items-center justify-between gap-3">
                      <span>{service.name}</span>
                      <span>{service.visits} / {formatPercent(service.sharePercent, 0)}</span>
                    </div>
                  )) : (
                    <p>Sem servico dominante no recorte.</p>
                  )}
                </div>
              </div>

              <div className="tonal-note">
                <p className="text-sm font-semibold text-foreground">Barbeiros mais frequentes</p>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {profile.favoriteProfessionals.length > 0 ? profile.favoriteProfessionals.map((professional) => (
                    <div key={professional.name} className="flex items-center justify-between gap-3">
                      <span>{professional.name}</span>
                      <span>{professional.visits} / {formatPercent(professional.sharePercent, 0)}</span>
                    </div>
                  )) : (
                    <p>Sem barbeiro dominante no recorte.</p>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="premium-block p-5">
            <h3 className="text-lg font-semibold text-foreground">Como interpretar a analise</h3>

            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="tonal-note">
                <p className="font-semibold text-foreground">Receita real</p>
                <p className="mt-2 leading-6">{profile.methodology.realRevenueDefinition}</p>
              </div>
              <div className="tonal-note">
                <p className="font-semibold text-foreground">Receita estimada</p>
                <p className="mt-2 leading-6">{profile.methodology.estimatedRevenueDefinition}</p>
              </div>
              <div className="tonal-note">
                <p className="font-semibold text-foreground">Cautela</p>
                <p className="mt-2 leading-6">{profile.methodology.caution}</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
