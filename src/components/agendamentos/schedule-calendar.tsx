'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import {
  GripVertical,
  Move,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  moveAppointmentSlot,
  moveScheduleBlock,
} from '@/actions/agendamentos'
import { AppointmentModal } from '@/components/agendamentos/appointment-modal'
import { ScheduleBlockModal, type ScheduleBlockValue } from '@/components/agendamentos/schedule-block-modal'
import { ProfessionalAvatar } from '@/components/ui/professional-avatar'
import type {
  ScheduleAppointmentItem,
  ScheduleToolbarProfessional,
  ScheduleToolbarService,
  ScheduleView,
} from '@/lib/agendamentos'
import {
  buildSelectionFromPoint,
  floorMinutesToStep,
  intervalsOverlap,
  minutesToTimeLabel,
  normalizeSelectionRange,
  timeLabelToMinutes,
} from '@/lib/schedule-grid'
import {
  APPOINTMENT_BILLING_MODEL_LABELS,
  APPOINTMENT_STATUS_LABELS,
  CUSTOMER_TYPE_LABELS,
  cn,
} from '@/lib/utils'
import { shouldCommitAppointmentMove } from '@/lib/agendamentos/appointment-edit'

interface PositionedAppointment extends ScheduleAppointmentItem {
  laneIndex: number
  laneCount: number
}

interface ScheduleCalendarColumn {
  key: string
  title: string
  helper: string
  professionalId: string | null
  professionalName: string | null
  professionalAvatar: string | null
  dateIso: string
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
}

interface CommittedSelection {
  columnKey: string
  professionalId: string | null
  dateIso: string
  startMinutes: number
  endMinutes: number
  durationMinutes: number
}

interface PointerSelectionState {
  columnKey: string
  professionalId: string | null
  dateIso: string
  pointerStartY: number
  anchorMinutes: number
  currentMinutes: number
}

interface DragPreview {
  itemId: string
  columnKey: string
  professionalId: string | null
  dateIso: string
  startMinutes: number
  endMinutes: number
  durationMinutes: number
  valid: boolean
}

interface DragState {
  item: PositionedAppointment
  sourceColumnKey: string
  sourceProfessionalId: string | null
  pointerStartX: number
  pointerStartY: number
  originalStartMinutes: number
  movedEnoughForDrag: boolean
}

const EVENT_GAP = 8
const MINIMUM_SELECTION_DURATION = 30
const SCHEDULE_MAJOR_GRID_LINE = 'rgba(148, 163, 184, 0.14)'
const SCHEDULE_MAJOR_GRID_LINE_SOFT = 'rgba(8, 10, 14, 0.52)'
const SCHEDULE_MINOR_GRID_LINE = 'rgba(124, 58, 237, 0.1)'
const APPOINTMENT_DRAG_THRESHOLD_PX = 8

