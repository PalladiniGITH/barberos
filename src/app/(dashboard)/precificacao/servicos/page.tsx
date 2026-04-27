import type { Metadata } from 'next'
import Link from 'next/link'
import {
  saveOperationalCategoryFromForm,
  saveServiceFromForm,
  toggleOperationalCategoryStatusFromForm,
  toggleServiceStatusFromForm,
} from '@/actions/catalogo'
import { assertAdministrativeRole, requireSession } from '@/lib/auth'
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

const catalogFieldClassName = 'min-w-0 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary'
const catalogLabelClassName = 'min-w-0 space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'

function ServiceInputFields({
  existingInputs = [],
  supplies,
}: {
  existingInputs?: ExistingServiceInput[]
  supplies: SupplyOption[]
}) {
  const rows = Array.from({ length: Math.max(4, existingInputs.length + 1) }, (_, index) => existingInputs[index] ?? null)

  return (
    <div className="min-w-0 space-y-2">
      {rows.map((input, index) => (
        <div
          key={`${input?.supplyId ?? 'empty'}-${index}`}
          className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_112px]"
        >
          <select
            name="supplyId"
            defaultValue={input?.supplyId ?? ''}
            className={catalogFieldClassName}
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
            className={catalogFieldClassName}
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
        <div className="executive-metric">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Serviços ativos</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{activeServicesCount}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {services.length - activeServicesCount > 0
              ? `${services.length - activeServicesCount} inativo${services.length - activeServicesCount > 1 ? 's' : ''} preservado${services.length - activeServicesCount > 1 ? 's' : ''} no historico.`
              : 'Catalogo principal que sustenta ticket e margem.'}
          </p>
        </div>

        <div className="executive-metric">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Preço médio</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{formatCurrency(averagePrice)}</p>
          <p className="mt-2 text-sm text-muted-foreground">Faixa útil para revisar posicionamento e consistência do catálogo.</p>
        </div>

        <div className="executive-metric">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Margem média estimada</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{formatPercent(averageMargin, 0)}</p>
          <p className="mt-2 text-sm text-muted-foreground">O que o catálogo deixa em média após custo e comissão.</p>
        </div>

        <div className="executive-metric">
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
                Compare preço, custo e margem para ajustar o catálogo com base em rentabilidade real.
              </p>
            </div>
          </div>

          {canManageCatalog && (
            <div className="tonal-note mt-6">
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-foreground">Cadastrar ou importar servico</h3>
                <p className="text-sm text-muted-foreground">
                  Servicos migrados continuam editaveis: preco, duracao, categoria, status e insumos usados.
                </p>
              </div>
              <form action={saveServiceFromForm} className="mt-4 min-w-0 space-y-4">
                <input type="hidden" name="active" value="true" />
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
                  <label className={catalogLabelClassName}>
                    Nome
                    <input
                      name="name"
                      required
                      placeholder="Corte, barba, combo..."
                      className={catalogFieldClassName}
                    />
                  </label>
                  <label className={catalogLabelClassName}>
                    Preco
                    <input
                      name="price"
                      required
                      inputMode="decimal"
                      placeholder="80,00"
                      className={catalogFieldClassName}
                    />
                  </label>
                  <label className={catalogLabelClassName}>
                    Duracao
                    <input
                      name="duration"
                      required
                      inputMode="numeric"
                      placeholder="45"
                      className={catalogFieldClassName}
                    />
                  </label>
                </div>
                <label className={cn(catalogLabelClassName, 'min-w-0')}>
                  Descrição / observações
                  <textarea
                    name="description"
                    placeholder="Descricao curta para recepcao e operacao"
                    className={cn(catalogFieldClassName, 'min-h-24 max-w-full resize-y leading-6')}
                  />
                </label>
                <label className={cn(catalogLabelClassName, 'min-w-0 max-w-[320px]')}>
                  Categoria
                  <select
                    name="categoryId"
                    className={catalogFieldClassName}
                  >
                    <option value="">Sem categoria</option>
                    {serviceCategories.filter((category) => category.active).map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <div className="min-w-0 overflow-hidden">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Composicao de insumos</p>
                  <ServiceInputFields supplies={supplies} />
                </div>
                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="submit"
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover"
                  >
                    Salvar servico
                  </button>
                </div>
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
                    Quando o catálogo estiver vazio, use estes exemplos para visualizar preço, duração e margem esperada de cada serviço.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {starterServices.map((service) => (
                  <div key={service.name} className="tonal-note">
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
                <article key={service.id} className="tonal-note-strong">
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
                    <div className="tonal-note">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preço</p>
                      <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(Number(service.price))}</p>
                    </div>
                    <div className="tonal-note">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custo total</p>
                      <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(service.totalCost)}</p>
                    </div>
                    <div className="tonal-note">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Margem</p>
                      <p className={cn(
                        'mt-2 text-xl font-semibold',
                        service.margin >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      )}>
                        {formatCurrency(service.margin)}
                      </p>
                    </div>
                  </div>

                  <div className="tonal-note mt-5">
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
                  <details className="tonal-note mt-5 overflow-hidden">
                    <summary className="cursor-pointer text-sm font-semibold text-foreground">Editar cadastro do servico</summary>
                      <form action={saveServiceFromForm} className="mt-4 min-w-0 space-y-4">
                        <input type="hidden" name="id" value={service.id} />
                        <input type="hidden" name="active" value={service.active ? 'true' : 'false'} />
                        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
                          <label className={catalogLabelClassName}>
                            Nome
                            <input name="name" defaultValue={service.name} required className={catalogFieldClassName} />
                          </label>
                          <label className={catalogLabelClassName}>
                            Preço
                            <input name="price" defaultValue={Number(service.price).toString()} required inputMode="decimal" className={catalogFieldClassName} />
                          </label>
                          <label className={catalogLabelClassName}>
                            Duração
                            <input name="duration" defaultValue={service.duration.toString()} required inputMode="numeric" className={catalogFieldClassName} />
                          </label>
                        </div>
                        <label className={cn(catalogLabelClassName, 'min-w-0')}>
                          Descrição / observações
                          <textarea
                            name="description"
                            defaultValue={service.description ?? ''}
                            className={cn(catalogFieldClassName, 'min-h-24 max-w-full resize-y leading-6')}
                          />
                        </label>
                        <label className={cn(catalogLabelClassName, 'min-w-0 max-w-[320px]')}>
                          Categoria
                          <select name="categoryId" defaultValue={service.categoryId ?? ''} className={catalogFieldClassName}>
                            <option value="">Sem categoria</option>
                            {serviceCategories.filter((category) => category.active || category.id === service.categoryId).map((category) => (
                              <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (inativa)'}</option>
                            ))}
                          </select>
                        </label>
                        <div className="min-w-0 overflow-hidden">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Composicao de insumos</p>
                          <ServiceInputFields supplies={supplies} existingInputs={service.serviceInputs} />
                        </div>
                        <div className="flex flex-wrap justify-end gap-3">
                          <button type="submit" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover">
                            Atualizar servico
                          </button>
                        </div>
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
                  Serviço com melhor margem no catálogo atual, útil para orientar posicionamento e mix de venda.
                </p>
              </div>
            ) : (
              <div className="tonal-note mt-4 border-dashed text-sm text-muted-foreground">
                Assim que os serviços forem cadastrados, esta área destaca os itens mais rentáveis e os que pedem revisão.
              </div>
            )}
          </section>

          <section className="dashboard-panel p-6">
            <h2 className="text-lg font-semibold text-foreground">Leituras rápidas</h2>
            <div className="mt-4 space-y-3">
              <div className="tonal-note">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Wallet className="h-4 w-4 text-primary" />
                  Resumo operacional
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Use esta visão para entender preço, margem e papel de cada serviço no catálogo.
                </p>
              </div>

              <div className="tonal-note">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Oportunidade de ajuste
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Revise serviços com margem comprimida para ajustar preço, comissão ou composição de insumos.
                </p>
              </div>

              <div className="tonal-note">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Receipt className="h-4 w-4 text-primary" />
                  Leitura integrada
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Preço, insumos e comissão ficam alinhados para apoiar decisões comerciais e operacionais.
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
