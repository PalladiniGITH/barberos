import type { Metadata } from 'next'
import Link from 'next/link'
import {
  saveOperationalCategoryFromForm,
  saveServiceFromForm,
  toggleOperationalCategoryStatusFromForm,
  toggleServiceStatusFromForm,
} from '@/actions/catalogo'
import { assertAdministrativeRole, requireSession } from '@/lib/auth'
import { PRODUCT_NAME } from '@/lib/branding'
import { prisma } from '@/lib/prisma'
import { cn, formatCurrency, formatPercent } from '@/lib/utils'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import {
  ArrowUpRight,
  Clock,
  Receipt,
  Scissors,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'

export const metadata: Metadata = { title: 'Serviços e Precificação' }

const starterServices = [
  { name: 'Corte Tradicional', price: 'R$ 45', duration: '30 min', margin: 'margem saudável' },
  { name: 'Corte + Barba', price: 'R$ 70', duration: '50 min', margin: 'bom potencial de upsell' },
  { name: 'Barba Express', price: 'R$ 35', duration: '20 min', margin: 'ótimo para aumentar ticket' },
]

type SupplyOption = {
  id: string
  name: string
  unit: string
}

type ExistingServiceInput = {
  supplyId: string
  quantity: unknown
}

function ServiceInputFields({
  existingInputs = [],
  supplies,
}: {
  existingInputs?: ExistingServiceInput[]
  supplies: SupplyOption[]
}) {
  const rows = Array.from({ length: Math.max(4, existingInputs.length + 1) }, (_, index) => existingInputs[index] ?? null)

  return (
    <div className="space-y-2">
      {rows.map((input, index) => (
        <div key={`${input?.supplyId ?? 'empty'}-${index}`} className="grid gap-2 md:grid-cols-[1fr_120px]">
          <select
            name="supplyId"
            defaultValue={input?.supplyId ?? ''}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
          >
            <option value="">Sem insumo</option>
            {supplies.map((supply) => (
              <option key={supply.id} value={supply.id}>{supply.name} ({supply.unit})</option>
            ))}
          </select>
          <input
            name="supplyQuantity"
            defaultValue={input ? Number(input.quantity).toString() : ''}
            inputMode="decimal"
            placeholder="Qtd."
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
          />
        </div>
      ))}
    </div>
  )
}

export default async function ServicosPage() {
  const session = await requireSession()
  assertAdministrativeRole(session.user.role, 'Sem permissao para consultar os servicos e precificacao da barbearia.')
  const canManageCatalog = ['OWNER', 'MANAGER'].includes(session.user.role)

  const [services, serviceCategories, supplies] = await Promise.all([
    prisma.service.findMany({
      where: { barbershopId: session.user.barbershopId },
      include: {
        category: true,
        pricingRule: true,
        serviceInputs: { include: { supply: true }, orderBy: { supply: { name: 'asc' } } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.operationalCategory.findMany({
      where: { barbershopId: session.user.barbershopId, type: 'SERVICE' },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    }),
    prisma.supply.findMany({
      where: { barbershopId: session.user.barbershopId, active: true },
      select: { id: true, name: true, unit: true },
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
      cardFeeRate,
      inputCost,
      margin,
      marginPercent,
      tax,
      taxRate,
      totalCost,
    }
  })

  const activeServicesCount = services.filter((service) => service.active).length
  const averagePrice = enrichedServices.reduce((sum, service) => sum + Number(service.price), 0) / Math.max(enrichedServices.length, 1)
  const averageMargin = enrichedServices.reduce((sum, service) => sum + service.marginPercent, 0) / Math.max(enrichedServices.length, 1)
  const attentionServices = enrichedServices.filter((service) => service.marginPercent < 20).length
  const bestService = [...enrichedServices].sort((left, right) => right.marginPercent - left.marginPercent)[0]

  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Precificação"
        description="Uma camada de margem e decisão comercial para mostrar que o produto não para no faturamento."
      />

      <SectionTabs
        currentPath="/precificacao/servicos"
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
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Serviços ativos</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{activeServicesCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {services.length - activeServicesCount > 0
              ? `${services.length - activeServicesCount} inativo${services.length - activeServicesCount > 1 ? 's' : ''} preservado${services.length - activeServicesCount > 1 ? 's' : ''} no historico.`
              : 'Catalogo principal que sustenta ticket e margem.'}
          </p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Preço médio</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{formatCurrency(averagePrice)}</p>
          <p className="mt-2 text-sm text-muted-foreground">Boa referência para posicionamento comercial do salão.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Margem média estimada</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{formatPercent(averageMargin, 0)}</p>
          <p className="mt-2 text-sm text-muted-foreground">O que o catálogo deixa em média após custo e comissão.</p>
        </div>

        <div className="dashboard-panel p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Serviços com atenção</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{attentionServices}</p>
          <p className="mt-2 text-sm text-muted-foreground">Itens que merecem revisão rápida de preço, comissão ou insumo.</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <section className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Serviços com leitura de margem</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A apresentação fica muito mais forte quando o sistema mostra quanto cada serviço realmente deixa no caixa.
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              Pronto para demo
            </span>
          </div>

          {canManageCatalog && (
            <div className="mt-6 rounded-2xl border border-border/70 bg-secondary/20 p-5">
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-foreground">Cadastrar ou importar servico</h3>
                <p className="text-sm text-muted-foreground">
                  Servicos migrados continuam editaveis: preco, duracao, categoria, status e insumos usados.
                </p>
              </div>
              <form action={saveServiceFromForm} className="mt-4 space-y-4">
                <input type="hidden" name="active" value="true" />
                <div className="grid gap-3 md:grid-cols-[1.4fr_0.7fr_0.7fr]">
                  <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Nome
                    <input
                      name="name"
                      required
                      placeholder="Corte, barba, combo..."
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none transition focus:border-primary"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Preco
                    <input
                      name="price"
                      required
                      inputMode="decimal"
                      placeholder="80,00"
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none transition focus:border-primary"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Duracao
                    <input
                      name="duration"
                      required
                      inputMode="numeric"
                      placeholder="45"
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none transition focus:border-primary"
                    />
                  </label>
                </div>
                <textarea
                  name="description"
                  placeholder="Descricao curta para recepcao e operacao"
                  className="min-h-20 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                />
                <select
                  name="categoryId"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                >
                  <option value="">Sem categoria</option>
                  {serviceCategories.filter((category) => category.active).map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Composicao de insumos</p>
                  <ServiceInputFields supplies={supplies} />
                </div>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover"
                >
                  Salvar servico
                </button>
              </form>
            </div>
          )}

          {enrichedServices.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-secondary/20 p-8">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Scissors className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-lg font-semibold text-foreground">Catálogo ainda não configurado</p>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Esta tela já está pronta para vender uma ideia forte: precificação com margem real. Enquanto o cadastro completo não entra, estes exemplos já sustentam a narrativa da demo.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {starterServices.map((service) => (
                  <div key={service.name} className="rounded-2xl border border-border/70 bg-background/50 p-4">
                    <p className="text-sm font-semibold text-foreground">{service.name}</p>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <p>Preço sugerido: <strong className="text-foreground">{service.price}</strong></p>
                      <p>Duração: <strong className="text-foreground">{service.duration}</strong></p>
                      <p>Leitura: <strong className="text-foreground">{service.margin}</strong></p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {enrichedServices.map((service) => (
                <article key={service.id} className="rounded-2xl border border-border/70 bg-secondary/25 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{service.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {service.description || 'Leitura direta de preço, custo e lucro para este serviço.'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-semibold text-muted-foreground">
                          {service.category?.name ?? 'Sem categoria'}
                        </span>
                        <span className={cn(
                          'rounded-full px-3 py-1 text-xs font-semibold',
                          service.active ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'
                        )}>
                          {service.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {service.duration} min
                      </span>
                      {canManageCatalog && (
                        <form action={toggleServiceStatusFromForm}>
                          <input type="hidden" name="id" value={service.id} />
                          <button type="submit" className="text-xs font-semibold text-primary">
                            {service.active ? 'Desativar' : 'Ativar'}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preço</p>
                      <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(Number(service.price))}</p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custo total</p>
                      <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(service.totalCost)}</p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Margem</p>
                      <p className={cn(
                        'mt-2 text-xl font-semibold',
                        service.margin >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      )}>
                        {formatCurrency(service.margin)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-border/70 bg-background/50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">Saúde de margem</p>
                      <span className={cn(
                        'rounded-full px-3 py-1 text-xs font-semibold',
                        service.marginPercent >= 35
                          ? 'bg-emerald-500/12 text-emerald-700'
                          : service.marginPercent >= 20
                            ? 'bg-amber-500/12 text-amber-700'
                            : 'bg-rose-500/12 text-rose-700'
                      )}>
                        {formatPercent(service.marginPercent, 0)}
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-700',
                          service.marginPercent >= 35
                            ? 'bg-emerald-500'
                            : service.marginPercent >= 20
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                        )}
                        style={{ width: `${Math.max(0, Math.min(100, service.marginPercent))}%` }}
                      />
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Insumos</span>
                        <span className="tabular-nums text-foreground">{formatCurrency(service.inputCost)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Comissão ({(service.commissionRate * 100).toFixed(0)}%)</span>
                        <span className="tabular-nums text-foreground">{formatCurrency(service.commissionCost)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Taxa cartão ({(service.cardFeeRate * 100).toFixed(1)}%)</span>
                        <span className="tabular-nums text-foreground">{formatCurrency(service.cardFee)}</span>
                      </div>
                      {service.tax > 0 && (
                        <div className="flex justify-between">
                          <span>Imposto ({(service.taxRate * 100).toFixed(1)}%)</span>
                          <span className="tabular-nums text-foreground">{formatCurrency(service.tax)}</span>
                        </div>
                      )}
                      {service.directCost > 0 && (
                        <div className="flex justify-between">
                          <span>Custo direto</span>
                          <span className="tabular-nums text-foreground">{formatCurrency(service.directCost)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {canManageCatalog && (
                    <details className="mt-5 rounded-2xl border border-border/70 bg-background/45 p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-foreground">Editar cadastro do servico</summary>
                      <form action={saveServiceFromForm} className="mt-4 space-y-4">
                        <input type="hidden" name="id" value={service.id} />
                        <input type="hidden" name="active" value={service.active ? 'true' : 'false'} />
                        <div className="grid gap-3 md:grid-cols-[1.3fr_0.6fr_0.6fr]">
                          <input name="name" defaultValue={service.name} required className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                          <input name="price" defaultValue={Number(service.price).toString()} required inputMode="decimal" className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                          <input name="duration" defaultValue={service.duration.toString()} required inputMode="numeric" className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                        </div>
                        <textarea
                          name="description"
                          defaultValue={service.description ?? ''}
                          className="min-h-20 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                        />
                        <select name="categoryId" defaultValue={service.categoryId ?? ''} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary">
                          <option value="">Sem categoria</option>
                          {serviceCategories.filter((category) => category.active || category.id === service.categoryId).map((category) => (
                            <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (inativa)'}</option>
                          ))}
                        </select>
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Composicao de insumos</p>
                          <ServiceInputFields supplies={supplies} existingInputs={service.serviceInputs} />
                        </div>
                        <button type="submit" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover">
                          Atualizar servico
                        </button>
                      </form>
                    </details>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          {canManageCatalog && (
            <section className="dashboard-panel p-6">
              <h2 className="text-lg font-semibold text-foreground">Categorias de servico</h2>
              <p className="mt-1 text-sm text-muted-foreground">Agrupe catalogos importados, combos e servicos manuais.</p>
              <form action={saveOperationalCategoryFromForm} className="mt-4 space-y-3">
                <input type="hidden" name="type" value="SERVICE" />
                <input type="hidden" name="active" value="true" />
                <input
                  name="name"
                  required
                  placeholder="Corte, barba, combo..."
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                />
                <button type="submit" className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover">
                  Criar categoria
                </button>
              </form>
              <div className="mt-4 space-y-2">
                {serviceCategories.map((category) => (
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
                        <input type="hidden" name="type" value="SERVICE" />
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
            <h2 className="text-lg font-semibold text-foreground">Destaque do catálogo</h2>
            {bestService ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
                <p className="text-sm font-semibold text-emerald-700">{bestService.name}</p>
                <p className="mt-3 text-3xl font-semibold text-foreground">{formatPercent(bestService.marginPercent, 0)}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Melhor leitura de margem no catálogo atual. Ótimo argumento para mostrar inteligência comercial do sistema.
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-border bg-secondary/20 p-5 text-sm text-muted-foreground">
                Assim que os serviços forem cadastrados, o módulo aponta quais são mais rentáveis e quais precisam de revisão.
              </div>
            )}
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Leituras rápidas</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Wallet className="h-4 w-4 text-primary" />
                  O que vende aqui
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Esta página mostra que o {PRODUCT_NAME} não só registra receita. Ele ajuda a decidir preço, margem e mix de serviços.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Próximo ganho simples
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Com o cadastro completo, esta área pode virar uma calculadora de preço ideal em poucos cliques.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Receipt className="h-4 w-4 text-primary" />
                  Navegação conectada
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Preço, insumo, comissão e meta passam a conversar com o restante do sistema em uma demo só.
                </p>
              </div>
            </div>

            <Link
              href="/precificacao/insumos"
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary"
            >
              Ver insumos
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </section>

          {attentionServices > 0 && (
            <section className="dashboard-panel p-6">
              <h2 className="text-lg font-semibold text-foreground">Serviços que merecem atenção</h2>
              <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-rose-700">
                  <TrendingDown className="h-4 w-4" />
                  {attentionServices} serviço{attentionServices > 1 ? 's' : ''} com margem abaixo de 20%
                </p>
                <p className="mt-2 text-sm leading-6 text-rose-100/85">
                  Essa leitura já dá um discurso muito forte na apresentação: o sistema ajuda a proteger lucro, não só a lançar valores.
                </p>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
