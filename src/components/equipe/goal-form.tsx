'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, X, Loader2, Target } from 'lucide-react'
import { toast } from 'sonner'
import { upsertMonthlyGoal } from '@/actions/equipe'

const schema = z.object({
  revenueGoal: z.string().min(1, 'Obrigatório'),
  revenueMin: z.string().min(1, 'Obrigatório'),
  expenseLimit: z.string().optional(),
  notes: z.string().max(500).optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  month: number
  year: number
  existing?: {
    revenueGoal: number
    revenueMin: number
    expenseLimit?: number | null
    notes?: string | null
  }
}

export function GoalForm({ month, year, existing }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      revenueGoal: existing?.revenueGoal?.toString() ?? '',
      revenueMin: existing?.revenueMin?.toString() ?? '',
      expenseLimit: existing?.expenseLimit?.toString() ?? '',
      notes: existing?.notes ?? '',
    },
  })

  async function onSubmit(data: FormData) {
    const result = await upsertMonthlyGoal({ ...data, month, year })
    if (result.success) {
      toast.success(existing ? 'Meta atualizada!' : 'Meta criada!')
      setOpen(false)
      router.refresh()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="action-button-primary"
      >
        <Target className="w-4 h-4" />
        {existing ? 'Editar Meta' : 'Definir Meta'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="modal-shell relative w-full max-w-sm animate-fade-in">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-5 py-4 sm:px-6">
              <h2 className="text-lg font-semibold">{existing ? 'Editar Meta do Mês' : 'Definir Meta do Mês'}</h2>
              <button onClick={() => setOpen(false)} className="rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-2 text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
              <div className="modal-shell-body space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Meta de Receita (R$) *</label>
                <input
                  {...register('revenueGoal')}
                  type="number" step="0.01" placeholder="30000,00"
                  className="auth-input px-3 py-2.5"
                />
                {errors.revenueGoal && <p className="text-destructive text-xs mt-1">{errors.revenueGoal.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Meta Mínima (R$) *</label>
                <input
                  {...register('revenueMin')}
                  type="number" step="0.01" placeholder="24000,00"
                  className="auth-input px-3 py-2.5"
                />
                {errors.revenueMin && <p className="text-destructive text-xs mt-1">{errors.revenueMin.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Limite de Despesas (R$)</label>
                <input
                  {...register('expenseLimit')}
                  type="number" step="0.01" placeholder="12000,00"
                  className="auth-input px-3 py-2.5"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Observações</label>
                <textarea
                  {...register('notes')}
                  rows={2} placeholder="Notas sobre o mês..."
                  className="auth-input min-h-[96px] resize-none px-3 py-2.5"
                />
              </div>
              </div>
              <div className="modal-shell-footer">
                <button type="button" onClick={() => setOpen(false)}
                  className="action-button flex-1">
                  Cancelar
                </button>
                <button type="submit" disabled={isSubmitting}
                  className="action-button-primary flex flex-1 items-center justify-center gap-2 disabled:opacity-50">
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
