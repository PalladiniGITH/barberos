import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { cn, formatCurrency, formatPercent } from '@/lib/utils'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { ArrowUpRight, Boxes, Receipt, Scissors, ShieldCheck, Sparkles, TrendingUp, Wallet } from 'lucide-react'

export const metadata: Metadata = { title: 'Precificação' }

export default async function PrecificacaoPage() {
  const session = await requireSession()

  const [services, supplies] = await Promise.all([
    prisma.service.findMany({
      where: { barbershopId: session.user.barbershopId },
      include: {
        pricingRule: true,
        serviceInputs: { include: { supply: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.supply.findMany({
      where: { barbershopId: session.user.barbershopId },
      include: {
        serviceInputs: { include: { service: true } },
      },
      orderBy: { name: 'asc' },
    }),
  ])

  const enrichedServices = services.map((service) => {
    const price = Number(service.price)
    const rule = service.pricingRule

    const inputCost = service.serviceInputs.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.supply.unitCost),
      0
    )
    const commissionRate = rule ? Number(rule.commissionPercent) / 100 : 0.4
    const cardFeeRate = rule ? Number(rule.cardFeePercent) / 100 : 0.03
    const taxRate = rule ? Number(rule.taxPercent) / 100 : 0
    const directCost = rule ? Number(rule.directCost) : 0

    const commissionCost = price * commissionRate
    const cardFee = price * cardFeeRate
    const tax = price * taxRate
    const totalCost = inputCost + commissionCost + cardFee + tax + directCost
    const margin = price - totalCost
    const marginPercent = price > 0 ? (margin / price) * 100 : 0

    return {
      ...service,
      cardFee,
      commissionCost,
      commissionRate,
      directCost,
      inputCost,
      margin,
      marginPercent,
      tax,
      taxRate,
      totalCost,
    }
  })

  const activeServices = enrichedServices.filter((service) => service.active).length
  const linkedSupplies = supplies.filter((supply) => supply.serviceInputs.length > 0).length
  const averagePrice =
    enrichedServices.reduce((sum, service) => sum + Number(service.price), 0) / Math.max(enrichedServices.length, 1)
  const averageMargin =
    enrichedServices.reduce((sum, service) => sum + service.marginPercent, 0) / Math.max(enrichedServices.length, 1)
  const attentionServices = enrichedServices.filter((service) => service.marginPercent < 20).length
  const bestService = [...enrichedServices].sort((left, right) => right.marginPercent - left.marginPercent)[0]
  const bestSupply = [...supplies].sort((left, right) => right.serviceInputs.length - left.serviceInputs.length)[0]

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Precificação"
        description="Uma navegação comercial que deixa claro onde está a margem, onde está o custo e onde está o ganho."
      />

      <SectionTabs
        currentPath="/precificacao"
        items={[
          {
            href: '/precificacao',
            label: 'Visão geral',
            helper: 'Resumo do catálogo, custos e atalhos de navegação.',
          },
          {
            href: '/precificacao/servicos',
            label: 'Serviços',
            helper: 'Preço, custo e leitura de lucro por serviço.',
          },
          {
            href: '/precificacao/insumos',
            label: 'Insumos',
            helper: 'Base de custo e relação com os serviços.',
          },
          {
            href: '/precificacao/resultado',
            label: 'Resultado',
            helper: 'Margem consolidada e leitura de resultado.',
          },
        ]}
      />

      <section className="dashboard-panel dashboard-spotlight overflow-hidden p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-200/70">
              Base de precificação
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
              {formatCurrency(averagePrice)}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              A tela de entrada resume quanto o catálogo vale, quanto custa operar e para onde a margem está indo.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              <Scissors className="h-3.5 w-3.5" />
              {activeServices} serviços ativos
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              <Boxes className="h-3.5 w-3.5" />
              {linkedSupplies} insumos conectados
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              <TrendingUp className="h-3.5 w-3.5" />
              {formatPercent(averageMargin, 0)} de margem média
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Serviços ativos</p>
            <p className="mt-3 text-2xl font-semibold text-white">{services.length}</p>
            <p className="mt-1 text-xs text-slate-400">Catálogo pronto para operar.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Insumos cadastrados</p>
            <p className="mt-3 text-2xl font-semibold text-white">{supplies.length}</p>
            <p className="mt-1 text-xs text-slate-400">Base de custo do catálogo.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Preço médio</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(averagePrice)}</p>
            <p className="mt-1 text-xs text-slate-400">Referência comercial do salão.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Margem média</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatPercent(averageMargin, 0)}</p>
            <p className="mt-1 text-xs text-slate-400">Leitura resumida do resultado.</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link href="/precificacao/servicos" className="dashboard-panel p-5 transition-transform hover:-translate-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Serviços</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{services.length}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Leitura de preço, custo e margem por serviço.
          </p>
          <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
            Abrir leitura de serviços
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </Link>

        <Link href="/precificacao/insumos" className="dashboard-panel p-5 transition-transform hover:-translate-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Insumos</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{supplies.length}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Base de custo conectada ao catálogo de serviços.
          </p>
          <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
            Ver base de custos
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </Link>

        <Link href="/precificacao/resultado" className="dashboard-panel p-5 transition-transform hover:-translate-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Resultado</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{formatPercent(averageMargin, 0)}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Margem consolidada e leitura final do catálogo.
          </p>
          <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
            Abrir consolidação
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Leitura comercial do catálogo</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Um caminho curto para mostrar que precificação no produto é decisão financeira, não cadastro solto.
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              Pronto para demo
            </span>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-secondary/25 p-5">
              <p className="text-sm font-semibold text-foreground">Serviço mais forte</p>
              {bestService ? (
                <>
                  <p className="mt-3 text-2xl font-semibold text-foreground">{bestService.name}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatPercent(bestService.marginPercent, 0)} de margem e {formatCurrency(bestService.margin)} de ganho estimado.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Cadastre serviços para exibir a leitura de margem do catálogo.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-border/70 bg-secondary/25 p-5">
              <p className="text-sm font-semibold text-foreground">Insumo mais conectado</p>
              {bestSupply ? (
                <>
                  <p className="mt-3 text-2xl font-semibold text-foreground">{bestSupply.name}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Presente em {bestSupply.serviceInputs.length} serviço{bestSupply.serviceInputs.length === 1 ? '' : 's'} do catálogo.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Assim que os insumos entrarem, a tela aponta quais itens mais impactam o preço final.
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/precificacao/resultado"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Ver resultado consolidado
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link
              href="/precificacao/servicos"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Revisar serviços
            </Link>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Leituras rápidas</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Wallet className="h-4 w-4 text-primary" />
                  O que vende aqui
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Preço, custo e margem aparecem na mesma narrativa comercial, sem depender de planilha.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Por que importa
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  O salão enxerga onde dá para proteger lucro antes de negociar preço no escuro.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Próximo passo
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  A aba de resultado fecha o ciclo e transforma a precificação em decisão de margem.
                </p>
              </div>
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Serviços que pedem atenção</h2>
            <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4">
              <p className={cn(
                'inline-flex items-center gap-2 text-sm font-semibold',
                attentionServices > 0 ? 'text-rose-700' : 'text-emerald-700'
              )}>
                <Receipt className="h-4 w-4" />
                {attentionServices > 0
                  ? `${attentionServices} serviço${attentionServices > 1 ? 's' : ''} com margem abaixo de 20%`
                  : 'Nenhum serviço abaixo de 20% de margem'}
              </p>
              <p className="mt-2 text-sm leading-6 text-rose-100/85">
                Quando existe pressão de margem, a tela já entrega o discurso de ajuste de preço, comissão ou insumo.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
