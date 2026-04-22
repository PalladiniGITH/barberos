import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  CHALLENGE_TYPE_LABELS,
  cn,
  formatCurrency,
  formatPercent,
  formatPeriodLabel,
  getGoalStatus,
  getMonthRange,
} from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { findSessionProfessional } from '@/lib/professionals/session-professional'
import { resolveProfessionalCommissionRatePercent } from '@/lib/professionals/operational-config'
import { getBarberDashboardData } from '@/lib/barber-dashboard'
import { getTeamSectionTabs } from '@/lib/team-navigation'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { ArrowUpRight, BadgeCheck, Crown, Target, TrendingUp, Users } from 'lucide-react'

export const metadata: Metadata = { title: 'Desempenho' }

interface Props {
  searchParams: { month?: string; year?: string }
}

export default async function DesempenhoPage({ searchParams }: Props) {
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
        <div className="page-section mx-auto flex max-w-5xl flex-col gap-6">
          <PageHeader
            title="Meu desempenho"
            description="Ainda nao encontramos um profissional ativo vinculado ao seu usuario para consolidar seu resultado."
            action={(
              <Suspense>
                <PeriodSelector month={month} year={year} pathname="/equipe/desempenho" />
              </Suspense>
            )}
          />

          <SectionTabs currentPath="/equipe/desempenho" items={getTeamSectionTabs(session.user.role)} />

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Vinculo profissional pendente</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Assim que a equipe ligar este login ao seu cadastro profissional, o painel passa a mostrar seus atendimentos, sua comissao e sua leitura individual.
            </p>
          </section>
        </div>
      )
    }

    const barberDashboardData = await getBarberDashboardData({
      barbershopId: session.user.barbershopId,
      professionalId: sessionProfessional.id,
      month,
      year,
    })

    if (!barberDashboardData) {
      return (
        <div className="page-section mx-auto flex max-w-5xl flex-col gap-6">
          <PageHeader
            title="Meu desempenho"
            description="Nao foi possivel consolidar seus indicadores agora."
            action={(
              <Suspense>
                <PeriodSelector month={month} year={year} pathname="/equipe/desempenho" />
              </Suspense>
            )}
          />

          <SectionTabs currentPath="/equipe/desempenho" items={getTeamSectionTabs(session.user.role)} />

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Painel indisponivel</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Sua agenda continua acessivel. Vale revisar o vinculo do barbeiro e os dados do periodo antes do deploy.
            </p>
          </section>
        </div>
      )
    }

    return (
      <div className="page-section mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          title="Meu desempenho"
          description={`Seu resultado em ${monthLabel}, com foco no que voce entregou, no que esta ganhando e no ritmo da sua meta.`}
          action={(
            <Suspense>
              <PeriodSelector month={month} year={year} pathname="/equipe/desempenho" />
            </Suspense>
          )}
        />

        <SectionTabs currentPath="/equipe/desempenho" items={getTeamSectionTabs(session.user.role)} />

        <section className="dashboard-panel dashboard-spotlight overflow-hidden p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">
                Resultado individual
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
                {formatCurrency(barberDashboardData.monthRevenue)}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Receita gerada por voce em {barberDashboardData.periodLabel}, com leitura direta de ticket, comissao e entregas concluidas.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                {barberDashboardData.appointmentsCompletedInPeriod} atendimento(s)
              </span>
              <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                {formatCurrency(barberDashboardData.averageTicket)} de ticket
              </span>
              <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                {barberDashboardData.attendanceScopeLabel}
              </span>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-sm text-slate-300">Ticket medio</p>
              <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(barberDashboardData.averageTicket)}</p>
              <p className="mt-1 text-xs text-slate-400">Media por atendimento concluido.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-sm text-slate-300">Comissao estimada</p>
              <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(barberDashboardData.estimatedCommission)}</p>
              <p className="mt-1 text-xs text-slate-400">
                {barberDashboardData.actualCommission !== null ? 'Valor fechado do periodo.' : 'Projecao com base na sua regra atual.'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-sm text-slate-300">Produtos vendidos</p>
              <p className="mt-3 text-2xl font-semibold text-white">{barberDashboardData.productSalesCount}</p>
              <p className="mt-1 text-xs text-slate-400">{formatCurrency(barberDashboardData.productRevenue)} em receita de produto.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-sm text-slate-300">Meta do periodo</p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {barberDashboardData.goalValue > 0 ? formatPercent(barberDashboardData.goalProgress, 0) : 'Sem meta'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {barberDashboardData.goalValue > 0 ? `${formatCurrency(barberDashboardData.goalValue)} de objetivo atual.` : 'Sem meta individual definida.'}
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
          <section className="dashboard-panel p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Leitura do seu periodo</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Um resumo simples do que voce esta entregando sem expor resultado de outros profissionais.
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {barberDashboardData.periodLabel}
              </span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Receita comissionavel</p>
                <p className="mt-3 text-2xl font-semibold text-foreground">{formatCurrency(barberDashboardData.commissionableRevenue)}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Base usada para estimar sua comissao quando ainda nao existe fechamento registrado.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Meta individual</p>
                <p className="mt-3 text-2xl font-semibold text-foreground">
                  {barberDashboardData.goalValue > 0 ? formatCurrency(barberDashboardData.goalValue) : 'Nao definida'}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {barberDashboardData.goalValue > 0
                    ? `${formatPercent(barberDashboardData.goalProgress, 0)} concluido ate agora.`
                    : 'Quando a lideranca definir sua meta, o progresso aparece aqui automaticamente.'}
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Agenda do dia</p>
                <p className="mt-3 text-2xl font-semibold text-foreground">{barberDashboardData.scheduledTodayCount}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Horarios ainda pendentes ou confirmados na sua agenda de hoje.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Concluidos hoje</p>
                <p className="mt-3 text-2xl font-semibold text-foreground">{barberDashboardData.completedTodayCount}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Atendimentos que ja viraram entrega real no dia de hoje.
                </p>
              </div>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="dashboard-panel p-6">
              <h2 className="text-lg font-semibold text-foreground">Desafio ativo</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                O acompanhamento da sua campanha atual fica centralizado aqui.
              </p>

              <div className="mt-4">
                {barberDashboardData.activeChallenge ? (
                  <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                    <p className="text-sm font-semibold text-foreground">{barberDashboardData.activeChallenge.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{barberDashboardData.activeChallenge.typeLabel}</p>
                    <p className="mt-4 text-2xl font-semibold text-foreground">
                      {formatPercent(barberDashboardData.activeChallenge.progress, 0)}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {barberDashboardData.activeChallenge.valueFormat === 'currency'
                        ? `${formatCurrency(barberDashboardData.activeChallenge.achievedValue)} de ${formatCurrency(barberDashboardData.activeChallenge.targetValue)}`
                        : `${barberDashboardData.activeChallenge.achievedValue} de ${barberDashboardData.activeChallenge.targetValue}`}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {barberDashboardData.activeChallenge.reward
                        ? `Recompensa ativa: ${barberDashboardData.activeChallenge.reward}.`
                        : 'Sem recompensa cadastrada para esta campanha.'}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
                    Nenhuma campanha ativa para o seu cadastro neste periodo.
                  </div>
                )}
              </div>
            </section>

            <section className="dashboard-panel p-6">
              <h2 className="text-lg font-semibold text-foreground">Acoes rapidas</h2>
              <div className="mt-4 space-y-3">
                <Link
                  href="/agendamentos"
                  className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/50"
                >
                  Abrir minha agenda
                  <ArrowUpRight className="h-4 w-4 text-primary" />
                </Link>
                <Link
                  href="/configuracoes"
                  className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/50"
                >
                  Abrir minha conta
                  <ArrowUpRight className="h-4 w-4 text-primary" />
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    )
  }

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
      const projectedCommission = revenue * (
        resolveProfessionalCommissionRatePercent({
          professionalRate: professional.commissionRate ? Number(professional.commissionRate) : null,
        }) / 100
      )
      return {
        ...professional,
        commission: commissionMap.get(professional.id) ?? projectedCommission,
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

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Desempenho da equipe"
        description="Leitura clara de resultado, ritmo e metas para mostrar como a operacao esta andando de verdade."
        action={(
          <Suspense>
            <PeriodSelector month={month} year={year} pathname="/equipe/desempenho" />
          </Suspense>
        )}
      />

      <SectionTabs currentPath="/equipe/desempenho" items={getTeamSectionTabs(session.user.role)} />

      <section className="dashboard-panel dashboard-spotlight overflow-hidden p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">
              Performance comercial
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
              {formatCurrency(teamRevenue)}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {monthLabel} mostra como o time converte atendimento em caixa: volume, ticket, meta e comissao na mesma leitura.
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
            <p className="mt-1 text-xs text-slate-400">Receita do periodo selecionado.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Ticket medio</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(averageTicket)}</p>
            <p className="mt-1 text-xs text-slate-400">Resumo de preco e mix de servicos.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Comissao estimada</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(commissionTotal)}</p>
            <p className="mt-1 text-xs text-slate-400">Leitura do fechamento da equipe.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Lider do periodo</p>
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
                Cada card mostra o que o time entregou e o quanto ainda falta para fechar o mes com consistencia.
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Meta geral</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {monthlyGoal ? formatCurrency(monthlyGoalValue) : 'Sem meta definida'}
              </p>
              {monthlyGoal && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatPercent(teamProgress, 0)} concluido no periodo.
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
                        <p className="truncate text-sm font-semibold text-foreground">{professional.name}</p>
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
                          ticket {formatCurrency(professional.ticket)} · comissao {formatCurrency(professional.commission)}
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
                      <span
                        className={cn(
                          professional.goalValue > 0 && professional.progress >= 100
                            ? 'text-emerald-500'
                            : professional.goalValue > 0 && professional.progress >= 80
                              ? 'text-amber-500'
                              : 'text-foreground'
                        )}
                      >
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
                  Quadro do mes
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {monthlyGoal
                    ? `${goalHitCount} profissionais ja bateram a meta individual e o time esta em ${formatPercent(teamProgress, 0)} da meta geral.`
                    : 'Sem meta cadastrada, a tela ainda assim entrega uma leitura clara do ritmo e do ranking.'}
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Ponto de atencao
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {rankedProfessionals.some((professional) => professional.goalValue > 0 && professional.progress < 80)
                    ? 'Existem profissionais abaixo de 80% da meta. Isso cria uma boa conversa de suporte e cobranca inteligente na demo.'
                    : 'A equipe esta com leitura positiva de ritmo e o painel ja sustenta uma narrativa de escala.'}
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Users className="h-4 w-4 text-primary" />
                  Top performer
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {leader
                    ? `${leader.name} lidera com ${formatCurrency(leader.revenue)} e ${formatCurrency(leader.ticket)} de ticket medio.`
                    : 'Cadastre receitas para enxergar o profissional mais forte do periodo.'}
                </p>
              </div>
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Desafios ativos</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Um jeito simples de mostrar competicao saudavel e reforcar o engajamento do time.
            </p>

            <div className="mt-4 space-y-3">
              {challengeRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-5 text-sm text-muted-foreground">
                  Nenhum desafio ativo neste periodo. A area continua pronta para mostrar metas de time quando houver campanha.
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
                      {challenge.completedCount} resultado{challenge.completedCount === 1 ? '' : 's'} concluido{challenge.completedCount === 1 ? '' : 's'}
                      {challenge.reward ? ` · recompensa: ${challenge.reward}` : ''}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Acao sugerida</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Use este painel quando quiser mostrar que o produto sai do cadastro e entra na conversa de resultado.
            </p>
            <Link href="/equipe/metas" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
              Abrir metas da equipe
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </section>
        </aside>
      </div>
    </div>
  )
}
