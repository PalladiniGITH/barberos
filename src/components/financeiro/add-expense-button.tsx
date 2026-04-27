'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { addExpense } from '@/actions/financeiro'

const schema = z.object({
  amount: z.string().min(1, 'Valor obrigatório'),
  type: z.string().min(1),
  description: z.string().min(1, 'Descrição obrigatória'),
  categoryId: z.string().optional(),
  dueDate: z.string().optional(),
  recurrent: z.boolean().optional(),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export interface ExpenseCategoryOption {
  id: string
  name: string
}

interface Props {
  categories: ExpenseCategoryOption[]
}

export function AddExpenseButton({ categories }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'VARIABLE', dueDate: new Date().toISOString().split('T')[0] },
  })

  async function onSubmit(data: FormData) {
    const result = await addExpense(data)
    if (result.success) {
      toast.success('Despesa registrada!')
      reset({ type: 'VARIABLE', dueDate: new Date().toISOString().split('T')[0] })
      setOpen(false)
      router.refresh()
    } else {
      toast.error(result.error ?? 'Erro ao salvar')
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="action-button-primary"
      >
        <Plus className="w-4 h-4" />
        Nova Despesa
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="premium-dialog relative w-full max-w-md p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-foreground">Nova Despesa</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
                <input
                  {...register('description')}
                  placeholder="Ex: Aluguel, Insumos..."
                  className="auth-input px-3 py-2.5"
                />
                {errors.description && <p className="text-destructive text-xs mt-1">{errors.description.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Valor (R$)</label>
                  <input
                    {...register('amount')}
                    type="number" step="0.01" placeholder="0,00"
                    className="auth-input px-3 py-2.5"
                  />
                  {errors.amount && <p className="text-destructive text-xs mt-1">{errors.amount.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Vencimento</label>
                  <input
                    {...register('dueDate')}
                    type="date"
                    className="auth-input px-3 py-2.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Tipo</label>
                  <select
                    {...register('type')}
                    className="auth-input px-3 py-2.5"
                  >
                    <option value="FIXED">Fixo</option>
                    <option value="VARIABLE">Variável</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Categoria</label>
                  <select
                    {...register('categoryId')}
                    className="auth-input px-3 py-2.5"
                  >
                    <option value="">Sem categoria</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input {...register('recurrent')} type="checkbox" className="w-4 h-4 accent-primary" />
                <span className="text-sm text-foreground">Despesa recorrente (mensal)</span>
              </label>

              <div className="flex gap-3 pt-2">
                <button
                  type="button" onClick={() => setOpen(false)}
                  className="action-button flex-1"
                >
                  Cancelar
                </button>
                <button
                  type="submit" disabled={isSubmitting}
                  className="action-button-primary flex flex-1 items-center justify-center gap-2"
                >
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
