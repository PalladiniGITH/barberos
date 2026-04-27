import type { Metadata } from 'next'
import Link from 'next/link'
import { assertAdministrativeRole, requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { cn, formatCurrency, formatPercent } from '@/lib/utils'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { ArrowUpRight, Boxes, CheckCircle2, Receipt, Scissors, TrendingUp, Wallet } from 'lucide-react'

export const metadata: Metadata = { title: 'Resultado da Precificação' }

export default async function ResultadoPage() {
  const session = await requireSession()
  assertAdministrativeRole(session.user.role, 'Sem permissao para consultar o resultado de precificacao da barbearia.')

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

  const grossPotential = enrichedServices.reduce((sum, service) => sum + Number(service.price), 0)
  const totalCostBase = enrichedServices.reduce((sum, service) => sum + service.totalCost, 0)
  const estimatedResult = enrichedServices.reduce((sum, service) => sum + service.margin, 0)
  const averageMargin = enrichedServices.reduce((sum, service) => sum + service.marginPercent, 0) / Math.max(enrichedServices.length, 1)
  const lowMarginServices = enrichedServices.filter((service) => service.marginPercent < 20)
  const bestService = [...enrichedServices].sort((left, right) => right.marginPercent - left.marginPercent)[0]
  const worstService = [...enrichedServices].sort((left, right) => left.marginPercent - right.marginPercent)[0]
  const totalDuration = enrichedServices.reduce((sum, service) => sum + service.duration, 0)
  const resultPerHour = totalDuration > 0 ? estimatedResult / (totalDuration / 60) : 0

  const supplyCosts = supplies
    .map((supply) => {
      const unitCost = Number(supply.unitCost)
      const totalCost = supply.serviceInputs.reduce((sum, item) => sum + Number(item.quantity) * unitCost, 0)

      return {
        id: supply.id,
        name: supply.name,
        totalCost,
        serviceCount: supply.serviceInputs.length,
      }
    })
    .sort((left, right) => right.totalCost - left.totalCost)

  const topCostSupply = supplyCosts[0]

  const hasServices = enrichedServices.length > 0

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Resultado da precificação"
        description="Consolidação de margem, custo e resultado para acompanhar o retorno real do catálogo."
      />

      <SectionTabs
        currentPath="/precificacao/resultado"
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
            helper: 'Margem consolidada e leitura final do catálogo.',
          },
        ]}
      />

      <section className="dashboard-panel dashboard-spotlight overflow-hidden p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-200/70">
              Resultado consolidado
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
              {formatCurrency(estimatedResult)}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Consolide margem estimada, custo total e retorno por hora para revisar a rentabilidade do catálogo.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              <Wallet className="h-3.5 w-3.5" />
              {formatPercent(averageMargin, 0)} de margem média
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              <TrendingUp className="h-3.5 w-3.5" />
              {formatCurrency(resultPerHour)} por hora
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              <Receipt className="h-3.5 w-3.5" />
              {lowMarginServices.length} serviços críticos
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Potencial bruto</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(grossPotential)}</p>
            <p className="mt-1 text-xs text-slate-400">Receita teórica do catálogo atual.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Custo total estimado</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(totalCostBase)}</p>
            <p className="mt-1 text-xs text-slate-400">Insumos, comissão, taxa e custos diretos.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Resultado estimado</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(estimatedResult)}</p>
            <p className="mt-1 text-xs text-slate-400">O que sobra depois do custo.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-slate-300">Serviços críticos</p>
            <p className="mt-3 text-2xl font-semibold text-white">{lowMarginServices.length}</p>
            <p className="mt-1 text-xs text-slate-400">Itens abaixo de 20% de margem.</p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Resultado por serviço</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Compare preço, custo e margem para revisar comissão, mix e rentabilidade dos serviços.
              </p>
            </div>
            {bestService && (
              <span className="surface-chip border-emerald-500/20 bg-emerald-500/10 text-emerald-700">
                Melhor margem: {bestService.name}
              </span>
            )}
          </div>

          {!hasServices ? (
            <div className="tonal-note mt-6 border-dashed p-8">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Scissors className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-lg font-semibold text-foreground">Nenhum serviço cadastrado ainda</p>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Assim que o catálogo entrar, esta tela consolida resultado, custo e margem de forma comparável entre serviços.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="table-shell mt-6 overflow-hidden">
                <table className="w-full data-table">
                  <thead className="bg-secondary/30">
                    <tr className="border-b border-border/70">
                      <th className="px-5 py-3 text-left">Serviço</th>
                      <th className="px-5 py-3 text-right">Preço</th>
                      <th className="px-5 py-3 text-right">Custo</th>
                      <th className="px-5 py-3 text-right">Margem</th>
                      <th className="px-5 py-3 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedServices
                      .sort((left, right) => right.marginPercent - left.marginPercent)
                      .map((service) => (
                        <tr key={service.id} className="border-b border-border/50 bg-card/80 transition-colors hover:bg-secondary/20">
                          <td className="px-5 py-4">
                            <p className="text-sm font-semibold text-foreground">{service.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{service.duration} min · {service.serviceInputs.length} insumos</p>
                          </td>
                          <td className="px-5 py-4 text-right text-sm font-semibold tabular-nums text-foreground">
                            {formatCurrency(Number(service.price))}
                          </td>
                          <td className="px-5 py-4 text-right text-sm font-semibold tabular-nums text-foreground">
                            {formatCurrency(service.totalCost)}
                          </td>
                          <td className={cn(
                            'px-5 py-4 text-right text-sm font-semibold tabular-nums',
                            service.margin >= 0 ? 'text-emerald-500' : 'text-rose-400'
                          )}>
                            {formatCurrency(service.margin)}
                          </td>
                          <td className="px-5 py-4 text-right text-sm font-semibold tabular-nums text-foreground">
                            {formatPercent(service.marginPercent, 0)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="tonal-note-strong">
                  <p className="text-sm font-semibold text-foreground">Serviço mais rentável</p>
                  {bestService ? (
                    <>
                      <p className="mt-3 text-2xl font-semibold text-foreground">{bestService.name}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {formatPercent(bestService.marginPercent, 0)} de margem e {formatCurrency(bestService.margin)} de resultado.
                      </p>
                    </>
                  ) : null}
                </div>

                <div className="tonal-note">
                  <p className="text-sm font-semibold text-foreground">Serviço mais pressionado</p>
                  {worstService ? (
                    <>
                      <p className="mt-3 text-2xl font-semibold text-foreground">{worstService.name}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {formatPercent(worstService.marginPercent, 0)} de margem e {formatCurrency(worstService.margin)} de resultado.
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </section>

        <aside className="space-y-5">
          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Resumo de margem</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Resultado por hora
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {formatCurrency(resultPerHour)} por hora de catálogo ajuda a explicar o ganho da operação com uma régua comercial simples.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Boxes className="h-4 w-4 text-primary" />
                  Principais custos
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {topCostSupply
                    ? `${topCostSupply.name} é o insumo que mais pesa no catálogo, com ${formatCurrency(topCostSupply.totalCost)} de custo alocado.`
                    : 'O custo concentrado aparece assim que os insumos são vinculados aos serviços.'}
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Leitura rápida
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {lowMarginServices.length > 0
                    ? 'Há serviços que pedem ajuste de preço ou estrutura de custo. Esse é o tipo de insight que deixa a demo convincente.'
                    : 'O catálogo já está saudável o suficiente para mostrar consistência e proteção de lucro.'}
                </p>
              </div>
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Próximo passo comercial</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A melhor forma de fechar a narrativa é voltar aos serviços e revisar onde a margem nasce.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/precificacao/servicos"
                className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
              >
                Revisar serviços
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link
                href="/precificacao/insumos"
                className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
              >
                Revisar insumos
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
