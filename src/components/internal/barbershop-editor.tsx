'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { updatePlatformBarbershop } from '@/actions/platform-admin'
import { BRAZIL_TIMEZONES } from '@/lib/onboarding'
import type { PlatformBarbershopDetailData } from '@/lib/platform-admin'

const BARBERSHOP_STATUS_OPTIONS = [
  { value: 'TRIAL', label: 'Trial' },
  { value: 'ACTIVE', label: 'Ativa' },
  { value: 'PAST_DUE', label: 'Em atraso' },
  { value: 'BLOCKED', label: 'Bloqueada' },
  { value: 'CANCELED', label: 'Cancelada' },
] as const

function toDateInputValue(value: Date | null | undefined) {
  if (!value) {
    return ''
  }

  return value.toISOString().slice(0, 10)
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === 'on'
}

function text(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

export function BarbershopEditor({
  barbershop,
  integrations,
}: {
  barbershop: PlatformBarbershopDetailData['barbershop']
  integrations: PlatformBarbershopDetailData['integrations']
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  const timezoneOptions = useMemo(() => BRAZIL_TIMEZONES, [])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    startTransition(async () => {
      const result = await updatePlatformBarbershop({
        barbershopId: barbershop.id,
        name: text(formData, 'name'),
        slug: text(formData, 'slug'),
        timezone: text(formData, 'timezone'),
        active: checked(formData, 'active'),
        phone: text(formData, 'phone'),
        email: text(formData, 'email'),
        address: text(formData, 'address'),
        billingEmail: text(formData, 'billingEmail'),
        subscriptionPlan: text(formData, 'subscriptionPlan'),
        subscriptionStatus: text(formData, 'subscriptionStatus'),
        trialEndsAt: text(formData, 'trialEndsAt'),
        blockedReason: text(formData, 'blockedReason'),
        whatsappEnabled: checked(formData, 'whatsappEnabled'),
        evolutionInstanceName: text(formData, 'evolutionInstanceName'),
      })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      setLastSavedAt(new Date())
      toast.success('Dados da barbearia atualizados no painel master.')
      router.refresh()
    })
  }

  return (
    <section
      id="dados"
      className="platform-panel p-5"
    >
      <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Dados da barbearia
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          Perfil operacional e comercial do tenant
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Edite os dados centrais da barbearia, o contexto comercial e os campos de WhatsApp/Evolution sem entrar
          direto no banco.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-5 space-y-5"
      >
        <section className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">Dados gerais</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Nome</span>
              <input name="name" defaultValue={barbershop.name} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Slug</span>
              <input name="slug" defaultValue={barbershop.slug} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Timezone</span>
              <select name="timezone" defaultValue={barbershop.timezone} className="auth-input h-11 rounded-[0.95rem] px-3 py-2">
                {timezoneOptions.map((timezone) => (
                  <option key={timezone.value} value={timezone.value}>
                    {timezone.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Telefone</span>
              <input name="phone" defaultValue={barbershop.phone ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Email</span>
              <input name="email" type="email" defaultValue={barbershop.email ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
            </label>
            <label className="block min-w-0 md:col-span-2 xl:col-span-1">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Endereco</span>
              <input name="address" defaultValue={barbershop.address ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
            </label>
          </div>

          <div className="mt-4 rounded-[1rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] p-4">
            <label className="flex items-start gap-3 text-sm text-foreground">
              <input
                name="active"
                type="checkbox"
                defaultChecked={barbershop.operationalActive}
                className="mt-0.5 h-4 w-4 rounded border-border bg-transparent text-primary focus:ring-primary/40"
              />
              <span>
                <span className="block font-medium">Tenant ativo na operacao</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Desmarque para pausar a operacao dessa barbearia sem perder o historico.
                </span>
              </span>
            </label>
          </div>
        </section>

        <section className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">Comercial e assinatura</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Plano</span>
              <input name="subscriptionPlan" defaultValue={barbershop.subscriptionPlan ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Status comercial</span>
              <select name="subscriptionStatus" defaultValue={barbershop.subscriptionStatus} className="auth-input h-11 rounded-[0.95rem] px-3 py-2">
                {BARBERSHOP_STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Billing email</span>
              <input name="billingEmail" type="email" defaultValue={barbershop.billingEmail ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Trial ate</span>
              <input name="trialEndsAt" type="date" defaultValue={toDateInputValue(barbershop.trialEndsAt)} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
            </label>
          </div>

          <label className="mt-4 block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Motivo de bloqueio</span>
            <textarea
              name="blockedReason"
              defaultValue={barbershop.blockedReason ?? ''}
              rows={3}
              placeholder="Use apenas quando o status comercial exigir contexto."
              className="auth-input min-h-[104px] rounded-[0.95rem] px-3 py-2"
            />
          </label>
        </section>

        <section
          id="whatsapp"
          className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
        >
          <div className="flex flex-col gap-3 border-b border-[rgba(255,255,255,0.06)] pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">WhatsApp e Evolution</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Configure a mensageria do tenant, revise a instance e use o diagnostico atual para validar a implantacao.
              </p>
            </div>
            <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3 text-sm">
              <p className="font-semibold text-foreground">{integrations.whatsappStatusLabel}</p>
              <p className="mt-1 text-muted-foreground">
                {integrations.whatsappLastEventAt
                  ? `Ultimo evento recebido na camada de webhook.`
                  : 'Sem evento recente recebido na mensageria.'}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium text-foreground">Instance Evolution</span>
              <input
                name="evolutionInstanceName"
                defaultValue={barbershop.evolutionInstanceName ?? ''}
                placeholder="linha-nobre-prod"
                className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
              />
            </label>

            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3">
              <p className="text-sm font-medium text-foreground">Webhook secret</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {integrations.webhookSecretConfigured
                  ? integrations.webhookSecretMasked ?? 'Configurado no ambiente'
                  : 'Nao configurado no ambiente'}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Esse secret e global de infraestrutura e aparece aqui apenas mascarado.
              </p>
            </div>

            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3">
              <p className="text-sm font-medium text-foreground">API key por tenant</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {integrations.evolutionApiKeyManagedPerTenant ? 'Modelada no schema atual' : 'Nao modelada nesta fase'}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                A chave segue tratada pela infraestrutura global enquanto o schema nao expor esse dado por tenant.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ultimo inbound</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {barbershop.whatsappLastInboundAt ? new Intl.DateTimeFormat('pt-BR').format(barbershop.whatsappLastInboundAt) : 'Sem registro'}
              </p>
            </div>
            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ultimo outbound</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {barbershop.whatsappLastOutboundAt ? new Intl.DateTimeFormat('pt-BR').format(barbershop.whatsappLastOutboundAt) : 'Sem registro'}
              </p>
            </div>
            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ultimo erro</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {barbershop.whatsappLastErrorAt ? new Intl.DateTimeFormat('pt-BR').format(barbershop.whatsappLastErrorAt) : 'Sem erro recente'}
              </p>
            </div>
            <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">WhatsApp</p>
              <div className="mt-2">
                <label className="flex items-start gap-3 text-sm text-foreground">
                  <input
                    name="whatsappEnabled"
                    type="checkbox"
                    defaultChecked={barbershop.whatsappEnabled}
                    className="mt-0.5 h-4 w-4 rounded border-border bg-transparent text-primary focus:ring-primary/40"
                  />
                  <span>
                    <span className="block font-medium">Habilitar tenant no canal</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Ative apenas quando instance, secret e roteamento estiverem corretos.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>

          {barbershop.whatsappLastErrorMessage && (
            <div className="mt-4 rounded-[1rem] border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <p className="font-semibold">Ultimo erro conhecido da integracao</p>
              <p className="mt-2 leading-6 text-amber-50/90">{barbershop.whatsappLastErrorMessage}</p>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-3 border-t border-[rgba(255,255,255,0.06)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {lastSavedAt
              ? `Ultimo save feito neste browser em ${lastSavedAt.toLocaleTimeString('pt-BR')}.`
              : 'Salve ao final de cada bloco de implantacao para manter o tenant consistente.'}
          </p>
          <button
            type="submit"
            disabled={isPending}
            className="action-button-primary inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? 'Salvando tenant...' : 'Salvar dados da barbearia'}
          </button>
        </div>
      </form>
    </section>
  )
}
