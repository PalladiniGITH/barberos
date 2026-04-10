import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  CHALLENGE_TYPE_LABELS,
  cn,
  formatCurrency,
  formatDate,
  formatPercent,
  getMonthRange,
} from '@/lib/utils'
import { PageHeader } from '@/components/layout/page-header'
import {
  ArrowUpRight,
  Crown,
  Flame,
  Gift,
  Medal,
  Sparkles,
  Target,
  Trophy,
  Users,
} from 'lucide-react'

export const metadata: Metadata = { title: 'Desafios' }

const challengeTemplates = [
  {
    title: 'Sprint de faturamento',
    type: 'REVENUE',
    target: 'R$ 6.000',
    reward: 'Bônus de R$ 300 ou dia de folga',
    helper: 'Perfeito para meses em que a barbearia precisa ganhar tração rápida.',
  },
  {
    title: 'Ticket médio premium',
    type: 'TICKET_AVERAGE',
    target: 'R$ 75 por atendimento',
    reward: 'Vale consumo ou comissão extra',
    helper: 'Empurra combos, barba e serviços de maior margem sem parecer só cobrança.',
  },
  {
    title: 'Campeonato de recorrência',
    type: 'SERVICES_COUNT',
    target: '120 atendimentos',
    reward: 'Troféu do mês + destaque no mural',
    helper: 'Bom para operações que querem volume e disciplina comercial ao mesmo tempo.',
  },
]

function templateTypeLabel(type: string) {
  return CHALLENGE_TYPE_LABELS[type] ?? type
}

