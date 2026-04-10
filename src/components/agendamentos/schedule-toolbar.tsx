'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { addDays, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  ListFilter,
  PanelsTopLeft,
} from 'lucide-react'
import { AppointmentModal } from '@/components/agendamentos/appointment-modal'
import { useNavigationFeedback } from '@/components/layout/navigation-feedback'
import type {
  ScheduleToolbarCustomer,
  ScheduleToolbarProfessional,
  ScheduleToolbarService,
  ScheduleView,
} from '@/lib/agendamentos'
import { capitalize, cn } from '@/lib/utils'

interface ScheduleToolbarProps {
  date: string
  view: ScheduleView
  selectedProfessionalId: string | null
  professionals: ScheduleToolbarProfessional[]
  services: ScheduleToolbarService[]
  recentCustomers: ScheduleToolbarCustomer[]
  professionalLocked?: boolean
  professionalLockedLabel?: string | null
}

function buildUrl(input: {
  date: string
  view: ScheduleView
  professionalId?: string | null
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('date', input.date)
  searchParams.set('view', input.view)

  if (input.professionalId) {
    searchParams.set('professionalId', input.professionalId)
  }

  return `/agendamentos?${searchParams.toString()}`
}

export function ScheduleToolbar({
  date,
  view,
  selectedProfessionalId,
  professionals,
  services,
  recentCustomers,
  professionalLocked = false,
  professionalLockedLabel = null,
}: ScheduleToolbarProps) {
  const router = useRouter()
  const { startNavigation } = useNavigationFeedback()

  const label = useMemo(() => {
    const current = new Date(`${date}T09:00:00`)
    return capitalize(format(current, "EEEE, dd 'de' MMMM", { locale: ptBR }))
  }, [date, view])

  const goToDate = (direction: 'previous' | 'next' | 'today') => {
    const current = new Date(`${date}T09:00:00`)
    const target = direction === 'today'
      ? new Date()
      : addDays(current, direction === 'next' ? 1 : -1)

    const href = buildUrl({
      date: format(target, 'yyyy-MM-dd'),
      view,
      professionalId: selectedProfessionalId,
    })

    startNavigation(href)
    router.push(href)
  }

  return (
    <div className="flex w-full flex-col gap-3 xl:min-w-[540px] xl:items-end">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
        <div className="flex min-w-0 items-center gap-1 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(30,41,59,0.78),rgba(15,23,42,0.7))] p-1 shadow-[0_18px_34px_-24px_rgba(2,6,23,0.72)]">
          <button
            type="button"
            onClick={() => goToDate('previous')}
            className="rounded-[0.75rem] p-2 text-slate-400 transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => goToDate('today')}
            className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[0.8rem] border border-[rgba(52,211,153,0.14)] bg-[linear-gradient(135deg,rgba(17,24,39,0.96),rgba(15,23,42,0.9))] px-3 py-2 text-slate-100 shadow-[0_16px_30px_-20px_rgba(2,6,23,0.72)]"
          >
            <CalendarDays className="h-3.5 w-3.5 text-slate-300" />
            <span className="truncate text-center text-sm font-medium text-slate-50">{label}</span>
          </button>

          <button
            type="button"
            onClick={() => goToDate('next')}
            className="rounded-[0.75rem] p-2 text-slate-400 transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {professionalLocked ? (
          <div className="inline-flex min-w-0 items-center gap-2 rounded-[0.95rem] border border-[rgba(52,211,153,0.16)] bg-[rgba(16,185,129,0.08)] px-3 py-2 text-sm text-emerald-100">
            <BadgeCheck className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{professionalLockedLabel ?? 'Minha agenda'}</span>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2 rounded-[0.95rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2">
            <ListFilter className="h-4 w-4 text-slate-400" />
            <select
              value={selectedProfessionalId ?? ''}
              onChange={(event) => {
                const href = buildUrl({
                  date,
                  view,
                  professionalId: event.target.value || null,
                })

                startNavigation(href)
                router.push(href)
              }}
              className="min-w-0 bg-transparent text-sm text-slate-100 outline-none"
            >
              <option value="">Toda a equipe</option>
              {professionals.map((professional) => (
                <option key={professional.id} value={professional.id}>
                  {professional.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <AppointmentModal
          defaultDate={date}
          defaultProfessionalId={selectedProfessionalId}
          professionals={professionals}
          services={services}
          recentCustomers={recentCustomers}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        {[
          { value: 'day' as const, label: 'Dia', icon: LayoutGrid },
          { value: 'barber' as const, label: 'Barbeiros', icon: PanelsTopLeft },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              const href = buildUrl({ date, view: item.value, professionalId: selectedProfessionalId })
              startNavigation(href)
              router.push(href)
            }}
            className={cn(
              'inline-flex items-center gap-2 rounded-[0.8rem] border px-3 py-1.5 text-sm font-medium transition-colors',
              view === item.value
                ? 'border-[rgba(52,211,153,0.18)] bg-[rgba(16,185,129,0.14)] text-emerald-100'
                : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-slate-300 hover:bg-[rgba(255,255,255,0.06)]'
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
