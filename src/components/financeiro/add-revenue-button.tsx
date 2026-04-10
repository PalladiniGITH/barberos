'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { addRevenue } from '@/actions/financeiro'

const schema = z.object({
  amount: z.string().min(1, 'Valor obrigatorio'),
  paymentMethod: z.string().min(1, 'Selecione a forma de pagamento'),
  date: z.string().min(1, 'Data obrigatoria'),
  professionalId: z.string().optional(),
  serviceId: z.string().optional(),
  categoryId: z.string().optional(),
  description: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export interface RevenueFormOption {
  id: string
  name: string
}

interface Props {
  professionals: RevenueFormOption[]
  services: RevenueFormOption[]
  categories: RevenueFormOption[]
}

export function AddRevenueButton({ professionals, services, categories }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      paymentMethod: 'PIX',
    },
  })

  async function onSubmit(data: FormData) {
    const result = await addRevenue({
      ...data,
      professionalId: data.professionalId || undefined,
      serviceId: data.serviceId || undefined,
      categoryId: data.categoryId || undefined,
    })

    if (result.success) {
      toast.success('Receita lancada com sucesso!')
      reset({
        date: new Date().toISOString().split('T')[0],
        paymentMethod: 'PIX',
      })
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
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        Nova Receita
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl animate-fade-in">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Nova Receita</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Valor (R$) *</label>
                  <input
                    {...register('amount')}
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0,00"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {errors.amount && <p className="mt-1 text-xs text-destructive">{errors.amount.message}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Data *</label>
                  <input
                    {...register('date')}
                    type="date"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {errors.date && <p className="mt-1 text-xs text-destructive">{errors.date.message}</p>}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Forma de Pagamento *</label>
                <select
                  {...register('paymentMethod')}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="PIX">PIX</option>
                  <option value="CASH">Dinheiro</option>
                  <option value="CREDIT_CARD">Cartao de Credito</option>
                  <option value="DEBIT_CARD">Cartao de Debito</option>
                  <option value="TRANSFER">Transferencia</option>
                  <option value="OTHER">Outro</option>
                </select>
                {errors.paymentMethod && <p className="mt-1 text-xs text-destructive">{errors.paymentMethod.message}</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Profissional</label>
                <select
                  {...register('professionalId')}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Sem profissional</option>
                  {professionals.map((professional) => (
                    <option key={professional.id} value={professional.id}>{professional.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Servico</label>
                <select
                  {...register('serviceId')}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Selecione um servico</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>{service.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Categoria</label>
                <select
                  {...register('categoryId')}
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Sem categoria</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Descricao</label>
                <input
                  {...register('description')}
                  type="text"
                  placeholder="Observacao..."
                  className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg border border-border py-2 text-sm text-foreground transition-colors hover:bg-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Salvando...' : 'Salvar Receita'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
