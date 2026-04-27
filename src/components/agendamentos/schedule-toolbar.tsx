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
import { ScheduleBlockModal } from '@/components/agendamentos/schedule-block-modal'
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
  }, [date])

  const goToDate = (direction: 'previous' | 'next' | 'today') => {
    const current = new Date(`${date}T09:00:00`)
    const target = direction === 'today' ? new Date() : addDays(current, direction === 'next' ? 1 : -1)

    const href = buildUrl({
      date: format(target, 'yyyy-MM-dd'),
      view,
      professionalId: selectedProfessionalId,
    })

    startNavigation(href)
    router.push(href)
  }

  return (
    <div className="flex w-full flex-col gap-3 xl:min-w-[720px]">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end">
        <div className="toolbar-surface flex min-w-0 items-center gap-1 p-1">
          <button
            type="button"
            onClick={() => goToDate('previous')}
            className="rounded-[0.8rem] p-2 text-muted-foreground transition-colors hover:bg-[rgba(255,255,255,0.045)] hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => goToDate('today')}
            className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[0.85rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-foreground"
          >
            <CalendarDays className="h-3.5 w-3.5 text-primary" />
            <span className="truncate text-center text-sm font-semibold">{label}</span>
          </button>

          <button
            type="button"
            onClick={() => goToDate('next')}
            className="rounded-[0.8rem] p-2 text-muted-foreground transition-colors hover:bg-[rgba(255,255,255,0.045)] hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
          {professionalLocked ? (
            <div className="inline-flex min-w-0 items-center gap-2 rounded-[0.95rem] border border-[rgba(124,92,255,0.16)] bg-[rgba(124,92,255,0.08)] px-3 py-2 text-sm font-medium text-primary">
              <BadgeCheck className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{professionalLockedLabel ?? 'Minha agenda'}</span>
            </div>
          ) : (
            <div className="toolbar-surface flex min-w-0 items-center gap-2 px-3 py-2.5">
              <ListFilter className="h-4 w-4 text-muted-foreground" />
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
                className="min-w-0 bg-transparent text-sm font-semibold text-foreground outline-none"
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

          <div className="flex flex-wrap items-center gap-2">
            <ScheduleBlockModal
              defaultDate={date}
              defaultStartTime="09:00"
              defaultEndTime="09:30"
              defaultProfessionalId={selectedProfessionalId}
              professionals={professionals}
            />

            <AppointmentModal
              defaultDate={date}
              defaultTime="09:00"
              defaultProfessionalId={selectedProfessionalId}
              professionals={professionals}
              services={services}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        {[
          { value: 'barber' as const, label: 'Grade por barbeiro', icon: PanelsTopLeft },
          { value: 'day' as const, label: 'Linha do dia', icon: LayoutGrid },
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
              'inline-flex items-center gap-2 rounded-[0.9rem] border px-3 py-1.5 text-sm font-semibold transition-colors',
              view === item.value
                ? 'border-[rgba(124,92,255,0.16)] bg-[rgba(124,92,255,0.08)] text-violet-100'
                : 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.025)] text-muted-foreground hover:bg-[rgba(255,255,255,0.045)] hover:text-foreground'
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
