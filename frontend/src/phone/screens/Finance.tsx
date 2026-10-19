import { useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, Screen, SectionTitle, Skeleton, Stat, Wide } from '../ui'
import { useCabinet } from '../CabinetContext'
import { annuity, rub, short } from '../../lib/format'
import { ALFA_DISCLAIMER, alfaProducts, alfaSnapshotIsStale, matchProducts, productTerm } from '../../data/alfaProducts'

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
  const [selectedId, setSelectedId] = useState('fast')
  useEffect(() => {
    if (!plan) return
    setAmount(plan.credit.amount_rub ?? 1000000)
    setMonths(plan.credit.recommended_term_months ?? 24)
    const id = plan.credit.recommended_product_id
    setSelectedId(alfaProducts.some((p) => p.id === id && p.rateFrom != null && p.id !== 'revolving') ? id! : 'fast')
  }, [plan])
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
  const selected = alfaProducts.find((p) => p.id === selectedId) ?? alfaProducts[0]
  const rate = selected.rateFrom ?? c.estimated_rate_percent ?? 22
  const payment = annuity(amount, rate, months)
  const load = f.monthly_profit_rub > 0 ? Math.round((payment / f.monthly_profit_rub) * 100) : 100
  const v = verdict[load > 50 ? 'not_recommended' : load > 35 ? 'risky' : 'ok']
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
        <Gauge value={load} tone={loadTone(load)} size={wide ? 112 : 96} />
        <div className="min-w-0">
          <Badge tone={v.tone}>{v.text}</Badge>
          <p className="mt-2 text-[13px] leading-snug text-muted">Оценка по ожидаемой прибыли и выбранному кредиту. Решение по заявке принимает банк.</p>
        </div>
      </Card>

      <Card className="space-y-4" id="credit-calc" delay={2}>
        <SectionTitle>Калькулятор платежа</SectionTitle>
        <label className="block text-[13px] text-muted">Продукт для расчёта
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="mt-1 h-12 w-full rounded-xl bg-surface-2 px-3 text-[14px] text-text outline-none focus:ring-2 focus:ring-accent">
            {alfaProducts.filter((p) => p.rateFrom != null && p.id !== 'revolving').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className={wide ? 'grid grid-cols-2 gap-10' : 'space-y-4'}>
          <Slider label="Сумма" value={amount} min={100000} max={Math.max(5000000, amount)} step={50000} onChange={setAmount} display={rub(amount)} />
          <Slider label="Срок" value={months} min={1} max={120} step={1} onChange={setMonths} display={`${months} мес.`} />
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
          <Stat label="Ставка от (оценка)" value={`${String(rate).replace('.', ',')}%`} />
          <Stat label="Платёж в месяц" value={rub(payment)} />
          <Stat label="Нагрузка" value={`${load}%`} tone={loadTone(load)} />
        </div>
        <p className="text-[12px] leading-snug text-muted">Предварительный аннуитетный расчёт по обычной ставке «от» выбранного продукта, без платных услуг. Нагрузка — доля платежа в ожидаемой прибыли. Банк может предложить другую ставку и график.</p>
        <a href={selected.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-fill px-5 py-3 text-center text-[14px] font-semibold text-white hover:bg-brand-deep">Условия и заявка в Альфа-Банке ↗</a>
      </Card>

      <Card id="alfa-products" delay={3}>
        <SectionTitle>Кредиты Альфа-Банка для бизнеса</SectionTitle>
        <ul className={wide ? 'grid gap-3 min-[1100px]:grid-cols-2' : 'space-y-3'}>
          {matches.map(({ product: p, fits, reasons }) => (
            <li key={p.id} className={`flex flex-col rounded-2xl bg-surface-2 p-4 ring-1 ${fits ? 'ring-white/10' : 'ring-white/5'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold leading-tight">{p.name}</div>
                  <div className="mt-0.5 text-[12px] text-muted">{p.short}</div>
                </div>
                <span className="shrink-0 whitespace-nowrap"><Badge tone={!fits ? 'muted' : p.collateral ? 'warn' : 'ok'}>{!fits ? 'Вне диапазона' : p.collateral ? 'Нужен залог' : 'Без залога'}</Badge></span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                <div><dt className="text-muted">Ставка</dt><dd className="mt-0.5 text-[14px] font-semibold">{p.rateFrom ? `от ${String(p.rateFrom).replace('.', ',')}%` : 'по запросу'}</dd></div>
                <div><dt className="text-muted">Сумма до</dt><dd className="mt-0.5 text-[14px] font-semibold">{short(p.amountMax)} ₽</dd></div>
                <div><dt className="text-muted">Срок</dt><dd className="mt-0.5 text-[14px] font-semibold">{productTerm(p)}</dd></div>
              </dl>
              <p className="mt-2.5 text-[12px] leading-snug text-muted">{p.note}</p>
              <p className={`mt-2 text-[12px] ${fits ? 'text-ok' : 'text-warn'}`}>{fits ? 'В диапазоне суммы и срока' : reasons.join(', ')}</p>
              {p.minBusinessMonths != null && <p className="mt-1 text-[12px] text-muted">Бизнес зарегистрирован от {p.minBusinessMonths} мес.</p>}
              <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть в Альфа-Банке: ${p.name}`}
                className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-fill px-3 py-3 text-center text-[14px] font-semibold text-white transition-colors hover:bg-brand-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Открыть в Альфа-Банке <span aria-hidden>↗</span></a>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-2xl bg-warn/10 p-3 text-[12px] leading-snug text-warn">
          Для этих продуктов банк указывает стаж бизнеса от 9 месяцев. Для нового бизнеса есть отдельная программа под залог — <a href="https://alfabank.ru/sme/profits/lombardnyj_kredit/" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">«Деньги на дело» ↗</a>. Возможность получения кредита уточняйте в банке.
        </div>
        <p className="mt-3 text-[11px] leading-snug text-muted">{ALFA_DISCLAIMER}</p>
        {alfaSnapshotIsStale() && <p className="mt-2 text-[12px] text-warn">Данные требуют обновления. Проверьте текущие условия по ссылке на сайте банка.</p>}
      </Card>
    </Screen>
  )
}

// Кольцо нагрузки. Цифра подобрана так, чтобы даже «100%» помещалась внутри кольца, не задевая дугу.
function Gauge({ value, tone, size = 96 }: { value: number; tone: 'ok' | 'warn' | 'bad'; size?: number }) {
  const r = 40
  const circ = 2 * Math.PI * r
  const [shown, setShown] = useState(0)
  useEffect(() => { const r = requestAnimationFrame(() => setShown(value)); return () => cancelAnimationFrame(r) }, [value])
  const pct = Math.min(shown, 100) / 100
  const k = size / 96
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Долговая нагрузка ${value}%`}>
      <svg viewBox="0 0 96 96" className="-rotate-90" width={size} height={size}>
        <circle cx="48" cy="48" r={r} fill="none" stroke="#2d2d33" strokeWidth="6" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={toneColor[tone]} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${circ * pct} ${circ}`} style={{ transition: 'stroke-dasharray .4s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="flex items-baseline font-display font-semibold tabular-nums leading-none" style={{ fontSize: 17 * k }}>
          {value}<span className="ml-px" style={{ fontSize: 11 * k }}>%</span>
        </span>
        <span className="mt-1 text-muted" style={{ fontSize: 10 * k }}>нагрузка</span>
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
