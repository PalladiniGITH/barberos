'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { addFinancialCategory } from '@/actions/financeiro'

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatorio'),
  type: z.enum(['REVENUE', 'EXPENSE_FIXED', 'EXPENSE_VARIABLE']),
  color: z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Cor invalida'),
})

type FormData = z.infer<typeof schema>

const COLOR_PRESETS = ['#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899']

export function AddCategoryButton() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'EXPENSE_VARIABLE', color: '#10b981' },
  })

  const selectedColor = watch('color')

  async function onSubmit(data: FormData) {
    const result = await addFinancialCategory(data)

    if (result.success) {
      toast.success('Categoria criada com sucesso')
      reset({ type: 'EXPENSE_VARIABLE', color: '#10b981' })
      setOpen(false)
      router.refresh()
    } else {
      toast.error(result.error ?? 'Nao foi possivel salvar')
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        Nova categoria
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Nova categoria</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground transition-colors hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Nome</label>
                <input
                  {...register('name')}
                  placeholder="Ex: Insumos, Pix, Aluguel"
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground outline-none transition focus:ring-2 focus:ring-primary/50"
                />
                {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Tipo</label>
                <select
                  {...register('type')}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground outline-none transition focus:ring-2 focus:ring-primary/50"
                >
                  <option value="REVENUE">Receita</option>
                  <option value="EXPENSE_FIXED">Despesa fixa</option>
                  <option value="EXPENSE_VARIABLE">Despesa variavel</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Cor</label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setValue('color', color, { shouldValidate: true })}
                      className={`h-9 w-9 rounded-full border-2 transition-transform ${selectedColor === color ? 'scale-110 border-foreground' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                      aria-label={`Selecionar cor ${color}`}
                    />
                  ))}
                </div>
                <input type="hidden" {...register('color')} />
                {errors.color && <p className="mt-1 text-xs text-destructive">{errors.color.message}</p>}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {isSubmitting ? 'Salvando' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
