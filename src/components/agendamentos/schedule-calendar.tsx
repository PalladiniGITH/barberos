'use client'

import { useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import {
  CalendarClock,
  Clock3,
  Phone,
  Scissors,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { AppointmentStatusActions } from '@/components/agendamentos/appointment-status-actions'
import type {
  ScheduleAppointmentItem,
  ScheduleToolbarCustomer,
  ScheduleToolbarProfessional,
  ScheduleToolbarService,
  ScheduleView,
} from '@/lib/agendamentos'
import {
  APPOINTMENT_BILLING_MODEL_LABELS,
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  CUSTOMER_TYPE_LABELS,
  cn,
  formatCurrency,
  formatDate,
  formatTime,
} from '@/lib/utils'

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

interface ScheduleCalendarProps {
  columns: ScheduleCalendarColumn[]
  view: ScheduleView
  selectedProfessionalId: string | null
  hours: string[]
  schedulePxPerMinute: number
  calendarHeight: number
  minColumnWidth: number
  professionals: ScheduleToolbarProfessional[]
  services: ScheduleToolbarService[]
  recentCustomers: ScheduleToolbarCustomer[]
}

const EVENT_GAP = 8

function getAppointmentStatusMeta(status: ScheduleAppointmentItem['status']) {
  const styles = {
    PENDING: {
      accent: 'from-amber-300/80 via-amber-400/70 to-transparent',
      badge: 'border-[rgba(251,191,36,0.2)] bg-[rgba(251,191,36,0.12)] text-amber-100',
      shell: 'border-[rgba(251,191,36,0.1)] bg-[linear-gradient(180deg,rgba(251,191,36,0.1),rgba(15,23,42,0.92))]',
    },
    CONFIRMED: {
      accent: 'from-emerald-300/80 via-emerald-400/70 to-transparent',
      badge: 'border-[rgba(52,211,153,0.18)] bg-[rgba(52,211,153,0.12)] text-emerald-100',
      shell: 'border-[rgba(52,211,153,0.1)] bg-[linear-gradient(180deg,rgba(16,185,129,0.1),rgba(15,23,42,0.92))]',
    },
    CANCELLED: {
      accent: 'from-rose-300/80 via-rose-400/70 to-transparent',
      badge: 'border-[rgba(251,113,133,0.18)] bg-[rgba(251,113,133,0.12)] text-rose-100',
      shell: 'border-[rgba(251,113,133,0.1)] bg-[linear-gradient(180deg,rgba(251,113,133,0.09),rgba(15,23,42,0.92))]',
    },
    COMPLETED: {
      accent: 'from-sky-300/80 via-sky-400/70 to-transparent',
      badge: 'border-[rgba(56,189,248,0.18)] bg-[rgba(56,189,248,0.12)] text-sky-100',
      shell: 'border-[rgba(56,189,248,0.1)] bg-[linear-gradient(180deg,rgba(56,189,248,0.1),rgba(15,23,42,0.92))]',
    },
    NO_SHOW: {
      accent: 'from-fuchsia-300/80 via-pink-400/70 to-transparent',
      badge: 'border-[rgba(244,114,182,0.18)] bg-[rgba(244,114,182,0.12)] text-pink-100',
      shell: 'border-[rgba(244,114,182,0.1)] bg-[linear-gradient(180deg,rgba(244,114,182,0.1),rgba(15,23,42,0.92))]',
    },
  } as const

  return styles[status] ?? styles.PENDING
}

function getEventWidth(laneCount: number) {
  if (laneCount <= 1) {
    return `calc(100% - ${EVENT_GAP * 2}px)`
  }

  return `calc((100% - ${EVENT_GAP * (laneCount + 1)}px) / ${laneCount})`
}

function getEventLeft(laneIndex: number, laneCount: number) {
  if (laneCount <= 1) {
    return `${EVENT_GAP}px`
  }

  const width = getEventWidth(laneCount)
  return `calc(${EVENT_GAP}px + ${laneIndex} * (${width} + ${EVENT_GAP}px))`
}

function getAppointmentTop(date: string, pxPerMinute: number) {
  const start = new Date(date)
  return (((start.getHours() - 8) * 60) + start.getMinutes()) * pxPerMinute
}

function DetailPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  const toneClass = {
    neutral: 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-slate-200',
    positive: 'border-[rgba(52,211,153,0.18)] bg-[rgba(16,185,129,0.12)] text-emerald-100',
    warning: 'border-[rgba(251,191,36,0.18)] bg-[rgba(251,191,36,0.12)] text-amber-100',
  }[tone]

  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold', toneClass)}>
      {children}
    </span>
  )
}

