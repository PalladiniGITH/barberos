'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Ban,
  CalendarClock,
  Clock3,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createScheduleBlock,
  moveScheduleBlock,
  removeScheduleBlock,
} from '@/actions/agendamentos'
import type { ScheduleToolbarProfessional } from '@/lib/agendamentos'

export interface ScheduleBlockValue {
  id: string
  date: string
  startTime: string
  endTime: string
  professionalId: string
  notes: string | null
}

interface ScheduleBlockModalProps {
  professionals: ScheduleToolbarProfessional[]
  defaultDate: string
  defaultStartTime?: string
  defaultEndTime?: string
  defaultProfessionalId?: string | null
  block?: ScheduleBlockValue
  triggerMode?: 'primary' | 'secondary' | 'icon'
  open?: boolean
  onOpenChange?: (value: boolean) => void
  hideTrigger?: boolean
}

const fieldClassName =
  'auth-input w-full min-w-0 rounded-[1rem] px-3.5 py-2.5 text-sm placeholder:text-muted-foreground'

function normalizeOptionalText(value: string) {
  const normalized = value.trim()
  return normalized ? normalized : null
}

function buildDefaultValues(input: {
  block?: ScheduleBlockValue
  defaultDate: string
  defaultStartTime: string
  defaultEndTime: string
  defaultProfessionalId: string | null
}) {
  return {
    date: input.block?.date ?? input.defaultDate,
    startTime: input.block?.startTime ?? input.defaultStartTime,
    endTime: input.block?.endTime ?? input.defaultEndTime,
    professionalId: input.block?.professionalId ?? input.defaultProfessionalId ?? '',
    notes: input.block?.notes ?? '',
  }
}

export function ScheduleBlockModal({
  professionals,
  defaultDate,
  defaultStartTime = '09:00',
  defaultEndTime = '09:30',
  defaultProfessionalId = null,
  block,
  triggerMode = 'secondary',
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: ScheduleBlockModalProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState(defaultStartTime)
  const [endTime, setEndTime] = useState(defaultEndTime)
  const [professionalId, setProfessionalId] = useState(defaultProfessionalId ?? '')
  const [notes, setNotes] = useState(block?.notes ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const router = useRouter()
  const isEdit = Boolean(block)

  const defaultValues = useMemo(
    () => buildDefaultValues({
      block,
      defaultDate,
      defaultStartTime,
      defaultEndTime,
      defaultProfessionalId,
    }),
    [block, defaultDate, defaultEndTime, defaultProfessionalId, defaultStartTime]
  )

  useEffect(() => {
    if (!open) {
      return
    }

    setDate(defaultValues.date)
    setStartTime(defaultValues.startTime)
    setEndTime(defaultValues.endTime)
    setProfessionalId(defaultValues.professionalId)
    setNotes(defaultValues.notes ?? '')
  }, [defaultValues, open])

  const selectedProfessional = professionals.find((professional) => professional.id === professionalId)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!professionalId) {
      toast.error('Selecione o barbeiro para bloquear a agenda.')
      return
    }

    if (!date || !startTime || !endTime) {
      toast.error('Preencha data e horario do bloqueio.')
      return
    }

    if (endTime <= startTime) {
      toast.error('O horario final precisa ser maior que o inicial.')
      return
    }

    setIsSubmitting(true)

    const payload = {
      professionalId,
      date,
      startTime,
      endTime,
      notes: normalizeOptionalText(notes),
    }

    const result = block
      ? await moveScheduleBlock(block.id, payload)
      : await createScheduleBlock(payload)

    setIsSubmitting(false)

    if (!result.success) {
      toast.error(result.error ?? 'Nao foi possivel salvar o bloqueio.')
      return
    }

    toast.success(block ? 'Bloqueio atualizado.' : 'Bloqueio criado.')
    setOpen(false)
    router.refresh()
  }

  async function handleRemove() {
    if (!block) {
      return
    }

    setIsRemoving(true)
    const result = await removeScheduleBlock(block.id)
    setIsRemoving(false)

    if (!result.success) {
      toast.error(result.error ?? 'Nao foi possivel remover o bloqueio.')
      return
    }

    toast.success('Bloqueio removido.')
    setOpen(false)
    router.refresh()
  }

  const triggerClass = {
    primary: 'action-button-primary',
    secondary: 'action-button',
    icon: 'inline-flex h-9 w-9 items-center justify-center rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-primary',
  }[triggerMode]

  return (
    <>
      {!hideTrigger && (
        <button type="button" onClick={() => setOpen(true)} className={triggerClass}>
          {triggerMode === 'icon' ? <Pencil className="h-4 w-4" /> : (
            <>
              {isEdit ? <Pencil className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
              {isEdit ? 'Editar bloqueio' : 'Bloquear agenda'}
            </>
          )}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 pt-4 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-[rgba(9,10,14,0.58)] backdrop-blur-sm" onClick={() => setOpen(false)} />

          <div className="premium-dialog relative z-10 grid w-full max-w-2xl gap-0 overflow-hidden rounded-[1.5rem]">
            <div className="flex items-start justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  {isEdit ? 'Editar bloqueio' : 'Novo bloqueio'}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Reserve indisponibilidade operacional com data, faixa de horario e barbeiro responsavel.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-primary"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-6 px-5 py-5 sm:px-6 sm:py-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">Barbeiro</span>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <select
                      value={professionalId}
                      onChange={(event) => setProfessionalId(event.target.value)}
                      className={`${fieldClassName} pl-10`}
                    >
                      <option value="">Selecione um barbeiro</option>
                      {professionals.map((professional) => (
                        <option key={professional.id} value={professional.id}>
                          {professional.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">Data</span>
                  <div className="relative">
                    <CalendarClock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      className={`${fieldClassName} pl-10`}
                    />
                  </div>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">Inicio</span>
                  <div className="relative">
                    <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="time"
                      value={startTime}
                      onChange={(event) => setStartTime(event.target.value)}
                      className={`${fieldClassName} pl-10`}
                    />
                  </div>
                </label>

                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">Fim</span>
                  <div className="relative">
                    <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="time"
                      value={endTime}
                      onChange={(event) => setEndTime(event.target.value)}
                      className={`${fieldClassName} pl-10`}
                    />
                  </div>
                </label>
              </div>

              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Motivo do bloqueio</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  placeholder="Ex.: almoco extendido, ausencia, horario reservado..."
                  className={`${fieldClassName} min-h-[112px] resize-none`}
                />
              </label>

              <div className="surface-tier-high flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {selectedProfessional?.name ?? 'Selecione o barbeiro'}{date ? ` em ${date}` : ''}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {startTime} - {endTime}{notes.trim() ? ` · ${notes.trim()}` : ' · Bloqueio operacional'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {block && (
                    <button
                      type="button"
                      onClick={handleRemove}
                      disabled={isRemoving || isSubmitting}
                      className="inline-flex items-center gap-2 rounded-[0.95rem] border border-[rgba(220,38,38,0.24)] bg-[rgba(220,38,38,0.12)] px-3.5 py-2 text-sm font-semibold text-rose-200 transition-colors hover:bg-[rgba(220,38,38,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Remover
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting || isRemoving}
                    className="action-button-primary disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (isEdit ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />)}
                    {isEdit ? 'Salvar bloqueio' : 'Criar bloqueio'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
