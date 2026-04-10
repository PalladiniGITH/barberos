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
    <div className="rounded-[1.25rem] border border-slate-800/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(30,41,59,0.94))] p-3 text-slate-100 shadow-[0_24px_50px_-28px_rgba(15,23,42,0.7)] backdrop-blur-sm">
      <p className="text-sm font-semibold text-slate-50">{label}</p>
      <div className="mt-2 space-y-1.5 text-sm">
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
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="page-kicker">Leitura de tendencia</p>
          <h3 className="mt-2 text-xl font-semibold text-foreground">Ritmo do caixa</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Entradas e saidas dos ultimos 6 meses para mostrar tendencia com clareza, nao surpresa.
          </p>
        </div>
        <span className="surface-chip">
          Ultimos 6 meses
        </span>
      </div>

      <div className="rounded-[1.6rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(17,24,39,0.94))] p-4 shadow-[0_30px_60px_-40px_rgba(2,6,23,0.82)]">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="receitasGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="despesasGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fb7185" stopOpacity={0.22} />
                <stop offset="95%" stopColor="#fb7185" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="rgba(148, 163, 184, 0.16)" strokeDasharray="4 4" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="month"
              tick={{ fill: 'rgba(226, 232, 240, 0.72)', fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: 'rgba(226, 232, 240, 0.72)', fontSize: 12 }}
              tickFormatter={(value) => `R$${(value / 1000).toFixed(0)}k`}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(52, 211, 153, 0.28)', strokeWidth: 1 }} />
            <Area
              dataKey="receitas"
              fill="url(#receitasGradient)"
              name="receitas"
              stroke="#34d399"
              strokeWidth={2.5}
              type="monotone"
            />
            <Area
              dataKey="despesas"
              fill="url(#despesasGradient)"
              name="despesas"
              stroke="#fb7185"
              strokeWidth={2.2}
              type="monotone"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
