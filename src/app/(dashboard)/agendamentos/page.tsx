import type { Metadata } from 'next'
import { format } from 'date-fns'
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  LayoutGrid,
  PanelsTopLeft,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { ScheduleAppointmentItem, ScheduleView } from '@/lib/agendamentos'
import {
  getSchedulePageData,
  resolveScheduleSearch,
  SCHEDULE_END_HOUR,
  SCHEDULE_START_HOUR,
} from '@/lib/agendamentos'
import { ScheduleCalendar } from '@/components/agendamentos/schedule-calendar'
import { ScheduleToolbar } from '@/components/agendamentos/schedule-toolbar'
import { PageHeader } from '@/components/layout/page-header'
import { cn, formatCurrency, formatPercent, formatTime } from '@/lib/utils'

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
  appointments: PositionedAppointment[]
}

function getSchedulePxPerMinute(view: ScheduleView) {
  return view === 'barber' ? 1.4 : 1.6
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
  const appointments = data.appointments.filter((appointment) =>
    format(new Date(appointment.startAt), 'yyyy-MM-dd') === selectedDay
  )

  return [
    {
      key: data.selectedProfessionalId ?? 'team-day',
      title: data.selectedProfessionalId ? (data.visibleProfessionals[0]?.name ?? 'Agenda do dia') : 'Agenda do dia',
      helper: data.selectedProfessionalId
        ? `${appointments.length} horarios deste barbeiro`
        : `${appointments.length} horarios da equipe neste dia`,
      appointments: buildPositionedAppointments(appointments),
    },
  ]
}

function buildBarberViewColumns(data: Awaited<ReturnType<typeof getSchedulePageData>>): ScheduleCalendarColumn[] {
  const selectedDay = data.days[0]?.key

  return data.visibleProfessionals.map((professional) => {
    const appointments = data.appointments.filter((appointment) =>
      appointment.professionalId === professional.id
      && format(new Date(appointment.startAt), 'yyyy-MM-dd') === selectedDay
    )

    return {
      key: professional.id,
      title: professional.name,
      helper: `${appointments.length} horarios`,
      appointments: buildPositionedAppointments(appointments),
    }
  })
}

