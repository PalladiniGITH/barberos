import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  formatCurrency,
  formatPercent,
  formatPeriodLabel,
  getGoalStatus,
  getMonthRange,
  cn,
} from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { findSessionProfessional } from '@/lib/professionals/session-professional'
import { getTeamSectionTabs } from '@/lib/team-navigation'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { GoalForm } from '@/components/equipe/goal-form'
import { ProfessionalAvatar } from '@/components/ui/professional-avatar'
import { AlertTriangle, CheckCircle2, Target, TrendingUp } from 'lucide-react'

export const metadata: Metadata = { title: 'Metas' }

interface Props {
  searchParams: { month?: string; year?: string }
}

export default async function MetasPage({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const { start, end } = getMonthRange(month, year)
  const monthLabel = formatPeriodLabel(month, year)

  if (session.user.role === 'BARBER') {
    const sessionProfessional = await findSessionProfessional({
      barbershopId: session.user.barbershopId,
      email: session.user.email,
      name: session.user.name,
    })

    if (!sessionProfessional) {
      return (
        <div className="page-section mx-auto max-w-5xl">
          <PageHeader
            title="Minhas metas"
            description="Ainda nao encontramos um profissional ativo vinculado ao seu usuario para montar sua leitura individual."
            action={(
              <Suspense>
                <PeriodSelector month={month} year={year} pathname="/equipe/metas" />
              </Suspense>
            )}
          />

          <SectionTabs currentPath="/equipe/metas" items={getTeamSectionTabs(session.user.role)} />

          <section className="dashboard-panel mt-6 p-6">
            <h2 className="text-lg font-semibold text-foreground">Vinculo profissional pendente</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Assim que a equipe ligar este login ao seu cadastro profissional, voce passa a ver meta, progresso e desempenho individual aqui.
            </p>
          </section>
        </div>
      )
    }

    const [personalGoal, monthlyGoal, revenueTotal, completedAppointments] = await Promise.all([
      prisma.professionalGoal.findUnique({
        where: {
          professionalId_month_year: {
            professionalId: sessionProfessional.id,
            month,
            year,
          },
        },
      }),
      prisma.monthlyGoal.findUnique({
        where: {
          barbershopId_month_year: {
            barbershopId: session.user.barbershopId,
            month,
            year,
          },
        },
      }),
      prisma.revenue.aggregate({
        where: {
          barbershopId: session.user.barbershopId,
          professionalId: sessionProfessional.id,
          date: { gte: start, lte: end },
        },
        _sum: { amount: true },
      }),
      prisma.appointment.count({
        where: {
          barbershopId: session.user.barbershopId,
          professionalId: sessionProfessional.id,
          startAt: { gte: start, lte: end },
          status: 'COMPLETED',
        },
      }),
    ])

    const realizedRevenue = Number(revenueTotal._sum.amount ?? 0)
    const personalGoalValue = Number(personalGoal?.revenueGoal ?? 0)
    const personalGoalMin = Number(personalGoal?.revenueMin ?? 0)
    const progress = personalGoalValue > 0 ? Math.min(100, (realizedRevenue / personalGoalValue) * 100) : 0
    const remaining = Math.max(0, personalGoalValue - realizedRevenue)
    const status = personalGoal ? getGoalStatus(realizedRevenue, personalGoalValue, personalGoalMin) : null
    const barbershopGoalValue = Number(monthlyGoal?.revenueGoal ?? 0)

    return (
      <div className="page-section mx-auto max-w-5xl">
        <PageHeader
          title="Minhas metas"
          description={`Seu objetivo individual em ${monthLabel}, com leitura clara do que ja foi entregue e do que ainda falta para fechar o periodo bem.`}
          action={(
            <Suspense>
              <PeriodSelector month={month} year={year} pathname="/equipe/metas" />
            </Suspense>
          )}
        />

        <SectionTabs currentPath="/equipe/metas" items={getTeamSectionTabs(session.user.role)} />

        {personalGoal ? (
          <div className="mt-6 space-y-5">
            <section className="dashboard-panel dashboard-spotlight overflow-hidden p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">
                    Meta individual
                  </p>
                  <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
                    {formatPercent(progress, 0)}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    {formatCurrency(realizedRevenue)} realizados de {formatCurrency(personalGoalValue)} na sua meta do periodo.
                  </p>
                </div>

                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold',
                    status === 'exceeded'
                      ? 'bg-emerald-500/12 text-emerald-200'
                      : status === 'on-track'
                        ? 'bg-amber-500/12 text-amber-200'
                        : 'bg-rose-500/12 text-rose-200'
                  )}
                >
                  {status === 'exceeded' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : status === 'on-track' ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  {status === 'exceeded' ? 'Meta batida' : status === 'on-track' ? 'No caminho' : 'Abaixo do esperado'}
                </span>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-sm text-slate-300">Realizado</p>
                  <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(realizedRevenue)}</p>
                  <p className="mt-1 text-xs text-slate-400">Receita registrada no periodo.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-sm text-slate-300">Meta</p>
                  <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(personalGoalValue)}</p>
                  <p className="mt-1 text-xs text-slate-400">Objetivo individual definido para voce.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-sm text-slate-300">Meta minima</p>
                  <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(personalGoalMin)}</p>
                  <p className="mt-1 text-xs text-slate-400">Faixa minima saudavel para o periodo.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-sm text-slate-300">Faltam</p>
                  <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(remaining)}</p>
                  <p className="mt-1 text-xs text-slate-400">Gap atual para fechar a meta principal.</p>
                </div>
              </div>
            </section>

            <section className="dashboard-panel p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Leitura da sua meta</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Um resumo direto para voce acompanhar o proprio ritmo sem entrar em modulos gerenciais.
                  </p>
                </div>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  {completedAppointments} atendimento(s) concluidos
                </span>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progresso da meta</span>
                    <span>{formatPercent(progress, 0)}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-700',
                        progress >= 100 ? 'bg-emerald-500' : progress >= 80 ? 'bg-amber-500' : 'bg-primary'
                      )}
                      style={{ width: `${Math.min(100, progress)}%` }}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground">Status atual</p>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {status === 'exceeded'
                        ? 'Meta batida com folga.'
                        : status === 'on-track'
                          ? 'Ritmo saudavel neste periodo.'
                          : 'Vale acelerar para recuperar o gap.'}
                    </p>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground">Referencia da casa</p>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {barbershopGoalValue > 0 ? formatCurrency(barbershopGoalValue) : 'Sem meta geral definida'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Aparece so como contexto. Sua meta individual continua sendo a referencia principal aqui.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <section className="dashboard-panel mt-6 p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Target className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Sua meta individual ainda nao foi definida</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  O painel continua mostrando seu resultado do periodo, mas a comparacao com meta individual so aparece quando a lideranca cadastrar esse alvo.
                </p>
                {barbershopGoalValue > 0 && (
                  <p className="mt-3 text-sm font-medium text-foreground">
                    Referencia geral da casa neste periodo: {formatCurrency(barbershopGoalValue)}.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    )
  }

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

  const statusIcon = {
    exceeded: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    'on-track': <TrendingUp className="h-4 w-4 text-amber-500" />,
    below: <AlertTriangle className="h-4 w-4 text-destructive" />,
  }

  const statusLabel = {
    exceeded: 'Meta batida',
    'on-track': 'No caminho',
    below: 'Abaixo',
  }

  return (
    <div className="page-section mx-auto max-w-5xl">
      <PageHeader
        title="Metas"
        description={`Meta da barbearia e da equipe em ${monthLabel}, com avanco claro e facil de defender.`}
        action={(
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
        )}
      />

      <SectionTabs currentPath="/equipe/metas" items={getTeamSectionTabs(session.user.role)} />

      {monthlyGoal ? (
        (() => {
          const progress = Math.min(100, (totalRevenue / Number(monthlyGoal.revenueGoal)) * 100)
          const status = getGoalStatus(totalRevenue, Number(monthlyGoal.revenueGoal), Number(monthlyGoal.revenueMin))
          const remaining = Math.max(0, Number(monthlyGoal.revenueGoal) - totalRevenue)

          return (
            <div className="mb-6 rounded-xl border border-border bg-card p-6">
              <div className="mb-5 flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Meta da Barbearia</h3>
                <div className="ml-auto flex items-center gap-1.5">
                  {statusIcon[status]}
                  <span
                    className={cn(
                      'text-sm font-medium',
                      status === 'exceeded' ? 'text-emerald-500' : status === 'on-track' ? 'text-amber-500' : 'text-destructive'
                    )}
                  >
                    {statusLabel[status]}
                  </span>
                </div>
              </div>

              <div className="mb-5 grid grid-cols-3 gap-6">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Realizado</p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(totalRevenue)}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Meta</p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(Number(monthlyGoal.revenueGoal))}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">{status === 'exceeded' ? 'Superado em' : 'Faltam'}</p>
                  <p className={cn('text-2xl font-bold tabular-nums', status === 'exceeded' ? 'text-emerald-500' : 'text-foreground')}>
                    {formatCurrency(status === 'exceeded' ? totalRevenue - Number(monthlyGoal.revenueGoal) : remaining)}
                  </p>
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>Minima: {formatCurrency(Number(monthlyGoal.revenueMin))}</span>
                  <span className="font-medium">{formatPercent(progress, 0)}</span>
                </div>
                <div className="relative h-3 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="absolute bottom-0 top-0 z-10 w-0.5 bg-amber-400/70"
                    style={{ left: `${(Number(monthlyGoal.revenueMin) / Number(monthlyGoal.revenueGoal)) * 100}%` }}
                  />
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-700',
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
        <div className="empty-state-shell mb-6 text-center">
          <Target className="mx-auto mb-2 h-8 w-8 text-muted-foreground opacity-40" />
          <p className="text-sm font-semibold text-foreground">Nenhuma meta definida para este mes</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Defina a meta geral para acompanhar progresso, minimo saudavel e ritmo do periodo em uma leitura so.
          </p>
        </div>
      )}

      <h3 className="mb-3 font-semibold text-foreground">Metas por Profissional</h3>
      {profGoals.length === 0 ? (
        <div className="empty-state-shell text-center">
          <p className="text-sm font-semibold text-foreground">Nenhuma meta individual definida</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Assim que as metas do time forem cadastradas, esta lista passa a mostrar realizado, objetivo e progresso por profissional.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {profGoals.map((pg) => {
            const revData = revenueByPro.find((revenueByProfessional) => revenueByProfessional.professionalId === pg.professionalId)
            const revenue = Number(revData?._sum.amount ?? 0)
            const progress = Math.min(100, (revenue / Number(pg.revenueGoal)) * 100)
            const status = getGoalStatus(revenue, Number(pg.revenueGoal), Number(pg.revenueMin))

            return (
              <div key={pg.id} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center gap-3">
                  <ProfessionalAvatar
                    name={pg.professional.name}
                    imageUrl={pg.professional.avatar}
                    size="sm"
                  />
                  <span className="flex-1 font-medium text-foreground">{pg.professional.name}</span>
                  <div className="flex items-center gap-1">
                    {statusIcon[status]}
                    <span
                      className={cn(
                        'text-xs font-medium',
                        status === 'exceeded' ? 'text-emerald-500' : status === 'on-track' ? 'text-amber-500' : 'text-destructive'
                      )}
                    >
                      {statusLabel[status]}
                    </span>
                  </div>
                </div>
                <div className="mb-2 flex items-center gap-6 text-sm">
                  <div>
                    <span className="text-muted-foreground">Realizado: </span>
                    <span className="font-semibold tabular-nums">{formatCurrency(revenue)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Meta: </span>
                    <span className="font-semibold tabular-nums">{formatCurrency(Number(pg.revenueGoal))}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Min: </span>
                    <span className="font-semibold tabular-nums">{formatCurrency(Number(pg.revenueMin))}</span>
                  </div>
                  <div className="ml-auto font-bold tabular-nums">{formatPercent(progress, 0)}</div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
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
