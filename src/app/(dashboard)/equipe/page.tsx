import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatCurrency, formatPercent, formatPeriodLabel, getMonthRange } from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { ArrowUpRight, Crown, Target, TrendingUp, Users } from 'lucide-react'
import { resolveProfessionalCommissionRatePercent } from '@/lib/professionals/operational-config'

export const metadata: Metadata = { title: 'Equipe' }

interface Props {
  searchParams: { month?: string; year?: string }
}

export default async function EquipePage({ searchParams }: Props) {
  const session = await requireSession()
  const { month, year } = resolvePeriod(searchParams)
  const { start, end } = getMonthRange(month, year)

  const [professionals, revenueByPro, monthlyGoal, commissions] = await Promise.all([
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
  ])

  const teamRevenue = revenueByPro.reduce((sum, item) => sum + Number(item._sum.amount ?? 0), 0)
  const activeProfessionals = professionals.filter((professional) => professional.active).length
  const attendanceCount = revenueByPro.reduce((sum, item) => sum + item._count, 0)
  const averageTicket = attendanceCount > 0 ? teamRevenue / attendanceCount : 0
  const commissionMap = new Map(
    commissions.map((commission) => [
      commission.professionalId,
      Number(commission.commissionAmount) + Number(commission.bonus),
    ])
  )

  const teamGoal = monthlyGoal ? Number(monthlyGoal.revenueGoal) : 0
  const goalProgress = teamGoal > 0 ? Math.min(100, (teamRevenue / teamGoal) * 100) : 0
  const professionalsWithRevenue = professionals
    .map((professional) => {
      const revenueData = revenueByPro.find((item) => item.professionalId === professional.id)
      const revenue = Number(revenueData?._sum.amount ?? 0)
      const count = revenueData?._count ?? 0
      const projectedCommission = revenue * (
        resolveProfessionalCommissionRatePercent({
          professionalRate: professional.commissionRate ? Number(professional.commissionRate) : null,
        }) / 100
      )

      return {
        ...professional,
        revenue,
        count,
        projectedCommission: commissionMap.get(professional.id) ?? projectedCommission,
      }
    })
  const commissionTotal = professionalsWithRevenue.reduce(
    (sum, professional) => sum + professional.projectedCommission,
    0
  )
  const leader = professionalsWithRevenue.sort((left, right) => right.revenue - left.revenue)[0]

  const monthLabel = formatPeriodLabel(month, year)

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Equipe"
        description="Uma visão comercial da equipe para apresentar resultado, ritmo e próximos passos em segundos."
        action={(
          <Suspense>
            <PeriodSelector month={month} year={year} pathname="/equipe" />
          </Suspense>
        )}
      />

      <SectionTabs
        currentPath="/equipe"
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
            helper: 'Leitura de performance e resultado do time.',
          },
        ]}
      />

      <section className="dashboard-panel dashboard-spotlight overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary/80">
              Resumo do período
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
              {formatCurrency(teamRevenue)}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {monthLabel} entra como um painel comercial simples: quanto a equipe trouxe, quanto converteu e onde o dono pode agir sem planilha.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              <Users className="h-3.5 w-3.5" />
              {activeProfessionals} profissionais ativos
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              <TrendingUp className="h-3.5 w-3.5" />
              {formatCurrency(averageTicket)} de ticket médio
            </span>
            {monthlyGoal && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                <Target className="h-3.5 w-3.5" />
                {formatPercent(goalProgress, 0)} da meta
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Faturamento do time</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(teamRevenue)}</p>
            <p className="mt-1 text-xs text-slate-400">Leitura direta do período selecionado.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Atendimentos</p>
            <p className="mt-3 text-2xl font-semibold text-white">{attendanceCount}</p>
            <p className="mt-1 text-xs text-slate-400">Base para ticket e ritmo da operação.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Comissão estimada</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(commissionTotal)}</p>
            <p className="mt-1 text-xs text-slate-400">Leitura financeira do fechamento da equipe.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Líder do mês</p>
            <p className="mt-3 text-2xl font-semibold text-white">{leader?.name ?? 'Sem movimento'}</p>
            <p className="mt-1 text-xs text-slate-400">
              {leader ? formatCurrency(leader.revenue) : 'Cadastre receitas para exibir o ranking.'}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link href="/equipe/profissionais" className="dashboard-panel p-5 transition-transform hover:-translate-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Profissionais</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{professionals.length}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Ranking, ticket médio e gestão por profissional em um clique.
          </p>
          <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
            Abrir visão de profissionais
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </Link>

        <Link href="/equipe/metas" className="dashboard-panel p-5 transition-transform hover:-translate-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Metas</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">
            {monthlyGoal ? formatPercent(goalProgress, 0) : 'Sem meta'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Acompanhamento da meta da barbearia e das metas individuais do mês.
          </p>
          <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
            Ver metas do período
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </Link>

        <Link href="/equipe/desempenho" className="dashboard-panel p-5 transition-transform hover:-translate-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Desempenho</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{formatCurrency(averageTicket)}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Leitura consolidada de performance, ritmo e consistência comercial.
          </p>
          <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
            Abrir painel de desempenho
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </Link>
      </div>

      <section className="dashboard-panel p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Leitura rápida da equipe</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Essa visão funciona bem em demo porque já organiza a conversa entre pessoas, metas e resultado.
            </p>
          </div>
          {leader && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-200/80">Destaque</p>
              <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-amber-100">
                <Crown className="h-4 w-4 text-amber-300" />
                {leader.name}
              </p>
              <p className="mt-1 text-xs text-amber-100/80">{formatCurrency(leader.revenue)} no período</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
