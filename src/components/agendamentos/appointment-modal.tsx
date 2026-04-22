'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  CalendarClock,
  Clock3,
  Loader2,
  Pencil,
  Phone,
  Plus,
  Scissors,
  Search,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createAppointment,
  searchCustomersForAppointment,
  updateAppointment,
} from '@/actions/agendamentos'
import type {
  ScheduleToolbarCustomer,
  ScheduleToolbarProfessional,
  ScheduleToolbarService,
} from '@/lib/agendamentos'
import {
  canProfessionalHandleCustomerType,
  PROFESSIONAL_ATTENDANCE_SCOPE_LABELS,
  resolveProfessionalAttendanceScope,
  resolveProfessionalServicePrice,
} from '@/lib/professionals/operational-config'
import {
  APPOINTMENT_BILLING_MODEL_LABELS,
  APPOINTMENT_STATUS_LABELS,
  CUSTOMER_TYPE_LABELS,
  cn,
  formatCurrency,
} from '@/lib/utils'

const schema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().min(2, 'Nome do cliente obrigatorio'),
  customerPhone: z.string().optional(),
  customerEmail: z.union([z.string().email('Email invalido'), z.literal('')]).optional(),
  customerType: z.enum(['SUBSCRIPTION', 'WALK_IN']),
  subscriptionPrice: z.string().optional(),
  professionalId: z.string().min(1, 'Selecione o barbeiro'),
  serviceId: z.string().min(1, 'Selecione o servico'),
  date: z.string().min(1, 'Data obrigatoria'),
  time: z.string().min(1, 'Horario obrigatorio'),
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']),
  source: z.enum(['MANUAL', 'WHATSAPP']),
  billingModel: z.enum(['AVULSO', 'SUBSCRIPTION_INCLUDED', 'SUBSCRIPTION_EXTRA']),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export interface AppointmentFormValue {
  id: string
  customerId: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  customerType: 'SUBSCRIPTION' | 'WALK_IN'
  subscriptionPrice: number | null
  professionalId: string
  serviceId: string
  date: string
  time: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'
  source: 'MANUAL' | 'WHATSAPP'
  billingModel: 'AVULSO' | 'SUBSCRIPTION_INCLUDED' | 'SUBSCRIPTION_EXTRA'
  priceSnapshot?: number | null
  notes: string | null
}

interface CustomerSearchResult {
  id: string
  name: string
  phone: string | null
  email: string | null
  type: 'SUBSCRIPTION' | 'WALK_IN'
  subscriptionPrice: number | null
}

interface AppointmentModalProps {
  professionals: ScheduleToolbarProfessional[]
  services: ScheduleToolbarService[]
  recentCustomers: ScheduleToolbarCustomer[]
  defaultDate: string
  defaultTime?: string
  defaultProfessionalId?: string | null
  appointment?: AppointmentFormValue
  triggerMode?: 'primary' | 'secondary' | 'icon'
  open?: boolean
  onOpenChange?: (value: boolean) => void
  hideTrigger?: boolean
}

const fieldClassName =
  'w-full min-w-0 rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(15,17,21,0.86)] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-[rgba(124,58,237,0.28)] focus:bg-[rgba(124,58,237,0.08)] focus:ring-4 focus:ring-[rgba(124,58,237,0.14)]'

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {error && <p className="mt-1.5 text-xs text-rose-600">{error}</p>}
    </label>
  )
}

