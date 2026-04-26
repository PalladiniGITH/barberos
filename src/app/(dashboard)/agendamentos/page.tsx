import type { Metadata } from 'next'
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Minus,
  PanelsTopLeft,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { requireSession } from '@/lib/auth'
import type { ScheduleAppointmentItem, ScheduleView } from '@/lib/agendamentos'
import {
  getSchedulePageData,
  resolveScheduleSearch,
  SCHEDULE_END_HOUR,
  SCHEDULE_START_HOUR,
} from '@/lib/agendamentos'
import { findSessionProfessional } from '@/lib/professionals/session-professional'
import { ScheduleCalendar } from '@/components/agendamentos/schedule-calendar'
import { ScheduleToolbar } from '@/components/agendamentos/schedule-toolbar'
import { PageHeader } from '@/components/layout/page-header'
import { cn, formatCurrency, formatPercent } from '@/lib/utils'

export const metadata: Metadata = { title: 'Agendamentos' }

interface Props {
  searchParams: {
    date?: string
    professionalId?: string
    view?: string
  }
}

interface PositionedAppointment extends ScheduleAppointmentItem {
  laneIndex: number
  laneCount: number
}

interface ScheduleCalendarColumn {
  key: string
  title: string
  helper: string
  professionalId: string | null
  dateIso: string
  appointments: PositionedAppointment[]
}

function getSchedulePxPerMinute(view: ScheduleView) {
  return view === 'barber' ? 2 : 1.9
}

function buildPositionedAppointments(appointments: ScheduleAppointmentItem[]): PositionedAppointment[] {
  if (appointments.length === 0) {
    return []
  }

  const sorted = [...appointments].sort((left, right) =>
    new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
  )

  const positioned: PositionedAppointment[] = []
  let cluster: Array<{ appointment: ScheduleAppointmentItem; laneIndex: number }> = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity

  function flushCluster() {
    if (cluster.length === 0) return

    const laneCount = Math.max(...cluster.map((item) => item.laneIndex)) + 1
    cluster.forEach(({ appointment, laneIndex }) => {
      positioned.push({
        ...appointment,
        laneIndex,
        laneCount,
      })
    })

    cluster = []
    laneEnds = []
    clusterEnd = -Infinity
  }

  sorted.forEach((appointment) => {
    const start = new Date(appointment.startAt).getTime()
    const end = new Date(appointment.endAt).getTime()

    if (cluster.length > 0 && start >= clusterEnd) {
      flushCluster()
    }

    let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= start)

    if (laneIndex === -1) {
      laneIndex = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[laneIndex] = end
    }

    clusterEnd = Math.max(clusterEnd, end)
    cluster.push({ appointment, laneIndex })
  })

  flushCluster()
  return positioned
}

function buildDayViewColumns(data: Awaited<ReturnType<typeof getSchedulePageData>>): ScheduleCalendarColumn[] {
  const selectedDay = data.days[0]?.key
  const appointments = data.appointments.filter((appointment) => appointment.localDateIso === selectedDay)

  return [
    {
      key: data.selectedProfessionalId ?? 'team-day',
      title: data.selectedProfessionalId ? (data.visibleProfessionals[0]?.name ?? 'Agenda do dia') : 'Operacao do dia',
      helper: data.selectedProfessionalId
        ? `${appointments.length} blocos visiveis nesta agenda`
        : `${appointments.length} blocos entre equipe, encaixes e bloqueios`,
      professionalId: data.selectedProfessionalId,
      dateIso: selectedDay,
      appointments: buildPositionedAppointments(appointments),
    },
  ]
}

function buildBarberViewColumns(data: Awaited<ReturnType<typeof getSchedulePageData>>): ScheduleCalendarColumn[] {
  const selectedDay = data.days[0]?.key

  return data.visibleProfessionals.map((professional) => {
    const appointments = data.appointments.filter((appointment) =>
      appointment.professionalId === professional.id && appointment.localDateIso === selectedDay
    )

    const appointmentCount = appointments.filter((item) => item.itemType === 'APPOINTMENT').length
    const blockCount = appointments.filter((item) => item.itemType === 'BLOCK').length

    return {
      key: professional.id,
      title: professional.name,
      helper: `${appointmentCount} atendimento${appointmentCount === 1 ? '' : 's'}${blockCount > 0 ? ` - ${blockCount} bloqueio${blockCount === 1 ? '' : 's'}` : ''}`,
      professionalId: professional.id,
      dateIso: selectedDay,
      appointments: buildPositionedAppointments(appointments),
    }
  })
}

