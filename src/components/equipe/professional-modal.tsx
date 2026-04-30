'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ImagePlus, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { createProfessional, updateProfessional } from '@/actions/equipe'
import { ProfessionalAvatar } from '@/components/ui/professional-avatar'
import {
  PROFESSIONAL_AVATAR_ALLOWED_MIME_TYPES,
  PROFESSIONAL_AVATAR_DEFAULT_MAX_FILE_SIZE_MB,
  professionalAvatarMaxFileSizeBytes,
} from '@/lib/professionals/avatar-upload-policy'
import {
  isProfessionalAvatarUrl,
  normalizeProfessionalAvatarUrl,
} from '@/lib/professionals/avatar'
import {
  PROFESSIONAL_ATTENDANCE_SCOPE_LABELS,
  type ProfessionalAttendanceScope,
} from '@/lib/professionals/operational-config'

const PROFESSIONAL_AVATAR_INPUT_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
const PROFESSIONAL_AVATAR_MAX_FILE_SIZE_BYTES = professionalAvatarMaxFileSizeBytes(
  PROFESSIONAL_AVATAR_DEFAULT_MAX_FILE_SIZE_MB
)

const decimalField = z
  .string()
  .optional()
  .refine(
    (value) => !value || /^\d+(?:[.,]\d{1,2})?$/.test(value.trim()),
    'Use apenas numeros e ate 2 casas decimais'
  )

const avatarField = z
  .string()
  .optional()
  .refine(
    (value) => !value || isProfessionalAvatarUrl(value),
    'Informe uma URL valida para a foto'
  )

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatorio (min. 2 caracteres)'),
  email: z.string().email('Email invalido').or(z.literal('')).optional(),
  phone: z.string().optional(),
  avatar: avatarField,
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
  avatar: string | null
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

function buildDefaultValues(professional?: ProfessionalFormValue): FormData {
  return {
    name: professional?.name ?? '',
    email: professional?.email ?? '',
    phone: professional?.phone ?? '',
    avatar: professional?.avatar ?? '',
    commissionRate: formatNumberInput(professional?.commissionRate),
    haircutPrice: formatNumberInput(professional?.haircutPrice),
    beardPrice: formatNumberInput(professional?.beardPrice),
    comboPrice: formatNumberInput(professional?.comboPrice),
    attendanceScope: professional?.attendanceScope ?? 'BOTH',
  }
}

async function uploadProfessionalAvatar(professionalId: string, file: File) {
  const formData = new FormData()
  formData.set('file', file)

  const response = await fetch(`/api/professionals/${professionalId}/avatar`, {
    method: 'POST',
    body: formData,
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error ?? 'Nao foi possivel enviar a foto agora.')
  }

  return payload as { success: true; avatarUrl: string }
}

