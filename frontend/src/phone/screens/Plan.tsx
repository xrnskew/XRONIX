import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Button, Card, Screen, Stat } from '../ui'
import { useCabinet } from '../PlanContext'
import { rub, short } from '../../lib/format'
import { mockPlan } from '../../mocks/data'

const levelTone = { low: 'text-ok', medium: 'text-warn', high: 'text-accent' } as const
const levelName = { low: 'Низкий', medium: 'Средний', high: 'Высокий' } as const

export default function PlanScreen() {
  const { plan, setPlan } = useCabinet()
  const nav = useNavigate()
  if (!plan)
    return (
      <Screen title="План">
        <Card className="space-y-3 text-center">
          <p className="text-[15px] text-muted">Плана пока нет. Опишите идею в чате, и ИИ соберёт его.</p>
          <Button onClick={() => nav('/chat')}>Перейти в чат</Button>
          <Button variant="ghost" onClick={() => setPlan(mockPlan)}>Показать пример</Button>
        </Card>
      </Screen>
    )
  const p = plan
  return (
    <Screen title={p.title}>
      <p className="px-1 text-[14px] leading-snug text-muted">{p.summary}</p>
      <Card>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Старт" value={short(p.finance.startup_cost_rub)} />
          <Stat label="Прибыль в мес." value={short(p.finance.monthly_profit_rub)} tone="ok" />
          <Stat label="Окупаемость" value={`${p.finance.payback_months} мес.`} />
        </div>
        <div className="mt-3 h-36" aria-label="Прогноз выручки и расходов по месяцам" role="img">
          <ResponsiveContainer>
            <BarChart data={p.finance.revenue_forecast} barGap={2}>
              <CartesianGrid stroke="#2c2c31" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#8d8d95', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={{ background: '#232327', border: 0, borderRadius: 12, fontSize: 12 }} formatter={(v) => rub(Number(v))} labelFormatter={(l) => `Месяц ${l}`} />
              <Bar dataKey="revenue_rub" name="Выручка" fill="#ff4538" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses_rub" name="Расходы" fill="#4a4a52" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <h2 className="mb-2 text-[16px] font-semibold">Шаги запуска</h2>
        <ol className="space-y-3">
          {p.steps.map((s) => (
            <li key={s.order} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[12px] font-semibold">{s.order}</span>
              <div className="min-w-0">
                <div className="text-[15px] font-medium">{s.title}</div>
                <div className="text-[13px] leading-snug text-muted">{s.description}</div>
                <div className="mt-0.5 text-[12px] text-muted">{s.duration_days ?? '—'} дн. · {rub(s.cost_rub)}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <h2 className="mb-2 text-[16px] font-semibold">Риски</h2>
        <ul className="space-y-2.5">
          {p.risks.map((r) => (
            <li key={r.title}>
              <div className="flex items-center justify-between text-[15px] font-medium">{r.title}<span className={`text-[12px] ${levelTone[r.level]}`}>{levelName[r.level]}</span></div>
              <div className="text-[13px] leading-snug text-muted">{r.mitigation}</div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-2 text-[16px] font-semibold">Возможности</h2>
        <ul className="space-y-2">
          {p.opportunities.map((o) => (
            <li key={o.title}><div className="text-[15px] font-medium">{o.title}</div><div className="text-[13px] text-muted">{o.description}</div></li>
          ))}
        </ul>
      </Card>
    </Screen>
  )
}
