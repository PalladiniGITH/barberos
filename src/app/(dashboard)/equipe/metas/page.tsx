import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange, formatCurrency, formatPercent, getGoalStatus, formatPeriodLabel } from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { GoalForm } from '@/components/equipe/goal-form'
import { Target, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Metas' }

interface Props { searchParams: { month?: string; year?: string } }

export default async function MetasPage({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const { start, end } = getMonthRange(month, year)

  const [monthlyGoal, profGoals, revenueTotal, revenueByPro] = await Promise.all([
    prisma.monthlyGoal.findUnique({
      where: { barbershopId_month_year: { barbershopId: session.user.barbershopId, month, year } },
    }),
    prisma.professionalGoal.findMany({
      where: { barbershopId: session.user.barbershopId, month, year },
      include: { professional: true },
    }),
    prisma.revenue.aggregate({
      where: { barbershopId: session.user.barbershopId, date: { gte: start, lte: end } },
      _sum: { amount: true },
    }),
    prisma.revenue.groupBy({
      by: ['professionalId'],
      where: { barbershopId: session.user.barbershopId, date: { gte: start, lte: end }, professionalId: { not: null } },
      _sum: { amount: true },
    }),
  ])

  const totalRevenue = Number(revenueTotal._sum.amount ?? 0)
  const monthLabel = formatPeriodLabel(month, year)

  const statusIcon = {
    exceeded: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
    'on-track': <TrendingUp className="w-4 h-4 text-amber-500" />,
    below: <AlertTriangle className="w-4 h-4 text-destructive" />,
  }

  const statusLabel = {
    exceeded: 'Meta batida',
    'on-track': 'No caminho',
    below: 'Abaixo',
  }

  return (
    <div className="page-section max-w-5xl mx-auto">
      <PageHeader
        title="Metas"
        description={`Meta da barbearia e da equipe em ${monthLabel}, com avanço claro e fácil de defender.`}
        action={
          <div className="flex items-center gap-3">
            <Suspense>
              <PeriodSelector month={month} year={year} pathname="/equipe/metas" />
            </Suspense>
            <GoalForm
              month={month}
              year={year}
              existing={monthlyGoal ? {
                revenueGoal: Number(monthlyGoal.revenueGoal),
                revenueMin: Number(monthlyGoal.revenueMin),
                expenseLimit: monthlyGoal.expenseLimit ? Number(monthlyGoal.expenseLimit) : null,
                notes: monthlyGoal.notes,
              } : undefined}
            />
          </div>
        }
      />

      <SectionTabs
        currentPath="/equipe/metas"
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

      {/* Barbearia Goal */}
      {monthlyGoal ? (
        (() => {
          const progress = Math.min(100, (totalRevenue / Number(monthlyGoal.revenueGoal)) * 100)
          const status = getGoalStatus(totalRevenue, Number(monthlyGoal.revenueGoal), Number(monthlyGoal.revenueMin))
          const remaining = Math.max(0, Number(monthlyGoal.revenueGoal) - totalRevenue)
          return (
            <div className="rounded-xl border border-border bg-card p-6 mb-6">
              <div className="flex items-center gap-2 mb-5">
                <Target className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-foreground text-lg">Meta da Barbearia</h3>
                <div className="ml-auto flex items-center gap-1.5">
                  {statusIcon[status]}
                  <span className={cn(
                    'text-sm font-medium',
                    status === 'exceeded' ? 'text-emerald-500' : status === 'on-track' ? 'text-amber-500' : 'text-destructive'
                  )}>
                    {statusLabel[status]}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-6 mb-5">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Realizado</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(totalRevenue)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Meta</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(Number(monthlyGoal.revenueGoal))}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{status === 'exceeded' ? 'Superado em' : 'Faltam'}</p>
                  <p className={cn('text-2xl font-bold tabular-nums', status === 'exceeded' ? 'text-emerald-500' : 'text-foreground')}>
                    {formatCurrency(status === 'exceeded' ? totalRevenue - Number(monthlyGoal.revenueGoal) : remaining)}
                  </p>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                  <span>Mínima: {formatCurrency(Number(monthlyGoal.revenueMin))}</span>
                  <span className="font-medium">{formatPercent(progress, 0)}</span>
                </div>
                <div className="h-3 bg-secondary rounded-full overflow-hidden relative">
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-400/70 z-10"
                    style={{ left: `${(Number(monthlyGoal.revenueMin) / Number(monthlyGoal.revenueGoal)) * 100}%` }}
                  />
                  <div
                    className={cn('h-full rounded-full transition-all duration-700',
                      status === 'exceeded' ? 'bg-emerald-500' : status === 'on-track' ? 'bg-amber-500' : 'bg-slate-500'
                    )}
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })()
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 mb-6 text-center">
          <Target className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-muted-foreground">Nenhuma meta definida para este mês</p>
        </div>
      )}

      {/* Professional Goals */}
      <h3 className="font-semibold text-foreground mb-3">Metas por Profissional</h3>
      {profGoals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">Nenhuma meta individual definida</p>
        </div>
      ) : (
        <div className="space-y-3">
          {profGoals.map((pg) => {
            const revData = revenueByPro.find((r) => r.professionalId === pg.professionalId)
            const revenue = Number(revData?._sum.amount ?? 0)
            const progress = Math.min(100, (revenue / Number(pg.revenueGoal)) * 100)
            const status = getGoalStatus(revenue, Number(pg.revenueGoal), Number(pg.revenueMin))
            return (
              <div key={pg.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                    {pg.professional.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <span className="font-medium text-foreground flex-1">{pg.professional.name}</span>
                  <div className="flex items-center gap-1">
                    {statusIcon[status]}
                    <span className={cn(
                      'text-xs font-medium',
                      status === 'exceeded' ? 'text-emerald-500' : status === 'on-track' ? 'text-amber-500' : 'text-destructive'
                    )}>
                      {statusLabel[status]}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm mb-2">
                  <div>
                    <span className="text-muted-foreground">Realizado: </span>
                    <span className="font-semibold tabular-nums">{formatCurrency(revenue)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Meta: </span>
                    <span className="font-semibold tabular-nums">{formatCurrency(Number(pg.revenueGoal))}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Mín: </span>
                    <span className="font-semibold tabular-nums">{formatCurrency(Number(pg.revenueMin))}</span>
                  </div>
                  <div className="ml-auto font-bold tabular-nums">{formatPercent(progress, 0)}</div>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all',
                      status === 'exceeded' ? 'bg-emerald-500' : status === 'on-track' ? 'bg-amber-500' : 'bg-slate-500'
                    )}
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
