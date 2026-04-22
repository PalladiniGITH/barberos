'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { updateCustomerProfile } from '@/actions/clientes'

const decimalField = z
  .string()
  .optional()
  .or(z.literal(''))
  .refine(
    (value) => !value || /^\d+(?:[.,]\d{1,2})?$/.test(value.trim()),
    'Use apenas numeros e ate 2 casas decimais'
  )

const optionalDateField = z
  .string()
  .optional()
  .or(z.literal(''))
  .refine(
    (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value),
    'Use uma data valida'
  )

const optionalPhoneField = z
  .string()
  .optional()
  .or(z.literal(''))
  .refine(
    (value) => !value || value.replace(/\D/g, '').length >= 10,
    'Telefone invalido'
  )

const schema = z.object({
  name: z.string().trim().min(2, 'Nome obrigatorio (min. 2 caracteres)'),
  phone: optionalPhoneField,
  email: z.string().email('Email invalido').optional().or(z.literal('')),
  birthDate: optionalDateField,
  notes: z.string().max(1000, 'Observacoes muito longas').optional().or(z.literal('')),
  type: z.enum(['SUBSCRIPTION', 'WALK_IN']),
  preferredProfessionalId: z.string().optional().or(z.literal('')),
  active: z.boolean(),
  marketingOptOut: z.boolean(),
  subscriptionStatus: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional().or(z.literal('')),
  subscriptionPrice: decimalField,
  subscriptionStartedAt: optionalDateField,
})

type FormData = z.infer<typeof schema>

export interface CustomerProfileEditValue {
  id: string
  name: string
  phone: string | null
  email: string | null
  birthDate: string | null
  notes: string | null
  type: 'SUBSCRIPTION' | 'WALK_IN'
  subscriptionStatus: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | null
  subscriptionPrice: number | null
  subscriptionStartedAt: string | null
  preferredProfessionalId: string | null
  preferredProfessionalName: string | null
  active: boolean
  marketingOptOut: boolean
}

interface Props {
  customer: CustomerProfileEditValue
  professionals: Array<{ id: string; name: string }>
}

function formatNumberInput(value: number | null | undefined) {
  return typeof value === 'number' ? String(value) : ''
}

