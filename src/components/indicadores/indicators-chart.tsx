'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface ChartData {
  label: string
  revenue: number
  expenses: number
  profit: number
  ticket: number
  profitMargin: number
  expensePercent: number
}

function CurrencyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="chart-tooltip">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="mt-2.5 space-y-2 text-sm">
        {payload.map((entry: any) => (
          <div key={entry.name} className="flex items-center justify-between gap-3">
            <p style={{ color: entry.color }} className="font-medium">
              {entry.name}
            </p>
            <p className="font-semibold text-foreground">{formatCurrency(entry.value)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function PercentTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="chart-tooltip">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="mt-2.5 space-y-2 text-sm">
        {payload.map((entry: any) => (
          <div key={entry.name} className="flex items-center justify-between gap-3">
            <p style={{ color: entry.color }} className="font-medium">
              {entry.name}
            </p>
            <p className="font-semibold text-foreground">{entry.value?.toFixed(1)}%</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function IndicatorsChart({ data }: { data: ChartData[] }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="dashboard-panel p-6">
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-foreground">Receita, despesas e lucro</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Leitura historica mais limpa para comparar consistencia, pressao de custo e resultado.
          </p>
        </div>

        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 6, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="hsla(223, 18%, 28%, 0.28)" strokeDasharray="3 6" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              tick={{ fill: 'hsl(223 12% 66%)', fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: 'hsl(223 12% 66%)', fontSize: 12 }}
              tickFormatter={(value) => `R$${(value / 1000).toFixed(0)}k`}
              tickLine={false}
            />
            <Tooltip content={<CurrencyTooltip />} cursor={{ fill: 'hsla(255, 40%, 30%, 0.14)' }} />
            <Bar dataKey="revenue" name="Receita" fill="#22c55e" radius={[8, 8, 0, 0]} />
            <Bar dataKey="expenses" name="Despesas" fill="#fb923c" radius={[8, 8, 0, 0]} />
            <Bar dataKey="profit" name="Lucro" fill="#60a5fa" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="dashboard-panel p-6">
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-foreground">Eficiência operacional</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Margem de lucro versus peso das despesas em uma leitura mais consistente com o shell executivo.
          </p>
        </div>

        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 4, right: 6, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="hsla(223, 18%, 28%, 0.28)" strokeDasharray="3 6" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              tick={{ fill: 'hsl(223 12% 66%)', fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: 'hsl(223 12% 66%)', fontSize: 12 }}
              tickFormatter={(value) => `${value.toFixed(0)}%`}
              tickLine={false}
            />
            <Tooltip content={<PercentTooltip />} />
            <Line
              dataKey="profitMargin"
              dot={{ fill: '#22c55e', r: 4 }}
              name="Margem"
              stroke="#22c55e"
              strokeWidth={2.5}
              type="monotone"
            />
            <Line
              dataKey="expensePercent"
              dot={{ fill: '#fb923c', r: 3 }}
              name="% Despesas"
              stroke="#fb923c"
              strokeDasharray="6 4"
              strokeWidth={2.2}
              type="monotone"
            />
          </LineChart>
        </ResponsiveContainer>
      </section>
    </div>
  )
}