export function AppointmentModal({
  professionals,
  services,
  recentCustomers,
  defaultDate,
  defaultTime = '09:00',
  defaultProfessionalId = null,
  appointment,
  triggerMode = 'primary',
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: AppointmentModalProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const router = useRouter()
  const isEdit = Boolean(appointment)
  const [customerSearchQuery, setCustomerSearchQuery] = useState('')
  const [customerSearchResults, setCustomerSearchResults] = useState<CustomerSearchResult[]>([])
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false)

  const defaultValues = useMemo<FormData>(() => ({
    customerId: appointment?.customerId ?? '',
    customerName: appointment?.customerName ?? '',
    customerPhone: appointment?.customerPhone ?? '',
    customerEmail: appointment?.customerEmail ?? '',
    customerType: appointment?.customerType ?? 'WALK_IN',
    subscriptionPrice: appointment?.subscriptionPrice ? String(appointment.subscriptionPrice) : '',
    professionalId: appointment?.professionalId ?? defaultProfessionalId ?? '',
    serviceId: appointment?.serviceId ?? '',
    date: appointment?.date ?? defaultDate,
    time: appointment?.time ?? defaultTime,
    status: appointment?.status ?? 'CONFIRMED',
    source: appointment?.source ?? 'MANUAL',
    billingModel: appointment?.billingModel ?? 'AVULSO',
    notes: appointment?.notes ?? '',
  }), [appointment, defaultDate, defaultProfessionalId, defaultTime])

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  useEffect(() => {
    if (open) {
      reset(defaultValues)
      setCustomerSearchQuery('')
      setCustomerSearchResults([])
    }
  }, [defaultValues, open, reset])

  const selectedServiceId = watch('serviceId')
  const selectedProfessionalId = watch('professionalId')
  const selectedStatus = watch('status')
  const selectedDate = watch('date')
  const selectedTime = watch('time')
  const selectedCustomerName = watch('customerName')
  const selectedCustomerType = watch('customerType')
  const selectedBillingModel = watch('billingModel')
  const selectedSubscriptionPrice = watch('subscriptionPrice')

  useEffect(() => {
    if (selectedCustomerType === 'WALK_IN') {
      if (selectedBillingModel !== 'AVULSO') {
        setValue('billingModel', 'AVULSO')
      }

      if (selectedSubscriptionPrice) {
        setValue('subscriptionPrice', '')
      }

      return
    }

    if (!selectedSubscriptionPrice) {
      setValue('subscriptionPrice', '199.90')
    }

    if (selectedBillingModel === 'AVULSO') {
      setValue('billingModel', 'SUBSCRIPTION_INCLUDED')
    }
  }, [selectedBillingModel, selectedCustomerType, selectedSubscriptionPrice, setValue])

  useEffect(() => {
    if (!open) {
      return
    }

    const query = customerSearchQuery.trim()

    if (query.length < 2) {
      setCustomerSearchResults([])
      setIsSearchingCustomers(false)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setIsSearchingCustomers(true)

      try {
        const results = await searchCustomersForAppointment(query)
        if (!cancelled) {
          setCustomerSearchResults(results)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('customer search failed', error)
          setCustomerSearchResults([])
        }
      } finally {
        if (!cancelled) {
          setIsSearchingCustomers(false)
        }
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [customerSearchQuery, open])

  const selectedService = services.find((service) => service.id === selectedServiceId)
  const selectedProfessional = professionals.find((professional) => professional.id === selectedProfessionalId)
  const selectedProfessionalScope = selectedProfessional
    ? PROFESSIONAL_ATTENDANCE_SCOPE_LABELS[
        resolveProfessionalAttendanceScope({
          acceptsSubscription: selectedProfessional.acceptsSubscription,
          acceptsWalkIn: selectedProfessional.acceptsWalkIn,
        })
      ]
    : null
  const professionalCanHandleCustomerType = selectedProfessional
    ? canProfessionalHandleCustomerType({
        customerType: selectedCustomerType,
        professional: selectedProfessional,
      })
    : true
  const resolvedServicePrice = selectedService
    ? resolveProfessionalServicePrice({
        serviceName: selectedService.name,
        basePrice: selectedService.price,
        professional: selectedProfessional,
      })
    : null
  const serviceDisplayPrice = resolvedServicePrice?.price ?? selectedService?.price ?? null
  const usesProfessionalPriceOverride = Boolean(
    selectedService
    && resolvedServicePrice
    && resolvedServicePrice.price !== selectedService.price
  )

  function applyCustomerSelection(customer: CustomerSearchResult | ScheduleToolbarCustomer) {
    setValue('customerId', customer.id)
    setValue('customerName', customer.name)
    setValue('customerPhone', customer.phone ?? '')
    setValue('customerEmail', customer.email ?? '')
    setValue('customerType', customer.type)
    setValue('subscriptionPrice', customer.subscriptionPrice ? String(customer.subscriptionPrice) : '')
    setValue(
      'billingModel',
      customer.type === 'SUBSCRIPTION' ? 'SUBSCRIPTION_INCLUDED' : 'AVULSO'
    )
    setCustomerSearchQuery('')
    setCustomerSearchResults([])
  }

  const customerNameField = register('customerName', {
    onChange: () => setValue('customerId', ''),
  })
  const customerPhoneField = register('customerPhone', {
    onChange: () => setValue('customerId', ''),
  })
  const customerEmailField = register('customerEmail', {
    onChange: () => setValue('customerId', ''),
  })

  async function onSubmit(values: FormData) {
    const payload = {
      ...values,
      customerId: values.customerId || undefined,
      customerPhone: values.customerPhone || undefined,
      customerEmail: values.customerEmail || undefined,
      subscriptionPrice: values.subscriptionPrice || undefined,
      notes: values.notes || undefined,
    }

    const result = appointment
      ? await updateAppointment(appointment.id, payload)
      : await createAppointment(payload)

    if (result.success) {
      toast.success(isEdit ? 'Agendamento atualizado.' : 'Agendamento criado.')
      setOpen(false)
      reset(defaultValues)
      router.refresh()
      return
    }

    toast.error(result.error ?? 'Nao foi possivel salvar o agendamento.')
  }

  const triggerClass = {
    primary: 'action-button-primary',
    secondary: 'action-button',
    icon: 'inline-flex h-9 w-9 items-center justify-center rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-primary',
  }[triggerMode]

  return (
    <>
      {!hideTrigger && (
        <button type="button" onClick={() => setOpen(true)} className={triggerClass}>
          {triggerMode === 'icon' ? <Pencil className="h-4 w-4" /> : (
            <>
              {isEdit ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {isEdit ? 'Editar' : 'Novo agendamento'}
            </>
          )}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 pt-4 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-[rgba(17,24,39,0.36)] backdrop-blur-sm" onClick={() => setOpen(false)} />

          <div className="relative z-10 grid h-[min(920px,calc(100vh-1rem))] w-full max-w-5xl min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[1.5rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.99),rgba(15,17,21,0.98))] shadow-[0_42px_120px_-60px_rgba(2,6,23,0.88)]">
            <div className="flex items-start justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  {isEdit ? 'Editar horario' : 'Novo horario'}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Preencha cliente, barbeiro, servico e horario com o minimo de atrito para a recepcao.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-[0.9rem] text-muted-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)] hover:text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid min-h-0 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,340px)]">
              <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 min-w-0 flex-col overflow-hidden px-5 py-5 sm:px-6">
                <input type="hidden" {...register('customerId')} />
                <input type="hidden" {...register('source')} />

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
                  <section className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Buscar cliente existente</p>
                    </div>

                    <div className="rounded-[1rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-3">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={customerSearchQuery}
                          onChange={(event) => setCustomerSearchQuery(event.target.value)}
                          placeholder="Busque por nome ou telefone"
                          className={cn(fieldClassName, 'pl-10')}
                        />
                      </div>

                      <div className="mt-3 space-y-2">
                        {isSearchingCustomers && (
                          <div className="flex items-center gap-2 rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Procurando cliente...
                          </div>
                        )}

                        {!isSearchingCustomers && customerSearchQuery.trim().length >= 2 && customerSearchResults.length === 0 && (
                          <div className="rounded-[0.9rem] border border-dashed border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs text-muted-foreground">
                            Nenhum cliente encontrado. Voce pode seguir com cadastro manual abaixo.
                          </div>
                        )}

                        {customerSearchResults.map((customer) => (
                          <button
                            key={customer.id}
                            type="button"
                            onClick={() => applyCustomerSelection(customer)}
                            className="flex w-full items-center justify-between gap-3 rounded-[0.9rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-left transition-colors hover:bg-[rgba(124,58,237,0.12)]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">{customer.name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {customer.phone ?? customer.email ?? 'Sem contato cadastrado'}
                              </p>
                            </div>
                            <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(124,58,237,0.08)] px-2 py-1 text-[10px] font-semibold text-primary">
                              {CUSTOMER_TYPE_LABELS[customer.type]}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Clientes recentes</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {recentCustomers.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => applyCustomerSelection(customer)}
                          className="inline-flex max-w-full items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-[rgba(124,58,237,0.12)]"
                        >
                          <UserRound className="h-3 w-3 flex-shrink-0 text-primary" />
                          <span className="truncate">{customer.name}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
                    <div className="lg:col-span-2 xl:col-span-6">
                      <Field label="Cliente *" error={errors.customerName?.message}>
                        <input {...customerNameField} placeholder="Ex: Carlos Mendes" className={fieldClassName} />
                      </Field>
                    </div>

                    <div className="xl:col-span-3">
                      <Field label="Telefone">
                        <input {...customerPhoneField} placeholder="(11) 99999-0000" className={fieldClassName} />
                      </Field>
                    </div>

                    <div className="xl:col-span-3">
                      <Field label="Email" error={errors.customerEmail?.message}>
                        <input {...customerEmailField} type="email" placeholder="cliente@email.com" className={fieldClassName} />
                      </Field>
                    </div>
                  </section>

                  <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12">
                    <div className="xl:col-span-4">
                      <Field label="Tipo do cliente">
                        <select {...register('customerType')} className={fieldClassName}>
                          <option value="WALK_IN">Cliente avulso</option>
                          <option value="SUBSCRIPTION">Cliente assinatura</option>
                        </select>
                      </Field>
                    </div>

                    <div className="xl:col-span-4">
                      <Field label="Cobranca do atendimento">
                        <select {...register('billingModel')} className={fieldClassName}>
                          <option value="AVULSO">Cobrar avulso</option>
                          <option value="SUBSCRIPTION_INCLUDED">Incluso na assinatura</option>
                          <option value="SUBSCRIPTION_EXTRA">Cobrar a parte</option>
                        </select>
                      </Field>
                    </div>

                    <div className="xl:col-span-4">
                      <Field label="Mensalidade" error={errors.subscriptionPrice?.message}>
                        <input
                          {...register('subscriptionPrice')}
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={selectedCustomerType === 'SUBSCRIPTION' ? '199.90' : 'Somente assinatura'}
                          disabled={selectedCustomerType !== 'SUBSCRIPTION'}
                          className={cn(
                            fieldClassName,
                            selectedCustomerType !== 'SUBSCRIPTION' ? 'cursor-not-allowed opacity-60' : ''
                          )}
                        />
                      </Field>
                    </div>
                  </section>

                  <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12">
                    <div className="xl:col-span-3">
                      <Field label="Data *">
                        <input {...register('date')} type="date" className={fieldClassName} />
                      </Field>
                    </div>

                    <div className="xl:col-span-3">
                      <Field label="Horario *">
                        <input {...register('time')} type="time" step="900" className={fieldClassName} />
                      </Field>
                    </div>

                    <div className="xl:col-span-3">
                      <Field label="Barbeiro *" error={errors.professionalId?.message}>
                        <select {...register('professionalId')} className={fieldClassName}>
                          <option value="">Selecione</option>
                          {professionals.map((professional) => (
                            <option key={professional.id} value={professional.id}>
                              {professional.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {selectedProfessionalScope && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Escopo: {selectedProfessionalScope}
                        </p>
                      )}
                      {!professionalCanHandleCustomerType && selectedProfessional && (
                        <p className="mt-1.5 text-xs text-amber-500">
                          Esse barbeiro nao atende {selectedCustomerType === 'SUBSCRIPTION' ? 'assinatura' : 'avulso'}.
                        </p>
                      )}
                    </div>

                    <div className="xl:col-span-3">
                      <Field label="Servico *" error={errors.serviceId?.message}>
                        <select {...register('serviceId')} className={fieldClassName}>
                          <option value="">Selecione</option>
                          {services.map((service) => (
                            <option key={service.id} value={service.id}>
                              {service.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {selectedService && serviceDisplayPrice !== null && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Valor operacional: {formatCurrency(serviceDisplayPrice)}
                          {usesProfessionalPriceOverride ? ' com ajuste do barbeiro.' : ' pelo catalogo base.'}
                        </p>
                      )}
                    </div>
                  </section>

                  <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
                    <div>
                      <Field label="Observacoes">
                        <textarea
                          {...register('notes')}
                          rows={4}
                          placeholder="Recado rapido para a equipe..."
                          className={cn(fieldClassName, 'resize-none')}
                        />
                      </Field>
                    </div>

                    <div>
                      <Field label="Status" error={errors.status?.message}>
                        <select {...register('status')} className={fieldClassName}>
                          <option value="CONFIRMED">Confirmado</option>
                          <option value="PENDING">Pendente</option>
                          <option value="COMPLETED">Concluido</option>
                          <option value="CANCELLED">Cancelado</option>
                          <option value="NO_SHOW">Nao compareceu</option>
                        </select>
                      </Field>
                    </div>
                  </section>
                </div>

                <div className="mt-5 flex flex-col gap-3 border-t border-[rgba(255,255,255,0.06)] pt-5 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="action-button h-11 flex-1"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !professionalCanHandleCustomerType}
                    className="action-button-primary h-11 flex-1 disabled:opacity-50"
                  >
                    {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isSubmitting ? 'Salvando...' : isEdit ? 'Salvar ajustes' : 'Salvar agendamento'}
                  </button>
                </div>
              </form>

              <aside className="min-h-0 min-w-0 overflow-y-auto border-t border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-5 py-5 xl:border-l xl:border-t-0 xl:px-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Resumo do horario</p>
                    <h3 className="mt-2 text-lg font-semibold text-foreground">{selectedCustomerName || 'Novo atendimento'}</h3>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                    <div className="panel-soft p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <CalendarClock className="h-4 w-4 text-primary" />
                        Agenda
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{selectedDate || 'Selecione a data'}</p>
                      <p className="mt-1 text-base font-semibold text-foreground">{selectedTime || '--:--'}</p>
                    </div>

                    <div className="panel-soft p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Scissors className="h-4 w-4 text-primary" />
                        Servico
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{selectedService?.name ?? 'Selecione um servico'}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{selectedService && serviceDisplayPrice !== null ? formatCurrency(serviceDisplayPrice) : 'Sem valor'}</span>
                        <span>{selectedService ? `${selectedService.duration} min` : 'Sem duracao'}</span>
                      </div>
                      {usesProfessionalPriceOverride && (
                        <p className="mt-2 text-xs text-primary">Preco individual aplicado para esse barbeiro.</p>
                      )}
                    </div>

                    <div className="panel-soft p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <UserRound className="h-4 w-4 text-primary" />
                        Atendimento
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{selectedProfessional?.name ?? 'Selecione o barbeiro'}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Status: {APPOINTMENT_STATUS_LABELS[selectedStatus]}</p>
                      {selectedProfessionalScope && (
                        <p className="mt-2 text-xs text-muted-foreground">{selectedProfessionalScope}</p>
                      )}
                      {!professionalCanHandleCustomerType && (
                        <p className="mt-2 text-xs text-amber-500">
                          Ajuste o barbeiro para continuar com {selectedCustomerType === 'SUBSCRIPTION' ? 'assinatura' : 'atendimento avulso'}.
                        </p>
                      )}
                    </div>

                    <div className="panel-soft p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Phone className="h-4 w-4 text-primary" />
                        Cliente
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{watch('customerPhone') || 'Sem telefone informado'}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{watch('customerEmail') || 'Sem email informado'}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                        <span className="inline-flex items-center rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-foreground">
                          {CUSTOMER_TYPE_LABELS[selectedCustomerType]}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-muted-foreground">
                          {APPOINTMENT_BILLING_MODEL_LABELS[selectedBillingModel]}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-[1rem] border border-[rgba(124,58,237,0.12)] bg-[linear-gradient(135deg,rgba(124,58,237,0.08),rgba(124,58,237,0.03))] p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                        <Clock3 className="h-4 w-4" />
                        Valor e duracao
                      </div>
                      <p className="mt-3 text-xl font-semibold text-foreground">
                        {selectedService && serviceDisplayPrice !== null ? formatCurrency(serviceDisplayPrice) : 'Selecione um servico'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedService ? `${selectedService.duration} minutos reservados na agenda.` : 'A duracao vem direto do catalogo.'}
                      </p>
                      {usesProfessionalPriceOverride && (
                        <p className="mt-3 text-xs text-primary">
                          O valor acima veio da configuracao individual do barbeiro.
                        </p>
                      )}
                      {selectedCustomerType === 'SUBSCRIPTION' && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Mensalidade atual: {selectedSubscriptionPrice ? formatCurrency(selectedSubscriptionPrice) : 'Defina a mensalidade do plano.'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