function getAppointmentStatusMeta(item: PositionedAppointment) {
  if (item.itemType === 'BLOCK') {
    return {
      accent: 'from-violet-500/85 via-violet-400/55 to-transparent',
      badge: 'border-[rgba(91,33,182,0.18)] bg-[rgba(91,33,182,0.1)] text-violet-100',
      shell: 'border-[rgba(124,58,237,0.16)] bg-[linear-gradient(180deg,rgba(78,48,144,0.26),rgba(18,18,23,0.98))]',
    } as const
  }

  const styles = {
    PENDING: {
      accent: 'from-amber-400/85 via-amber-300/55 to-transparent',
      badge: 'border-[rgba(245,158,11,0.18)] bg-[rgba(245,158,11,0.1)] text-amber-100',
      shell: 'border-[rgba(245,158,11,0.16)] bg-[linear-gradient(180deg,rgba(120,82,22,0.24),rgba(18,18,23,0.98))]',
    },
    CONFIRMED: {
      accent: 'from-emerald-400/88 via-emerald-300/58 to-transparent',
      badge: 'border-[rgba(16,185,129,0.16)] bg-[rgba(16,185,129,0.1)] text-emerald-100',
      shell: 'border-[rgba(34,197,94,0.15)] bg-[linear-gradient(180deg,rgba(28,84,62,0.24),rgba(18,18,23,0.98))]',
    },
    CANCELLED: {
      accent: 'from-rose-400/88 via-rose-300/58 to-transparent',
      badge: 'border-[rgba(244,63,94,0.16)] bg-[rgba(244,63,94,0.1)] text-rose-100',
      shell: 'border-[rgba(244,63,94,0.16)] bg-[linear-gradient(180deg,rgba(98,34,49,0.26),rgba(18,18,23,0.98))]',
    },
    COMPLETED: {
      accent: 'from-sky-400/88 via-sky-300/58 to-transparent',
      badge: 'border-[rgba(14,165,233,0.16)] bg-[rgba(14,165,233,0.1)] text-sky-100',
      shell: 'border-[rgba(14,165,233,0.15)] bg-[linear-gradient(180deg,rgba(25,77,101,0.24),rgba(18,18,23,0.98))]',
    },
    NO_SHOW: {
      accent: 'from-pink-400/88 via-fuchsia-300/58 to-transparent',
      badge: 'border-[rgba(236,72,153,0.16)] bg-[rgba(236,72,153,0.1)] text-pink-100',
      shell: 'border-[rgba(236,72,153,0.16)] bg-[linear-gradient(180deg,rgba(99,34,70,0.24),rgba(18,18,23,0.98))]',
    },
  } as const

  return styles[item.status] ?? styles.PENDING
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

function getAppointmentTop(startMinutesOfDay: number, dayStartMinutes: number, pxPerMinute: number) {
  return (startMinutesOfDay - dayStartMinutes) * pxPerMinute
}

function buildAppointmentFormValue(appointment: PositionedAppointment) {
  return {
    id: appointment.id,
    customerId: appointment.customerId,
    customerName: appointment.customerName,
    customerPhone: appointment.customerPhone,
    customerEmail: appointment.customerEmail,
    customerType: appointment.customerType,
    subscriptionPrice: appointment.customerSubscriptionPrice,
    professionalId: appointment.professionalId,
    serviceId: appointment.serviceId,
    date: appointment.localDateIso,
    time: appointment.startTimeLabel,
    status: appointment.status,
    source: appointment.source,
    billingModel: appointment.billingModel,
    priceSnapshot: appointment.priceSnapshot,
    notes: appointment.notes,
  }
}

function buildScheduleBlockValue(item: PositionedAppointment): ScheduleBlockValue {
  return {
    id: item.id,
    date: item.localDateIso,
    startTime: item.startTimeLabel,
    endTime: item.endTimeLabel,
    professionalId: item.professionalId,
    notes: item.blockReason ?? item.notes,
  }
}

function itemBlocksScheduling(item: PositionedAppointment) {
  return item.itemType === 'BLOCK' || item.status === 'PENDING' || item.status === 'CONFIRMED'
}

function ScheduleItemPreview({ item }: { item: PositionedAppointment }) {
  const statusMeta = getAppointmentStatusMeta(item)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {item.localDateLabel} - {item.startTimeLabel} - {item.endTimeLabel}
        </p>
        <p className="mt-2 text-base font-semibold text-foreground">
          {item.itemType === 'BLOCK' ? item.notes ?? 'Bloqueio operacional' : item.customerName}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {item.itemType === 'BLOCK' ? `Bloqueio com ${item.professionalName}` : item.serviceName}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold', statusMeta.badge)}>
          {item.itemType === 'BLOCK' ? 'Bloqueado' : APPOINTMENT_STATUS_LABELS[item.status]}
        </span>
        {item.itemType === 'APPOINTMENT' && (
          <>
            <span className="inline-flex items-center rounded-full border border-[rgba(84,35,145,0.08)] bg-[rgba(124,58,237,0.04)] px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              {CUSTOMER_TYPE_LABELS[item.customerType]}
            </span>
            <span className="inline-flex items-center rounded-full border border-[rgba(84,35,145,0.08)] bg-[rgba(124,58,237,0.04)] px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              {APPOINTMENT_BILLING_MODEL_LABELS[item.billingModel]}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function AppointmentDetailsDialog({
  appointment,
  professionals,
  services,
  open,
  onOpenChange,
}: {
  appointment: PositionedAppointment
  professionals: ScheduleToolbarProfessional[]
  services: ScheduleToolbarService[]
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  return (
    <AppointmentModal
      hideTrigger
      open={open}
      onOpenChange={onOpenChange}
      appointment={buildAppointmentFormValue(appointment)}
      defaultDate={appointment.localDateIso}
      defaultTime={appointment.startTimeLabel}
      defaultProfessionalId={appointment.professionalId}
      professionals={professionals}
      services={services}
    />
  )
}

function ScheduleAppointmentCard({
  item,
  view,
  selectedProfessionalId,
  schedulePxPerMinute,
  dayStartMinutes,
  onPointerDown,
  onOpenAppointment,
  onOpenBlock,
  registerPreviewCloser,
}: {
  item: PositionedAppointment
  view: ScheduleView
  selectedProfessionalId: string | null
  schedulePxPerMinute: number
  dayStartMinutes: number
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>, item: PositionedAppointment) => void
  onOpenAppointment: (item: PositionedAppointment) => void
  onOpenBlock: (item: PositionedAppointment) => void
  registerPreviewCloser: (closer: () => void) => () => void
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const closePreview = useCallback(() => {
    setPreviewOpen(false)
  }, [])
  const top = getAppointmentTop(item.startMinutesOfDay, dayStartMinutes, schedulePxPerMinute)
  const height = Math.max(item.durationMinutes * schedulePxPerMinute, item.itemType === 'BLOCK' ? 56 : view === 'barber' ? 84 : 92)
  const width = getEventWidth(item.laneCount)
  const left = getEventLeft(item.laneIndex, item.laneCount)
  const compact = item.laneCount > 1 || height < 96
  const statusMeta = getAppointmentStatusMeta(item)

  useEffect(() => registerPreviewCloser(closePreview), [closePreview, registerPreviewCloser])

  return (
    <Popover.Root modal={false} open={previewOpen} onOpenChange={setPreviewOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onPointerDown={(event) => onPointerDown(event, item)}
          onWheelCapture={closePreview}
          onMouseEnter={() => setPreviewOpen(true)}
          onMouseLeave={() => setPreviewOpen(false)}
          onClick={() => {
            closePreview()
            if (item.itemType === 'BLOCK') {
              onOpenBlock(item)
            } else {
              onOpenAppointment(item)
            }
          }}
          className={cn(
            'group absolute overflow-hidden rounded-[1rem] border text-left shadow-[0_18px_34px_-24px_rgba(8,10,18,0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_42px_-28px_rgba(8,10,18,0.62)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,33,182,0.26)]',
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
          <div className="flex h-full min-w-0 flex-col justify-between px-3 py-3.5">
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(8,10,14,0.62)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-100">
                {item.startTimeLabel}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
                <GripVertical className="h-3 w-3" />
                mover
              </span>
            </div>

            <div className="min-w-0">
              <p
                title={item.itemType === 'BLOCK' ? item.notes ?? 'Bloqueio operacional' : item.customerName}
                className={cn(
                  'overflow-hidden font-semibold text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]',
                  compact ? 'text-[13px] leading-5' : 'text-sm leading-5'
                )}
              >
                {item.itemType === 'BLOCK' ? item.notes ?? 'Bloqueio operacional' : item.customerName}
              </p>
              <p
                title={item.itemType === 'BLOCK' ? `Bloqueio com ${item.professionalName}` : item.serviceName}
                className={cn(
                  'mt-1 overflow-hidden text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]',
                  compact ? 'text-[11px] leading-4 text-slate-300' : 'text-xs leading-5 text-slate-300'
                )}
              >
                {item.itemType === 'BLOCK' ? `Bloqueio com ${item.professionalName}` : item.serviceName}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
              <span className="truncate">
                {item.itemType === 'BLOCK'
                  ? 'Intervalo indisponivel'
                  : view === 'barber'
                    ? `${item.durationMinutes} min`
                    : selectedProfessionalId
                      ? `${item.durationMinutes} min`
                      : item.professionalName}
              </span>
              <span className="truncate group-hover:text-primary">
                {item.itemType === 'BLOCK' ? 'Bloqueio' : item.source === 'WHATSAPP' ? 'WhatsApp' : 'Manual'}
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
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={closePreview}
          onWheelCapture={closePreview}
          className="pointer-events-none z-50 w-[320px] select-none rounded-[1.3rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,30,40,0.98),rgba(12,13,17,0.995))] p-4 text-foreground shadow-[0_36px_90px_-44px_rgba(2,6,23,0.82)]"
        >
          <ScheduleItemPreview item={item} />
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
}: ScheduleCalendarProps) {
  const calendarRootRef = useRef<HTMLDivElement | null>(null)
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const hoverPreviewClosersRef = useRef(new Set<() => void>())
  const suppressAppointmentOpenRef = useRef<string | null>(null)
  const [pointerSelection, setPointerSelection] = useState<PointerSelectionState | null>(null)
  const [committedSelection, setCommittedSelection] = useState<CommittedSelection | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [savingMoveId, setSavingMoveId] = useState<string | null>(null)
  const [appointmentModalState, setAppointmentModalState] = useState<{
    open: boolean
    defaultDate: string
    defaultTime: string
    defaultProfessionalId: string | null
  }>({
    open: false,
    defaultDate: columns[0]?.dateIso ?? '',
    defaultTime: '09:00',
    defaultProfessionalId: columns[0]?.professionalId ?? selectedProfessionalId,
  })
  const [activeAppointment, setActiveAppointment] = useState<PositionedAppointment | null>(null)
  const [activeBlock, setActiveBlock] = useState<PositionedAppointment | null>(null)

  const calendarMinWidth = 88 + (columns.length * minColumnWidth)
  const dayStartMinutes = useMemo(() => timeLabelToMinutes(hours[0] ?? '08:00'), [hours])
  const dayEndMinutes = useMemo(() => {
    const lastHour = hours[hours.length - 1] ?? '20:00'
    return timeLabelToMinutes(lastHour) + 60
  }, [hours])

  const registerPreviewCloser = useCallback((closer: () => void) => {
    hoverPreviewClosersRef.current.add(closer)

    return () => {
      hoverPreviewClosersRef.current.delete(closer)
    }
  }, [])

  const dismissHoverPreviews = useCallback(() => {
    hoverPreviewClosersRef.current.forEach((closePreview) => {
      closePreview()
    })
  }, [])

  function clearCurrentSelection() {
    setPointerSelection(null)
    setCommittedSelection(null)
  }

  function getColumnByKey(columnKey: string) {
    return columns.find((column) => column.key === columnKey) ?? null
  }

  function resolveMinutesFromPointer(columnKey: string, clientY: number) {
    const element = columnRefs.current[columnKey]

    if (!element) {
      return dayStartMinutes
    }

    const rect = element.getBoundingClientRect()
    const rawMinutes = dayStartMinutes + ((clientY - rect.top) / schedulePxPerMinute)
    return Math.max(dayStartMinutes, Math.min(dayEndMinutes, rawMinutes))
  }

  function findColumnFromPointer(clientX: number) {
    return columns.find((column) => {
      const rect = columnRefs.current[column.key]?.getBoundingClientRect()
      return rect ? clientX >= rect.left && clientX <= rect.right : false
    }) ?? null
  }

  function hasConflict(input: {
    column: ScheduleCalendarColumn
    professionalId: string | null
    startMinutes: number
    endMinutes: number
    ignoreId?: string
  }) {
    return input.column.appointments.some((entry) => {
      if (entry.id === input.ignoreId || !itemBlocksScheduling(entry)) {
        return false
      }

      if (!input.column.professionalId && input.professionalId && entry.professionalId !== input.professionalId) {
        return false
      }

      return intervalsOverlap({
        startMinutes: input.startMinutes,
        endMinutes: input.endMinutes,
        compareStartMinutes: entry.startMinutesOfDay,
        compareEndMinutes: entry.startMinutesOfDay + entry.durationMinutes,
      })
    })
  }

  useEffect(() => {
    if (!pointerSelection && !dragState) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      if (pointerSelection) {
        setCommittedSelection(null)
        setPointerSelection((current) => current ? { ...current, currentMinutes: resolveMinutesFromPointer(current.columnKey, event.clientY) } : null)
      }

      if (dragState) {
        const pointerDistanceX = Math.abs(event.clientX - dragState.pointerStartX)
        const pointerDistanceY = Math.abs(event.clientY - dragState.pointerStartY)
        const movedEnoughForDrag = dragState.movedEnoughForDrag
          || Math.max(pointerDistanceX, pointerDistanceY) >= APPOINTMENT_DRAG_THRESHOLD_PX

        if (!movedEnoughForDrag) {
          return
        }

        if (!dragState.movedEnoughForDrag) {
          setDragState((current) => current ? { ...current, movedEnoughForDrag: true } : current)
        }

        const candidateColumn = findColumnFromPointer(event.clientX) ?? getColumnByKey(dragState.sourceColumnKey)
        if (!candidateColumn) {
          return
        }

        const deltaMinutes = (event.clientY - dragState.pointerStartY) / schedulePxPerMinute
        const nextStart = floorMinutesToStep(dragState.originalStartMinutes + deltaMinutes)
        const startMinutes = Math.max(dayStartMinutes, Math.min(dayEndMinutes - dragState.item.durationMinutes, nextStart))
        const endMinutes = Math.min(dayEndMinutes, startMinutes + dragState.item.durationMinutes)
        const professionalId = candidateColumn.professionalId ?? dragState.item.professionalId
        const valid = !hasConflict({
          column: candidateColumn,
          professionalId,
          startMinutes,
          endMinutes,
          ignoreId: dragState.item.id,
        })

        setDragPreview({
          itemId: dragState.item.id,
          columnKey: candidateColumn.key,
          professionalId,
          dateIso: candidateColumn.dateIso,
          startMinutes,
          endMinutes,
          durationMinutes: dragState.item.durationMinutes,
          valid,
        })
      }
    }

    async function handlePointerUp() {
      if (pointerSelection) {
        const normalized = normalizeSelectionRange({
          anchorMinutes: pointerSelection.anchorMinutes,
          currentMinutes: pointerSelection.currentMinutes,
          dayStartMinutes,
          dayEndMinutes,
          minimumDuration: MINIMUM_SELECTION_DURATION,
        })
        const pointerDistance = Math.abs(pointerSelection.currentMinutes - pointerSelection.anchorMinutes) * schedulePxPerMinute

        if (pointerDistance < 8) {
          const quickSelection = buildSelectionFromPoint({
            minutes: pointerSelection.anchorMinutes,
            dayStartMinutes,
            dayEndMinutes,
            defaultDuration: MINIMUM_SELECTION_DURATION,
          })
          setAppointmentModalState({
            open: true,
            defaultDate: pointerSelection.dateIso,
            defaultTime: minutesToTimeLabel(quickSelection.startMinutes),
            defaultProfessionalId: pointerSelection.professionalId,
          })
        } else {
          setCommittedSelection({
            columnKey: pointerSelection.columnKey,
            professionalId: pointerSelection.professionalId,
            dateIso: pointerSelection.dateIso,
            ...normalized,
          })
        }

        setPointerSelection(null)
      }

      if (dragState) {
        if (dragState.movedEnoughForDrag) {
          suppressAppointmentOpenRef.current = dragState.item.id
        }

        const shouldCommitMove = Boolean(
          dragState.movedEnoughForDrag
          && dragPreview
          && dragPreview.valid
          && shouldCommitAppointmentMove(
            {
              dateIso: dragState.item.localDateIso,
              startMinutes: dragState.item.startMinutesOfDay,
              professionalId: dragState.item.professionalId,
            },
            {
              dateIso: dragPreview.dateIso,
              startMinutes: dragPreview.startMinutes,
              professionalId: dragPreview.professionalId,
            },
          )
        )

        if (shouldCommitMove && dragPreview) {
          const professionalId = dragPreview.professionalId ?? dragState.item.professionalId
          const date = dragPreview.dateIso

          setSavingMoveId(dragState.item.id)
          const result = dragState.item.itemType === 'BLOCK'
            ? await moveScheduleBlock(dragState.item.id, {
                professionalId,
                date,
                startTime: minutesToTimeLabel(dragPreview.startMinutes),
                endTime: minutesToTimeLabel(dragPreview.endMinutes),
                notes: dragState.item.notes ?? dragState.item.blockReason ?? '',
              })
            : await moveAppointmentSlot(dragState.item.id, {
                professionalId,
                date,
                time: minutesToTimeLabel(dragPreview.startMinutes),
              })

          setSavingMoveId(null)

          if (result.success) {
            toast.success(dragState.item.itemType === 'BLOCK' ? 'Bloqueio remarcado.' : 'Agendamento remarcado.')
          } else {
            toast.error(result.error ?? 'Não foi possível mover esse bloco.')
          }
        }

        setDragState(null)
        setDragPreview(null)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [
    columns,
    dayEndMinutes,
    dayStartMinutes,
    dragPreview,
    dragState,
    pointerSelection,
    schedulePxPerMinute,
  ])

  useEffect(() => {
    function shouldDismissFromEventTarget(target: EventTarget | null) {
      const root = calendarRootRef.current

      if (!root || !(target instanceof Node)) {
        return false
      }

      if (root.contains(target)) {
        return true
      }

      return target instanceof Element || target instanceof Document
        ? target.contains(root)
        : false
    }

    function handleHoverInterrupt(event: Event) {
      if (shouldDismissFromEventTarget(event.target)) {
        dismissHoverPreviews()
      }
    }

    window.addEventListener('wheel', handleHoverInterrupt, { capture: true, passive: true })
    window.addEventListener('scroll', handleHoverInterrupt, { capture: true, passive: true })

    return () => {
      window.removeEventListener('wheel', handleHoverInterrupt, true)
      window.removeEventListener('scroll', handleHoverInterrupt, true)
    }
  }, [dismissHoverPreviews])

  return (
    <>
      <div ref={calendarRootRef} onWheelCapture={dismissHoverPreviews} className="overflow-x-auto pb-1">
        <div className="px-4 py-5 sm:px-6" style={{ minWidth: `${calendarMinWidth}px` }}>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `88px repeat(${Math.max(columns.length, 1)}, minmax(${minColumnWidth}px, 1fr))` }}
          >
            <div className="sticky left-0 z-20 rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(31,34,44,0.99),rgba(18,20,28,0.99))] px-3 py-3 shadow-[0_16px_24px_-18px_rgba(2,6,23,0.54)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Horario</p>
            </div>

            {columns.map((column) => (
              <div
                key={`${column.key}-header`}
                className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(31,34,44,0.99),rgba(18,20,28,0.99))] px-4 py-3 shadow-[0_16px_24px_-18px_rgba(2,6,23,0.5)]"
              >
                <div className="flex items-start gap-3">
                  {column.professionalName ? (
                    <ProfessionalAvatar
                      name={column.professionalName}
                      imageUrl={column.professionalAvatar}
                      size="sm"
                      className="mt-0.5"
                    />
                  ) : null}

                  <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-tight text-foreground">{column.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{column.helper}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div
            className="mt-3 grid gap-3"
            style={{ gridTemplateColumns: `88px repeat(${Math.max(columns.length, 1)}, minmax(${minColumnWidth}px, 1fr))` }}
          >
            <div className="sticky left-0 z-10 rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(29,31,39,0.98),rgba(17,18,24,0.99))] px-2 shadow-[0_16px_24px_-18px_rgba(2,6,23,0.5)]">
              {hours.map((hour, index) => (
                <div
                  key={hour}
                  className="relative border-t"
                  style={{
                    height: `${60 * schedulePxPerMinute}px`,
                    borderTopColor: index === 0 ? 'transparent' : SCHEDULE_MAJOR_GRID_LINE,
                    boxShadow: index === 0 ? undefined : `inset 0 1px 0 ${SCHEDULE_MAJOR_GRID_LINE_SOFT}`,
                  }}
                >
                  <span className={cn(
                    'absolute -top-2 left-0 rounded-[0.7rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(9,10,14,0.88)] px-2.5 py-1 text-xs font-semibold text-foreground shadow-[0_10px_16px_-10px_rgba(2,6,23,0.5)]',
                    index === 0 ? 'top-0' : ''
                  )}>
                    {hour}
                  </span>
                </div>
              ))}
            </div>
            {columns.map((column) => {
              const liveSelection = pointerSelection?.columnKey === column.key
                ? normalizeSelectionRange({
                    anchorMinutes: pointerSelection.anchorMinutes,
                    currentMinutes: pointerSelection.currentMinutes,
                    dayStartMinutes,
                    dayEndMinutes,
                    minimumDuration: MINIMUM_SELECTION_DURATION,
                  })
                : null
              const committedForColumn = committedSelection?.columnKey === column.key ? committedSelection : null
              const dragPreviewForColumn = dragPreview?.columnKey === column.key ? dragPreview : null

              return (
                <div key={column.key} className="min-w-0">
                  <div
                    ref={(element) => {
                      columnRefs.current[column.key] = element
                    }}
                    onPointerDown={(event) => {
                      const target = event.target as HTMLElement
                      if (target.closest('[data-schedule-item], [data-schedule-selection-actions]')) {
                        return
                      }

                      setActiveAppointment(null)
                      setActiveBlock(null)
                      const minutes = resolveMinutesFromPointer(column.key, event.clientY)
                      setPointerSelection({
                        columnKey: column.key,
                        professionalId: column.professionalId,
                        dateIso: column.dateIso,
                        pointerStartY: event.clientY,
                        anchorMinutes: minutes,
                        currentMinutes: minutes,
                      })
                    }}
                    className="relative overflow-hidden rounded-[1.05rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(23,25,31,0.98),rgba(14,15,20,0.99))] shadow-[0_18px_28px_-20px_rgba(2,6,23,0.56)]"
                    style={{ height: `${calendarHeight}px` }}
                  >
                    {hours.map((hour, index) => (
                      <div key={`${column.key}-${hour}`}>
                        <div
                          className="absolute inset-x-0 border-t"
                          style={{
                            top: `${index * 60 * schedulePxPerMinute}px`,
                            borderColor: SCHEDULE_MAJOR_GRID_LINE,
                            boxShadow: `0 1px 0 ${SCHEDULE_MAJOR_GRID_LINE_SOFT}`,
                          }}
                        />
                        {index < hours.length - 1 && (
                          <div
                            className="absolute inset-x-0 border-t border-dashed"
                            style={{
                              top: `${index * 60 * schedulePxPerMinute + 30 * schedulePxPerMinute}px`,
                              borderColor: SCHEDULE_MINOR_GRID_LINE,
                            }}
                          />
                        )}
                      </div>
                    ))}

                    {column.appointments.map((item) => (
                      <div key={item.id} data-schedule-item>
                        <ScheduleAppointmentCard
                          item={item}
                          view={view}
                          selectedProfessionalId={selectedProfessionalId}
                          schedulePxPerMinute={schedulePxPerMinute}
                          dayStartMinutes={dayStartMinutes}
                          registerPreviewCloser={registerPreviewCloser}
                          onPointerDown={(event, currentItem) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setCommittedSelection(null)
                            setPointerSelection(null)
                            setDragState({
                              item: currentItem,
                              sourceColumnKey: column.key,
                              sourceProfessionalId: column.professionalId,
                              pointerStartX: event.clientX,
                              pointerStartY: event.clientY,
                              originalStartMinutes: currentItem.startMinutesOfDay,
                              movedEnoughForDrag: false,
                            })
                            setDragPreview(null)
                          }}
                          onOpenAppointment={(item) => {
                            if (suppressAppointmentOpenRef.current === item.id) {
                              suppressAppointmentOpenRef.current = null
                              return
                            }

                            setActiveAppointment(item)
                          }}
                          onOpenBlock={setActiveBlock}
                        />
                      </div>
                    ))}

                    {liveSelection && (
                      <div
                        className="absolute inset-x-3 rounded-[0.9rem] border border-dashed border-[rgba(91,33,182,0.18)] bg-[rgba(91,33,182,0.08)]"
                        style={{
                          top: `${getAppointmentTop(liveSelection.startMinutes, dayStartMinutes, schedulePxPerMinute)}px`,
                          height: `${Math.max(liveSelection.durationMinutes * schedulePxPerMinute, 40)}px`,
                        }}
                      />
                    )}

                    {committedForColumn && (
                      <div
                        data-schedule-selection-actions
                        className="absolute inset-x-3 rounded-[0.9rem] border border-[rgba(91,33,182,0.16)] bg-[rgba(91,33,182,0.08)] shadow-[0_16px_28px_-20px_rgba(22,16,39,0.18)]"
                        style={{
                          top: `${getAppointmentTop(committedForColumn.startMinutes, dayStartMinutes, schedulePxPerMinute)}px`,
                          height: `${Math.max(committedForColumn.durationMinutes * schedulePxPerMinute, 58)}px`,
                        }}
                      >
                        <div className="flex h-full flex-col justify-between gap-3 p-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                              {minutesToTimeLabel(committedForColumn.startMinutes)} - {minutesToTimeLabel(committedForColumn.endMinutes)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Escolha se esse intervalo vira agendamento ou bloqueio operacional.
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setAppointmentModalState({
                                  open: true,
                                  defaultDate: committedForColumn.dateIso,
                                  defaultTime: minutesToTimeLabel(committedForColumn.startMinutes),
                                  defaultProfessionalId: committedForColumn.professionalId,
                                })
                                clearCurrentSelection()
                              }}
                              className="action-button-primary px-3 py-2 text-xs"
                            >
                              Criar agendamento
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveBlock({
                                  id: 'draft-block',
                                  itemType: 'BLOCK',
                                  customerId: '',
                                  customerName: 'Bloqueio Operacional',
                                  customerPhone: null,
                                  customerEmail: null,
                                  customerType: 'WALK_IN',
                                  customerSubscriptionPrice: null,
                                  professionalId: committedForColumn.professionalId ?? '',
                                  professionalName: '',
                                  serviceId: '',
                                  serviceName: 'Bloqueio Operacional',
                                  status: 'CONFIRMED',
                                  source: 'MANUAL',
                                  billingModel: 'AVULSO',
                                  startAt: '',
                                  endAt: '',
                                  localDateIso: committedForColumn.dateIso,
                                  localDateLabel: committedForColumn.dateIso,
                                  startTimeLabel: minutesToTimeLabel(committedForColumn.startMinutes),
                                  endTimeLabel: minutesToTimeLabel(committedForColumn.endMinutes),
                                  startDateTimeLabel: '',
                                  endDateTimeLabel: '',
                                  startMinutesOfDay: committedForColumn.startMinutes,
                                  durationMinutes: committedForColumn.durationMinutes,
                                  priceSnapshot: 0,
                                  notes: 'Bloqueio operacional',
                                  sourceReference: null,
                                  blockReason: 'Bloqueio operacional',
                                  laneIndex: 0,
                                  laneCount: 1,
                                })
                                clearCurrentSelection()
                              }}
                              className="action-button px-3 py-2 text-xs"
                            >
                              Bloquear agenda
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                clearCurrentSelection()
                              }}
                              className="action-button px-3 py-2 text-xs"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {dragPreviewForColumn && dragState && dragPreviewForColumn.itemId === dragState.item.id && (
                      <div
                        className={cn(
                          'pointer-events-none absolute inset-x-3 rounded-[0.85rem] border border-dashed px-3 py-2 shadow-[0_12px_20px_-16px_rgba(22,16,39,0.12)]',
                          dragPreviewForColumn.valid
                            ? 'border-[rgba(91,33,182,0.22)] bg-[rgba(91,33,182,0.09)]'
                            : 'border-[rgba(244,63,94,0.22)] bg-[rgba(244,63,94,0.1)]'
                        )}
                        style={{
                          top: `${getAppointmentTop(dragPreviewForColumn.startMinutes, dayStartMinutes, schedulePxPerMinute)}px`,
                          height: `${Math.max(dragPreviewForColumn.durationMinutes * schedulePxPerMinute, 56)}px`,
                        }}
                      >
                        <div className="flex h-full items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
                              {minutesToTimeLabel(dragPreviewForColumn.startMinutes)} - {minutesToTimeLabel(dragPreviewForColumn.endMinutes)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {dragPreviewForColumn.valid ? 'Solte para salvar a remarcacao.' : 'Conflito com slot ja ocupado.'}
                            </p>
                          </div>
                          {savingMoveId === dragState.item.id && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(15,17,21,0.86)] px-2 py-1 text-[11px] font-medium text-muted-foreground">
                              <Move className="h-3 w-3 animate-pulse" />
                              salvando
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {column.appointments.length === 0 && !committedForColumn && (
                      <div className="absolute inset-x-5 top-6 rounded-[0.95rem] border border-dashed border-[rgba(52,44,78,0.12)] bg-[rgba(91,33,182,0.035)] px-4 py-3 text-xs leading-6 text-muted-foreground">
                        Clique para criar. Arraste para reservar um intervalo maior.
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <AppointmentModal
        hideTrigger
        open={appointmentModalState.open}
        onOpenChange={(value) => setAppointmentModalState((current) => ({ ...current, open: value }))}
        defaultDate={appointmentModalState.defaultDate}
        defaultTime={appointmentModalState.defaultTime}
        defaultProfessionalId={appointmentModalState.defaultProfessionalId}
        professionals={professionals}
        services={services}
      />

      {activeAppointment && (
        <AppointmentDetailsDialog
          appointment={activeAppointment}
          professionals={professionals}
          services={services}
          open={Boolean(activeAppointment)}
          onOpenChange={(value) => {
            if (!value) {
              setActiveAppointment(null)
            }
          }}
        />
      )}

      {activeBlock && (
        <ScheduleBlockModal
          hideTrigger
          open={Boolean(activeBlock)}
          onOpenChange={(value) => {
            if (!value) {
              setActiveBlock(null)
              setCommittedSelection(null)
            }
          }}
          professionals={professionals}
          defaultDate={activeBlock.localDateIso}
          defaultStartTime={activeBlock.startTimeLabel}
          defaultEndTime={activeBlock.endTimeLabel}
          defaultProfessionalId={activeBlock.professionalId}
          block={activeBlock.id === 'draft-block' ? undefined : buildScheduleBlockValue(activeBlock)}
        />
      )}
    </>
  )
}

