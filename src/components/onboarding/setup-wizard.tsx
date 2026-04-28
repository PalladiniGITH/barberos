'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  MapPin,
  Plus,
  Scissors,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { completeOnboarding } from '@/actions/onboarding'
import { PRODUCT_NAME } from '@/lib/branding'
import { cn } from '@/lib/utils'

const schema = z.object({
  name: z.string().min(2, 'Nome da barbearia obrigatório'),
  phone: z.string().optional(),
  email: z.string().email('Email inválido').or(z.literal('')).optional(),
  address: z.string().optional(),
  timezone: z.string().min(1, 'Selecione o timezone da barbearia'),
  professionals: z.array(z.object({
    name: z.string().min(2, 'Cada profissional precisa ter ao menos 2 caracteres'),
  })).min(1, 'Cadastre pelo menos 1 profissional').max(6),
  services: z.array(z.object({
    name: z.string().min(2, 'Cada serviço precisa ter ao menos 2 caracteres'),
    price: z.string().min(1, 'Preço obrigatório'),
    duration: z.string().min(1, 'Duração obrigatória'),
  })).min(1, 'Cadastre pelo menos 1 serviço').max(8),
  revenueGoal: z.string().min(1, 'Meta de faturamento obrigatória'),
  revenueMin: z.string().min(1, 'Meta mínima obrigatória'),
  expenseLimit: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface SetupWizardProps {
  currentMonthLabel: string
  initialData: FormData
  initialStats: {
    completedSteps: number
    professionalsCount: number
    servicesCount: number
  }
  checklist: Array<{
    id: string
    label: string
    done: boolean
    detail: string
  }>
}

const steps = [
  {
    id: 'business',
    title: 'Sua barbearia',
    description: 'Ajuste os dados básicos para a operação começar organizada desde o primeiro acesso.',
    icon: Briefcase,
    fields: ['name', 'phone', 'email', 'address', 'timezone'] as const,
  },
  {
    id: 'team',
    title: 'Equipe inicial',
    description: 'Sem equipe cadastrada, o sistema não consegue montar ranking, meta individual nem leitura de desempenho.',
    icon: Users,
    fields: ['professionals'] as const,
  },
  {
    id: 'services',
    title: 'Serviços principais',
    description: 'Esses serviços alimentam ticket médio, margem e leitura comercial do catálogo.',
    icon: Scissors,
    fields: ['services'] as const,
  },
  {
    id: 'goal',
    title: 'Meta do mês',
    description: 'A meta transforma números soltos em direção clara para a gestão e para a equipe.',
    icon: TrendingUp,
    fields: ['revenueGoal', 'revenueMin', 'expenseLimit'] as const,
  },
] as const

export function SetupWizard({
  currentMonthLabel,
  initialData,
  initialStats,
  checklist,
}: SetupWizardProps) {
  const router = useRouter()
  const [stepIndex, setStepIndex] = useState(0)

  const {
    control,
    register,
    handleSubmit,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: initialData,
  })

  const professionalsFieldArray = useFieldArray({
    control,
    name: 'professionals',
  })

  const servicesFieldArray = useFieldArray({
    control,
    name: 'services',
  })

  async function goNext() {
    const valid = await trigger([...steps[stepIndex].fields])
    if (!valid) return
    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  function goBack() {
    setStepIndex((current) => Math.max(current - 1, 0))
  }

  async function onSubmit(data: FormData) {
    const result = await completeOnboarding(data)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    toast.success(`Barbearia configurada. Agora o ${PRODUCT_NAME} já pode montar a leitura inicial da operação.`)
    router.push('/dashboard')
    router.refresh()
  }

  const currentStep = steps[stepIndex]
  const professionalArrayError = !Array.isArray(errors.professionals)
    ? errors.professionals?.message
    : undefined
  const servicesArrayError = !Array.isArray(errors.services)
    ? errors.services?.message
    : undefined

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="dashboard-panel overflow-hidden">
        <div className="border-b border-white/10 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">
            Setup guiado
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            Coloque a barbearia no ar em minutos
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Complete os pontos essenciais para começar a operar com agenda, equipe e leitura inicial do negócio.
          </p>
        </div>

        <div className="space-y-6 p-6">
          <div className="rounded-2xl border border-border/70 bg-[rgba(30,41,59,0.72)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Progresso inicial</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {initialStats.completedSteps} de 4 fundamentos já configurados
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {Math.round((initialStats.completedSteps / 4) * 100)}%
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-background/70">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${(initialStats.completedSteps / 4) * 100}%` }}
              />
            </div>
          </div>

          <div className="space-y-3">
            {checklist.map((item, index) => (
              <div
                key={item.id}
                className={cn(
                  'rounded-2xl border p-4 transition-colors',
                  item.done ? 'border-primary/25 bg-primary/10' : 'border-border/70 bg-secondary/30',
                  index === stepIndex && 'border-primary/40'
                )}
              >
                <div className="flex items-start gap-3">
                  <span className={cn(
                    'mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl',
                    item.done ? 'bg-primary/15 text-primary' : 'bg-background/70 text-muted-foreground'
                  )}>
                    {item.done ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-border/70 bg-[rgba(30,41,59,0.72)] p-4">
            <p className="text-sm font-semibold text-foreground">O que você destrava ao finalizar</p>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p className="inline-flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
                Dashboard pronta para mostrar faturamento, lucro e meta desde o primeiro login.
              </p>
              <p className="inline-flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                Estrutura da barbearia organizada para agenda, equipe e indicadores desde o início.
              </p>
              <p className="inline-flex items-start gap-2">
                <CalendarDays className="mt-0.5 h-4 w-4 text-primary" />
                Meta de {currentMonthLabel} pronta para contextualizar o mês desde o início.
              </p>
            </div>
          </div>
        </div>
      </aside>

      <section className="dashboard-panel p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Etapa {stepIndex + 1} de {steps.length}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <currentStep.icon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  {currentStep.title}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {currentStep.description}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                onClick={() => setStepIndex(index)}
                className={cn(
                  'h-2.5 w-12 rounded-full transition-colors',
                  index === stepIndex
                    ? 'bg-primary'
                    : index < stepIndex
                      ? 'bg-primary/60'
                      : 'bg-secondary'
                )}
                aria-label={`Ir para etapa ${index + 1}`}
              />
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-8">
          {stepIndex === 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-foreground">Nome da barbearia</label>
                <input
                  {...register('name')}
                  placeholder="Ex: Barbearia Konoha"
                  className="w-full rounded-xl border border-border bg-secondary px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Telefone</label>
                <input
                  {...register('phone')}
                  placeholder="(11) 99999-9999"
                  className="w-full rounded-xl border border-border bg-secondary px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
                <input
                  {...register('email')}
                  type="email"
                  placeholder="contato@sua-barbearia.com.br"
                  className="w-full rounded-xl border border-border bg-secondary px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
              </div>

              <div className="md:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-foreground">Endereço</label>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    {...register('address')}
                    placeholder="Rua, número, bairro e cidade"
                    className="w-full rounded-xl border border-border bg-secondary py-3 pl-10 pr-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-foreground">Timezone da operação</label>
                <select
                  {...register('timezone')}
                  className="w-full rounded-xl border border-border bg-secondary px-3.5 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Selecione o timezone</option>
                  <option value="America/Sao_Paulo">Brasília (GMT-3)</option>
                  <option value="America/Fortaleza">Fortaleza (GMT-3)</option>
                  <option value="America/Recife">Recife (GMT-3)</option>
                  <option value="America/Bahia">Salvador (GMT-3)</option>
                  <option value="America/Manaus">Manaus (GMT-4)</option>
                  <option value="America/Campo_Grande">Campo Grande (GMT-4)</option>
                  <option value="America/Cuiaba">Cuiabá (GMT-4)</option>
                  <option value="America/Porto_Velho">Porto Velho (GMT-4)</option>
                  <option value="America/Rio_Branco">Rio Branco (GMT-5)</option>
                </select>
                {errors.timezone && <p className="mt-1 text-xs text-destructive">{errors.timezone.message}</p>}
              </div>
            </div>
          )}

          {stepIndex === 1 && (
            <div>
              <div className="rounded-2xl border border-border/70 bg-[rgba(30,41,59,0.72)] p-4">
                <p className="text-sm font-semibold text-foreground">Quem vai aparecer no ranking e nas metas</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Cadastre a equipe principal agora. Você pode complementar depois, mas com pelo menos 1 nome o sistema já libera ranking, metas e desempenho.
                </p>
              </div>

              <div className="mt-5 space-y-3">
                {professionalsFieldArray.fields.map((field, index) => (
                  <div key={field.id} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <label className="mb-1.5 block text-sm font-medium text-foreground">
                          Profissional {index + 1}
                        </label>
                        <input
                          {...register(`professionals.${index}.name`)}
                          placeholder={index === 0 ? 'Ex: João' : 'Ex: Maria'}
                          className="w-full rounded-xl border border-border bg-background/70 px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        {errors.professionals?.[index]?.name && (
                          <p className="mt-1 text-xs text-destructive">
                            {errors.professionals[index]?.name?.message}
                          </p>
                        )}
                      </div>

                      {professionalsFieldArray.fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => professionalsFieldArray.remove(index)}
                          className="mt-7 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-background/60 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {typeof professionalArrayError === 'string' && (
                <p className="mt-2 text-xs text-destructive">{professionalArrayError}</p>
              )}

              <button
                type="button"
                onClick={() => professionalsFieldArray.append({ name: '' })}
                disabled={professionalsFieldArray.fields.length >= 6}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                Adicionar profissional
              </button>
            </div>
          )}

          {stepIndex === 2 && (
            <div>
              <div className="rounded-2xl border border-border/70 bg-[rgba(30,41,59,0.72)] p-4">
                <p className="text-sm font-semibold text-foreground">Serviços que sustentam o seu ticket médio</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Comece com os principais. Depois a precificação ajuda a transformar isso em margem e leitura de resultado.
                </p>
              </div>

              <div className="mt-5 space-y-3">
                {servicesFieldArray.fields.map((field, index) => (
                  <div key={field.id} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_140px_140px_auto]">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">Nome do serviço</label>
                        <input
                          {...register(`services.${index}.name`)}
                          placeholder="Ex: Corte + Barba"
                          className="w-full rounded-xl border border-border bg-background/70 px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        {errors.services?.[index]?.name && (
                          <p className="mt-1 text-xs text-destructive">
                            {errors.services[index]?.name?.message}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">Preço</label>
                        <input
                          {...register(`services.${index}.price`)}
                          type="number"
                          min="1"
                          step="0.01"
                          placeholder="45"
                          className="w-full rounded-xl border border-border bg-background/70 px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        {errors.services?.[index]?.price && (
                          <p className="mt-1 text-xs text-destructive">
                            {errors.services[index]?.price?.message}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">Duração</label>
                        <input
                          {...register(`services.${index}.duration`)}
                          type="number"
                          min="5"
                          step="5"
                          placeholder="30"
                          className="w-full rounded-xl border border-border bg-background/70 px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        {errors.services?.[index]?.duration && (
                          <p className="mt-1 text-xs text-destructive">
                            {errors.services[index]?.duration?.message}
                          </p>
                        )}
                      </div>

                      <div className="flex items-end">
                        {servicesFieldArray.fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => servicesFieldArray.remove(index)}
                            className="rounded-lg p-3 text-muted-foreground transition-colors hover:bg-background/60 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {typeof servicesArrayError === 'string' && (
                <p className="mt-2 text-xs text-destructive">{servicesArrayError}</p>
              )}

              <button
                type="button"
                onClick={() => servicesFieldArray.append({ name: '', price: '', duration: '' })}
                disabled={servicesFieldArray.fields.length >= 8}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                Adicionar serviço
              </button>
            </div>
          )}

          {stepIndex === 3 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2 rounded-2xl border border-border/70 bg-[rgba(30,41,59,0.72)] p-4">
                <p className="text-sm font-semibold text-foreground">Feche o setup já com direção comercial</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Em vez de só registrar movimento, o {PRODUCT_NAME} vai mostrar se {currentMonthLabel.toLowerCase()} está no caminho esperado.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Meta de faturamento</label>
                <input
                  {...register('revenueGoal')}
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="30000"
                  className="w-full rounded-xl border border-border bg-secondary px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {errors.revenueGoal && <p className="mt-1 text-xs text-destructive">{errors.revenueGoal.message}</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Meta mínima</label>
                <input
                  {...register('revenueMin')}
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="24000"
                  className="w-full rounded-xl border border-border bg-secondary px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {errors.revenueMin && <p className="mt-1 text-xs text-destructive">{errors.revenueMin.message}</p>}
              </div>

              <div className="md:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-foreground">Limite de despesas do mês</label>
                <input
                  {...register('expenseLimit')}
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="12000"
                  className="w-full rounded-xl border border-border bg-secondary px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {errors.expenseLimit && <p className="mt-1 text-xs text-destructive">{errors.expenseLimit.message}</p>}
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3 border-t border-border/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {stepIndex < steps.length - 1
                ? 'Avance etapa por etapa. O objetivo é colocar a barbearia em operação sem transformar o setup em um formulário gigante.'
                : 'Finalizando aqui, o sistema já entra pronto para a primeira leitura no painel executivo.'}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={goBack}
                disabled={stepIndex === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </button>

              {stepIndex < steps.length - 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Continuar
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Finalizar setup
                </button>
              )}
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
