import { useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, Screen, SectionTitle, Skeleton, Stat, Wide } from '../ui'
import { useCabinet } from '../CabinetContext'
import { annuity, rub, short } from '../../lib/format'
import { ALFA_DISCLAIMER, matchProducts } from '../../data/alfaProducts'

const verdict = {
  ok: { text: 'Кредит подходит', tone: 'ok' as const },
  risky: { text: 'Есть риски', tone: 'warn' as const },
  not_recommended: { text: 'Не рекомендуем', tone: 'bad' as const },
}
const loadTone = (n: number) => (n > 50 ? 'bad' : n > 35 ? 'warn' : 'ok')
const toneColor = { ok: '#3ddc84', warn: '#ffb020', bad: '#ff4538' }

export default function Finance() {
  const { plan, planLoading, planError, reloadPlan } = useCabinet()
  const nav = useNavigate()
  const wide = useContext(Wide)
  const [amount, setAmount] = useState(plan?.credit.amount_rub ?? 1000000)
  const [months, setMonths] = useState(plan?.credit.recommended_term_months ?? 24)
  const matches = useMemo(() => matchProducts(amount, months), [amount, months])

  if (planLoading && !plan) return <Screen title="Финансы и кредит"><Skeleton /></Screen>
  if (planError && !plan)
    return (
      <Screen title="Финансы и кредит">
        <Card className="space-y-3 py-8 text-center">
          <p role="alert" className="mx-auto max-w-[260px] text-[15px] leading-snug text-accent">{planError}</p>
          <Button onClick={reloadPlan}>Повторить</Button>
        </Card>
      </Screen>
    )
  if (!plan)
    return (
      <Screen title="Финансы и кредит">
        <Card className="space-y-3 py-8 text-center">
          <p className="mx-auto max-w-[240px] text-[15px] leading-snug text-muted">Расчёт появится, когда будет готов план.</p>
          <Button onClick={() => nav('/chat')}>Перейти в чат</Button>
        </Card>
      </Screen>
    )

  const { finance: f, credit: c } = plan
  const rate = c.estimated_rate_percent ?? 22
  const payment = annuity(amount, rate, months)
  const load = Math.round((payment / Math.max(f.monthly_profit_rub, 1)) * 100)
  const v = verdict[c.verdict ?? 'ok']
  const ownShare = Math.round((f.own_funds_rub / f.startup_cost_rub) * 100)

  if (!c.needed)
    return (
      <Screen title="Финансы и кредит">
        <Card>
          <Badge tone="ok">Кредит не нужен</Badge>
          <p className="mt-2 text-[14px] leading-snug text-muted">{c.comment}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Stat label="Нужно на старт" value={rub(f.startup_cost_rub)} />
            <Stat label="Свои средства" value={rub(f.own_funds_rub)} tone="ok" />
          </div>
        </Card>
      </Screen>
    )

  return (
    <Screen title="Финансы и кредит">
      <Card delay={0} span={7}>
        <SectionTitle>Откуда взять {short(f.startup_cost_rub)} ₽</SectionTitle>
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Свои средства ${ownShare}%, не хватает ${100 - ownShare}%`}>
          <div className="bg-ok" style={{ width: `${ownShare}%` }} />
          <div className="bg-accent" style={{ width: `${100 - ownShare}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat label="Свои средства" value={rub(f.own_funds_rub)} tone="ok" />
          <Stat label="Не хватает" value={rub(f.funding_gap_rub)} tone="bad" />
        </div>
      </Card>

      <Card className={`flex items-center gap-4 ${wide ? 'gap-6 p-6' : ''}`} delay={1} span={5}>
        <Gauge value={load} tone={loadTone(load)} />
        <div className="min-w-0">
          <Badge tone={v.tone}>{v.text}</Badge>
          <p className="mt-2 text-[13px] leading-snug text-muted">{c.comment}</p>
        </div>
      </Card>

      <Card className="space-y-4" id="credit-calc" delay={2}>
        <SectionTitle>Калькулятор платежа</SectionTitle>
        <div className={wide ? 'grid grid-cols-2 gap-10' : 'space-y-4'}>
          <Slider label="Сумма" value={amount} min={100000} max={5000000} step={50000} onChange={setAmount} display={rub(amount)} />
          <Slider label="Срок" value={months} min={6} max={60} step={6} onChange={setMonths} display={`${months} мес.`} />
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
          <Stat label="Ставка (оценка)" value={`${rate}%`} />
          <Stat label="Платёж в месяц" value={rub(payment)} />
          <Stat label="Нагрузка" value={`${load}%`} tone={loadTone(load)} />
        </div>
        <p className="text-[12px] leading-snug text-muted">Нагрузка — доля платежа в ожидаемой прибыли. Итоговый расчёт делает сервер.</p>
      </Card>

      <Card id="alfa-products" delay={3}>
        <SectionTitle>Кредиты Альфа-Банка для бизнеса</SectionTitle>
        <ul className={wide ? 'grid gap-3 min-[1100px]:grid-cols-2' : 'space-y-3'}>
          {matches.map(({ product: p, fits, reasons }) => (
            <li key={p.id} className={`rounded-2xl bg-surface-2 p-3.5 ${fits ? '' : 'opacity-55'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold leading-tight">{p.name}</div>
                  <div className="mt-0.5 text-[12px] text-muted">{p.short}</div>
                </div>
                <span className="shrink-0 whitespace-nowrap"><Badge tone={!fits ? 'muted' : p.collateral ? 'warn' : 'ok'}>{p.id === c.recommended_product_id && fits ? 'Рекомендуем' : !fits ? 'Не подходит' : p.collateral ? 'Нужен залог' : 'Подходит'}</Badge></span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                <div><dt className="text-muted">Ставка</dt><dd className="mt-0.5 text-[14px] font-semibold">{p.rateFrom ? `от ${String(p.rateFrom).replace('.', ',')}%` : 'по запросу'}</dd></div>
                <div><dt className="text-muted">Сумма до</dt><dd className="mt-0.5 text-[14px] font-semibold">{short(p.amountMax)} ₽</dd></div>
                <div><dt className="text-muted">Срок</dt><dd className="mt-0.5 text-[14px] font-semibold">{p.termMin}–{p.termMax} мес.</dd></div>
              </dl>
              <p className="mt-2.5 text-[12px] leading-snug text-muted">{fits ? p.note : reasons.join(', ')}</p>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-2xl bg-warn/10 p-3 text-[12px] leading-snug text-warn">
          Новому бизнесу банки обычно одобряют кредит после 6–12 месяцев работы. До этого помогут потребительский кредит или открытие расчётного счёта.
        </div>
        <p className="mt-3 text-[11px] leading-snug text-muted">{ALFA_DISCLAIMER}</p>
      </Card>
    </Screen>
  )
}

function Gauge({ value, tone }: { value: number; tone: 'ok' | 'warn' | 'bad' }) {
  const r = 36
  const circ = 2 * Math.PI * r
  const [shown, setShown] = useState(0)
  useEffect(() => { const r = requestAnimationFrame(() => setShown(value)); return () => cancelAnimationFrame(r) }, [value])
  const pct = Math.min(shown, 100) / 100
  return (
    <div className="relative h-[96px] w-[96px] shrink-0" role="img" aria-label={`Долговая нагрузка ${value}%`}>
      <svg viewBox="0 0 96 96" className="-rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#2d2d33" strokeWidth="9" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={toneColor[tone]} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${circ * pct} ${circ}`} style={{ transition: 'stroke-dasharray .4s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[20px] font-semibold tabular-nums leading-none">{value}%</span>
        <span className="mt-1 text-[10px] text-muted">нагрузка</span>
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, display }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; display: string }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex justify-between text-[14px]"><span className="text-muted">{label}</span><span className="font-semibold tabular-nums">{display}</span></div>
      <input type="range" className="w-full accent-[#ff4538]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}
