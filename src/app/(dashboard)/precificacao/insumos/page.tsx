import type { Metadata } from 'next'
import Link from 'next/link'
import { Fragment } from 'react'
import {
  saveOperationalCategoryFromForm,
  saveSupplyFromForm,
  toggleOperationalCategoryStatusFromForm,
  toggleSupplyStatusFromForm,
} from '@/actions/catalogo'
import { assertAdministrativeRole, requireSession } from '@/lib/auth'
import { PRODUCT_NAME } from '@/lib/branding'
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
  assertAdministrativeRole(session.user.role, 'Sem permissao para consultar os insumos e custos da barbearia.')
  const canManageCatalog = ['OWNER', 'MANAGER'].includes(session.user.role)

  const [supplies, supplyCategories] = await Promise.all([
    prisma.supply.findMany({
      where: { barbershopId: session.user.barbershopId },
      include: {
        category: true,
        serviceInputs: { include: { service: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.operationalCategory.findMany({
      where: { barbershopId: session.user.barbershopId, type: 'SUPPLY' },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    }),
  ])

  const linkedSupplies = supplies.filter((supply) => supply.serviceInputs.length > 0).length
  const orphanSupplies = supplies.length - linkedSupplies
  const inactiveSupplies = supplies.filter((supply) => !supply.active).length
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
          <p className="mt-2 text-sm text-muted-foreground">
            {inactiveSupplies > 0
              ? `${inactiveSupplies} inativo${inactiveSupplies > 1 ? 's' : ''} no cadastro.`
              : 'Insumos que ainda podem ser ligados ao catalogo depois.'}
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Base de insumos</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                O objetivo aqui é mostrar que a precificação do {PRODUCT_NAME} tem fundamento de custo, não chute.
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              Estrutura funcional
            </span>
          </div>

          {canManageCatalog && (
            <div className="mt-6 rounded-2xl border border-border/70 bg-secondary/20 p-5">
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-foreground">Cadastrar ou importar insumo</h3>
                <p className="text-sm text-muted-foreground">
                  Dados vindos de outro sistema entram como cadastro normal e continuam editaveis aqui.
                </p>
              </div>
              <form action={saveSupplyFromForm} className="mt-4 grid gap-3 md:grid-cols-[1.4fr_0.7fr_0.7fr_0.7fr]">
                <input type="hidden" name="active" value="true" />
                <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Nome
                  <input
                    name="name"
                    required
                    placeholder="Shampoo, pomada, toalha..."
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none transition focus:border-primary"
                  />
                </label>
                <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Unidade
                  <input
                    name="unit"
                    required
                    placeholder="ml, un, g"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none transition focus:border-primary"
                  />
                </label>
                <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Custo unit.
                  <input
                    name="unitCost"
                    required
                    inputMode="decimal"
                    placeholder="12,50"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none transition focus:border-primary"
                  />
                </label>
                <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Quantidade
                  <input
                    name="stockQuantity"
                    inputMode="decimal"
                    placeholder="10"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none transition focus:border-primary"
                  />
                </label>
                <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground md:col-span-3">
                  Categoria
                  <select
                    name="categoryId"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none transition focus:border-primary"
                  >
                    <option value="">Sem categoria</option>
                    {supplyCategories.filter((category) => category.active).map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="self-end rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover"
                >
                  Salvar insumo
                </button>
              </form>
            </div>
          )}

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
            <div className="mt-6 overflow-x-auto rounded-2xl border border-border/70">
              <table className="w-full data-table">
                <thead className="bg-secondary/30">
                  <tr className="border-b border-border/70">
                    <th className="px-5 py-3 text-left">Insumo</th>
                    <th className="px-5 py-3 text-left">Categoria</th>
                    <th className="px-5 py-3 text-left">Unidade</th>
                    <th className="px-5 py-3 text-right">Qtd.</th>
                    <th className="px-5 py-3 text-right">Custo unitário</th>
                    <th className="px-5 py-3 text-left">Usado em</th>
                    {canManageCatalog && <th className="px-5 py-3 text-right">Gestao</th>}
                  </tr>
                </thead>
                <tbody>
                  {supplies.map((supply) => (
                    <Fragment key={supply.id}>
                      <tr className="border-b border-border/50 bg-card/80 transition-colors hover:bg-secondary/20">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                              <Package className="h-4 w-4" />
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-foreground">{supply.name}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {supply.active ? 'Ativo no catalogo' : 'Inativo para operacao'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">{supply.category?.name ?? 'Sem categoria'}</td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">{supply.unit}</td>
                        <td className="px-5 py-4 text-right text-sm tabular-nums text-muted-foreground">
                          {supply.stockQuantity === null ? '-' : Number(supply.stockQuantity).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-5 py-4 text-right text-sm font-semibold tabular-nums text-foreground">
                          {formatCurrency(Number(supply.unitCost))}
                        </td>
                        <td className="px-5 py-4 text-sm text-muted-foreground">
                          {supply.serviceInputs.length === 0
                            ? '-'
                            : supply.serviceInputs.map((input) => input.service.name).join(', ')}
                        </td>
                        {canManageCatalog && (
                          <td className="px-5 py-4 text-right">
                            <form action={toggleSupplyStatusFromForm}>
                              <input type="hidden" name="id" value={supply.id} />
                              <button type="submit" className="text-xs font-semibold text-primary">
                                {supply.active ? 'Desativar' : 'Ativar'}
                              </button>
                            </form>
                          </td>
                        )}
                      </tr>
                      {canManageCatalog && (
                        <tr className="border-b border-border/50 bg-background/40">
                          <td colSpan={7} className="px-5 py-3">
                            <details className="rounded-xl border border-border/70 bg-secondary/20 p-3">
                              <summary className="cursor-pointer text-sm font-semibold text-foreground">Editar {supply.name}</summary>
                              <form action={saveSupplyFromForm} className="mt-4 grid gap-3 md:grid-cols-[1.4fr_0.6fr_0.7fr_0.7fr]">
                                <input type="hidden" name="id" value={supply.id} />
                                <input type="hidden" name="active" value={supply.active ? 'true' : 'false'} />
                                <input name="name" defaultValue={supply.name} required className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                                <input name="unit" defaultValue={supply.unit} required className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                                <input name="unitCost" defaultValue={Number(supply.unitCost).toString()} required inputMode="decimal" className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                                <input name="stockQuantity" defaultValue={supply.stockQuantity === null ? '' : Number(supply.stockQuantity).toString()} inputMode="decimal" className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                                <select name="categoryId" defaultValue={supply.categoryId ?? ''} className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary md:col-span-3">
                                  <option value="">Sem categoria</option>
                                  {supplyCategories.filter((category) => category.active || category.id === supply.categoryId).map((category) => (
                                    <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (inativa)'}</option>
                                  ))}
                                </select>
                                <button type="submit" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover">
                                  Atualizar
                                </button>
                              </form>
                            </details>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-5">
          {canManageCatalog && (
            <section className="dashboard-panel p-6">
              <h2 className="text-lg font-semibold text-foreground">Categorias de insumo</h2>
              <p className="mt-1 text-sm text-muted-foreground">Organize itens importados ou criados manualmente sem travar a base.</p>
              <form action={saveOperationalCategoryFromForm} className="mt-4 space-y-3">
                <input type="hidden" name="type" value="SUPPLY" />
                <input type="hidden" name="active" value="true" />
                <input
                  name="name"
                  required
                  placeholder="Higiene, finalizacao, descartaveis..."
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                />
                <button type="submit" className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover">
                  Criar categoria
                </button>
              </form>
              <div className="mt-4 space-y-2">
                {supplyCategories.map((category) => (
                  <div key={category.id} className="rounded-xl border border-border/70 bg-secondary/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{category.name}</p>
                        <p className="text-xs text-muted-foreground">{category.active ? 'Ativa' : 'Inativa'}</p>
                      </div>
                    <form action={toggleOperationalCategoryStatusFromForm}>
                        <input type="hidden" name="id" value={category.id} />
                        <button type="submit" className="text-xs font-semibold text-primary">
                          {category.active ? 'Desativar' : 'Ativar'}
                        </button>
                      </form>
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-primary">Editar nome</summary>
                      <form action={saveOperationalCategoryFromForm} className="mt-2 flex gap-2">
                        <input type="hidden" name="id" value={category.id} />
                        <input type="hidden" name="type" value="SUPPLY" />
                        <input type="hidden" name="active" value={category.active ? 'true' : 'false'} />
                        <input name="name" defaultValue={category.name} required className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary" />
                        <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                          Salvar
                        </button>
                      </form>
                    </details>
                  </div>
                ))}
              </div>
            </section>
          )}

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
