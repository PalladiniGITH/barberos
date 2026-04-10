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
        className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg text-sm transition-colors"
      >
        <Target className="w-4 h-4" />
        {existing ? 'Editar Meta' : 'Definir Meta'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">{existing ? 'Editar Meta do Mês' : 'Definir Meta do Mês'}</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Meta de Receita (R$) *</label>
                <input
                  {...register('revenueGoal')}
                  type="number" step="0.01" placeholder="30000,00"
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {errors.revenueGoal && <p className="text-destructive text-xs mt-1">{errors.revenueGoal.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Meta Mínima (R$) *</label>
                <input
                  {...register('revenueMin')}
                  type="number" step="0.01" placeholder="24000,00"
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {errors.revenueMin && <p className="text-destructive text-xs mt-1">{errors.revenueMin.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Limite de Despesas (R$)</label>
                <input
                  {...register('expenseLimit')}
                  type="number" step="0.01" placeholder="12000,00"
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Observações</label>
                <textarea
                  {...register('notes')}
                  rows={2} placeholder="Notas sobre o mês..."
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setOpen(false)}
                  className="flex-1 py-2 rounded-lg border border-border text-foreground hover:bg-secondary text-sm">
                  Cancelar
                </button>
                <button type="submit" disabled={isSubmitting}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg text-sm disabled:opacity-50">
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
