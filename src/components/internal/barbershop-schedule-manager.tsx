'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  createPlatformScheduleBlock,
  removePlatformScheduleBlock,
  updatePlatformScheduleBlock,
} from '@/actions/platform-admin'
import type { PlatformBarbershopDetailData } from '@/lib/platform-admin'

function text(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

export function BarbershopScheduleManager({
  barbershopId,
  timezone,
  schedule,
  professionals,
}: {
  barbershopId: string
  timezone: string
  schedule: PlatformBarbershopDetailData['schedule']
  professionals: PlatformBarbershopDetailData['professionals']
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const hasProfessionals = professionals.length > 0

  const editingBlock = useMemo(
    () => schedule.upcomingBlocks.find((block) => block.id === editingId) ?? null,
    [editingId, schedule.upcomingBlocks]
  )

  function resetForm() {
    setEditingId(null)
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    startTransition(async () => {
      const payload = {
        barbershopId,
        professionalId: text(formData, 'professionalId'),
        date: text(formData, 'date'),
        startTime: text(formData, 'startTime'),
        endTime: text(formData, 'endTime'),
        notes: text(formData, 'notes'),
      }

      const result = editingBlock
        ? await updatePlatformScheduleBlock(editingBlock.id, payload)
        : await createPlatformScheduleBlock(payload)

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(editingBlock ? 'Bloqueio operacional atualizado.' : 'Bloqueio operacional criado.')
      resetForm()
      router.refresh()
    })
  }

  function removeBlock(blockId: string) {
    startTransition(async () => {
      const result = await removePlatformScheduleBlock(barbershopId, blockId)

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success('Bloqueio operacional removido.')
      if (editingId === blockId) {
        resetForm()
      }
      router.refresh()
    })
  }

  return (
    <section
      id="horarios"
      className="platform-panel p-5"
    >
      <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Horarios e disponibilidade
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          Janela atual da operacao e bloqueios por profissional
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Nesta fase o painel master usa a janela operacional global ja existente e permite preparar a agenda com
          bloqueios operacionais por profissional. O modelo de grade semanal detalhada pode evoluir depois.
        </p>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">
                {editingBlock ? 'Editar bloqueio operacional' : 'Adicionar bloqueio operacional'}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Use para reservar janelas de treinamento, manutencao, folga ou indisponibilidade na agenda do tenant.
              </p>
            </div>

            {editingBlock ? (
              <button type="button" onClick={resetForm} className="action-button">
                <X className="h-4 w-4" />
                Cancelar edicao
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] px-3 py-2 text-xs text-muted-foreground">
                <Plus className="h-3.5 w-3.5" />
                Novo bloqueio master
              </span>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Janela padrao</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{schedule.defaultWindow.label}</p>
            </div>
            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Timezone</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{timezone}</p>
            </div>
            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Bloqueios futuros</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{schedule.upcomingBlocks.length}</p>
            </div>
          </div>

          <form
            key={editingBlock?.id ?? 'new-platform-block'}
            onSubmit={onSubmit}
            className="mt-4 space-y-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block min-w-0 md:col-span-2">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Profissional</span>
                <select
                  name="professionalId"
                  defaultValue={editingBlock?.professionalId ?? professionals[0]?.id ?? ''}
                  disabled={!hasProfessionals}
                  className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                >
                  {hasProfessionals ? (
                    professionals.map((professional) => (
                      <option key={professional.id} value={professional.id}>
                        {professional.name}{professional.active ? '' : ' (inativo)'}
                      </option>
                    ))
                  ) : (
                    <option value="">Cadastre um profissional primeiro</option>
                  )}
                </select>
              </label>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Data</span>
                <input
                  name="date"
                  type="date"
                  defaultValue={editingBlock?.dateInputValue ?? ''}
                  className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Inicio</span>
                <input
                  name="startTime"
                  type="time"
                  defaultValue={editingBlock?.startTimeValue ?? ''}
                  className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Fim</span>
                <input
                  name="endTime"
                  type="time"
                  defaultValue={editingBlock?.endTimeValue ?? ''}
                  className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                />
              </label>
            </div>

            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Observacao operacional</span>
              <textarea
                name="notes"
                rows={3}
                defaultValue={editingBlock?.notes ?? ''}
                placeholder="Ex.: treinamento interno, manutencao, pausa prolongada."
                className="auth-input min-h-[104px] rounded-[0.95rem] px-3 py-2"
              />
            </label>

            <div className="flex flex-col gap-3 border-t border-[rgba(255,255,255,0.06)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                O backend valida profissional do tenant, timezone e conflito com agenda antes de salvar.
              </p>
              <button type="submit" disabled={isPending || !hasProfessionals} className="action-button-primary inline-flex items-center justify-center gap-2 disabled:opacity-60">
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingBlock ? 'Salvar bloqueio' : 'Criar bloqueio'}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
          <div className="flex items-start justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] pb-4">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">Bloqueios futuros</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Visualize a disponibilidade ja protegida para este tenant e ajuste rapidamente durante a implantacao.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] px-3 py-2 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {schedule.upcomingBlocks.length} itens
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {schedule.upcomingBlocks.length === 0 ? (
              <div className="rounded-[1rem] border border-dashed border-[rgba(255,255,255,0.08)] px-4 py-8 text-sm text-muted-foreground">
                Nenhum bloqueio futuro configurado para este tenant ainda.
              </div>
            ) : (
              schedule.upcomingBlocks.map((block) => (
                <article
                  key={block.id}
                  className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{block.professionalName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {block.dateLabel} - {block.startTimeLabel} as {block.endTimeLabel}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setEditingId(block.id)} className="action-button">
                        <Pencil className="h-4 w-4" />
                        Editar
                      </button>
                      <button type="button" onClick={() => removeBlock(block.id)} className="action-button">
                        <Trash2 className="h-4 w-4" />
                        Remover
                      </button>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {block.notes ?? 'Bloqueio operacional sem observacao adicional.'}
                  </p>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