export default async function DesafiosPage() {
  const session = await requireSession()
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const { start, end } = getMonthRange(currentMonth, currentYear)

  const [challenges, monthLeaderboard, professionalCount] = await Promise.all([
    prisma.challenge.findMany({
      where: { barbershopId: session.user.barbershopId },
      include: {
        results: {
          include: { professional: true },
          orderBy: { achievedValue: 'desc' },
        },
      },
      orderBy: [{ active: 'desc' }, { startDate: 'desc' }],
    }),
    prisma.revenue.groupBy({
      by: ['professionalId'],
      where: {
        barbershopId: session.user.barbershopId,
        date: { gte: start, lte: end },
        professionalId: { not: null },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 3,
    }),
    prisma.professional.count({
      where: { barbershopId: session.user.barbershopId, active: true },
    }),
  ])

  const professionalIds = monthLeaderboard.map((entry) => entry.professionalId!).filter(Boolean)
  const professionals = professionalIds.length > 0
    ? await prisma.professional.findMany({
        where: { id: { in: professionalIds } },
        select: { id: true, name: true },
      })
    : []

  const leaderboard = monthLeaderboard.map((entry, index) => ({
    id: entry.professionalId!,
    name: professionals.find((professional) => professional.id === entry.professionalId)?.name ?? 'Profissional',
    revenue: Number(entry._sum.amount ?? 0),
    position: index + 1,
  }))

  const activeChallenges = challenges.filter((challenge) => challenge.active)
  const completedResults = challenges.reduce(
    (sum, challenge) => sum + challenge.results.filter((result) => result.completed).length,
    0
  )
  const rewardsPublished = challenges.filter((challenge) => Boolean(challenge.reward)).length

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Desafios"
        description="Um módulo comercial para puxar performance da equipe sem transformar gestão em planilha."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Desafios ativos</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{activeChallenges.length}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Campanhas rodando agora para manter o time em ritmo comercial.
          </p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Equipe engajada</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{professionalCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Profissionais aptos a aparecer em ranking, metas e premiações.
          </p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Metas batidas</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{completedResults}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Conclusões registradas até aqui nos desafios ativos e encerrados.
          </p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Prêmios publicados</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{rewardsPublished}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Recompensas prontas para reforçar cultura de resultado na apresentação.
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Desafios em andamento e histórico</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Mesmo simplificado por enquanto, este módulo já mostra como o produto ajuda a puxar faturamento e comportamento de equipe.
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              Estrutura pronta para demo
            </span>
          </div>

          {challenges.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-secondary/20 p-8 text-center">
              <Trophy className="mx-auto h-10 w-10 text-muted-foreground/60" />
              <p className="mt-4 text-lg font-semibold text-foreground">Nenhum desafio criado ainda</p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                A estrutura do módulo já está pronta para mostrar ranking, progresso e recompensa. Para a apresentação, você já consegue usar os modelos sugeridos ao lado como narrativa de produto.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-5">
              {challenges.map((challenge) => {
                const leader = challenge.results[0]
                const totalTarget = Number(challenge.targetValue)

                return (
                  <article key={challenge.id} className="rounded-2xl border border-border/70 bg-secondary/25">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 px-5 py-5">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={cn(
                          'mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl',
                          challenge.active ? 'bg-amber-500/15 text-amber-300' : 'bg-secondary text-muted-foreground'
                        )}>
                          <Trophy className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-foreground">{challenge.title}</h3>
                            <span className={cn(
                              'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold',
                              challenge.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-secondary text-muted-foreground'
                            )}>
                              {challenge.active ? <Flame className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                              {challenge.active ? 'Ativo agora' : 'Encerrado'}
                            </span>
                            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
                              {templateTypeLabel(challenge.type)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {challenge.description || 'Desafio configurado para estimular resultado da equipe com leitura rápida e recompensa clara.'}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-right">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Meta do desafio</p>
                        <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(totalTarget)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(challenge.startDate)} até {formatDate(challenge.endDate)}
                        </p>
                      </div>
                    </div>

                    {(challenge.reward || leader) && (
                      <div className="grid gap-4 border-b border-border/70 px-5 py-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                          <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber-200">
                            <Gift className="h-4 w-4" />
                            Recompensa
                          </p>
                          <p className="mt-2 text-sm leading-6 text-amber-100/90">
                            {challenge.reward || 'Defina um prêmio simples e visível para manter o desafio com cara de campanha real.'}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                          <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Crown className="h-4 w-4 text-amber-300" />
                            Quem está liderando
                          </p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {leader
                              ? `${leader.professional.name} está na frente com ${formatCurrency(Number(leader.achievedValue))}, alcançando ${formatPercent((Number(leader.achievedValue) / totalTarget) * 100, 0)} da meta.`
                              : 'Ainda não existe movimentação suficiente para apontar um líder neste desafio.'}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="px-5 py-5">
                      <p className="mb-4 text-sm font-semibold text-foreground">Ranking do desafio</p>
                      <div className="space-y-3">
                        {challenge.results.map((result, index) => {
                          const achieved = Number(result.achievedValue)
                          const progress = totalTarget > 0 ? Math.min(100, (achieved / totalTarget) * 100) : 0

                          return (
                            <div key={result.id} className="rounded-2xl border border-border/70 bg-background/50 p-4">
                              <div className="flex items-center gap-3">
                                <span className={cn(
                                  'flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold',
                                  index === 0
                                    ? 'bg-amber-500/15 text-amber-300'
                                    : index === 1
                                      ? 'bg-slate-400/15 text-slate-300'
                                      : index === 2
                                        ? 'bg-orange-700/15 text-orange-300'
                                        : 'bg-secondary text-muted-foreground'
                                )}>
                                  {index === 0 ? <Crown className="h-4 w-4" /> : index === 1 ? <Medal className="h-4 w-4" /> : index + 1}
                                </span>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-foreground">{result.professional.name}</p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {result.completed ? 'Meta já concluída neste desafio.' : 'Ainda disputando a liderança.'}
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-sm font-semibold tabular-nums text-foreground">
                                        {formatCurrency(achieved)}
                                      </p>
                                      <p className={cn(
                                        'mt-1 text-xs font-medium',
                                        result.completed ? 'text-emerald-300' : 'text-muted-foreground'
                                      )}>
                                        {formatPercent(progress, 0)}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                                    <div
                                      className={cn(
                                        'h-full rounded-full transition-all duration-700',
                                        result.completed
                                          ? 'bg-emerald-500'
                                          : index === 0
                                            ? 'bg-amber-400'
                                            : 'bg-primary'
                                      )}
                                      style={{ width: `${progress}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Templates prontos para demo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Estruturas simples, com cara de produto, para mostrar o potencial do módulo sem precisar construir toda a lógica agora.
            </p>

            <div className="mt-5 space-y-3">
              {challengeTemplates.map((template) => (
                <div key={template.title} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">{template.title}</p>
                    <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-muted-foreground">
                      {templateTypeLabel(template.type)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{template.helper}</p>
                  <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                    <p>Meta sugerida: <strong className="text-foreground">{template.target}</strong></p>
                    <p>Recompensa: <strong className="text-foreground">{template.reward}</strong></p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Base de competição do mês</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Uma leitura rápida para conectar desafios ao faturamento real na apresentação.
            </p>

            {leaderboard.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-border bg-secondary/20 p-5 text-sm text-muted-foreground">
                Ainda não há receita lançada no mês para sugerir uma disputa inicial.
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {leaderboard.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{entry.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.position === 1 ? 'Liderando o mês' : `Posição ${entry.position} no mês`}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-foreground">{formatCurrency(entry.revenue)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Link
              href="/equipe/profissionais"
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary"
            >
              Ver equipe completa
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Por que este módulo vende</h2>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p className="inline-flex items-start gap-2">
                <Target className="mt-0.5 h-4 w-4 text-primary" />
                Mostra que o BarberOS não cuida só de lançamento, mas também de motivação comercial.
              </p>
              <p className="inline-flex items-start gap-2">
                <Users className="mt-0.5 h-4 w-4 text-primary" />
                Liga resultado da equipe com metas e reconhecimento, algo raro em sistemas pequenos.
              </p>
              <p className="inline-flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
                Dá argumento de valor na apresentação mesmo antes da automação completa entrar.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
