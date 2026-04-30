'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus, Power, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  createPlatformService,
  togglePlatformServiceActive,
  updatePlatformService,
} from '@/actions/platform-admin'
import type { PlatformBarbershopDetailData } from '@/lib/platform-admin'
import { formatCurrency } from '@/lib/utils'

function text(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === 'on'
}

export function BarbershopServicesManager({
  barbershopId,
  services,
  categories,
}: {
  barbershopId: string
  services: PlatformBarbershopDetailData['services']
  categories: PlatformBarbershopDetailData['serviceCategories']
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)

  const editingService = useMemo(
    () => services.find((service) => service.id === editingId) ?? null,
    [editingId, services]
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
        description: text(formData, 'description'),
        price: text(formData, 'price'),
        duration: text(formData, 'duration'),
        categoryId: text(formData, 'categoryId'),
        active: checked(formData, 'active'),
      }

      const result = editingService
        ? await updatePlatformService(editingService.id, payload)
        : await createPlatformService(payload)

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(editingService ? 'Servico atualizado.' : 'Servico criado.')
      resetForm()
      router.refresh()
    })
  }

  function toggleActive(serviceId: string) {
    startTransition(async () => {
      const result = await togglePlatformServiceActive(barbershopId, serviceId)

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success('Status do servico atualizado.')
      router.refresh()
    })
  }

  return (
    <section
      id="servicos"
      className="platform-panel p-5"
    >
      <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Servicos</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          Catalogo operacional para implantacao e migracao manual
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          O PLATFORM_ADMIN prepara servicos, preco, duracao e categoria diretamente no tenant alvo antes do piloto.
        </p>
      </div>

      <form
        key={editingService?.id ?? 'new-service'}
        onSubmit={onSubmit}
        className="mt-5 rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">
              {editingService ? 'Editar servico' : 'Adicionar servico'}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Use essa area para montar o catalogo inicial vindo de operacao nova ou de sistema legado.
            </p>
          </div>

          {editingService ? (
            <button type="button" onClick={resetForm} className="action-button">
              <X className="h-4 w-4" />
              Cancelar edicao
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] px-3 py-2 text-xs text-muted-foreground">
              <Plus className="h-3.5 w-3.5" />
              Novo servico master
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block min-w-0 md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Nome</span>
            <input name="name" defaultValue={editingService?.name ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Preco</span>
            <input name="price" inputMode="decimal" defaultValue={editingService?.price ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Duracao (min)</span>
            <input name="duration" inputMode="numeric" defaultValue={editingService?.duration ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0 md:col-span-2 xl:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Descricao</span>
            <input name="description" defaultValue={editingService?.description ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Categoria</span>
            <select name="categoryId" defaultValue={editingService?.categoryId ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2">
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-3 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3 text-sm text-foreground">
            <input
              name="active"
              type="checkbox"
              defaultChecked={editingService?.active ?? true}
              className="mt-0.5 h-4 w-4 rounded border-border bg-transparent text-primary focus:ring-primary/40"
            />
            <span>
              <span className="block font-medium">Ativo no tenant</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Servicos inativos ficam fora da rotina, mas seguem no historico.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-[rgba(255,255,255,0.06)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Duracao e preco sao validados no backend para evitar migracao com dado invalido.
          </p>
          <button type="submit" disabled={isPending} className="action-button-primary inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editingService ? 'Salvar servico' : 'Criar servico'}
          </button>
        </div>
      </form>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {services.map((service) => (
          <article
            key={service.id}
            className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-foreground">{service.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{service.description ?? 'Sem descricao operacional registrada.'}</p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                service.active
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-500/20 bg-slate-500/10 text-slate-300'
              }`}>
                {service.active ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Preco</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{formatCurrency(service.price)}</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Duracao</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{service.duration} min</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Categoria</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{service.categoryName ?? 'Sem categoria'}</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agenda futura</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{service.upcomingAppointments}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditingId(service.id)} className="action-button">
                <Pencil className="h-4 w-4" />
                Editar
              </button>
              <button type="button" onClick={() => toggleActive(service.id)} className="action-button">
                <Power className="h-4 w-4" />
                {service.active ? 'Inativar' : 'Ativar'}
              </button>
            </div>
          </article>
        ))}

        {services.length === 0 && (
          <div className="rounded-[1.15rem] border border-dashed border-[rgba(255,255,255,0.08)] px-4 py-10 text-center text-sm text-muted-foreground xl:col-span-2">
            Nenhum servico cadastrado para este tenant ainda.
          </div>
        )}
      </div>
    </section>
  )
}
