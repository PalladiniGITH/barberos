import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ROLE_LABELS } from '@/lib/utils'
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

export const metadata: Metadata = { title: 'Configurações' }

export default async function ConfiguracoesPage() {
  const session = await requireSession()

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
      title: 'Painel do negócio',
      helper: 'Resultado, meta e prioridades do mês em poucos segundos.',
      icon: Sparkles,
      tone: 'bg-emerald-500/10 text-emerald-300',
    },
    {
      title: 'Caixa e lucro',
      helper: 'Entradas e saídas para proteger margem e previsibilidade.',
      icon: ShieldCheck,
      tone: 'bg-sky-500/10 text-sky-300',
    },
    {
      title: 'Time em ação',
      helper: 'Profissionais, metas e campanhas para puxar resultado.',
      icon: Users,
      tone: 'bg-primary/10 text-primary',
    },
    {
      title: 'Preço e margem',
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
      title: 'Saúde do negócio',
      helper: 'Leitura estratégica de crescimento, margem e consistência.',
      icon: Target,
      tone: 'bg-violet-500/10 text-violet-200',
    },
  ]

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Conta da barbearia"
        description="Dados da operação, acessos da equipe e a base da conta em um só lugar."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Usuários ativos</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{userCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">Pessoas com acesso direto ao sistema.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Profissionais</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{professionalCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">Base operacional para equipe, ranking e metas.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Serviços + insumos</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{serviceCount + supplyCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">Estrutura já suficiente para vender o módulo de margem.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Campanhas internas</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{challengeCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">Desafios cadastrados para reforçar narrativa de performance.</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_360px]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Perfil da barbearia</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Um resumo da conta para a apresentação parecer operação real, não ambiente improvisado.
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
                <p className="text-sm font-semibold text-foreground">Dados da operação</p>
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
                  <p className="text-muted-foreground">Endereço</p>
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
                    {barbershop?.onboardingCompletedAt ? 'Concluído' : 'Pendente'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Usuário atual</p>
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
            <h3 className="text-sm font-semibold text-foreground">Módulos disponíveis</h3>
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
            <h2 className="text-lg font-semibold text-foreground">Segurança e isolamento</h2>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p className="inline-flex items-start gap-2">
                <Lock className="mt-0.5 h-4 w-4 text-primary" />
                Cada barbearia enxerga apenas os próprios dados e acessos.
              </p>
              <p className="inline-flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                A estrutura já nasce pronta para escalar como SaaS sem misturar operações.
              </p>
              <p className="inline-flex items-start gap-2">
                <Globe2 className="mt-0.5 h-4 w-4 text-primary" />
                Fuso por barbearia já preparado para crescimento da base.
              </p>
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Próximos ajustes recomendados</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Tag className="h-4 w-4 text-primary" />
                  Precificação mais forte
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Fechar o cadastro de serviços e insumos deixa a conversa de margem ainda mais forte.
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Users className="h-4 w-4 text-primary" />
                  Metas individuais
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Esse é o próximo ganho simples para fortalecer equipe e desafios.
                </p>
              </div>
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Navegação útil na demo</h2>
            <div className="mt-4 space-y-3">
              <Link
                href="/dashboard"
                className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/50"
              >
                Ver painel do negócio
                <ArrowUpRight className="h-4 w-4 text-primary" />
              </Link>
              <Link
                href="/precificacao/servicos"
                className="flex items-center justify-between rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/50"
              >
                Explorar precificação
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