export function ProfessionalModal({ professional }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null)
  const [selectedAvatarPreviewUrl, setSelectedAvatarPreviewUrl] = useState<string | null>(null)
  const [showAdvancedAvatarField, setShowAdvancedAvatarField] = useState(false)
  const [avatarTaskLabel, setAvatarTaskLabel] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const router = useRouter()
  const isEdit = Boolean(professional)
  const defaultValues = buildDefaultValues(professional)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  useEffect(() => {
    if (!selectedAvatarPreviewUrl) {
      return undefined
    }

    return () => {
      URL.revokeObjectURL(selectedAvatarPreviewUrl)
    }
  }, [selectedAvatarPreviewUrl])

  const watchedAvatarValue = watch('avatar')
  const previewName = watch('name') || professional?.name || 'Novo profissional'
  const previewAvatarUrl = selectedAvatarPreviewUrl
    ?? normalizeProfessionalAvatarUrl(watchedAvatarValue)
  const hasAvatarPreview = Boolean(previewAvatarUrl)
  const isBusy = isSubmitting

  function resetPendingAvatarSelection() {
    setSelectedAvatarFile(null)
    setSelectedAvatarPreviewUrl(null)
    setAvatarTaskLabel(null)

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleRemoveAvatar() {
    resetPendingAvatarSelection()
    setValue('avatar', '', { shouldDirty: true, shouldValidate: true })
  }

  function closeModal() {
    resetPendingAvatarSelection()
    reset(buildDefaultValues(professional))
    setShowAdvancedAvatarField(false)
    setOpen(false)
  }

  function openModal() {
    reset(buildDefaultValues(professional))
    resetPendingAvatarSelection()
    setShowAdvancedAvatarField(false)
    setOpen(true)
  }

  function handleAvatarFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (
      !PROFESSIONAL_AVATAR_ALLOWED_MIME_TYPES.includes(
        file.type as (typeof PROFESSIONAL_AVATAR_ALLOWED_MIME_TYPES)[number]
      )
    ) {
      toast.error('Envie apenas imagens JPG, PNG ou WEBP.')
      event.target.value = ''
      return
    }

    if (file.size > PROFESSIONAL_AVATAR_MAX_FILE_SIZE_BYTES) {
      toast.error(`A foto deve ter no maximo ${PROFESSIONAL_AVATAR_DEFAULT_MAX_FILE_SIZE_MB}MB.`)
      event.target.value = ''
      return
    }

    setSelectedAvatarFile(file)
    setSelectedAvatarPreviewUrl((currentPreviewUrl) => {
      if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl)
      }

      return URL.createObjectURL(file)
    })
  }

  async function onSubmit(data: FormData) {
    const isUploadingNewAvatar = Boolean(selectedAvatarFile)
    const avatarValueForMutation = isUploadingNewAvatar
      ? professional?.avatar ?? ''
      : data.avatar?.trim() ?? ''
    const payload = {
      ...data,
      avatar: avatarValueForMutation,
      commissionRate: data.commissionRate?.replace(',', '.') ?? '',
      haircutPrice: data.haircutPrice?.replace(',', '.') ?? '',
      beardPrice: data.beardPrice?.replace(',', '.') ?? '',
      comboPrice: data.comboPrice?.replace(',', '.') ?? '',
    }

    const result = professional
      ? await updateProfessional(professional.id, payload)
      : await createProfessional(payload)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    if (selectedAvatarFile) {
      setAvatarTaskLabel('Enviando foto...')

      try {
        await uploadProfessionalAvatar(result.professionalId, selectedAvatarFile)
      } catch (error) {
        toast.error(
          isEdit
            ? `Profissional atualizado, mas a foto nao foi enviada: ${(error as Error).message}`
            : `Profissional cadastrado, mas a foto nao foi enviada: ${(error as Error).message}`
        )
        closeModal()
        router.refresh()
        return
      } finally {
        setAvatarTaskLabel(null)
      }
    }

    toast.success(isEdit ? 'Profissional atualizado!' : 'Profissional cadastrado!')
    closeModal()
    router.refresh()
  }

  return (
    <>
      <button
        onClick={openModal}
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
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} />
          <div className="modal-shell relative w-full max-w-2xl animate-fade-in">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{isEdit ? 'Editar profissional' : 'Novo profissional'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Configure atendimento, comissao e precos operacionais do barbeiro sem mexer no catalogo base.
                </p>
              </div>

              <button onClick={closeModal} className="rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-2 text-muted-foreground transition-colors hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
              <div className="modal-shell-body space-y-5">
                <div className="surface-tier-low flex flex-col gap-4 rounded-[1.25rem] p-4 sm:flex-row sm:items-center">
                  <ProfessionalAvatar
                    name={previewName}
                    imageUrl={previewAvatarUrl}
                    size="lg"
                  />

                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-foreground">Foto do profissional</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Envie uma foto JPG, PNG ou WEBP com ate {PROFESSIONAL_AVATAR_DEFAULT_MAX_FILE_SIZE_MB}MB. O sistema salva apenas o caminho seguro da imagem e usa fallback por iniciais quando necessario.
                    </p>

                    {selectedAvatarFile ? (
                      <p className="mt-3 text-xs font-medium text-foreground/80">
                        Arquivo selecionado: {selectedAvatarFile.name}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={PROFESSIONAL_AVATAR_INPUT_ACCEPT}
                        className="hidden"
                        onChange={handleAvatarFileSelection}
                      />

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        {selectedAvatarFile || hasAvatarPreview ? 'Trocar foto' : 'Enviar foto'}
                      </button>

                      {hasAvatarPreview ? (
                        <button
                          type="button"
                          onClick={handleRemoveAvatar}
                          className="inline-flex items-center gap-2 rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remover foto
                        </button>
                      ) : null}

                      {selectedAvatarFile ? (
                        <button
                          type="button"
                          onClick={resetPendingAvatarSelection}
                          className="inline-flex items-center gap-2 rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                          Descartar upload
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="surface-tier-low space-y-3 rounded-[1.25rem] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Fallback avancado</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Se voce ja tiver um CDN ou storage externo, ainda pode salvar uma URL manualmente.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowAdvancedAvatarField((currentValue) => !currentValue)}
                      className="rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {showAdvancedAvatarField ? 'Ocultar URL' : 'Usar URL manual'}
                    </button>
                  </div>

                  <div className={showAdvancedAvatarField ? 'block' : 'hidden'}>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">URL da foto</label>
                    <input
                      {...register('avatar')}
                      placeholder="https://cdn.seusite.com/profissionais/joao.webp"
                      className="auth-input px-3 py-2.5"
                    />
                    {showAdvancedAvatarField && errors.avatar ? (
                      <p className="mt-1 text-xs text-destructive">{errors.avatar.message}</p>
                    ) : null}
                  </div>
                </div>

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
                  onClick={closeModal}
                  className="action-button flex-1"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isBusy}
                  className="action-button-primary flex flex-1 items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {avatarTaskLabel ?? (isBusy ? 'Salvando...' : 'Salvar profissional')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
