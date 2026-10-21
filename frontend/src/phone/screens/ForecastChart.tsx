import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import type { Plan } from '../../types/plan'
import { rub } from '../../lib/format'

// Отдельным модулем, чтобы recharts грузился лениво: только когда открыт план, а не при входе на сайт
export default function ForecastChart({ data, wide }: { data: Plan['finance']['revenue_forecast']; wide: boolean }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} barGap={2} maxBarSize={wide ? 26 : undefined}>
        <CartesianGrid stroke="#2c2c31" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: '#8d8d95', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={{ background: '#232327', border: 0, borderRadius: 12, fontSize: 12 }} formatter={(v) => rub(Number(v))} labelFormatter={(l) => `Месяц ${l}`} />
        <Bar dataKey="revenue_rub" name="Выручка" fill="#ff4538" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses_rub" name="Расходы" fill="#5a5a63" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
