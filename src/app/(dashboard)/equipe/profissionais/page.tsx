import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Crown } from 'lucide-react'
import { assertAdministrativeRole, requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolvePeriod } from '@/lib/period'
import { serializeForClient } from '@/lib/serialize-for-client'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { ProfessionalModal, type ProfessionalFormValue } from '@/components/equipe/professional-modal'
import { ToggleActiveButton } from '@/components/equipe/toggle-active-button'
import { ProfessionalAvatar } from '@/components/ui/professional-avatar'
import {
  PROFESSIONAL_ATTENDANCE_SCOPE_LABELS,
  resolveProfessionalAttendanceScope,
} from '@/lib/professionals/operational-config'
import { cn, formatCurrency } from '@/lib/utils'

export const metadata: Metadata = { title: 'Profissionais' }

interface Props { searchParams: { month?: string; year?: string } }

export default async function ProfissionaisPage({ searchParams }: Props) {
  const session = await requireSession()
  assertAdministrativeRole(session.user.role, 'Sem permissao para consultar os profissionais da equipe.')
  const { month, year } = resolvePeriod(searchParams)
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0, 23, 59, 59, 999)

  const [professionals, revenueByPro, goals] = await Promise.all([
    prisma.professional.findMany({
      where: { barbershopId: session.user.barbershopId },
      orderBy: { name: 'asc' },
    }),
    prisma.revenue.groupBy({
      by: ['professionalId'],
      where: { barbershopId: session.user.barbershopId, date: { gte: start, lte: end }, professionalId: { not: null } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.professionalGoal.findMany({
      where: { barbershopId: session.user.barbershopId, month, year },
    }),
  ])

  const enriched = professionals
    .map((professional) => {
      const revenueData = revenueByPro.find((item) => item.professionalId === professional.id)
      const goal = goals.find((item) => item.professionalId === professional.id)
      const revenue = Number(revenueData?._sum.amount ?? 0)
      const count = revenueData?._count ?? 0
      const goalValue = Number(goal?.revenueGoal ?? 0)
      const progress = goalValue > 0 ? Math.min(100, (revenue / goalValue) * 100) : 0
      const attendanceScope = resolveProfessionalAttendanceScope({
        acceptsSubscription: professional.acceptsSubscription,
        acceptsWalkIn: professional.acceptsWalkIn,
      })

      return {
        ...professional,
        attendanceScope,
        revenue,
        count,
        goalValue,
        progress,
        ticketMedio: count > 0 ? revenue / count : 0,
      }
    })
    .sort((left, right) => right.revenue - left.revenue)

  const leader = enriched[0]
  const configuredCommissionAverage = professionals.reduce(
    (sum, professional) => sum + Number(professional.commissionRate ?? 0),
    0
  ) / Math.max(professionals.length, 1)
  const walkInEnabledCount = professionals.filter((professional) => professional.acceptsWalkIn).length
  const subscriptionEnabledCount = professionals.filter((professional) => professional.acceptsSubscription).length

  const professionalFormMap = new Map(
    (serializeForClient(
      professionals.map((professional) => ({
        id: professional.id,
        name: professional.name,
        email: professional.email,
        phone: professional.phone,
        avatar: professional.avatar,
        commissionRate: professional.commissionRate,
        haircutPrice: professional.haircutPrice,
        beardPrice: professional.beardPrice,
        comboPrice: professional.comboPrice,
        attendanceScope: resolveProfessionalAttendanceScope({
          acceptsSubscription: professional.acceptsSubscription,
          acceptsWalkIn: professional.acceptsWalkIn,
        }),
      }))
    ) as unknown as ProfessionalFormValue[]).map((professional) => [professional.id, professional])
  )

  return (
    <div className="page-section mx-auto max-w-6xl">
      <PageHeader
        title="Profissionais"
        description="Veja quem puxa resultado, ticket, escopo de atendimento e configuração comercial do time."
        action={(
          <div className="flex items-center gap-3">
            <Suspense>
              <PeriodSelector month={month} year={year} pathname="/equipe/profissionais" />
            </Suspense>
            <ProfessionalModal />
          </div>
        )}
      />

      <SectionTabs
        currentPath="/equipe/profissionais"
        items={[
          {
            href: '/equipe',
            label: 'Visão geral',
            helper: 'Resumo do time, metas e atalhos de navegação.',
          },
          {
            href: '/equipe/profissionais',
            label: 'Profissionais',
            helper: 'Ranking, ticket e gestão individual da equipe.',
          },
          {
            href: '/equipe/metas',
            label: 'Metas',
            helper: 'Meta da barbearia e metas individuais do mês.',
          },
          {
            href: '/equipe/desempenho',
            label: 'Desempenho',
            helper: 'Leitura consolidada da operação do time.',
          },
        ]}
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-4">
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Resultado do time</p>
          <p className="text-2xl font-bold text-emerald-500 tabular-nums">
            {formatCurrency(enriched.reduce((accumulator, professional) => accumulator + professional.revenue, 0))}
          </p>
        </div>

        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Atendimentos</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {enriched.reduce((accumulator, professional) => accumulator + professional.count, 0)}
          </p>
        </div>

        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Líder do mês</p>
          <p className="text-lg font-bold text-foreground">{leader?.name ?? '—'}</p>
          <p className="text-sm text-emerald-500">{leader ? formatCurrency(leader.revenue) : ''}</p>
        </div>

        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Configuração comercial</p>
          <p className="text-lg font-bold text-foreground">{configuredCommissionAverage.toFixed(0)}% de comissão média</p>
          <p className="text-sm text-muted-foreground">
            {walkInEnabledCount} operam no avulso • {subscriptionEnabledCount} atendem assinatura
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {enriched.map((professional, index) => (
          <div key={professional.id} className={cn('kpi-card relative', !professional.active && 'opacity-50')}>
            <div className="absolute right-3 top-3 flex items-center gap-1">
              {index === 0 && professional.active && <Crown className="h-4 w-4 text-amber-400" />}
              <ProfessionalModal professional={professionalFormMap.get(professional.id)} />
              <ToggleActiveButton id={professional.id} active={professional.active} />
            </div>

            <div className="mb-4 flex items-center gap-3">
              <ProfessionalAvatar
                name={professional.name}
                imageUrl={professional.avatar}
                size="md"
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-semibold text-foreground">{professional.name}</p>
                  {!professional.active && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">inativo</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{professional.count} atendimentos</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                    {PROFESSIONAL_ATTENDANCE_SCOPE_LABELS[professional.attendanceScope]}
                  </span>
                  <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                    Comissão {Number(professional.commissionRate ?? 40).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="mr-8 text-right">
                <p className="font-bold text-foreground tabular-nums">{formatCurrency(professional.revenue)}</p>
                <p className="text-xs text-muted-foreground">ticket: {formatCurrency(professional.ticketMedio)}</p>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Corte</p>
                <p className="mt-1 font-semibold text-foreground">
                  {professional.haircutPrice ? formatCurrency(Number(professional.haircutPrice)) : 'Padrão'}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Barba</p>
                <p className="mt-1 font-semibold text-foreground">
                  {professional.beardPrice ? formatCurrency(Number(professional.beardPrice)) : 'Padrão'}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Combo</p>
                <p className="mt-1 font-semibold text-foreground">
                  {professional.comboPrice ? formatCurrency(Number(professional.comboPrice)) : 'Padrão'}
                </p>
              </div>
            </div>

            {professional.goalValue > 0 && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>Meta: {formatCurrency(professional.goalValue)}</span>
                  <span className={cn(professional.progress >= 100 ? 'text-emerald-500' : 'text-foreground')}>
                    {professional.progress.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      professional.progress >= 100 ? 'bg-emerald-500' : professional.progress >= 80 ? 'bg-amber-500' : 'bg-slate-500'
                    )}
                    style={{ width: `${Math.min(100, professional.progress)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
