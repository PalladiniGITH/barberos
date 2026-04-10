import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  CHALLENGE_TYPE_LABELS,
  formatCurrency,
  formatPercent,
  formatPeriodLabel,
  getGoalStatus,
  getMonthRange,
} from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { ArrowUpRight, BadgeCheck, Crown, Target, TrendingUp, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Desempenho' }

interface Props {
  searchParams: { month?: string; year?: string }
}

export default async function DesempenhoPage({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const { start, end } = getMonthRange(month, year)

  const [professionals, revenueByPro, goals, monthlyGoal, commissions, challenges] = await Promise.all([
    prisma.professional.findMany({
      where: { barbershopId: session.user.barbershopId },
      orderBy: { name: 'asc' },
    }),
    prisma.revenue.groupBy({
      by: ['professionalId'],
      where: {
        barbershopId: session.user.barbershopId,
        date: { gte: start, lte: end },
        professionalId: { not: null },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.professionalGoal.findMany({
      where: { barbershopId: session.user.barbershopId, month, year },
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
    prisma.commission.findMany({
      where: { barbershopId: session.user.barbershopId, month, year },
    }),
    prisma.challenge.findMany({
      where: {
        barbershopId: session.user.barbershopId,
        active: true,
        startDate: { lte: end },
        endDate: { gte: start },
      },
      include: {
        results: {
          include: { professional: true },
        },
      },
      orderBy: { endDate: 'asc' },
    }),
  ])

  const professionalGoals = new Map(goals.map((goal) => [goal.professionalId, goal]))
  const commissionMap = new Map(
    commissions.map((commission) => [
      commission.professionalId,
      Number(commission.commissionAmount) + Number(commission.bonus),
    ])
  )

  const rankedProfessionals = professionals
    .map((professional) => {
      const revenueData = revenueByPro.find((item) => item.professionalId === professional.id)
      const revenue = Number(revenueData?._sum.amount ?? 0)
      const count = revenueData?._count ?? 0
      const goal = professionalGoals.get(professional.id)
      const goalValue = Number(goal?.revenueGoal ?? 0)
      const goalMin = Number(goal?.revenueMin ?? 0)
      const progress = goalValue > 0 ? Math.min(100, (revenue / goalValue) * 100) : 0
      const ticket = count > 0 ? revenue / count : 0
      const status = goal ? getGoalStatus(revenue, goalValue, goalMin) : null
      return {
        ...professional,
        commission: commissionMap.get(professional.id) ?? 0,
        count,
        goalValue,
        progress,
        revenue,
        status,
        ticket,
      }
    })
    .sort((left, right) => right.revenue - left.revenue)

  const teamRevenue = rankedProfessionals.reduce((sum, professional) => sum + professional.revenue, 0)
  const attendanceCount = rankedProfessionals.reduce((sum, professional) => sum + professional.count, 0)
  const averageTicket = attendanceCount > 0 ? teamRevenue / attendanceCount : 0
  const goalHitCount = rankedProfessionals.filter((professional) => professional.goalValue > 0 && professional.revenue >= professional.goalValue).length
  const commissionTotal = rankedProfessionals.reduce((sum, professional) => sum + professional.commission, 0)
  const monthlyGoalValue = monthlyGoal ? Number(monthlyGoal.revenueGoal) : 0
  const teamProgress = monthlyGoalValue > 0 ? Math.min(100, (teamRevenue / monthlyGoalValue) * 100) : 0
  const leader = rankedProfessionals[0]

  const challengeRows = challenges.map((challenge) => {
    const completedCount = challenge.results.filter((result) => result.completed).length
    const bestResult = challenge.results.reduce(
      (best, result) => Math.max(best, Number(result.achievedValue)),
      0
    )
    const completionRate = professionals.length > 0 ? (completedCount / professionals.length) * 100 : 0

    return {
      id: challenge.id,
      title: challenge.title,
      type: CHALLENGE_TYPE_LABELS[challenge.type],
      target: Number(challenge.targetValue),
      completedCount,
      completionRate,
      bestResult,
      reward: challenge.reward,
    }
  })

  const monthLabel = formatPeriodLabel(month, year)

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Desempenho da equipe"
        description="Leitura clara de resultado, ritmo e metas para mostrar como a operação está andando de verdade."
        action={(
          <Suspense>
            <PeriodSelector month={month} year={year} pathname="/equipe/desempenho" />
          </Suspense>
        )}
      />

      <SectionTabs
        currentPath="/equipe/desempenho"
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

      <section className="dashboard-panel dashboard-spotlight overflow-hidden p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200/70">
              Performance comercial
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
              {formatCurrency(teamRevenue)}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {monthLabel} mostra como o time converte atendimento em caixa: volume, ticket, meta e comissão na mesma leitura.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              <Users className="mr-1 h-3.5 w-3.5" />
              {professionals.length} profissionais
            </span>
            <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              <Target className="mr-1 h-3.5 w-3.5" />
              {goalHitCount} metas batidas
            </span>
            {monthlyGoal && (
              <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                <TrendingUp className="mr-1 h-3.5 w-3.5" />
                {formatPercent(teamProgress, 0)} da meta geral
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Faturamento</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(teamRevenue)}</p>
            <p className="mt-1 text-xs text-slate-400">Receita do período selecionado.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Ticket médio</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(averageTicket)}</p>
            <p className="mt-1 text-xs text-slate-400">Resumo de preço e mix de serviços.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Comissão estimada</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(commissionTotal)}</p>
            <p className="mt-1 text-xs text-slate-400">Leitura do fechamento da equipe.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Líder do período</p>
            <p className="mt-3 text-2xl font-semibold text-white">{leader?.name ?? 'Sem movimento'}</p>
            <p className="mt-1 text-xs text-slate-400">
              {leader ? formatCurrency(leader.revenue) : 'Cadastre receitas para exibir o ranking.'}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_360px]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Ranking e ritmo individual</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Cada card mostra o que o time entregou e o quanto ainda falta para fechar o mês com consistência.
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Meta geral</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {monthlyGoal ? formatCurrency(monthlyGoalValue) : 'Sem meta definida'}
              </p>
              {monthlyGoal && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatPercent(teamProgress, 0)} concluído no período.
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {rankedProfessionals.map((professional, index) => (
              <div key={professional.id} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-background/60">
                    {index === 0 ? (
                      <Crown className="h-4 w-4 text-amber-400" />
                    ) : (
                      <span className="text-sm font-semibold text-muted-foreground">{index + 1}</span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {professional.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {professional.count} atendimentos
                          {professional.goalValue > 0 ? ` · meta de ${formatCurrency(professional.goalValue)}` : ' · sem meta individual'}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums text-foreground">
                          {formatCurrency(professional.revenue)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          ticket {formatCurrency(professional.ticket)} · comissão {formatCurrency(professional.commission)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {professional.status
                          ? professional.status === 'exceeded'
                            ? 'Meta batida'
                            : professional.status === 'on-track'
                              ? 'No caminho'
                              : 'Abaixo da meta'
                          : 'Sem meta definida'}
                      </span>
                      <span className={cn(
                        professional.goalValue > 0 && professional.progress >= 100
                          ? 'text-emerald-500'
                          : professional.goalValue > 0 && professional.progress >= 80
                            ? 'text-amber-500'
                            : 'text-foreground'
                      )}>
                        {professional.goalValue > 0 ? formatPercent(professional.progress, 0) : formatCurrency(professional.revenue)}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-background/70">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-700',
                          professional.goalValue > 0
                            ? professional.progress >= 100
                              ? 'bg-emerald-500'
                              : professional.progress >= 80
                                ? 'bg-amber-500'
                                : 'bg-slate-500'
                            : 'bg-sky-400'
                        )}
                        style={{
                          width: `${professional.goalValue > 0 ? Math.min(100, professional.progress) : Math.min(100, professional.revenue > 0 ? 100 : 0)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Leitura executiva</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <BadgeCheck className="h-4 w-4 text-primary" />
                  Quadro do mês
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {monthlyGoal
                    ? `${goalHitCount} profissionais já bateram a meta individual e o time está em ${formatPercent(teamProgress, 0)} da meta geral.`
                    : 'Sem meta cadastrada, a tela ainda assim entrega uma leitura clara do ritmo e do ranking.'}
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Ponto de atenção
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {rankedProfessionals.some((professional) => professional.goalValue > 0 && professional.progress < 80)
                    ? 'Existem profissionais abaixo de 80% da meta. Isso cria uma boa conversa de suporte e cobrança inteligente na demo.'
                    : 'A equipe está com leitura positiva de ritmo e o painel já sustenta uma narrativa de escala.'}
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Users className="h-4 w-4 text-primary" />
                  Top performer
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {leader
                    ? `${leader.name} lidera com ${formatCurrency(leader.revenue)} e ${formatCurrency(leader.ticket)} de ticket médio.`
                    : 'Cadastre receitas para enxergar o profissional mais forte do período.'}
                </p>
              </div>
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Desafios ativos</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Um jeito simples de mostrar competição saudável e reforçar o engajamento do time.
            </p>

            <div className="mt-4 space-y-3">
              {challengeRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-5 text-sm text-muted-foreground">
                  Nenhum desafio ativo neste período. A área continua pronta para mostrar metas de time quando houver campanha.
                </div>
              ) : (
                challengeRows.map((challenge) => (
                  <div key={challenge.id} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{challenge.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{challenge.type}</p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        {formatPercent(challenge.completionRate, 0)}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border border-border/60 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Meta</p>
                        <p className="mt-1 font-semibold text-foreground">{formatCurrency(challenge.target)}</p>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Melhor entrega</p>
                        <p className="mt-1 font-semibold text-foreground">{formatCurrency(challenge.bestResult)}</p>
                      </div>
                    </div>

                    <p className="mt-3 text-xs text-muted-foreground">
                      {challenge.completedCount} resultado{challenge.completedCount === 1 ? '' : 's'} concluído{challenge.completedCount === 1 ? '' : 's'}
                      {challenge.reward ? ` · recompensa: ${challenge.reward}` : ''}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Ação sugerida</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Use este painel quando quiser mostrar que o produto sai do cadastro e entra na conversa de resultado.
            </p>
            <a
              href="/equipe/metas"
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary"
            >
              Abrir metas da equipe
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </section>
        </aside>
      </div>
    </div>
  )
}
