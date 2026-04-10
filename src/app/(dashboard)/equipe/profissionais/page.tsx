import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange, formatCurrency } from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { serializeForClient } from '@/lib/serialize-for-client'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { Crown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProfessionalModal, type ProfessionalFormValue } from '@/components/equipe/professional-modal'
import { ToggleActiveButton } from '@/components/equipe/toggle-active-button'

export const metadata: Metadata = { title: 'Profissionais' }

interface Props { searchParams: { month?: string; year?: string } }

export default async function ProfissionaisPage({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const { start, end } = getMonthRange(month, year)

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
    .map((p) => {
      const revData = revenueByPro.find((r) => r.professionalId === p.id)
      const goal = goals.find((g) => g.professionalId === p.id)
      const revenue = Number(revData?._sum.amount ?? 0)
      const count = revData?._count ?? 0
      const goalValue = Number(goal?.revenueGoal ?? 0)
      const progress = goalValue > 0 ? Math.min(100, (revenue / goalValue) * 100) : 0
      return { ...p, revenue, count, goalValue, progress, ticketMedio: count > 0 ? revenue / count : 0 }
    })
    .sort((a, b) => b.revenue - a.revenue)

  const leader = enriched[0]
  const professionalFormMap = new Map(
    (serializeForClient(
      professionals.map((professional) => ({
        id: professional.id,
        name: professional.name,
        email: professional.email,
        phone: professional.phone,
      }))
    ) as unknown as ProfessionalFormValue[]).map((professional) => [professional.id, professional])
  )

  return (
    <div className="page-section max-w-6xl mx-auto">
      <PageHeader
        title="Profissionais"
        description="Veja quem puxa resultado, ticket e ritmo de atendimento no período."
        action={
          <div className="flex items-center gap-3">
            <Suspense>
              <PeriodSelector month={month} year={year} pathname="/equipe/profissionais" />
            </Suspense>
            <ProfessionalModal />
          </div>
        }
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

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="kpi-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Resultado do time</p>
          <p className="text-2xl font-bold text-emerald-500 tabular-nums">
            {formatCurrency(enriched.reduce((acc, p) => acc + p.revenue, 0))}
          </p>
        </div>
        <div className="kpi-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Atendimentos</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {enriched.reduce((acc, p) => acc + p.count, 0)}
          </p>
        </div>
        <div className="kpi-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Líder do Mês</p>
          <p className="text-lg font-bold text-foreground">{leader?.name ?? '—'}</p>
          <p className="text-sm text-emerald-500">{leader ? formatCurrency(leader.revenue) : ''}</p>
        </div>
      </div>

      {/* Cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {enriched.map((prof, idx) => (
          <div key={prof.id} className={cn('kpi-card relative', !prof.active && 'opacity-50')}>
            <div className="absolute top-3 right-3 flex items-center gap-1">
              {idx === 0 && prof.active && <Crown className="w-4 h-4 text-amber-400" />}
              <ProfessionalModal professional={professionalFormMap.get(prof.id)} />
              <ToggleActiveButton id={prof.id} active={prof.active} />
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                {prof.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-foreground">{prof.name}</p>
                  {!prof.active && <span className="text-[10px] px-1.5 py-0.5 bg-secondary rounded text-muted-foreground">inativo</span>}
                </div>
                <p className="text-xs text-muted-foreground">{prof.count} atendimentos</p>
              </div>
              <div className="ml-auto text-right mr-8">
                <p className="font-bold text-foreground tabular-nums">{formatCurrency(prof.revenue)}</p>
                <p className="text-xs text-muted-foreground">ticket: {formatCurrency(prof.ticketMedio)}</p>
              </div>
            </div>

            {prof.goalValue > 0 && (
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Meta: {formatCurrency(prof.goalValue)}</span>
                  <span className={cn(prof.progress >= 100 ? 'text-emerald-500' : 'text-foreground')}>
                    {prof.progress.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', prof.progress >= 100 ? 'bg-emerald-500' : prof.progress >= 80 ? 'bg-amber-500' : 'bg-slate-500')}
                    style={{ width: `${Math.min(100, prof.progress)}%` }}
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
