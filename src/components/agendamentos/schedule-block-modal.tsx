'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Ban, Loader2, Minus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  createScheduleBlock,
  moveScheduleBlock,
  removeScheduleBlock,
} from '@/actions/agendamentos'
import type { ScheduleToolbarProfessional } from '@/lib/agendamentos'

const schema = z.object({
  professionalId: z.string().min(1, 'Selecione o barbeiro'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horario inicial invalido'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Horario final invalido'),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

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
  defaultStartTime: string
  defaultEndTime: string
  defaultProfessionalId?: string | null
  block?: ScheduleBlockValue
  open?: boolean
  onOpenChange?: (value: boolean) => void
  hideTrigger?: boolean
}

const fieldClassName =
  'w-full min-w-0 rounded-[1rem] border border-[rgba(84,35,145,0.08)] bg-white px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-[rgba(124,58,237,0.2)] focus:ring-4 focus:ring-[rgba(124,58,237,0.1)]'

export function ScheduleBlockModal({
  professionals,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  defaultProfessionalId = null,
  block,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: ScheduleBlockModalProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const router = useRouter()
  const isEdit = Boolean(block)

  const defaultValues = useMemo<FormData>(() => ({
    professionalId: block?.professionalId ?? defaultProfessionalId ?? '',
    date: block?.date ?? defaultDate,
    startTime: block?.startTime ?? defaultStartTime,
    endTime: block?.endTime ?? defaultEndTime,
    notes: block?.notes ?? '',
  }), [block, defaultDate, defaultEndTime, defaultProfessionalId, defaultStartTime])

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  useEffect(() => {
    if (open) {
      reset(defaultValues)
    }
  }, [defaultValues, open, reset])

  const selectedProfessionalId = watch('professionalId')
  const selectedProfessional = professionals.find((professional) => professional.id === selectedProfessionalId)

  async function onSubmit(values: FormData) {
    const result = block
      ? await moveScheduleBlock(block.id, values)
      : await createScheduleBlock(values)

    if (result.success) {
      toast.success(block ? 'Bloqueio atualizado.' : 'Bloqueio criado.')
      setOpen(false)
      router.refresh()
      return
    }

    toast.error(result.error ?? 'Nao foi possivel salvar o bloqueio.')
  }

  async function handleRemove() {
    if (!block) return
    setRemoving(true)

    const result = await removeScheduleBlock(block.id)
    setRemoving(false)

    if (result.success) {
      toast.success('Bloqueio removido.')
      setOpen(false)
      router.refresh()
      return
    }

    toast.error(result.error ?? 'Nao foi possivel remover o bloqueio.')
  }

  return (
    <>
      {!hideTrigger && (
        <button type="button" onClick={() => setOpen(true)} className="action-button">
          <Minus className="h-4 w-4" />
          Bloquear agenda
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[rgba(17,24,39,0.36)] backdrop-blur-sm" onClick={() => setOpen(false)} />

          <div className="relative z-10 w-full max-w-xl rounded-[1.5rem] border border-[rgba(84,35,145,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(249,246,253,0.97))] shadow-[0_42px_120px_-60px_rgba(124,58,237,0.28)]">
            <div className="flex items-start justify-between gap-4 border-b border-[rgba(84,35,145,0.08)] px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  {isEdit ? 'Editar bloqueio' : 'Bloquear agenda'}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Use isso para pausa, ausência, encaixe proibido ou reserva operacional.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-[0.9rem] text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.04)] hover:text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 px-5 py-5 sm:px-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">Barbeiro *</span>
                  <select {...register('professionalId')} className={fieldClassName}>
                    <option value="">Selecione</option>
                    {professionals.map((professional) => (
                      <option key={professional.id} value={professional.id}>
                        {professional.name}
                      </option>
                    ))}
                  </select>
                  {errors.professionalId && <p className="mt-1.5 text-xs text-rose-600">{errors.professionalId.message}</p>}
                </label>

                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">Data *</span>
                  <input {...register('date')} type="date" className={fieldClassName} />
                  {errors.date && <p className="mt-1.5 text-xs text-rose-600">{errors.date.message}</p>}
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">Inicio *</span>
                  <input {...register('startTime')} type="time" step="900" className={fieldClassName} />
                  {errors.startTime && <p className="mt-1.5 text-xs text-rose-600">{errors.startTime.message}</p>}
                </label>

                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">Fim *</span>
                  <input {...register('endTime')} type="time" step="900" className={fieldClassName} />
                  {errors.endTime && <p className="mt-1.5 text-xs text-rose-600">{errors.endTime.message}</p>}
                </label>
              </div>

              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Motivo / observacao</span>
                <textarea
                  {...register('notes')}
                  rows={4}
                  placeholder="Ex: pausa do almoco, barbeiro externo, horario reservado..."
                  className={fieldClassName}
                />
              </label>

              <div className="rounded-[1rem] border border-[rgba(124,58,237,0.12)] bg-[rgba(124,58,237,0.05)] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Ban className="h-4 w-4" />
                  Resumo do bloqueio
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {selectedProfessional?.name ?? 'Selecione o barbeiro'} com o intervalo informado ficará indisponível na agenda e a IA também deixa de sugerir esse espaço.
                </p>
              </div>

              <div className="flex flex-col gap-3 border-t border-[rgba(84,35,145,0.08)] pt-5 sm:flex-row">
                {block ? (
                  <button
                    type="button"
                    onClick={handleRemove}
                    disabled={removing}
                    className="action-button h-11 flex-1 text-rose-600 hover:bg-[rgba(244,63,94,0.06)]"
                  >
                    {removing && <Loader2 className="h-4 w-4 animate-spin" />}
                    Remover bloqueio
                  </button>
                ) : (
                  <button type="button" onClick={() => setOpen(false)} className="action-button h-11 flex-1">
                    Cancelar
                  </button>
                )}

                <button type="submit" disabled={isSubmitting} className="action-button-primary h-11 flex-1 disabled:opacity-50">
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Salvando...' : block ? 'Salvar bloqueio' : 'Bloquear intervalo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
