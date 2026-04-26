import {
  Activity,
  ArrowUpRight,
  Bot,
  CalendarClock,
  Gift,
  MessageCircle,
  RotateCcw,
  Sparkles,
  Users,
} from 'lucide-react'
import type { CampaignAutomationDeliveryStatus, CampaignAutomationType } from '@prisma/client'
import type { CampaignAutomationManagementData } from '@/lib/campaign-automation'
import { cn, formatPercent } from '@/lib/utils'

const CAMPAIGN_LABELS: Record<CampaignAutomationType, string> = {
  BIRTHDAY: 'Aniversarios',
  WALK_IN_INACTIVE: 'Avulsos inativos',
  SUBSCRIPTION_ABSENT: 'Assinantes ausentes',
}

const CAMPAIGN_HELPERS: Record<CampaignAutomationType, string> = {
  BIRTHDAY: 'Relacionamento afetivo com beneficio configurado.',
  WALK_IN_INACTIVE: 'Reativacao de clientes avulsos sem retorno recente.',
  SUBSCRIPTION_ABSENT: 'Estimulo para assinantes voltarem a usar o plano.',
}

const DELIVERY_STATUS_LABELS: Record<CampaignAutomationDeliveryStatus, string> = {
  PENDING: 'Pendente',
  SENT: 'Enviada',
  FAILED: 'Falhou',
  SKIPPED: 'Ignorada',
}

function formatDateIsoLabel(dateIso: string) {
  const [year, month, day] = dateIso.split('-')
  return `${day}/${month}/${year}`
}

function formatDateTimeLabel(date: Date | null, timezone: string) {
  if (!date) {
    return 'Sem registro'
  }

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDeliveryRate(value: number | null) {
  return value === null ? 'Sem envios' : formatPercent(value, 0)
}

function StatusBadge({ status }: { status: CampaignAutomationManagementData['status'] }) {
  const className = {
    active: 'border-[rgba(22,163,74,0.24)] bg-[rgba(22,163,74,0.12)] text-emerald-100',
    attention: 'border-[rgba(245,158,11,0.24)] bg-[rgba(245,158,11,0.12)] text-amber-100',
    inactive: 'border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] text-muted-foreground',
  }[status]

  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold', className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status === 'active' ? 'Automacao ativa' : status === 'attention' ? 'Revisar automacao' : 'Automacao inativa'}
    </span>
  )
}

function SummaryCard({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string
  value: string
  helper: string
  icon: typeof Activity
}) {
  return (
    <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="executive-label">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-[rgba(124,58,237,0.18)] bg-[rgba(124,58,237,0.12)] text-primary">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{helper}</p>
    </div>
  )
}

function DeliveryStatusChip({ status }: { status: CampaignAutomationDeliveryStatus }) {
  const className = {
    SENT: 'border-[rgba(22,163,74,0.2)] bg-[rgba(22,163,74,0.1)] text-emerald-100',
    FAILED: 'border-[rgba(220,38,38,0.24)] bg-[rgba(220,38,38,0.12)] text-rose-100',
    SKIPPED: 'border-[rgba(245,158,11,0.22)] bg-[rgba(245,158,11,0.1)] text-amber-100',
    PENDING: 'border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] text-muted-foreground',
  }[status]

  return (
    <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold', className)}>
      {DELIVERY_STATUS_LABELS[status]}
    </span>
  )
}

