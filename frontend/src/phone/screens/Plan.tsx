import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Badge, Button, Card, Screen, SectionTitle, Skeleton, Wide } from '../ui'
import { useCabinet } from '../CabinetContext'
import { rub, shortParts } from '../../lib/format'
import { useCountUp } from '../../lib/useCountUp'
import { USE_MOCKS } from '../../api'

const level = { low: { tone: 'ok', name: 'Низкий' }, medium: { tone: 'warn', name: 'Средний' }, high: { tone: 'bad', name: 'Высокий' } } as const

export default function PlanScreen() {
  const { plan, planLoading, planError, reloadPlan, showDemoPlan } = useCabinet()
  const nav = useNavigate()
  const wide = useContext(Wide)
  if (planLoading && !plan) return <Screen title="План"><Skeleton /></Screen>
  if (planError && !plan)
    return (
      <Screen title="План">
        <Card className="space-y-3 py-8 text-center" >
          <p role="alert" className="mx-auto max-w-[260px] text-[15px] leading-snug text-accent">{planError}</p>
          <Button onClick={reloadPlan}>Повторить</Button>
        </Card>
      </Screen>
    )
  if (!plan)
    return (
      <Screen title="План">
        <Card className="space-y-3 py-8 text-center">
          <p className="mx-auto max-w-[240px] text-[15px] leading-snug text-muted">Плана пока нет. Опишите идею в чате, и ИИ соберёт его.</p>
          <Button onClick={() => nav('/chat')}>Перейти в чат</Button>
          {USE_MOCKS && <Button variant="ghost" onClick={showDemoPlan}>Показать пример</Button>}
        </Card>
      </Screen>
    )
  const p = plan
  return (
    <Screen title="План">
      <div className={`hero-card card-ring rise rounded-[26px] ${wide ? 'grid items-end gap-8 p-8 min-[1100px]:grid-cols-[1.15fr_1fr]' : 'p-5'}`}>
        <div>
          <div className="flex gap-1.5"><Badge tone="muted">{p.business.sphere}</Badge><Badge tone="muted">{p.business.city}</Badge></div>
          <h2 className={`mt-3 font-bold leading-tight tracking-tight ${wide ? 'font-display text-[34px] font-semibold' : 'text-[22px]'}`}>{p.title}</h2>
          <p className={`mt-1.5 leading-snug text-text/65 ${wide ? 'max-w-[520px] text-[16px]' : 'text-[14px]'}`}>{p.summary}</p>
        </div>
        <div className={`grid grid-cols-3 gap-2 ${wide ? '' : 'mt-5'}`}>
          <Big label="На старт" {...shortParts(p.finance.startup_cost_rub)} wide={wide} />
          <Big label="Прибыль в мес." {...shortParts(p.finance.monthly_profit_rub)} tone="ok" wide={wide} />
          <Big label="Окупится за" value={p.finance.payback_months == null ? '—' : String(p.finance.payback_months)} unit="мес." wide={wide} />
        </div>
      </div>

      <Card delay={1} span={12}>
        <SectionTitle>Выручка и расходы за первый год</SectionTitle>
        <div className="mb-2 flex gap-4 text-[12px] text-muted"><Legend c="bg-accent" t="Выручка" /><Legend c="bg-[#5a5a63]" t="Расходы" /></div>
        <div className={wide ? 'h-56' : 'h-36'} aria-label="Прогноз выручки и расходов по месяцам" role="img">
          <ResponsiveContainer>
            <BarChart data={p.finance.revenue_forecast} barGap={2} maxBarSize={wide ? 26 : undefined}>
              <CartesianGrid stroke="#2c2c31" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#8d8d95', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={{ background: '#232327', border: 0, borderRadius: 12, fontSize: 12 }} formatter={(v) => rub(Number(v))} labelFormatter={(l) => `Месяц ${l}`} />
              <Bar dataKey="revenue_rub" name="Выручка" fill="#ff4538" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses_rub" name="Расходы" fill="#5a5a63" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card id="plan-steps" delay={2} span={7} tall>
        <SectionTitle>Шаги запуска</SectionTitle>
        <ol className="relative">
          <span className="absolute bottom-3 left-[13px] top-3 w-px bg-line" aria-hidden />
          {p.steps.map((s) => (
            <li key={s.order} className="relative flex gap-3 pb-4 last:pb-0">
              <span className="relative z-10 mt-0.5 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full bg-fill text-[12px] font-bold text-white ring-4 ring-surface">{s.order}</span>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">{s.title}</div>
                <div className="text-[13px] leading-snug text-muted">{s.description}</div>
                <div className="mt-1 text-[12px] font-medium text-text/70">{s.duration_days ?? '—'} дн. · {rub(s.cost_rub)}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card id="plan-risks" delay={3} span={5}>
        <SectionTitle>Риски</SectionTitle>
        <ul className="space-y-3.5">
          {p.risks.map((r) => (
            <li key={r.title}>
              <div className="flex items-center justify-between gap-2"><span className="text-[15px] font-semibold">{r.title}</span><Badge tone={level[r.level].tone}>{level[r.level].name}</Badge></div>
              <div className="mt-0.5 text-[13px] leading-snug text-muted">{r.mitigation}</div>
            </li>
          ))}
        </ul>
      </Card>

      <Card delay={4} span={5}>
        <SectionTitle>Возможности</SectionTitle>
        <ul className="space-y-3">
          {p.opportunities.map((o) => (
            <li key={o.title}><div className="text-[15px] font-semibold">{o.title}</div><div className="text-[13px] leading-snug text-muted">{o.description}</div></li>
          ))}
        </ul>
      </Card>
    </Screen>
  )
}

const Legend = ({ c, t }: { c: string; t: string }) => <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${c}`} />{t}</span>

const Big = ({ label, value, unit, tone, wide }: { label: string; value: string; unit: string; tone?: 'ok'; wide?: boolean }) => {
  const n = parseFloat(value.replace(',', '.'))
  const decimals = value.includes(',') ? 1 : 0
  const shown = useCountUp(Number.isFinite(n) ? n : 0)
  return (
    <div className="min-w-0">
      <div className={`font-display ${wide ? 'text-[40px]' : 'text-[22px]'} font-semibold leading-none tabular-nums ${tone === 'ok' ? 'text-ok' : ''}`}>{Number.isFinite(n) ? shown.toFixed(decimals).replace('.', ',') : value}</div>
      <div className={`mt-1 text-text/55 ${wide ? 'text-[13px]' : 'text-[11px]'}`}>{unit}</div>
      <div className={`mt-2 leading-tight text-text/70 ${wide ? 'text-[14px]' : 'text-[12px]'}`}>{label}</div>
    </div>
  )
}
