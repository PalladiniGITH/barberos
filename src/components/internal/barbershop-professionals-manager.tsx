'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus, Power, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  createPlatformProfessional,
  togglePlatformProfessionalActive,
  updatePlatformProfessional,
} from '@/actions/platform-admin'
import { ProfessionalAvatar } from '@/components/ui/professional-avatar'
import { PROFESSIONAL_ATTENDANCE_SCOPE_LABELS } from '@/lib/professionals/operational-config'
import type { PlatformBarbershopDetailData } from '@/lib/platform-admin'
import { formatCurrency } from '@/lib/utils'

function text(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === 'on'
}

export function BarbershopProfessionalsManager({
  barbershopId,
  professionals,
}: {
  barbershopId: string
  professionals: PlatformBarbershopDetailData['professionals']
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)

  const editingProfessional = useMemo(
    () => professionals.find((professional) => professional.id === editingId) ?? null,
    [editingId, professionals]
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
        email: text(formData, 'email'),
        phone: text(formData, 'phone'),
        avatar: text(formData, 'avatar'),
        attendanceScope: text(formData, 'attendanceScope'),
        commissionRate: text(formData, 'commissionRate'),
        haircutPrice: text(formData, 'haircutPrice'),
        beardPrice: text(formData, 'beardPrice'),
        comboPrice: text(formData, 'comboPrice'),
        active: checked(formData, 'active'),
      }

      const result = editingProfessional
        ? await updatePlatformProfessional(editingProfessional.id, payload)
        : await createPlatformProfessional(payload)

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success(editingProfessional ? 'Profissional atualizado.' : 'Profissional criado.')
      resetForm()
      router.refresh()
    })
  }

  function toggleActive(professionalId: string) {
    startTransition(async () => {
      const result = await togglePlatformProfessionalActive(barbershopId, professionalId)

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success('Status do profissional atualizado.')
      router.refresh()
    })
  }

  return (
    <section
      id="profissionais"
      className="platform-panel p-5"
    >
      <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Profissionais</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          Equipe do tenant preparada pelo painel master
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Cadastre, edite e ative a equipe operacional sem usar o contexto do tenant logado. O guard do backend
          valida o barbershop alvo em cada mutacao.
        </p>
      </div>

      <form
        key={editingProfessional?.id ?? 'new-professional'}
        onSubmit={onSubmit}
        className="mt-5 rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">
              {editingProfessional ? 'Editar profissional' : 'Adicionar profissional'}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Nesta fase, o painel master aceita avatar por URL/caminho ja existente para agilizar migracoes manuais.
            </p>
          </div>

          {editingProfessional ? (
            <button type="button" onClick={resetForm} className="action-button">
              <X className="h-4 w-4" />
              Cancelar edicao
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] px-3 py-2 text-xs text-muted-foreground">
              <Plus className="h-3.5 w-3.5" />
              Novo cadastro master
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block min-w-0 md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Nome</span>
            <input name="name" defaultValue={editingProfessional?.name ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Email</span>
            <input name="email" type="email" defaultValue={editingProfessional?.email ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Telefone</span>
            <input name="phone" defaultValue={editingProfessional?.phone ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0 md:col-span-2 xl:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Avatar (URL ou /uploads/...)</span>
            <input name="avatar" defaultValue={editingProfessional?.avatar ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Escopo de atendimento</span>
            <select
              name="attendanceScope"
              defaultValue={editingProfessional?.attendanceScope ?? 'BOTH'}
              className="auth-input h-11 rounded-[0.95rem] px-3 py-2"
            >
              {Object.entries(PROFESSIONAL_ATTENDANCE_SCOPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Comissao (%)</span>
            <input name="commissionRate" inputMode="decimal" defaultValue={editingProfessional?.commissionRate ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Corte</span>
            <input name="haircutPrice" inputMode="decimal" defaultValue={editingProfessional?.haircutPrice ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Barba</span>
            <input name="beardPrice" inputMode="decimal" defaultValue={editingProfessional?.beardPrice ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Combo</span>
            <input name="comboPrice" inputMode="decimal" defaultValue={editingProfessional?.comboPrice ?? ''} className="auth-input h-11 rounded-[0.95rem] px-3 py-2" />
          </label>
          <label className="flex items-start gap-3 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,16,0.36)] px-4 py-3 text-sm text-foreground">
            <input
              name="active"
              type="checkbox"
              defaultChecked={editingProfessional?.active ?? true}
              className="mt-0.5 h-4 w-4 rounded border-border bg-transparent text-primary focus:ring-primary/40"
            />
            <span>
              <span className="block font-medium">Ativo na agenda</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Use para preparar a equipe antes do piloto.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-[rgba(255,255,255,0.06)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            O painel master salva no tenant alvo e revalida agenda, equipe e dashboard.
          </p>
          <button type="submit" disabled={isPending} className="action-button-primary inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editingProfessional ? 'Salvar profissional' : 'Criar profissional'}
          </button>
        </div>
      </form>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {professionals.map((professional) => (
          <article
            key={professional.id}
            className="rounded-[1.15rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <ProfessionalAvatar name={professional.name} imageUrl={professional.avatar} size="md" />
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-foreground">{professional.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{professional.email ?? 'Sem email'}{professional.phone ? ` - ${professional.phone}` : ''}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {PROFESSIONAL_ATTENDANCE_SCOPE_LABELS[professional.attendanceScope]}
                  </p>
                </div>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                professional.active
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-500/20 bg-slate-500/10 text-slate-300'
              }`}>
                {professional.active ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agenda futura</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{professional.upcomingAppointments}</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Comissao</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{professional.commissionRate !== null ? `${professional.commissionRate}%` : 'Padrao'}</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Corte</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{professional.haircutPrice !== null ? formatCurrency(professional.haircutPrice) : 'Catalogo'}</p>
              </div>
              <div className="rounded-[0.95rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(12,12,16,0.36)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Combo</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{professional.comboPrice !== null ? formatCurrency(professional.comboPrice) : 'Catalogo'}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditingId(professional.id)} className="action-button">
                <Pencil className="h-4 w-4" />
                Editar
              </button>
              <button type="button" onClick={() => toggleActive(professional.id)} className="action-button">
                <Power className="h-4 w-4" />
                {professional.active ? 'Inativar' : 'Ativar'}
              </button>
            </div>
          </article>
        ))}

        {professionals.length === 0 && (
          <div className="rounded-[1.15rem] border border-dashed border-[rgba(255,255,255,0.08)] px-4 py-10 text-center text-sm text-muted-foreground xl:col-span-2">
            Nenhum profissional cadastrado para este tenant ainda.
          </div>
        )}
      </div>
    </section>
  )
}