export function CampaignAutomationPanel({ data }: { data: CampaignAutomationManagementData }) {
  return (
    <section className="dashboard-panel overflow-hidden p-5 sm:p-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-[1.55rem] font-semibold tracking-tight text-foreground">
                Campanhas automaticas e relacionamento
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
                Acompanhe se as campanhas das 09:00 estao rodando, quem foi impactado e como a automacao esta ajudando a trazer clientes de volta.
              </p>
            </div>

            <StatusBadge status={data.status} />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Status"
              value={data.statusLabel}
              helper={data.statusDescription}
              icon={Activity}
            />
            <SummaryCard
              label="Janela diaria"
              value={data.executionTimeLabel}
              helper={`Proxima janela: ${formatDateIsoLabel(data.nextWindow.localDateIso)} as ${data.nextWindow.timeLabel}.`}
              icon={CalendarClock}
            />
            <SummaryCard
              label="Disparos hoje"
              value={`${data.todayTotals.deliveriesSent}`}
              helper={`${data.todayTotals.deliveriesFailed} falha(s) e ${data.todayTotals.deliveriesSkipped} ignorado(s).`}
              icon={MessageCircle}
            />
            <SummaryCard
              label="Taxa de entrega"
              value={formatDeliveryRate(data.todayTotals.deliveryRate)}
              helper={`${data.todayTotals.eligibleCustomers} cliente(s) elegiveis no ciclo de hoje.`}
              icon={Sparkles}
            />
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {data.campaignSummaries.map((campaign) => (
              <article
                key={campaign.campaignType}
                className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{CAMPAIGN_LABELS[campaign.campaignType]}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{CAMPAIGN_HELPERS[campaign.campaignType]}</p>
                  </div>
                  <span className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                    campaign.active
                      ? 'border-[rgba(124,58,237,0.28)] bg-[rgba(124,58,237,0.13)] text-violet-100'
                      : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground'
                  )}>
                    {campaign.active ? 'Ativa' : 'Pausada'}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="executive-label">Elegiveis</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">{campaign.eligibleCustomers}</p>
                  </div>
                  <div>
                    <p className="executive-label">Enviadas</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">{campaign.deliveriesSent}</p>
                  </div>
                  <div>
                    <p className="executive-label">Entrega</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">{formatDeliveryRate(campaign.deliveryRate)}</p>
                  </div>
                </div>

                <div className="mt-4 rounded-[0.9rem] border border-[rgba(255,255,255,0.07)] bg-[rgba(15,17,21,0.46)] p-3">
                  <p className="text-sm font-semibold text-foreground">Beneficio configurado</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-foreground">
                    {campaign.benefitDescription ?? 'Sem beneficio configurado'}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="premium-rail p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[1.35rem] font-semibold tracking-tight text-foreground">Operacao assistida</h3>
            </div>
            <Bot className="h-5 w-5 text-primary" />
          </div>

          <div className="mt-4 space-y-3">
            <div className="panel-soft">
              <p className="executive-label">Ultima execucao</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {data.lastRun ? formatDateTimeLabel(data.lastRun.completedAt ?? data.lastRun.startedAt, data.timezone) : 'Ainda sem execucao'}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {data.lastRun
                  ? `${data.lastRun.deliveriesSent} enviada(s), ${data.lastRun.deliveriesFailed} falha(s), ${data.lastRun.deliveriesSkipped} ignorada(s).`
                  : 'A primeira execucao aparece aqui depois da janela diaria.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="panel-soft">
                <p className="executive-label">Responderam</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{data.estimatedImpact.respondedCustomers}</p>
                <p className="mt-1 text-xs text-muted-foreground">Estimado em {data.estimatedImpact.windowDays} dias.</p>
              </div>
              <div className="panel-soft">
                <p className="executive-label">Reagendaram</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{data.estimatedImpact.rebookedCustomers}</p>
                <p className="mt-1 text-xs text-muted-foreground">Via WhatsApp.</p>
              </div>
            </div>

            <div className="rounded-[1rem] border border-[rgba(124,58,237,0.18)] bg-[rgba(124,58,237,0.1)] p-4">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                <RotateCcw className="h-4 w-4 text-primary" />
                Proxima janela
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {data.nextWindow.description} A automacao usa regras deterministicas; a IA apenas personaliza a mensagem.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-5 overflow-hidden rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.035)]">
        <div className="flex items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.07)] px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">Clientes impactados recentemente</h3>
          </div>
          <Gift className="h-4 w-4 text-primary" />
        </div>

        {data.recentDeliveries.length > 0 ? (
          <div className="divide-y divide-[rgba(255,255,255,0.06)]">
            {data.recentDeliveries.map((delivery) => (
              <div key={delivery.id} className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{delivery.customerName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {CAMPAIGN_LABELS[delivery.campaignType]} · {delivery.usedAi ? 'Mensagem com IA' : delivery.usedFallback ? 'Fallback seguro' : 'Mensagem registrada'}
                  </p>
                </div>
                <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {delivery.benefitDescription ?? 'Sem beneficio registrado'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTimeLabel(delivery.sentAt ?? delivery.createdAt, data.timezone)}
                </p>
                <DeliveryStatusChip status={delivery.status} />
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">Ainda sem disparos registrados</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Depois da primeira execucao diaria, os clientes impactados aparecem aqui.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