function AppointmentPreview({
  appointment,
}: {
  appointment: PositionedAppointment
}) {
  const statusMeta = getAppointmentStatusMeta(appointment.status)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
          {formatDate(appointment.startAt)} / {formatTime(appointment.startAt)} - {formatTime(appointment.endAt)}
        </p>
        <p className="mt-2 text-base font-semibold text-white">{appointment.customerName}</p>
        <p className="mt-1 text-sm text-slate-300">{appointment.serviceName}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold', statusMeta.badge)}>
          {APPOINTMENT_STATUS_LABELS[appointment.status]}
        </span>
        <DetailPill>{CUSTOMER_TYPE_LABELS[appointment.customerType]}</DetailPill>
        <DetailPill>{APPOINTMENT_BILLING_MODEL_LABELS[appointment.billingModel]}</DetailPill>
      </div>

      <div className="grid gap-2 rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-3 text-xs text-slate-300">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-400">Barbeiro</span>
          <span className="font-medium text-slate-100">{appointment.professionalName}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-400">Duracao</span>
          <span className="font-medium text-slate-100">{appointment.durationMinutes} min</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-400">Valor</span>
          <span className="font-medium text-slate-100">{formatCurrency(appointment.priceSnapshot)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-400">Contato</span>
          <span className="truncate font-medium text-slate-100">
            {appointment.customerPhone ?? appointment.customerEmail ?? 'Sem contato'}
          </span>
        </div>
      </div>

      {appointment.notes && (
        <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Observacao</p>
          <p className="mt-2 text-sm leading-6 text-slate-200">{appointment.notes}</p>
        </div>
      )}

      <p className="text-xs leading-5 text-slate-400">Passe o olho aqui para contexto rapido. No clique, abrimos a visao completa do agendamento.</p>
    </div>
  )
}

