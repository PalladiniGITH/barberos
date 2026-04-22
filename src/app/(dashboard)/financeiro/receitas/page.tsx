import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { TrendingUp, ArrowUpRight } from 'lucide-react'
import { assertAdministrativeRole, requireSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange, formatCurrency, formatDate, PAYMENT_METHOD_LABELS } from '@/lib/utils'
import { resolvePeriod } from '@/lib/period'
import { serializeForClient } from '@/lib/serialize-for-client'
import { PageHeader } from '@/components/layout/page-header'
import { SectionTabs } from '@/components/layout/section-tabs'
import { PeriodSelector } from '@/components/shared/period-selector'
import { AddRevenueButton, type RevenueFormOption } from '@/components/financeiro/add-revenue-button'
import { DeleteRevenueButton } from '@/components/financeiro/delete-revenue-button'
import { FINANCE_SECTION_TABS } from '../_financeiro'

export const metadata: Metadata = { title: 'Receitas' }

interface Props {
  searchParams: { month?: string; year?: string }
}

export default async function ReceitasPage({ searchParams }: Props) {
  const session = await requireSession()
  assertAdministrativeRole(session.user.role, 'Sem permissao para consultar as receitas da barbearia.')
  const { month, year } = resolvePeriod(searchParams)
  const { start, end } = getMonthRange(month, year)
  const { barbershopId } = session.user

  const [revenues, professionals, services, categories, summary, paymentMix] = await Promise.all([
    prisma.revenue.findMany({
      where: { barbershopId, date: { gte: start, lte: end } },
      include: { professional: true, service: true, category: true },
      orderBy: { date: 'desc' },
    }),
    prisma.professional.findMany({ where: { barbershopId, active: true }, orderBy: { name: 'asc' } }),
    prisma.service.findMany({ where: { barbershopId, active: true }, orderBy: { name: 'asc' } }),
    prisma.financialCategory.findMany({ where: { barbershopId, type: 'REVENUE' }, orderBy: { name: 'asc' } }),
    prisma.revenue.aggregate({
      where: { barbershopId, date: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.revenue.groupBy({
      by: ['paymentMethod'],
      where: { barbershopId, date: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    }),
  ])

  const totalRevenue = Number(summary._sum.amount ?? 0)
  const avgTicket = summary._count > 0 ? totalRevenue / summary._count : 0
  const paymentTotal = paymentMix.reduce((sum, item) => sum + Number(item._sum.amount ?? 0), 0)
  const revenueFormOptions = serializeForClient({
    professionals: professionals.map((professional) => ({
      id: professional.id,
      name: professional.name,
    })),
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
    })),
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
    })),
  }) as unknown as {
    professionals: RevenueFormOption[]
    services: RevenueFormOption[]
    categories: RevenueFormOption[]
  }

  const byPayment: Record<string, number> = {}
  revenues.forEach((entry) => {
    byPayment[entry.paymentMethod] = (byPayment[entry.paymentMethod] ?? 0) + Number(entry.amount)
  })

  return (
    <div className="page-section mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Receitas"
        description="Tudo o que entrou no caixa no periodo, com leitura comercial e operacional clara."
        action={
          <div className="flex items-center gap-3">
            <Suspense>
              <PeriodSelector month={month} year={year} pathname="/financeiro/receitas" />
            </Suspense>
            <AddRevenueButton
              professionals={revenueFormOptions.professionals}
              services={revenueFormOptions.services}
              categories={revenueFormOptions.categories}
            />
          </div>
        }
      />

      <SectionTabs items={FINANCE_SECTION_TABS} currentPath="/financeiro/receitas" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Entradas do periodo</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-700">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Movimentos</p>
          <p className="text-2xl font-bold tabular-nums text-foreground">{summary._count}</p>
        </div>
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Ticket medio</p>
          <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(avgTicket)}</p>
        </div>
        <div className="kpi-card">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">PIX + dinheiro</p>
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {formatCurrency((byPayment['PIX'] ?? 0) + (byPayment['CASH'] ?? 0))}
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="dashboard-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h3 className="font-semibold text-foreground">Entradas do periodo</h3>
            <span className="text-sm text-muted-foreground">{revenues.length} movimentos</span>
          </div>

          {revenues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <TrendingUp className="mb-3 h-10 w-10 opacity-40 text-muted-foreground" />
              <p className="text-muted-foreground">Nenhuma receita lancada neste periodo</p>
              <p className="mt-1 text-sm text-muted-foreground">Use o botao "Nova Receita" para registrar a primeira entrada.</p>
              <Link href="/financeiro/categorias" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                Rever categorias
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full data-table">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left">Data</th>
                    <th className="px-5 py-3 text-left">Profissional</th>
                    <th className="px-5 py-3 text-left">Servico</th>
                    <th className="px-5 py-3 text-left">Categoria</th>
                    <th className="px-5 py-3 text-left">Pagamento</th>
                    <th className="px-5 py-3 text-right">Valor</th>
                    <th className="w-10 px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {revenues.map((revenue) => (
                    <tr key={revenue.id} className="group border-b border-border/50 transition-colors hover:bg-secondary/30">
                      <td className="px-5 py-3 text-sm tabular-nums text-muted-foreground">{formatDate(revenue.date)}</td>
                      <td className="px-5 py-3 text-sm text-foreground">{revenue.professional?.name ?? 'Sem profissional'}</td>
                      <td className="px-5 py-3 text-sm text-foreground">{revenue.service?.name ?? revenue.description ?? 'Sem servico'}</td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">{revenue.category?.name ?? 'Sem categoria'}</td>
                      <td className="px-5 py-3 text-sm">
                        <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
                          {PAYMENT_METHOD_LABELS[revenue.paymentMethod] ?? revenue.paymentMethod}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold tabular-nums text-emerald-700">
                        {formatCurrency(Number(revenue.amount))}
                      </td>
                      <td className="px-5 py-3">
                        <div className="opacity-0 transition-opacity group-hover:opacity-100">
                          <DeleteRevenueButton id={revenue.id} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-secondary/20">
                    <td colSpan={5} className="px-5 py-3 text-sm font-medium text-muted-foreground">Total</td>
                    <td className="px-5 py-3 text-right font-bold tabular-nums text-emerald-700">
                      {formatCurrency(totalRevenue)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <aside className="dashboard-panel p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Composicao do caixa</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Leitura rapida para entender por onde o faturamento entra com mais forca.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {paymentMix.length > 0 ? paymentMix.map((item) => {
              const amount = Number(item._sum.amount ?? 0)
              const share = paymentTotal > 0 ? (amount / paymentTotal) * 100 : 0

              return (
                <div key={item.paymentMethod} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{PAYMENT_METHOD_LABELS[item.paymentMethod] ?? item.paymentMethod}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{share.toFixed(0)}% do total do periodo</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(amount)}</p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-background/70">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, share)}%` }} />
                  </div>
                </div>
              )
            }) : (
              <div className="rounded-2xl border border-dashed border-border bg-secondary/25 p-5 text-sm text-muted-foreground">
                Nenhum mix de pagamento disponivel neste periodo.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
