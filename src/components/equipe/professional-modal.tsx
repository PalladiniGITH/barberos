'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { createProfessional, updateProfessional } from '@/actions/equipe'
import {
  PROFESSIONAL_ATTENDANCE_SCOPE_LABELS,
  type ProfessionalAttendanceScope,
} from '@/lib/professionals/operational-config'

const decimalField = z
  .string()
  .optional()
  .refine(
    (value) => !value || /^\d+(?:[.,]\d{1,2})?$/.test(value.trim()),
    'Use apenas numeros e ate 2 casas decimais'
  )

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatorio (min. 2 caracteres)'),
  email: z.string().email('Email invalido').or(z.literal('')).optional(),
  phone: z.string().optional(),
  commissionRate: decimalField,
  haircutPrice: decimalField,
  beardPrice: decimalField,
  comboPrice: decimalField,
  attendanceScope: z.enum(['BOTH', 'SUBSCRIPTION_ONLY', 'WALK_IN_ONLY']),
})

type FormData = z.infer<typeof schema>

export interface ProfessionalFormValue {
  id: string
  name: string
  email: string | null
  phone: string | null
  commissionRate: number | null
  haircutPrice: number | null
  beardPrice: number | null
  comboPrice: number | null
  attendanceScope: ProfessionalAttendanceScope
}

interface Props {
  professional?: ProfessionalFormValue
}

function formatNumberInput(value: number | null | undefined) {
  return typeof value === 'number' ? String(value) : ''
}

export function ProfessionalModal({ professional }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const isEdit = Boolean(professional)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: professional?.name ?? '',
      email: professional?.email ?? '',
      phone: professional?.phone ?? '',
      commissionRate: formatNumberInput(professional?.commissionRate),
      haircutPrice: formatNumberInput(professional?.haircutPrice),
      beardPrice: formatNumberInput(professional?.beardPrice),
      comboPrice: formatNumberInput(professional?.comboPrice),
      attendanceScope: professional?.attendanceScope ?? 'BOTH',
    },
  })

  async function onSubmit(data: FormData) {
    const payload = {
      ...data,
      commissionRate: data.commissionRate?.replace(',', '.') ?? '',
      haircutPrice: data.haircutPrice?.replace(',', '.') ?? '',
      beardPrice: data.beardPrice?.replace(',', '.') ?? '',
      comboPrice: data.comboPrice?.replace(',', '.') ?? '',
    }

    const result = professional
      ? await updateProfessional(professional.id, payload)
      : await createProfessional(payload)

    if (result.success) {
      toast.success(isEdit ? 'Profissional atualizado!' : 'Profissional cadastrado!')
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
        className={
          isEdit
            ? 'flex items-center gap-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'
            : 'flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
        }
      >
        {isEdit ? <Pencil className="h-3.5 w-3.5" /> : <><Plus className="h-4 w-4" /> Novo Profissional</>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-2xl animate-fade-in">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{isEdit ? 'Editar Profissional' : 'Novo Profissional'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Configure atendimento, comissao e precos operacionais do barbeiro sem mexer no catalogo base.
                </p>
              </div>

              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Nome *</label>
                  <input
                    {...register('name')}
                    placeholder="Ex: Joao Silva"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium">Email</label>
                  <input
                    {...register('email')}
                    type="email"
                    placeholder="joao@barbearia.com"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Telefone</label>
                  <input
                    {...register('phone')}
                    placeholder="(11) 99999-9999"
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium">Escopo de atendimento</label>
                  <select
                    {...register('attendanceScope')}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {Object.entries(PROFESSIONAL_ATTENDANCE_SCOPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-secondary/20 p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-foreground">Configuracao comercial</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Esses valores entram na operacao avulsa e na leitura individual do barbeiro. Se um campo ficar vazio, o sistema usa o valor padrao do servico.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Comissao (%)</label>
                    <input
                      {...register('commissionRate')}
                      inputMode="decimal"
                      placeholder="40"
                      className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    {errors.commissionRate && <p className="mt-1 text-xs text-destructive">{errors.commissionRate.message}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Corte</label>
                    <input
                      {...register('haircutPrice')}
                      inputMode="decimal"
                      placeholder="55"
                      className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    {errors.haircutPrice && <p className="mt-1 text-xs text-destructive">{errors.haircutPrice.message}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Barba</label>
                    <input
                      {...register('beardPrice')}
                      inputMode="decimal"
                      placeholder="35"
                      className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    {errors.beardPrice && <p className="mt-1 text-xs text-destructive">{errors.beardPrice.message}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Combo</label>
                    <input
                      {...register('comboPrice')}
                      inputMode="decimal"
                      placeholder="80"
                      className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    {errors.comboPrice && <p className="mt-1 text-xs text-destructive">{errors.comboPrice.message}</p>}
                  </div>
                </div>
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
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
