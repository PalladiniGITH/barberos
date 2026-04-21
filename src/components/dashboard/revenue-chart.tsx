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
    <div className="rounded-[1.2rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(28,32,48,0.98),rgba(15,17,21,0.96))] p-3.5 text-foreground shadow-[0_28px_44px_-28px_rgba(2,6,23,0.68)]">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="mt-2.5 space-y-1.5 text-sm">
        {payload.map((entry: any) => (
          <p key={entry.name} className="font-medium" style={{ color: entry.color }}>
            {entry.name === 'receitas' ? 'Receitas' : 'Despesas'}: {formatCurrency(entry.value)}
          </p>
        ))}
      </div>
    </div>
  )
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <section className="dashboard-panel p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="page-kicker">Leitura de tendencia</p>
          <h3 className="mt-2 text-[1.6rem] font-semibold tracking-tight text-foreground">Ritmo do caixa</h3>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
            Receita e custo organizados como leitura de decisao, com contraste suficiente para bater o olho e entender o mes.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="surface-chip">Ultimos 6 meses</span>
          <span className="surface-chip">Receita x custo</span>
        </div>
      </div>

      <div className="rounded-[1.65rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(35,38,58,0.94),rgba(21,24,33,0.98))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
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
