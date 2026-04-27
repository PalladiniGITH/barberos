'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface RevenueChartProps {
  data: { month: string; receitas: number; despesas: number }[]
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="chart-tooltip">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="mt-2.5 space-y-2 text-sm">
        {payload.map((entry: any) => (
          <div key={entry.name} className="flex items-center justify-between gap-3">
            <p className="font-medium" style={{ color: entry.color }}>
              {entry.name === 'receitas' ? 'Receitas' : 'Despesas'}
            </p>
            <p className="font-semibold text-foreground">{formatCurrency(entry.value)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function RevenueChart({ data }: RevenueChartProps) {
  const latestPoint = data[data.length - 1] ?? null
  const highestRevenue = data.reduce((highest, point) => Math.max(highest, point.receitas), 0)
  const lowestExpense = data.reduce((lowest, point) => point.despesas > 0 ? Math.min(lowest, point.despesas) : lowest, Number.POSITIVE_INFINITY)
  const lowestExpenseValue = Number.isFinite(lowestExpense) ? lowestExpense : 0

  return (
    <section className="dashboard-panel p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h3 className="mt-2 text-[1.6rem] font-semibold tracking-tight text-foreground">Ritmo do caixa</h3>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
            Receita e custo organizados como leitura de decisao, com contraste suficiente para bater o olho e entender o mes.
          </p>
        </div>

        <p className="text-sm text-muted-foreground">Ultimos 6 meses de receita e custo.</p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="surface-tier-low p-5">
          <p className="executive-label">Ultimo fechamento</p>
          <p className="mt-3 text-lg font-semibold text-foreground">
            {latestPoint ? formatCurrency(latestPoint.receitas) : 'Sem leitura'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {latestPoint ? `${latestPoint.month} como base mais recente de receita.` : 'Ainda sem historico suficiente.'}
          </p>
        </div>

        <div className="surface-tier-low p-5">
          <p className="executive-label">Pico de receita</p>
          <p className="mt-3 text-lg font-semibold text-foreground">{formatCurrency(highestRevenue)}</p>
          <p className="mt-2 text-sm text-muted-foreground">Maior patamar de caixa observado na serie recente.</p>
        </div>

        <div className="surface-tier-low p-5">
          <p className="executive-label">Menor pressao de custo</p>
          <p className="mt-3 text-lg font-semibold text-foreground">{formatCurrency(lowestExpenseValue)}</p>
          <p className="mt-2 text-sm text-muted-foreground">Referencia util para medir folga do caixa ao longo do periodo.</p>
        </div>
      </div>

      <div className="rounded-[1.65rem] border border-[rgba(255,255,255,0.05)] bg-[linear-gradient(180deg,rgba(33,35,46,0.92),rgba(22,24,30,0.97))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="receitasGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#5b21b6" stopOpacity={0.32} />
                <stop offset="95%" stopColor="#6d28d9" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="despesasGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#e11d48" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="month"
              tick={{ fill: 'rgba(156, 163, 175, 0.86)', fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: 'rgba(156, 163, 175, 0.86)', fontSize: 12 }}
              tickFormatter={(value) => `R$${(value / 1000).toFixed(0)}k`}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(91,33,182,0.18)', strokeWidth: 1 }} />
            <Area
              dataKey="receitas"
              fill="url(#receitasGradient)"
              name="receitas"
              stroke="#5b21b6"
              strokeWidth={2.6}
              type="monotone"
            />
            <Area
              dataKey="despesas"
              fill="url(#despesasGradient)"
              name="despesas"
              stroke="#e11d48"
              strokeWidth={2.15}
              type="monotone"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
