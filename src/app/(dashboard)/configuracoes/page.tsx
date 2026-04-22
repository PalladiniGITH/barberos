import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ROLE_LABELS, formatCurrency, formatPercent } from '@/lib/utils'
import { PageHeader } from '@/components/layout/page-header'
import {
  ArrowUpRight,
  Building2,
  Globe2,
  Lock,
  Scissors,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Target,
  Trophy,
  Users,
} from 'lucide-react'
import { findSessionProfessional } from '@/lib/professionals/session-professional'
import {
  PROFESSIONAL_ATTENDANCE_SCOPE_LABELS,
  resolveProfessionalAttendanceScope,
} from '@/lib/professionals/operational-config'

export const metadata: Metadata = { title: 'Configuracoes' }

export default async function ConfiguracoesPage() {
  const session = await requireSession()

  if (session.user.role === 'BARBER') {
    const [barbershop, sessionProfessional] = await Promise.all([
      prisma.barbershop.findUnique({
        where: { id: session.user.barbershopId },
        select: {
          name: true,
          slug: true,
          phone: true,
          email: true,
          timezone: true,
          address: true,
        },
      }),
      findSessionProfessional({
        barbershopId: session.user.barbershopId,
        email: session.user.email,
        name: session.user.name,
      }),
    ])

    const attendanceScopeLabel = sessionProfessional
      ? PROFESSIONAL_ATTENDANCE_SCOPE_LABELS[
          resolveProfessionalAttendanceScope({
            acceptsSubscription: sessionProfessional.acceptsSubscription,
            acceptsWalkIn: sessionProfessional.acceptsWalkIn,
          })
        ]
      : 'Vinculo pendente'

    return (
      <div className="page-section mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          title="Minha conta"
          description="Seus dados de acesso e o perfil profissional usado para montar sua experiencia no sistema."
        />

        <div className="grid gap-4 md:grid-cols-3">
          <div className="dashboard-panel p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Perfil atual</p>
            <p className="mt-3 text-2xl font-semibold text-foreground">{ROLE_LABELS[session.user.role] ?? session.user.role}</p>
            <p className="mt-2 text-sm text-muted-foreground">Acesso focado na sua operacao individual.</p>
          </div>

          <div className="dashboard-panel p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Barbearia</p>
            <p className="mt-3 text-2xl font-semibold text-foreground">{barbershop?.name ?? 'BarberOS'}</p>
            <p className="mt-2 text-sm text-muted-foreground">Seu vinculo operacional atual dentro do sistema.</p>
          </div>

          <div className="dashboard-panel p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Escopo de atendimento</p>
            <p className="mt-3 text-2xl font-semibold text-foreground">{attendanceScopeLabel}</p>
            <p className="mt-2 text-sm text-muted-foreground">Regra usada para agenda, precificacao e leitura da sua operacao.</p>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
          <section className="dashboard-panel p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Meu perfil profissional</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Informacoes do seu acesso e do seu cadastro profissional, sem misturar configuracoes administrativas da barbearia.
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                Conta pessoal
              </span>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-border/70 bg-secondary/25 p-5">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Dados de acesso</p>
                </div>
                <div className="mt-4 grid gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Nome</p>
                    <p className="mt-1 font-medium text-foreground">{session.user.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Email</p>
                    <p className="mt-1 font-medium text-foreground">{session.user.email}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Barbearia</p>
                    <p className="mt-1 font-medium text-foreground">{barbershop?.name ?? 'BarberOS'}</p>
                    <p className="text-muted-foreground">{barbershop?.slug ?? session.user.barbershopSlug}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Fuso horario</p>
                    <p className="mt-1 font-medium text-foreground">{barbershop?.timezone ?? 'America/Sao_Paulo'}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/25 p-5">
                <div className="flex items-center gap-2">
                  <Scissors className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Configuracao profissional</p>
                </div>

                {sessionProfessional ? (
                  <div className="mt-4 grid gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Cadastro vinculado</p>
                      <p className="mt-1 font-medium text-foreground">{sessionProfessional.name}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Comissao</p>
                      <p className="mt-1 font-medium text-foreground">
                        {sessionProfessional.commissionRate ? formatPercent(Number(sessionProfessional.commissionRate), 0) : 'Nao definida'}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Precos avulsos</p>
                      <p className="mt-1 font-medium text-foreground">
                        Corte {formatCurrency(sessionProfessional.haircutPrice ? Number(sessionProfessional.haircutPrice) : null)}
                      </p>
                      <p className="text-muted-foreground">
                        Barba {formatCurrency(sessionProfessional.beardPrice ? Number(sessionProfessional.beardPrice) : null)} · Combo {formatCurrency(sessionProfessional.comboPrice ? Number(sessionProfessional.comboPrice) : null)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Contato operacional</p>
                      <p className="mt-1 font-medium text-foreground">{barbershop?.phone ?? 'Nao informado'}</p>
                      <p className="text-muted-foreground">{barbershop?.email ?? 'Nao informado'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-border bg-background/40 p-4 text-sm text-muted-foreground">
                    Seu usuario ainda nao esta ligado a um cadastro profissional ativo.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-border/70 bg-secondary/25 p-5">
              <h3 className="text-sm font-semibold text-foreground">Modulos liberados no seu perfil</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[
                  'Minha operacao',
                  'Minha agenda',
                  'Minhas metas',
                  'Meu desempenho',
                  'Minha conta',
                ].map((module) => (
                  <div key={module} className="rounded-2xl border border-border/70 bg-background/50 p-4">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <ShieldCheck className="h-4 w-4" />
                    </span>
                    <p className="mt-4 text-sm font-semibold text-foreground">{module}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Visao liberada para o seu dia a dia, sem ruido administrativo.
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="dashboard-panel p-6">
              <h2 className="text-lg font-semibold text-foreground">Atalhos da sua rotina</h2>
              <div className="mt-4 space-y-3">
                <Link
                  href="/dashboard"
                  className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/50"
                >
                  Abrir meu painel
                  <ArrowUpRight className="h-4 w-4 text-primary" />
                </Link>
                <Link
                  href="/agendamentos"
                  className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/50"
                >
                  Abrir minha agenda
                  <ArrowUpRight className="h-4 w-4 text-primary" />
                </Link>
                <Link
                  href="/equipe/desempenho"
                  className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/50"
                >
                  Ver meu desempenho
                  <ArrowUpRight className="h-4 w-4 text-primary" />
                </Link>
              </div>
            </section>

            <section className="dashboard-panel p-6">
              <h2 className="text-lg font-semibold text-foreground">Referencia da barbearia</h2>
              <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                <p className="inline-flex items-start gap-2">
                  <Building2 className="mt-0.5 h-4 w-4 text-primary" />
                  {barbershop?.address ?? 'Endereco ainda nao informado para esta conta.'}
                </p>
                <p className="inline-flex items-start gap-2">
                  <Globe2 className="mt-0.5 h-4 w-4 text-primary" />
                  Slug da operacao: {barbershop?.slug ?? session.user.barbershopSlug}
                </p>
                <p className="inline-flex items-start gap-2">
                  <Lock className="mt-0.5 h-4 w-4 text-primary" />
                  Seu acesso fica restrito aos modulos pessoais e a sua propria leitura operacional.
                </p>
              </div>
            </section>
          </aside>
        </div>
      </div>
    )
  }

  const [barbershop, userCount, professionalCount, serviceCount, supplyCount, challengeCount] = await Promise.all([
    prisma.barbershop.findUnique({ where: { id: session.user.barbershopId } }),
    prisma.user.count({ where: { barbershopId: session.user.barbershopId, active: true } }),
    prisma.professional.count({ where: { barbershopId: session.user.barbershopId } }),
    prisma.service.count({ where: { barbershopId: session.user.barbershopId } }),
    prisma.supply.count({ where: { barbershopId: session.user.barbershopId } }),
    prisma.challenge.count({ where: { barbershopId: session.user.barbershopId } }),
  ])

  const moduleStatus = [
    {
      title: 'Painel do negocio',
      helper: 'Resultado, meta e prioridades do mes em poucos segundos.',
      icon: Sparkles,
      tone: 'bg-emerald-500/10 text-emerald-300',
    },
    {
      title: 'Caixa e lucro',
      helper: 'Entradas e saidas para proteger margem e previsibilidade.',
      icon: ShieldCheck,
      tone: 'bg-sky-500/10 text-sky-300',
    },
    {
      title: 'Time em acao',
      helper: 'Profissionais, metas e campanhas para puxar resultado.',
      icon: Users,
      tone: 'bg-primary/10 text-primary',
    },
    {
      title: 'Preco e margem',
      helper: 'Estrutura pronta para mostrar rentabilidade sem excesso de complexidade.',
      icon: Scissors,
      tone: 'bg-amber-500/10 text-amber-200',
    },
    {
      title: 'Campanhas do time',
      helper: 'Camada comercial para acelerar vendas e engajamento.',
      icon: Trophy,
      tone: 'bg-orange-500/10 text-orange-200',
    },
    {
      title: 'Saude do negocio',
      helper: 'Leitura estrategica de crescimento, margem e consistencia.',
      icon: Target,
      tone: 'bg-violet-500/10 text-violet-200',
    },
  ]

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Conta da barbearia"
        description="Dados da operacao, acessos da equipe e a base da conta em um so lugar."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Usuarios ativos</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{userCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">Pessoas com acesso direto ao sistema.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Profissionais</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{professionalCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">Base operacional para equipe, ranking e metas.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Servicos + insumos</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{serviceCount + supplyCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">Estrutura ja suficiente para vender o modulo de margem.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Campanhas internas</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{challengeCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">Desafios cadastrados para reforcar narrativa de performance.</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_360px]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Perfil da barbearia</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Um resumo da conta para a apresentacao parecer operacao real, nao ambiente improvisado.
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              Conta pronta para apresentar
            </span>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-secondary/25 p-5">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Dados da operacao</p>
              </div>
              <div className="mt-4 grid gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Nome</p>
                  <p className="mt-1 font-medium text-foreground">{barbershop?.name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Slug</p>
                  <p className="mt-1 font-mono font-medium text-foreground">{barbershop?.slug}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Contato</p>
                  <p className="mt-1 font-medium text-foreground">{barbershop?.phone ?? '—'}</p>
                  <p className="text-muted-foreground">{barbershop?.email ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Endereco</p>
                  <p className="mt-1 font-medium text-foreground">{barbershop?.address ?? '—'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-secondary/25 p-5">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Dados da conta</p>
              </div>
              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Timezone</p>
                  <p className="mt-1 font-medium text-foreground">{barbershop?.timezone ?? 'America/Sao_Paulo'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status de onboarding</p>
                  <p className="mt-1 font-medium text-foreground">
                    {barbershop?.onboardingCompletedAt ? 'Concluido' : 'Pendente'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Usuario atual</p>
                  <p className="mt-1 font-medium text-foreground">{session.user.name}</p>
                  <p className="text-muted-foreground">{ROLE_LABELS[session.user.role] ?? session.user.role}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Identificador interno</p>
                  <p className="mt-1 font-mono text-xs text-foreground/80">{session.user.barbershopId}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-border/70 bg-secondary/25 p-5">
            <h3 className="text-sm font-semibold text-foreground">Modulos disponiveis</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {moduleStatus.map((module) => (
                <div key={module.title} className="rounded-2xl border border-border/70 bg-background/50 p-4">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${module.tone}`}>
                    <module.icon className="h-4 w-4" />
                  </span>
                  <p className="mt-4 text-sm font-semibold text-foreground">{module.title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{module.helper}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Seguranca e isolamento</h2>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p className="inline-flex items-start gap-2">
                <Lock className="mt-0.5 h-4 w-4 text-primary" />
                Cada barbearia enxerga apenas os proprios dados e acessos.
              </p>
              <p className="inline-flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                A estrutura ja nasce pronta para escalar como SaaS sem misturar operacoes.
              </p>
              <p className="inline-flex items-start gap-2">
                <Globe2 className="mt-0.5 h-4 w-4 text-primary" />
                Fuso por barbearia ja preparado para crescimento da base.
              </p>
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Proximos ajustes recomendados</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Tag className="h-4 w-4 text-primary" />
                  Precificacao mais forte
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Fechar o cadastro de servicos e insumos deixa a conversa de margem ainda mais forte.
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Users className="h-4 w-4 text-primary" />
                  Metas individuais
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Esse e o proximo ganho simples para fortalecer equipe e desafios.
                </p>
              </div>
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Navegacao util na demo</h2>
            <div className="mt-4 space-y-3">
              <Link
                href="/dashboard"
                className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/50"
              >
                Ver painel do negocio
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
              <Link
                href="/precificacao/servicos"
                className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/50"
              >
                Explorar precificacao
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
              <Link
                href="/indicadores"
                className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/50"
              >
                Ir para indicadores
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
