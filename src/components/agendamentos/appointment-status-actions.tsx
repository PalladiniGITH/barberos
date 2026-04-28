'use client'

import { type ComponentType, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import * as Popover from '@radix-ui/react-popover'
import {
  Ban,
  CheckCheck,
  CheckCircle2,
  Clock3,
  Loader2,
  MoreHorizontal,
  UserX,
} from 'lucide-react'
import { toast } from 'sonner'
import { updateAppointmentStatus } from '@/actions/agendamentos'
import { AppointmentModal, type AppointmentFormValue } from '@/components/agendamentos/appointment-modal'
import type {
  ScheduleToolbarProfessional,
  ScheduleToolbarService,
} from '@/lib/agendamentos'
import { formatCurrency } from '@/lib/utils'

interface AppointmentStatusActionsProps {
  appointment: AppointmentFormValue
  professionals: ScheduleToolbarProfessional[]
  services: ScheduleToolbarService[]
  compact?: boolean
}

interface StatusAction {
  icon: ComponentType<{ className?: string }>
  label: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'
  className: string
}

function getActions(status: AppointmentFormValue['status']): StatusAction[] {
  if (status === 'PENDING') {
    return [
      {
        icon: CheckCircle2,
        label: 'Confirmar',
        status: 'CONFIRMED',
        className: 'hover:border-violet-400/40 hover:bg-violet-400/12 hover:text-violet-100',
      },
      {
        icon: Ban,
        label: 'Cancelar',
        status: 'CANCELLED',
        className: 'hover:border-rose-400/40 hover:bg-rose-400/12 hover:text-rose-100',
      },
    ]
  }

  if (status === 'CONFIRMED') {
    return [
      {
        icon: CheckCheck,
        label: 'Concluir',
        status: 'COMPLETED',
        className: 'hover:border-violet-400/40 hover:bg-violet-400/12 hover:text-violet-100',
      },
      {
        icon: UserX,
        label: 'No-show',
        status: 'NO_SHOW',
        className: 'hover:border-amber-400/40 hover:bg-amber-400/12 hover:text-amber-100',
      },
      {
        icon: Ban,
        label: 'Cancelar',
        status: 'CANCELLED',
        className: 'hover:border-rose-400/40 hover:bg-rose-400/12 hover:text-rose-100',
      },
    ]
  }

  return []
}

export function AppointmentStatusActions({
  appointment,
  professionals,
  services,
  compact = false,
}: AppointmentStatusActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const actions = getActions(appointment.status)

  const meta = useMemo(() => ({
    professional: professionals.find((professional) => professional.id === appointment.professionalId) ?? null,
    service: services.find((service) => service.id === appointment.serviceId) ?? null,
  }), [appointment.professionalId, appointment.serviceId, professionals, services])

  function handleStatusChange(status: StatusAction['status']) {
    startTransition(async () => {
      const result = await updateAppointmentStatus(appointment.id, status)
      if (result.success) {
        setOpen(false)
        toast.success('Status atualizado.')
        router.refresh()
        return
      }

      toast.error(result.error ?? 'Não foi possível atualizar o status.')
    })
  }

  if (!compact) {
    return (
      <div className="flex items-center gap-1.5">
        <AppointmentModal
          appointment={appointment}
          defaultDate={appointment.date}
          professionals={professionals}
          services={services}
          defaultProfessionalId={appointment.professionalId}
          triggerMode="icon"
        />

        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            title={action.label}
            disabled={isPending}
            onClick={() => handleStatusChange(action.status)}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-slate-400 transition-colors ${action.className}`}
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <action.icon className="h-3.5 w-3.5" />}
          </button>
        ))}
      </div>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="surface-inverse surface-inverse-subtle inline-flex h-8 w-8 items-center justify-center rounded-lg border text-slate-300 transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-white"
          title="Abrir detalhes"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={10}
          className="surface-inverse z-50 w-[280px] rounded-[1.3rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(30,41,59,0.98),rgba(15,23,42,0.96))] p-4 text-slate-100 shadow-[0_32px_80px_-42px_rgba(2,6,23,0.92)] backdrop-blur-xl"
        >
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                {appointment.time}
              </p>
              <p className="mt-2 text-base font-semibold text-white">{appointment.customerName}</p>
              <p className="mt-1 text-sm text-slate-300">{meta.service?.name ?? 'Servico'}</p>
            </div>

            <div className="surface-inverse-subtle grid gap-2 rounded-[1rem] border p-3 text-xs text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Barbeiro</span>
                <span className="font-medium text-slate-100">{meta.professional?.name ?? 'Nao informado'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Valor</span>
                <span className="font-medium text-slate-100">
                  {formatCurrency(appointment.priceSnapshot ?? meta.service?.price ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Duracao</span>
                <span className="font-medium text-slate-100">
                  {meta.service?.duration ?? 0} min
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Contato</span>
                <span className="truncate font-medium text-slate-100">
                  {appointment.customerPhone ?? appointment.customerEmail ?? 'Sem contato'}
                </span>
              </div>
            </div>

            {appointment.notes && (
              <div className="surface-inverse-subtle rounded-[1rem] border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Observacao
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-200">{appointment.notes}</p>
              </div>
            )}

            <div className="grid gap-2">
              <AppointmentModal
                appointment={appointment}
                defaultDate={appointment.date}
                professionals={professionals}
                services={services}
                defaultProfessionalId={appointment.professionalId}
                triggerMode="secondary"
              />

              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  disabled={isPending}
                  onClick={() => handleStatusChange(action.status)}
                  className={`surface-inverse-subtle flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm font-medium text-slate-100 transition-colors ${action.className}`}
                >
                  <span className="inline-flex items-center gap-2">
                    {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <action.icon className="h-3.5 w-3.5" />}
                    {action.label}
                  </span>
                  <Clock3 className="h-3.5 w-3.5 text-slate-500" />
                </button>
              ))}
            </div>
          </div>

          <Popover.Arrow className="fill-[rgba(30,41,59,0.98)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