function AppointmentDetailsDialog({
  appointment,
  professionals,
  services,
  recentCustomers,
  open,
  onOpenChange,
}: {
  appointment: PositionedAppointment
  professionals: ScheduleToolbarProfessional[]
  services: ScheduleToolbarService[]
  recentCustomers: ScheduleToolbarCustomer[]
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  const statusMeta = getAppointmentStatusMeta(appointment.status)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.72)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,760px)] -translate-x-1/2 -translate-y-1/2 rounded-[1.5rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(17,24,39,0.96))] shadow-[0_48px_120px_-60px_rgba(2,6,23,0.95)] outline-none">
          <div className="flex items-start justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] px-6 py-5">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                {formatDate(appointment.startAt)} / {formatTime(appointment.startAt)} - {formatTime(appointment.endAt)}
              </p>
              <Dialog.Title className="mt-2 truncate text-2xl font-semibold text-white">
                {appointment.customerName}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-slate-300">
                {appointment.serviceName} com {appointment.professionalName}
              </Dialog.Description>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-slate-300 transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className="flex flex-wrap gap-2">
              <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold', statusMeta.badge)}>
                {APPOINTMENT_STATUS_LABELS[appointment.status]}
              </span>
              <DetailPill>{CUSTOMER_TYPE_LABELS[appointment.customerType]}</DetailPill>
              <DetailPill tone={appointment.billingModel === 'AVULSO' ? 'neutral' : 'positive'}>
                {APPOINTMENT_BILLING_MODEL_LABELS[appointment.billingModel]}
              </DetailPill>
              <DetailPill>{APPOINTMENT_SOURCE_LABELS[appointment.source]}</DetailPill>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="surface-soft p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Resumo do atendimento</p>
                <div className="mt-4 space-y-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-slate-400">
                      <UserRound className="h-4 w-4" />
                      Cliente
                    </span>
                    <span className="font-medium text-right">{appointment.customerName}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-slate-400">
                      <Scissors className="h-4 w-4" />
                      Servico
                    </span>
                    <span className="font-medium text-right">{appointment.serviceName}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-slate-400">
                      <CalendarClock className="h-4 w-4" />
                      Barbeiro
                    </span>
                    <span className="font-medium text-right">{appointment.professionalName}</span>
                  </div>
                </div>
              </div>

              <div className="surface-soft p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Valor e operacao</p>
                <div className="mt-4 space-y-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-slate-400">
                      <Clock3 className="h-4 w-4" />
                      Duracao
                    </span>
                    <span className="font-medium">{appointment.durationMinutes} min</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-slate-400">
                      <Sparkles className="h-4 w-4" />
                      Valor do slot
                    </span>
                    <span className="font-medium">{formatCurrency(appointment.priceSnapshot)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-slate-400">
                      <Phone className="h-4 w-4" />
                      Contato
                    </span>
                    <span className="max-w-[220px] truncate font-medium text-right">
                      {appointment.customerPhone ?? appointment.customerEmail ?? 'Sem contato'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {appointment.notes && (
              <div className="surface-soft p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Observacoes</p>
                <p className="mt-3 text-sm leading-6 text-slate-200">{appointment.notes}</p>
              </div>
            )}

            <div className="rounded-[1.1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Acoes do agendamento</p>
                  <p className="mt-1 text-sm text-slate-400">Edite o horario ou atualize o status sem sair da agenda.</p>
                </div>
                <AppointmentStatusActions
                  appointment={{
                    id: appointment.id,
                    customerId: appointment.customerId,
                    customerName: appointment.customerName,
                    customerPhone: appointment.customerPhone,
                    customerEmail: appointment.customerEmail,
                    customerType: appointment.customerType,
                    subscriptionPrice: appointment.customerSubscriptionPrice,
                    professionalId: appointment.professionalId,
                    serviceId: appointment.serviceId,
                    date: format(new Date(appointment.startAt), 'yyyy-MM-dd'),
                    time: format(new Date(appointment.startAt), 'HH:mm'),
                    status: appointment.status,
                    source: appointment.source,
                    billingModel: appointment.billingModel,
                    notes: appointment.notes,
                  }}
                  professionals={professionals}
                  services={services}
                  recentCustomers={recentCustomers}
                />
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ScheduleAppointmentCard({
  appointment,
  view,
  selectedProfessionalId,
  schedulePxPerMinute,
  professionals,
  services,
  recentCustomers,
}: {
  appointment: PositionedAppointment
  view: ScheduleView
  selectedProfessionalId: string | null
  schedulePxPerMinute: number
  professionals: ScheduleToolbarProfessional[]
  services: ScheduleToolbarService[]
  recentCustomers: ScheduleToolbarCustomer[]
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const top = getAppointmentTop(appointment.startAt, schedulePxPerMinute)
  const height = Math.max(
    appointment.durationMinutes * schedulePxPerMinute,
    view === 'barber' ? 84 : 92
  )
  const width = getEventWidth(appointment.laneCount)
  const left = getEventLeft(appointment.laneIndex, appointment.laneCount)
  const compact = appointment.laneCount > 1 || height < 96
  const statusMeta = getAppointmentStatusMeta(appointment.status)

  return (
    <>
      <Popover.Root open={previewOpen} onOpenChange={setPreviewOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            onMouseEnter={() => setPreviewOpen(true)}
            onMouseLeave={() => setPreviewOpen(false)}
            onClick={() => {
              setPreviewOpen(false)
              setDialogOpen(true)
            }}
            className={cn(
              'group absolute overflow-hidden rounded-[1rem] border text-left shadow-[0_22px_46px_-28px_rgba(2,6,23,0.88)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(255,255,255,0.14)] hover:shadow-[0_30px_58px_-30px_rgba(2,6,23,0.92)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50',
              statusMeta.shell
            )}
            style={{
              top: `${top}px`,
              left,
              width,
              height: `${height}px`,
            }}
          >
            <span className={cn('absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b', statusMeta.accent)} />
            <div className="flex h-full min-w-0 flex-col justify-between px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(15,23,42,0.52)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-200">
                  {formatTime(appointment.startAt)}
                </span>
                <span className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full border border-white/10', compact ? 'mt-1' : 'mt-0.5', statusMeta.badge)} />
              </div>

              <div className="min-w-0">
                <p
                  title={appointment.customerName}
                  className={cn(
                    'overflow-hidden font-semibold text-white [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]',
                    compact ? 'text-[13px] leading-5' : 'text-sm leading-5'
                  )}
                >
                  {appointment.customerName}
                </p>
                <p
                  title={appointment.serviceName}
                  className={cn(
                    'mt-1 overflow-hidden text-slate-300 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]',
                    compact ? 'text-[11px] leading-4' : 'text-xs leading-5'
                  )}
                >
                  {appointment.serviceName}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span className="truncate">
                  {view === 'barber'
                    ? `${appointment.durationMinutes} min`
                    : selectedProfessionalId
                      ? `${appointment.durationMinutes} min`
                      : appointment.professionalName}
                </span>
                <span className="truncate text-slate-500 group-hover:text-slate-300">
                  Abrir
                </span>
              </div>
            </div>
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            side={view === 'barber' ? 'right' : 'top'}
            align="start"
            sideOffset={12}
            onMouseEnter={() => setPreviewOpen(true)}
            onMouseLeave={() => setPreviewOpen(false)}
            className="z-50 w-[320px] rounded-[1.3rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(30,41,59,0.98),rgba(15,23,42,0.97))] p-4 text-slate-100 shadow-[0_36px_90px_-44px_rgba(2,6,23,0.96)] backdrop-blur-xl"
          >
            <AppointmentPreview appointment={appointment} />
            <Popover.Arrow className="fill-[rgba(30,41,59,0.98)]" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <AppointmentDetailsDialog
        appointment={appointment}
        professionals={professionals}
        services={services}
        recentCustomers={recentCustomers}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  )
}

export function ScheduleCalendar({
  columns,
  view,
  selectedProfessionalId,
  hours,
  schedulePxPerMinute,
  calendarHeight,
  minColumnWidth,
  professionals,
  services,
  recentCustomers,
}: ScheduleCalendarProps) {
  const calendarMinWidth = 86 + (columns.length * minColumnWidth)

  return (
    <div className="overflow-x-auto">
      <div className="px-4 py-4 sm:px-6" style={{ minWidth: `${calendarMinWidth}px` }}>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `86px repeat(${Math.max(columns.length, 1)}, minmax(${minColumnWidth}px, 1fr))` }}
        >
          <div className="sticky left-0 z-20 rounded-[1rem] bg-[rgba(10,15,28,0.9)] px-2 py-3 backdrop-blur-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">Horario</p>
          </div>

          {columns.map((column) => (
            <div
              key={`${column.key}-header`}
              className="rounded-[1rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.035)] px-4 py-3"
            >
              <p className="text-sm font-semibold text-white">{column.title}</p>
              <p className="mt-1 text-xs text-slate-400">{column.helper}</p>
            </div>
          ))}
        </div>

        <div
          className="mt-3 grid gap-3"
          style={{ gridTemplateColumns: `86px repeat(${Math.max(columns.length, 1)}, minmax(${minColumnWidth}px, 1fr))` }}
        >
          <div className="sticky left-0 z-10 rounded-[1rem] bg-[rgba(10,15,28,0.94)] px-2">
            {hours.map((hour) => (
              <div
                key={hour}
                className="relative border-t border-[rgba(255,255,255,0.05)] first:border-t-0"
                style={{ height: `${60 * schedulePxPerMinute}px` }}
              >
                <span className="absolute -top-2 left-0 rounded-[0.75rem] bg-[rgba(15,23,42,0.98)] px-2 py-0.5 text-xs font-medium text-slate-400">
                  {hour}
                </span>
              </div>
            ))}
          </div>

          {columns.map((column) => (
            <div key={column.key} className="min-w-0">
              <div
                className="relative overflow-hidden rounded-[1.1rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(15,23,42,0.78),rgba(15,23,42,0.62))]"
                style={{ height: `${calendarHeight}px` }}
              >
                {hours.map((hour, index) => (
                  <div
                    key={`${column.key}-${hour}`}
                    className={cn(
                      'absolute inset-x-0 border-t first:border-t-0',
                      index % 2 === 0 ? 'border-[rgba(255,255,255,0.055)]' : 'border-[rgba(255,255,255,0.035)]'
                    )}
                    style={{ top: `${index * 60 * schedulePxPerMinute}px` }}
                  />
                ))}

                {column.appointments.map((appointment) => (
                  <ScheduleAppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    view={view}
                    selectedProfessionalId={selectedProfessionalId}
                    schedulePxPerMinute={schedulePxPerMinute}
                    professionals={professionals}
                    services={services}
                    recentCustomers={recentCustomers}
                  />
                ))}

                {column.appointments.length === 0 && (
                  <div className="absolute inset-x-5 top-6 rounded-[1rem] border border-dashed border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.025)] px-4 py-3 text-xs text-slate-500">
                    {selectedProfessionalId
                      ? 'Nenhum horario neste recorte.'
                      : 'Grade livre neste bloco.'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