export function CustomerProfileEditModal({ customer, professionals }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const {
    register,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: customer.name,
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      birthDate: customer.birthDate ?? '',
      notes: customer.notes ?? '',
      type: customer.type,
      preferredProfessionalId: customer.preferredProfessionalId ?? '',
      active: customer.active,
      marketingOptOut: customer.marketingOptOut,
      subscriptionStatus: customer.subscriptionStatus ?? 'ACTIVE',
      subscriptionPrice: formatNumberInput(customer.subscriptionPrice),
      subscriptionStartedAt: customer.subscriptionStartedAt ?? '',
    },
  })

  const selectedType = watch('type')

  async function onSubmit(data: FormData) {
    const payload = {
      ...data,
      subscriptionPrice: data.subscriptionPrice?.replace(',', '.') ?? '',
    }

    const result = await updateCustomerProfile(customer.id, payload)

    if (result.success) {
      toast.success('Cliente atualizado com sucesso.')
      setOpen(false)
      router.refresh()
      return
    }

    toast.error(result.error)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="action-button"
      >
        <Pencil className="h-4 w-4" />
        Editar cliente
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Fechar edicao"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          <div className="relative flex h-full w-full max-w-2xl flex-col border-l border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.98),rgba(15,17,21,0.98))] shadow-[0_30px_70px_-30px_rgba(2,6,23,0.95)]">
            <div className="flex items-start justify-between gap-4 border-b border-[rgba(255,255,255,0.08)] px-6 py-5">
              <div>
                <p className="page-kicker">Cadastro do cliente</p>
                <h2 className="mt-2 text-xl font-semibold text-foreground">Editar dados e relacionamento</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  Atualize contato, perfil comercial, barbeiro preferido e bloqueio de campanhas sem sair da leitura analitica.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <section className="dashboard-panel p-4 sm:p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">Dados basicos</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Informacoes de contato e contexto do relacionamento com a barbearia.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-sm font-medium text-foreground">Nome</label>
                      <input
                        {...register('name')}
                        placeholder="Ex: Bruno Almeida"
                        className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                      />
                      {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">Telefone</label>
                      <input
                        {...register('phone')}
                        placeholder="(11) 99999-9999"
                        className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                      />
                      {errors.phone && <p className="mt-1 text-xs text-destructive">{errors.phone.message}</p>}
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
                      <input
                        {...register('email')}
                        type="email"
                        placeholder="cliente@email.com"
                        className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                      />
                      {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">Data de nascimento</label>
                      <input
                        {...register('birthDate')}
                        type="date"
                        className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                      />
                      {errors.birthDate && <p className="mt-1 text-xs text-destructive">{errors.birthDate.message}</p>}
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">Barbeiro preferido</label>
                      <select
                        {...register('preferredProfessionalId')}
                        className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                      >
                        <option value="">Sem preferencia definida</option>
                        {professionals.map((professional) => (
                          <option key={professional.id} value={professional.id}>
                            {professional.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-sm font-medium text-foreground">Observacoes</label>
                      <textarea
                        {...register('notes')}
                        rows={4}
                        placeholder="Anotacoes comerciais, preferencia de atendimento ou contexto util para a equipe."
                        className="auth-input min-h-[110px] rounded-[0.95rem] px-3 py-2"
                      />
                      {errors.notes && <p className="mt-1 text-xs text-destructive">{errors.notes.message}</p>}
                    </div>
                  </div>
                </section>

                <section className="dashboard-panel p-4 sm:p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">Relacionamento e status</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Defina o modelo do cliente, o status operacional e a elegibilidade para campanhas.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">Tipo do cliente</label>
                      <select
                        {...register('type')}
                        className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                      >
                        <option value="WALK_IN">Avulso</option>
                        <option value="SUBSCRIPTION">Assinatura</option>
                      </select>
                    </div>

                    <div className="space-y-3 rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
                      <label className="flex items-start gap-3 text-sm text-foreground">
                        <input
                          {...register('active')}
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-border bg-transparent text-primary focus:ring-primary/40"
                        />
                        <span>
                          <span className="block font-medium">Cliente ativo</span>
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                            Desmarque para sinalizar cadastro inativo sem apagar o historico.
                          </span>
                        </span>
                      </label>

                      <label className="flex items-start gap-3 text-sm text-foreground">
                        <input
                          {...register('marketingOptOut')}
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-border bg-transparent text-primary focus:ring-primary/40"
                        />
                        <span>
                          <span className="block font-medium">Bloquear campanhas automaticas</span>
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                            Impede contatos promocionais e reativacoes automatizadas para este cliente.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                </section>

                {selectedType === 'SUBSCRIPTION' && (
                  <section className="dashboard-panel p-4 sm:p-5">
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold text-foreground">Dados comerciais da assinatura</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Esses campos sustentam a leitura comercial do perfil e a operacao recorrente.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">Status da assinatura</label>
                        <select
                          {...register('subscriptionStatus')}
                          className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                        >
                          <option value="ACTIVE">Ativa</option>
                          <option value="PAUSED">Pausada</option>
                          <option value="CANCELLED">Cancelada</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">Valor da assinatura</label>
                        <input
                          {...register('subscriptionPrice')}
                          inputMode="decimal"
                          placeholder="149,90"
                          className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                        />
                        {errors.subscriptionPrice && (
                          <p className="mt-1 text-xs text-destructive">{errors.subscriptionPrice.message}</p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">Inicio da assinatura</label>
                        <input
                          {...register('subscriptionStartedAt')}
                          type="date"
                          className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
                        />
                        {errors.subscriptionStartedAt && (
                          <p className="mt-1 text-xs text-destructive">{errors.subscriptionStartedAt.message}</p>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </div>

              <div className="flex items-center gap-3 border-t border-[rgba(255,255,255,0.08)] px-6 py-4">
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
                  className="premium-dark-button flex-1 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Salvando...' : 'Salvar alteracoes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