export default async function AgendamentosPage({ searchParams }: Props) {
  const session = await requireSession()
  const filters = resolveScheduleSearch(searchParams)
  const inferredProfessional = session.user.role === 'BARBER'
    ? await prisma.professional.findFirst({
        where: {
          barbershopId: session.user.barbershopId,
          active: true,
          OR: [
            session.user.email ? { email: session.user.email } : undefined,
            session.user.name ? { name: session.user.name } : undefined,
          ].filter(Boolean) as Array<{ email?: string; name?: string }>,
        },
        select: {
          id: true,
          name: true,
        },
      })
    : null
  const professionalLocked = Boolean(inferredProfessional && session.user.role === 'BARBER')
  const effectiveProfessionalId = professionalLocked
    ? inferredProfessional?.id ?? null
    : filters.professionalId
  const schedule = await getSchedulePageData({
    barbershopId: session.user.barbershopId,
    date: filters.date,
    view: filters.view,
    professionalId: effectiveProfessionalId,
  })

  if (schedule.professionals.length === 0 || schedule.services.length === 0) {
    return (
      <div className="page-section mx-auto flex max-w-5xl flex-col gap-6">
        <PageHeader
          title="Agendamentos"
          description="A agenda interna esta pronta, mas precisa de um minimo de base cadastrada para rodar sem atrito no dia a dia."
        />

        <section className="dashboard-panel dashboard-spotlight p-6">
          <p className="spotlight-kicker">Base operacional pendente</p>
          <h2 className="spotlight-title">Cadastre equipe e servicos para ativar a agenda.</h2>
          <p className="spotlight-copy max-w-3xl">
            O agendamento usa barbeiro, servico, duracao e valor real do catalogo para bloquear conflitos e organizar a rotina.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="spotlight-stat">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Barbeiros ativos</p>
              <p className="mt-2 text-3xl font-semibold text-white">{schedule.professionals.length}</p>
              <p className="mt-2 text-sm text-slate-300">A agenda por dia e por barbeiro precisa de pelo menos um profissional ativo.</p>
            </div>
            <div className="spotlight-stat">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Servicos ativos</p>
              <p className="mt-2 text-3xl font-semibold text-white">{schedule.services.length}</p>
              <p className="mt-2 text-sm text-slate-300">A duracao e o valor de cada horario vem direto do catalogo.</p>
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
  const minColumnWidth = schedule.view === 'barber' ? 224 : 340

  return (
    <div className="page-section mx-auto flex max-w-[1820px] flex-col gap-5">
      <PageHeader
        title="Agendamentos"
        description="Agenda interna da barbearia com leitura rapida por dia ou por barbeiro, foco operacional e acoes para confirmar, ajustar e concluir atendimentos."
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

      <section className="dashboard-panel dashboard-spotlight px-5 py-5 sm:px-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <h2 className="text-[2rem] font-semibold tracking-tight text-white sm:text-[2.35rem]">
              {schedule.view === 'barber'
                ? 'Agenda por barbeiro'
                : professionalLocked
                  ? 'Minha agenda do dia'
                  : 'Agenda do dia'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              {schedule.rangeLabel}. {schedule.view === 'barber'
                ? 'Veja a equipe inteira por coluna, com leitura proporcional e escalavel para muitos barbeiros.'
                : 'Use a timeline resumida do dia para decidir rapido sem poluir a tela.'}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="spotlight-chip">
                <CalendarClock className="h-3.5 w-3.5 text-sky-200" />
                {schedule.summary.scheduledCount} ativos
              </span>
              <span className="spotlight-chip">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-200" />
                {formatCurrency(schedule.summary.scheduledValue)}
              </span>
              <span className="spotlight-chip">
                {schedule.view === 'barber' ? <PanelsTopLeft className="h-3.5 w-3.5 text-slate-200" /> : <LayoutGrid className="h-3.5 w-3.5 text-slate-200" />}
                {schedule.view === 'barber' ? 'Grade da equipe' : 'Timeline simplificada'}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <div className="spotlight-stat">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Confirmados</p>
              <p className="mt-2 text-3xl font-semibold text-white">{schedule.summary.confirmedCount}</p>
              <p className="mt-2 text-sm text-slate-300">{formatPercent(scheduledRatio)} da agenda pronta para atendimento.</p>
            </div>
            <div className="spotlight-stat">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Pendentes</p>
              <p className="mt-2 text-3xl font-semibold text-white">{schedule.summary.pendingCount}</p>
              <p className="mt-2 text-sm text-slate-300">Espacos que ainda pedem confirmacao.</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="dashboard-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[rgba(255,255,255,0.06)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <h3 className="text-lg font-semibold text-white">
                {schedule.view === 'barber' ? 'Visao por barbeiro' : 'Visao por dia'}
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                Cards resumidos por padrao, preview no hover e detalhe completo no clique para manter a grade escaneavel.
              </p>
            </div>
            <div className="text-sm text-slate-400">
              {schedule.selectedProfessionalId
                ? 'Filtro por barbeiro ativo.'
                : schedule.view === 'barber'
                  ? 'Cada coluna representa um barbeiro ativo da equipe.'
                  : 'Uma timeline unica resume o fluxo operacional do dia.'}
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
          <section className="premium-rail">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
              {schedule.panel.mode === 'professional' ? 'Barbeiro' : 'Equipe'}
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">{schedule.panel.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{schedule.panel.subtitle}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">Faturamento do periodo</p>
                <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(schedule.panel.periodRevenue)}</p>
                <p className="mt-1 text-sm text-slate-400">Meta: {formatCurrency(schedule.panel.periodGoal)}</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(52,211,153,0.14)] bg-[rgba(16,185,129,0.08)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-emerald-200">Ritmo da meta</p>
                <p className="mt-2 text-2xl font-semibold text-white">{formatPercent(schedule.panel.periodGoalProgress)}</p>
                <p className="mt-1 text-sm text-emerald-100/75">Leitura do periodo atual com receita real.</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">Agendado hoje</p>
                <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(schedule.panel.scheduledValueToday)}</p>
                <p className="mt-1 text-sm text-slate-400">Protege o caixa de curto prazo.</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">Concluidos no dia</p>
                <p className="mt-2 text-2xl font-semibold text-white">{schedule.panel.completedCount}</p>
                <p className="mt-1 text-sm text-slate-400">Leitura operacional do fechamento do dia.</p>
              </div>
            </div>
          </section>

          <section className="premium-block">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Fila do dia</p>
                <h3 className="mt-2 text-lg font-semibold text-white">Proximos atendimentos</h3>
              </div>
              <Clock3 className="h-5 w-5 text-slate-400" />
            </div>

            <div className="mt-4 space-y-3">
              {schedule.panel.upcomingToday.length > 0 ? schedule.panel.upcomingToday.map((appointment) => (
                <div key={appointment.id} className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{appointment.customerName}</p>
                      <p className="mt-1 truncate text-sm text-slate-400">
                        {appointment.serviceName} com {appointment.professionalName}
                      </p>
                    </div>
                    <span className="rounded-[0.7rem] bg-[rgba(255,255,255,0.05)] px-2.5 py-1 text-xs font-medium text-slate-200">
                      {formatTime(appointment.startAt)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                    <span className="truncate">{appointment.customerPhone ?? 'Sem telefone'}</span>
                    <span>{formatCurrency(appointment.priceSnapshot)}</span>
                  </div>
                </div>
              )) : (
                <div className="rounded-[0.95rem] border border-dashed border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.02)] p-5 text-sm text-slate-400">
                  Nenhum horario montado para este dia. Abra um novo agendamento e comece a preencher a agenda.
                </div>
              )}
            </div>
          </section>

          <details className="disclosure-panel">
            <summary className="disclosure-summary">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Status da agenda</p>
                <h3 className="mt-2 text-lg font-semibold text-white">Leitura rapida</h3>
              </div>
              <span className="rounded-[0.75rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-xs font-semibold text-slate-300">
                Abrir
              </span>
            </summary>

            <div className="disclosure-body space-y-3">
              {[
                {
                  label: 'Confirmados',
                  value: schedule.summary.confirmedCount,
                  helper: 'Prontos para rodar',
                  icon: CheckCircle2,
                  tone: 'text-emerald-200',
                },
                {
                  label: 'Pendentes',
                  value: schedule.summary.pendingCount,
                  helper: 'Pedem retorno rapido',
                  icon: Clock3,
                  tone: 'text-amber-200',
                },
                {
                  label: 'Cancelados',
                  value: schedule.summary.cancelledCount,
                  helper: 'Boa chance de reagendar',
                  icon: XCircle,
                  tone: 'text-rose-200',
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-[0.8rem] bg-[rgba(255,255,255,0.04)]">
                      <item.icon className={cn('h-4 w-4', item.tone)} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                      <p className="text-xs text-slate-400">{item.helper}</p>
                    </div>
                  </div>
                  <span className="text-lg font-semibold text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </details>
        </aside>
      </div>
    </div>
  )
}