export default async function AgendamentosPage({ searchParams }: Props) {
  const session = await requireSession()
  const filters = resolveScheduleSearch(searchParams)
  const inferredProfessional = session.user.role === 'BARBER'
    ? await findSessionProfessional({
        barbershopId: session.user.barbershopId,
        email: session.user.email,
        name: session.user.name,
      })
    : null

  if (session.user.role === 'BARBER' && !inferredProfessional) {
    return (
      <div className="page-section flex flex-col gap-5">
        <PageHeader
          title="Minha agenda"
          description="Nao encontramos um cadastro profissional vinculado ao seu usuario para liberar sua agenda individual."
        />

        <section className="dashboard-panel p-6">
          <p className="page-kicker">Vinculo pendente</p>
          <h2 className="mt-2 text-[1.4rem] font-semibold tracking-tight text-foreground">
            Seu usuario ainda nao esta ligado a um barbeiro ativo.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            Assim que a equipe vincular este login ao seu cadastro profissional, a grade passa a abrir somente a sua agenda com seguranca.
          </p>
        </section>
      </div>
    )
  }

  const professionalLocked = Boolean(inferredProfessional && session.user.role === 'BARBER')
  const effectiveProfessionalId = professionalLocked ? inferredProfessional?.id ?? null : filters.professionalId
  const schedule = await getSchedulePageData({
    barbershopId: session.user.barbershopId,
    date: filters.date,
    view: filters.view,
    professionalId: effectiveProfessionalId,
    viewerRole: session.user.role,
    viewerProfessionalId: inferredProfessional?.id ?? null,
  })

  if (schedule.professionals.length === 0 || schedule.services.length === 0) {
    return (
      <div className="page-section flex flex-col gap-5">
        <PageHeader
          title="Agenda operacional"
          description="A nova agenda precisa de equipe e servicos cadastrados para funcionar com consistencia."
        />

        <section className="dashboard-spotlight p-6">
          <p className="spotlight-kicker">Base operacional pendente</p>
          <h2 className="spotlight-title">Cadastre equipe e servicos para ativar a agenda.</h2>
          <p className="spotlight-copy max-w-3xl">
            A grade usa barbeiro, duracao, conflitos, bloqueios e disponibilidade real. Sem essa base, a operacao fica pela metade.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="spotlight-stat">
              <p className="executive-label">Barbeiros ativos</p>
              <p className="mt-3 text-3xl font-semibold text-foreground">{schedule.professionals.length}</p>
              <p className="mt-2 text-sm text-muted-foreground">A grade por barbeiro precisa de pelo menos um profissional ativo.</p>
            </div>
            <div className="spotlight-stat">
              <p className="executive-label">Servicos ativos</p>
              <p className="mt-3 text-3xl font-semibold text-foreground">{schedule.services.length}</p>
              <p className="mt-2 text-sm text-muted-foreground">Duracao, valor e operacao do slot vem direto do catalogo.</p>
            </div>
          </div>
        </section>
      </div>
    )
  }

  const schedulePxPerMinute = getSchedulePxPerMinute(schedule.view)
  const columns = schedule.view === 'day' ? buildDayViewColumns(schedule) : buildBarberViewColumns(schedule)
  const totalMinutes = (SCHEDULE_END_HOUR - SCHEDULE_START_HOUR) * 60
  const calendarHeight = totalMinutes * schedulePxPerMinute
  const scheduledRatio = schedule.summary.scheduledCount > 0
    ? (schedule.summary.confirmedCount / schedule.summary.scheduledCount) * 100
    : 0
  const minColumnWidth = schedule.view === 'barber' ? 280 : 360
  const whatsappBookings = schedule.appointments.filter((appointment) => appointment.itemType === 'APPOINTMENT' && appointment.source === 'WHATSAPP').length

  return (
    <div className="page-section flex flex-col gap-5">
      <PageHeader
        title="Agenda operacional"
        description="Uma grade feita para recepcao e operacao real: leitura rapida, movimentos seguros e bloqueios visiveis."
        action={(
          <ScheduleToolbar
            date={schedule.date}
            view={schedule.view}
            selectedProfessionalId={schedule.selectedProfessionalId}
            professionals={schedule.professionals}
            services={schedule.services}
            recentCustomers={schedule.recentCustomers}
            professionalLocked={professionalLocked}
            professionalLockedLabel={inferredProfessional?.name ?? null}
          />
        )}
      />

      <section className="dashboard-spotlight overflow-hidden px-5 py-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_360px]">
          <div>
            <p className="spotlight-kicker">Operacao do dia</p>
            <h2 className="mt-3 text-[2.5rem] font-semibold tracking-tight text-foreground sm:text-[2.9rem]">
              {schedule.rangeLabel}
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted-foreground">
              Uma agenda central para encaixe, bloqueio, remarcacao e leitura do fluxo da casa sem ruido visual.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="spotlight-chip">
                <PanelsTopLeft className="h-3.5 w-3.5 text-primary" />
                {schedule.view === 'barber' ? 'Grade por barbeiro' : 'Linha do dia'}
              </span>
              <span className="spotlight-chip">
                <CalendarClock className="h-3.5 w-3.5 text-primary" />
                {schedule.summary.scheduledCount} atendimentos
              </span>
              <span className="spotlight-chip">
                <Minus className="h-3.5 w-3.5 text-primary" />
                {schedule.summary.blockedCount} bloqueios
              </span>
              <span className="spotlight-chip">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {whatsappBookings} via WhatsApp
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="hero-stat-card">
                <p className="executive-label">Confirmados</p>
                <p className="mt-3 text-[1.9rem] font-semibold tracking-tight text-foreground">{schedule.summary.confirmedCount}</p>
                <p className="mt-2 text-sm text-muted-foreground">{formatPercent(scheduledRatio)} da agenda pronta para atendimento.</p>
              </div>
              <div className="hero-stat-card">
                <p className="executive-label">Agendado no dia</p>
                <p className="mt-3 text-[1.9rem] font-semibold tracking-tight text-foreground">{formatCurrency(schedule.summary.scheduledValue)}</p>
                <p className="mt-2 text-sm text-muted-foreground">Valor bruto montado para a operacao do dia.</p>
              </div>
              <div className="hero-stat-card">
                <p className="executive-label">WhatsApp</p>
                <p className="mt-3 text-[1.9rem] font-semibold tracking-tight text-foreground">{whatsappBookings}</p>
                <p className="mt-2 text-sm text-muted-foreground">Agendamentos de IA visiveis no mesmo fluxo operacional.</p>
              </div>
            </div>
          </div>

          <aside className="premium-rail p-5">
            <p className="page-kicker">{schedule.panel.mode === 'professional' ? 'Barbeiro' : 'Equipe'}</p>
            <h3 className="mt-2 text-[1.5rem] font-semibold tracking-tight text-foreground">{schedule.panel.title}</h3>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{schedule.panel.subtitle}</p>

            <div className="mt-5 space-y-3">
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="executive-label">Faturamento do periodo</p>
                <p className="mt-3 text-[1.85rem] font-semibold tracking-tight text-foreground">{formatCurrency(schedule.panel.periodRevenue)}</p>
                <p className="mt-2 text-sm text-muted-foreground">Meta do periodo: {formatCurrency(schedule.panel.periodGoal)}</p>
              </div>

              <div className="rounded-[0.95rem] border border-[rgba(52,44,78,0.1)] bg-[rgba(91,33,182,0.06)] p-4">
                <p className="executive-label">Ritmo da meta</p>
                <p className="mt-3 text-[1.6rem] font-semibold tracking-tight text-foreground">{formatPercent(schedule.panel.periodGoalProgress)}</p>
                <p className="mt-2 text-sm text-muted-foreground">Leitura do periodo com receita real, nao estimada.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="panel-soft">
                  <p className="executive-label">Agendado hoje</p>
                  <p className="mt-3 text-xl font-semibold text-foreground">{formatCurrency(schedule.panel.scheduledValueToday)}</p>
                </div>
                <div className="panel-soft">
                  <p className="executive-label">Concluidos</p>
                  <p className="mt-3 text-xl font-semibold text-foreground">{schedule.panel.completedCount}</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="dashboard-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[rgba(58,47,86,0.08)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="page-kicker">Grade interativa</p>
              <h3 className="mt-2 text-[1.45rem] font-semibold tracking-tight text-foreground">Agenda em grid</h3>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
                Clique em um slot vazio para criar. Clique e arraste para escolher intervalo. Arraste um bloco existente para remarcar com seguranca.
              </p>
            </div>
            <div className="rounded-[0.75rem] border border-[rgba(52,44,78,0.1)] bg-[rgba(91,33,182,0.05)] px-3 py-1.5 text-sm font-medium text-foreground">
              Operacao visual com bloqueios e conflitos
            </div>
          </div>

          <ScheduleCalendar
            columns={columns}
            view={schedule.view}
            selectedProfessionalId={schedule.selectedProfessionalId}
            hours={schedule.hours}
            schedulePxPerMinute={schedulePxPerMinute}
            calendarHeight={calendarHeight}
            minColumnWidth={minColumnWidth}
            professionals={schedule.professionals}
            services={schedule.services}
            recentCustomers={schedule.recentCustomers}
          />
        </section>

        <aside className="space-y-4">
          <section className="premium-block p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="page-kicker">Fila do dia</p>
                <h3 className="mt-2 text-[1.3rem] font-semibold tracking-tight text-foreground">Proximos atendimentos</h3>
              </div>
              <Clock3 className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="mt-4 space-y-3">
              {schedule.panel.upcomingToday.length > 0 ? schedule.panel.upcomingToday.map((appointment) => (
                <div key={appointment.id} className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4 shadow-[0_16px_24px_-18px_rgba(2,6,23,0.5)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{appointment.customerName}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {appointment.serviceName} com {appointment.professionalName}
                      </p>
                    </div>
                    <span className="rounded-[0.7rem] bg-[rgba(91,33,182,0.08)] px-2.5 py-1 text-xs font-semibold text-primary">
                      {appointment.startTimeLabel}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{appointment.customerPhone ?? 'Sem telefone'}</span>
                    <span>{formatCurrency(appointment.priceSnapshot)}</span>
                  </div>
                </div>
              )) : (
                <div className="rounded-[0.9rem] border border-dashed border-[rgba(52,44,78,0.12)] bg-[rgba(91,33,182,0.035)] p-5 text-sm text-muted-foreground">
                  Nenhum atendimento montado para este dia. Use a grade para preencher a agenda sem sair do fluxo.
                </div>
              )}
            </div>
          </section>

          <details className="disclosure-panel">
          <summary className="disclosure-summary">
            <div>
              <p className="page-kicker">Status da agenda</p>
              <h3 className="mt-2 text-[1.2rem] font-semibold tracking-tight text-foreground">Leitura rapida</h3>
            </div>
            <span className="text-sm font-medium text-muted-foreground">Ver resumo</span>
          </summary>

            <div className="disclosure-body space-y-3">
              {[
                {
                  label: 'Confirmados',
                  value: schedule.summary.confirmedCount,
                  helper: 'Prontos para rodar',
                  icon: CheckCircle2,
                  tone: 'text-emerald-600',
                },
                {
                  label: 'Pendentes',
                  value: schedule.summary.pendingCount,
                  helper: 'Pedem retorno rapido',
                  icon: Clock3,
                  tone: 'text-amber-600',
                },
                {
                  label: 'Cancelados',
                  value: schedule.summary.cancelledCount,
                  helper: 'Boa chance de reagendar',
                  icon: XCircle,
                  tone: 'text-rose-600',
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-[0.9rem] border border-[rgba(52,44,78,0.1)] bg-[rgba(91,33,182,0.035)] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-[0.8rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(15,17,21,0.72)]">
                      <item.icon className={cn('h-4 w-4', item.tone)} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.helper}</p>
                    </div>
                  </div>
                  <span className="text-lg font-semibold text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          </details>
        </aside>
      </div>
    </div>
  )
}
