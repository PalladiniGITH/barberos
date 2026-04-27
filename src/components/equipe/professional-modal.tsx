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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="modal-shell relative w-full max-w-2xl animate-fade-in">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{isEdit ? 'Editar profissional' : 'Novo profissional'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Configure atendimento, comissao e precos operacionais do barbeiro sem mexer no catalogo base.
                </p>
              </div>

              <button onClick={() => setOpen(false)} className="rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-2 text-muted-foreground transition-colors hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
              <div className="modal-shell-body space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Nome *</label>
                  <input
                    {...register('name')}
                    placeholder="Ex: Joao Silva"
                    className="auth-input px-3 py-2.5"
                  />
                  {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
                  <input
                    {...register('email')}
                    type="email"
                    placeholder="joao@barbearia.com"
                    className="auth-input px-3 py-2.5"
                  />
                  {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Telefone</label>
                  <input
                    {...register('phone')}
                    placeholder="(11) 99999-9999"
                    className="auth-input px-3 py-2.5"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Escopo de atendimento</label>
                  <select
                    {...register('attendanceScope')}
                    className="auth-input px-3 py-2.5"
                  >
                    {Object.entries(PROFESSIONAL_ATTENDANCE_SCOPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="surface-tier-low p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-foreground">Configuracao comercial</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Esses valores entram na operacao avulsa e na leitura individual do barbeiro. Se um campo ficar vazio, o sistema usa o valor padrao do servico.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">Comissao (%)</label>
                    <input
                      {...register('commissionRate')}
                      inputMode="decimal"
                      placeholder="40"
                      className="auth-input px-3 py-2.5"
                    />
                    {errors.commissionRate && <p className="mt-1 text-xs text-destructive">{errors.commissionRate.message}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">Corte</label>
                    <input
                      {...register('haircutPrice')}
                      inputMode="decimal"
                      placeholder="55"
                      className="auth-input px-3 py-2.5"
                    />
                    {errors.haircutPrice && <p className="mt-1 text-xs text-destructive">{errors.haircutPrice.message}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">Barba</label>
                    <input
                      {...register('beardPrice')}
                      inputMode="decimal"
                      placeholder="35"
                      className="auth-input px-3 py-2.5"
                    />
                    {errors.beardPrice && <p className="mt-1 text-xs text-destructive">{errors.beardPrice.message}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">Combo</label>
                    <input
                      {...register('comboPrice')}
                      inputMode="decimal"
                      placeholder="80"
                      className="auth-input px-3 py-2.5"
                    />
                    {errors.comboPrice && <p className="mt-1 text-xs text-destructive">{errors.comboPrice.message}</p>}
                  </div>
                </div>
              </div>
              </div>

              <div className="modal-shell-footer">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="action-button flex-1"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="action-button-primary flex flex-1 items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Salvando...' : 'Salvar profissional'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
