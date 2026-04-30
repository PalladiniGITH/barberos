'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  createPlatformCustomer,
  updatePlatformCustomer,
} from '@/actions/platform-admin'
import { ProfessionalAvatar } from '@/components/ui/professional-avatar'
import type { PlatformBarbershopDetailData } from '@/lib/platform-admin'
import {
  CUSTOMER_TYPE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  formatCurrency,
} from '@/lib/utils'

function text(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === 'on'
}

function toDateInputValue(value: Date | null | undefined) {
  if (!value) {
    return ''
  }

  return value.toISOString().slice(0, 10)
}

export function BarbershopCustomersManager({
  barbershopId,
  customers,
  professionals,
}: {
  barbershopId: string
  customers: PlatformBarbershopDetailData['customers']
  professionals: PlatformBarbershopDetailData['professionals']
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)

  const editingCustomer = useMemo(
    () => customers.find((customer) => customer.id === editingId) ?? null,
    [customers, editingId]
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
        name: text(formData, 'name'),
        phone: text(formData, 'phone'),
        email: text(formData, 'email'),
        notes: text(formData, 'notes'),
        type: text(formData, 'type'),
        preferredProfessionalId: text(formData, 'preferredProfessionalId'),
        active: checked(formData, 'active'),
        marketingOptOut: checked(formData, 'marketingOptOut'),
        subscriptionStatus: text(formData, 'subscriptionStatus'),
        subscriptionPrice: text(formData, 'subscriptionPrice'),
        subscriptionStartedAt: text(formData, 'subscriptionStartedAt'),
      }

      const result = editingCustomer
        ? await updatePlatformCustomer(editingCustomer.id, payload)
        : await createPlatformCustomer(payload)

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(editingCustomer ? 'Cliente atualizado.' : 'Cliente criado.')
      resetForm()
      router.refresh()
    })
  }

  return (
    <section
      id="clientes"
      className="platform-panel p-5"
    >
      <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Clientes e migracao manual
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          Base inicial para onboarding e operacao assistida
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          O PLATFORM_ADMIN consegue alimentar clientes principais, preferencia de profissional e contexto de
          assinatura sem depender de importacao automatica nesta fase.
        </p>
      </div>

      <form
        key={editingCustomer?.id ?? 'new-customer'}
        onSubmit={onSubmit}
        className="mt-5 rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">
              {editingCustomer ? 'Editar cliente' : 'Adicionar cliente'}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Ideal para cadastrar clientes-chave e assinantes que precisam entrar no piloto logo no inicio.
            </p>
          </div>

          {editingCustomer ? (
            <button type="button" onClick={resetForm} className="action-button">
              <X className="h-4 w-4" />
              Cancelar edicao
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] px-3 py-2 text-xs text-muted-foreground">
              <Plus className="h-3.5 w-3.5" />
              Novo cliente master
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block min-w-0 md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Nome</span>
            <input name="name" defaultValue={editingCustomer?.name ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Telefone</span>
            <input name="phone" defaultValue={editingCustomer?.phone ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Email</span>
            <input name="email" type="email" defaultValue={editingCustomer?.email ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Tipo</span>
            <select name="type" defaultValue={editingCustomer?.type ?? 'WALK_IN'} className="auth-input h-11 rounded-[0.95rem] px-3 py-2">
              <option value="WALK_IN">Avulso</option>
              <option value="SUBSCRIPTION">Assinatura</option>
            </select>
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Profissional preferido</span>
            <select
              name="preferredProfessionalId"
              defaultValue={editingCustomer?.preferredProfessionalId ?? ''}
              className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
            >
              <option value="">Nao definido</option>
              {professionals.map((professional) => (
                <option key={professional.id} value={professional.id}>
                  {professional.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Status da assinatura</span>
            <select
              name="subscriptionStatus"
              defaultValue={editingCustomer?.subscriptionStatus ?? 'ACTIVE'}
              className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
            >
              <option value="">Sem assinatura</option>
              <option value="ACTIVE">Ativa</option>
              <option value="PAUSED">Pausada</option>
              <option value="CANCELLED">Cancelada</option>
            </select>
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Valor da assinatura</span>
            <input
              name="subscriptionPrice"
              inputMode="decimal"
              defaultValue={editingCustomer?.subscriptionPrice ?? ''}
              className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Inicio da assinatura</span>
            <input
              name="subscriptionStartedAt"
              type="date"
              defaultValue={toDateInputValue(editingCustomer?.subscriptionStartedAt)}
              className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
            />
          </label>
        </div>

        <label className="mt-4 block min-w-0">
          <span className="mb-1.5 block text-sm font-medium text-foreground">Observacoes internas</span>
          <textarea
            name="notes"
            rows={3}
            defaultValue={editingCustomer?.notes ?? ''}
            className="auth-input min-h-[104px] rounded-[0.95rem] px-3 py-2"
          />
        </label>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex items-start gap-3 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3 text-sm text-foreground">
            <input
              name="active"
              type="checkbox"
              defaultChecked={editingCustomer?.active ?? true}
              className="mt-0.5 h-4 w-4 rounded border-border bg-transparent text-primary focus:ring-primary/40"
            />
            <span>
              <span className="block font-medium">Cliente ativo</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Mantem o cliente visivel para agenda, inteligencia e operacao do tenant.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3 text-sm text-foreground">
            <input
              name="marketingOptOut"
              type="checkbox"
              defaultChecked={editingCustomer?.marketingOptOut ?? false}
              className="mt-0.5 h-4 w-4 rounded border-border bg-transparent text-primary focus:ring-primary/40"
            />
            <span>
              <span className="block font-medium">Opt-out de marketing</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Use quando a migracao indicar que o cliente nao deseja automacoes.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-[rgba(255,255,255,0.06)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Todas as mutacoes internas validam tenant alvo, profissional preferido e role de plataforma no backend.
          </p>
          <button type="submit" disabled={isPending} className="action-button-primary inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editingCustomer ? 'Salvar cliente' : 'Criar cliente'}
          </button>
        </div>
      </form>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {customers.map((customer) => {
          const preferredProfessional = professionals.find(
            (professional) => professional.id === customer.preferredProfessionalId
          )

          return (
            <article
              key={customer.id}
              className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-foreground">{customer.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {customer.phone ?? 'Sem telefone'}
                    {customer.email ? ` - ${customer.email}` : ''}
                  </p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                  customer.active
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                    : 'border-slate-500/20 bg-slate-500/10 text-slate-300'
                }`}>
                  {customer.active ? 'Ativo' : 'Inativo'}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-200">
                  {CUSTOMER_TYPE_LABELS[customer.type]}
                </span>
                {customer.subscriptionStatus && (
                  <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-200">
                    {SUBSCRIPTION_STATUS_LABELS[customer.subscriptionStatus]}
                  </span>
                )}
                {customer.marketingOptOut && (
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                    Marketing pausado
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agenda futura</p>
                  <p className="mt-2 text-lg font-semibold text-foreground">{customer.upcomingAppointments}</p>
                </div>
                <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Assinatura</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {customer.subscriptionPrice !== null ? formatCurrency(customer.subscriptionPrice) : 'Nao aplicavel'}
                  </p>
                </div>
                <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3 sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Preferencia operacional</p>
                  {preferredProfessional ? (
                    <div className="mt-2 flex items-center gap-2">
                      <ProfessionalAvatar
                        name={preferredProfessional.name}
                        imageUrl={preferredProfessional.avatar}
                        size="sm"
                      />
                      <p className="text-sm font-semibold text-foreground">{preferredProfessional.name}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">Sem profissional preferido definido.</p>
                  )}
                </div>
              </div>

              {customer.notes && (
                <p className="mt-4 rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3 text-sm leading-6 text-muted-foreground">
                  {customer.notes}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditingId(customer.id)} className="action-button">
                  <Pencil className="h-4 w-4" />
                  Editar
                </button>
              </div>
            </article>
          )
        })}

        {customers.length === 0 && (
          <div className="rounded-[1.15rem] border border-dashed border-[rgba(255,255,255,0.08)] px-4 py-10 text-center text-sm text-muted-foreground xl:col-span-2">
            Nenhum cliente carregado para este tenant ainda.
          </div>
        )}
      </div>
    </section>
  )
}
