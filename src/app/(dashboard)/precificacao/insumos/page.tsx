import type { Metadata } from 'next'
import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import {
  ArrowUpRight,
  Boxes,
  Package,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react'

export const metadata: Metadata = { title: 'Insumos' }

const starterSupplies = [
  { name: 'Pomada modeladora', unit: 'un', cost: 'R$ 12,00', useCase: 'Corte tradicional, acabamento e venda de balcão' },
  { name: 'Óleo de barba', unit: 'ml', cost: 'R$ 0,08', useCase: 'Barba completa, hidratação e upsell' },
  { name: 'Lâmina descartável', unit: 'un', cost: 'R$ 1,50', useCase: 'Barba, acabamento e limpeza' },
]

export default async function InsumosPage() {
  const session = await requireSession()

  const supplies = await prisma.supply.findMany({
    where: { barbershopId: session.user.barbershopId },
    include: {
      serviceInputs: { include: { service: true } },
    },
    orderBy: { name: 'asc' },
  })

  const linkedSupplies = supplies.filter((supply) => supply.serviceInputs.length > 0).length
  const orphanSupplies = supplies.length - linkedSupplies
  const averageCost = supplies.reduce((sum, supply) => sum + Number(supply.unitCost), 0) / Math.max(supplies.length, 1)
  const mostConnectedSupply = [...supplies].sort(
    (left, right) => right.serviceInputs.length - left.serviceInputs.length
  )[0]

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Precificação"
        description="A base de custo do produto: simples agora, mas com estrutura suficiente para uma demo convincente."
      />

      <SectionTabs
        currentPath="/precificacao/insumos"
        items={[
          {
            href: '/precificacao',
            label: 'Visão geral',
            helper: 'Resumo do catálogo, custos e atalhos de navegação.',
          },
          {
            href: '/precificacao/servicos',
            label: 'Serviços e margem',
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Insumos cadastrados</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{supplies.length}</p>
          <p className="mt-2 text-sm text-muted-foreground">Base mínima para conectar custo a serviços e margem.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Vinculados a serviços</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{linkedSupplies}</p>
          <p className="mt-2 text-sm text-muted-foreground">Itens que já alimentam precificação de forma real.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Custo unitário médio</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{formatCurrency(averageCost)}</p>
          <p className="mt-2 text-sm text-muted-foreground">Boa referência para mostrar disciplina operacional na demo.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Itens sem uso</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{orphanSupplies}</p>
          <p className="mt-2 text-sm text-muted-foreground">Insumos que ainda podem ser ligados ao catálogo depois.</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Base de insumos</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                O objetivo aqui é mostrar que a precificação do BarberOS tem fundamento de custo, não chute.
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              Estrutura funcional
            </span>
          </div>

          {supplies.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-secondary/20 p-8">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Zap className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-lg font-semibold text-foreground">Nenhum insumo cadastrado ainda</p>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    A página não fica vazia: ela já apresenta uma estrutura real de custo e mostra como o módulo vai evoluir sem precisar de lógica pesada agora.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {starterSupplies.map((supply) => (
                  <div key={supply.name} className="rounded-2xl border border-border/70 bg-background/50 p-4">
                    <p className="text-sm font-semibold text-foreground">{supply.name}</p>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <p>Unidade: <strong className="text-foreground">{supply.unit}</strong></p>
                      <p>Custo sugerido: <strong className="text-foreground">{supply.cost}</strong></p>
                      <p>Uso típico: <strong className="text-foreground">{supply.useCase}</strong></p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-2xl border border-border/70">
              <table className="w-full data-table">
                <thead className="bg-secondary/30">
                  <tr className="border-b border-border/70">
                    <th className="px-5 py-3 text-left">Insumo</th>
                    <th className="px-5 py-3 text-left">Unidade</th>
                    <th className="px-5 py-3 text-right">Custo unitário</th>
                    <th className="px-5 py-3 text-left">Usado em</th>
                  </tr>
                </thead>
                <tbody>
                  {supplies.map((supply) => (
                    <tr key={supply.id} className="border-b border-border/50 bg-card/80 transition-colors hover:bg-secondary/20">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <Package className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{supply.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {supply.serviceInputs.length > 0
                                ? `${supply.serviceInputs.length} serviço${supply.serviceInputs.length > 1 ? 's' : ''} dependem deste item`
                                : 'Ainda não vinculado a nenhum serviço'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-muted-foreground">{supply.unit}</td>
                      <td className="px-5 py-4 text-right text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(Number(supply.unitCost))}
                      </td>
                      <td className="px-5 py-4 text-sm text-muted-foreground">
                        {supply.serviceInputs.length === 0
                          ? '—'
                          : supply.serviceInputs.map((input) => input.service.name).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Insumo-chave</h2>
            {mostConnectedSupply ? (
              <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/10 p-5">
                <p className="text-sm font-semibold text-sky-700">{mostConnectedSupply.name}</p>
                <p className="mt-3 text-3xl font-semibold text-foreground">{mostConnectedSupply.serviceInputs.length}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  serviço{mostConnectedSupply.serviceInputs.length > 1 ? 's' : ''} dependem deste item. Ótimo para mostrar como custo conversa com catálogo.
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-border bg-secondary/20 p-5 text-sm text-muted-foreground">
                Assim que os insumos forem lançados, este painel mostra quais itens mais impactam o catálogo.
              </div>
            )}
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Por que isso vende</h2>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p className="inline-flex items-start gap-2">
                <Boxes className="mt-0.5 h-4 w-4 text-primary" />
                Tira a precificação do campo do palpite e leva para uma conversa de custo real.
              </p>
              <p className="inline-flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                Reforça a percepção de sistema profissional, não só financeiro.
              </p>
              <p className="inline-flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
                Sustenta o discurso de margem, precificação e lucro sem precisar de estoque completo agora.
              </p>
            </div>
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Próximo passo recomendado</h2>
            <div className="mt-4 rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                <TrendingUp className="h-4 w-4 text-primary" />
                Fechar o ciclo com serviços
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Depois de cadastrar insumos, a apresentação fica mais forte quando você mostra a margem por serviço na tela ao lado.
              </p>
            </div>

            <Link
              href="/precificacao/servicos"
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary"
            >
              Ver serviços e margem
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </section>
        </aside>
      </div>
    </div>
  )
}
