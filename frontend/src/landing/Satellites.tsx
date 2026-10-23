import { useEffect, useState } from 'react'
import { mockPlan, mockProfile } from '../mocks/data'
import { annuity, rub, shortParts } from '../lib/format'
import { alfaProducts } from '../data/alfaProducts'

// Карточки вокруг телефона. Висят в 3D на разной глубине (translateZ), поэтому при наклоне телефона
// сдвигаются с параллаксом. Набор меняется вместе со слайдом. Все цифры из того же плана, что и в кабинете.
// Чисто декоративные: pointer-events: none и aria-hidden, текст дублирует слайд слева.
// Показываются от 1280 px (решает Landing): на более узких экранах рядом с телефоном нет места.

type Slot = 'a' | 'b' | 'c' | 'd'
export type Item =
  | { slot: Slot; kind: 'user' | 'ai'; text: string }
  | { slot: Slot; kind: 'stat'; value: string; label: string; ok?: boolean }
  | { slot: Slot; kind: 'chip'; text: string; active?: boolean }
  | { slot: Slot; kind: 'check'; text: string; lock?: boolean }
  | { slot: Slot; kind: 'typing' }
  | { slot: Slot; kind: 'gauge'; value: number }
  | { slot: Slot; kind: 'bars'; data?: { month: number; revenue_rub: number; expenses_rub: number }[] }

// Карточки стоят колонкой СЛЕВА от телефона и не заходят на экран: экран должен оставаться читаемым.
// Под колонку Landing сдвигает телефон вправо на RAIL/2. Небольшой сдвиг dx делает колонку «живой».
export const RAIL = 236 // ширина колонки карточек вместе с зазором до телефона, px
const GAP = 26
const SLOTS: Record<Slot, { dx: number; top: string; z: number }> = {
  a: { dx: 0, top: '6%', z: 90 },
  b: { dx: 28, top: '30%', z: 130 },
  c: { dx: 6, top: '55%', z: 110 },
  d: { dx: 32, top: '78%', z: 70 },
}
const slotStyle = (s: Slot, k: number): React.CSSProperties => ({ right: `calc(100% + ${(GAP + SLOTS[s].dx) * k}px)`, top: SLOTS[s].top })

const f = mockPlan.finance
const c = mockPlan.credit
const start = shortParts(f.startup_cost_rub)
const profit = shortParts(f.monthly_profit_rub)
// Платёж пересчитываем по аннуитету, как кабинет и бэкенд, а не берём оценку ИИ: цифры на экране должны совпадать
const product = alfaProducts.find((p) => p.id === c.recommended_product_id && p.rateFrom != null && p.id !== 'revolving') ?? alfaProducts[0]
const payment = annuity(c.amount_rub ?? 0, product.rateFrom ?? c.estimated_rate_percent ?? 0, c.recommended_term_months ?? 1)
const load = f.monthly_profit_rub > 0 ? Math.round(payment / f.monthly_profit_rub * 100) : 100

const sets: Record<string, Item[]> = {
  top: [
    { slot: 'a', kind: 'user', text: 'Хочу открыть кофейню у метро' },
    { slot: 'b', kind: 'stat', value: `${start.value} ${start.unit}`, label: 'нужно на старт' },
    { slot: 'c', kind: 'check', text: 'План, финансы и кредит' },
    { slot: 'd', kind: 'chip', text: `Окупится за ${f.payback_months} мес.` },
  ],
  problem: [
    { slot: 'a', kind: 'ai', text: 'Сколько нужно денег?' },
    { slot: 'b', kind: 'ai', text: 'Какой кредит брать?' },
    { slot: 'c', kind: 'ai', text: 'Потяну ли платёж?' },
  ],
  how: [
    { slot: 'a', kind: 'typing' },
    { slot: 'b', kind: 'chip', text: '500 тыс – 2 млн', active: true },
    { slot: 'c', kind: 'chip', text: 'Опыта нет' },
    { slot: 'd', kind: 'check', text: 'Ответ проверен по схеме' },
  ],
  plan: [
    { slot: 'a', kind: 'stat', value: `+${profit.value} ${profit.unit}`, label: 'прибыль в месяц', ok: true },
    { slot: 'b', kind: 'bars' },
    { slot: 'c', kind: 'stat', value: `${f.payback_months} мес.`, label: 'окупаемость' },
    { slot: 'd', kind: 'chip', text: `${mockPlan.steps.length} шагов запуска` },
  ],
  credit: [
    { slot: 'a', kind: 'stat', value: rub(payment), label: 'платёж в месяц' },
    { slot: 'b', kind: 'gauge', value: load },
    { slot: 'c', kind: 'check', text: load > 50 ? 'Не рекомендуем' : load > 35 ? 'Есть риски' : 'Кредит подходит' },
    { slot: 'd', kind: 'chip', text: product.collateral ? 'Кредит с залогом' : 'Кредит без залога' },
  ],
  memory: [
    ...mockProfile.tags.slice(0, 3).map((t, i): Item => ({ slot: (['a', 'b', 'c'] as const)[i], kind: 'chip', text: t })),
    { slot: 'd', kind: 'ai', text: 'Помню: кофейня у метро, свои 500 тыс ₽' },
  ],
  arch: [
    { slot: 'a', kind: 'chip', text: 'JWT' },
    { slot: 'b', kind: 'check', text: 'JSON по схеме' },
    { slot: 'c', kind: 'chip', text: 'GigaChat' },
    { slot: 'd', kind: 'check', text: 'Токен только на сервере', lock: true },
  ],
  team: [
    { slot: 'a', kind: 'stat', value: '3', label: 'человека в команде' },
    { slot: 'b', kind: 'chip', text: 'xronix.ru' },
    { slot: 'c', kind: 'stat', value: '7', label: 'дней хакатона' },
  ],
}

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// show=false (человек взял телефон в руки или узкий экран): карточки гаснут и не рисуются
export default function Satellites({ slide, show, k = 1 }: { slide: string; show: boolean; k?: number }) {
  // Смена набора: старые карточки гаснут, затем появляются новые по очереди
  const target = show ? slide : ''
  const [shown, setShown] = useState(target)
  const [phase, setPhase] = useState<'in' | 'out'>('in')
  useEffect(() => {
    if (target === shown) return
    if (still()) { setShown(target); return }
    setPhase('out')
    const t = window.setTimeout(() => { setShown(target); setPhase('in') }, 320)
    return () => window.clearTimeout(t)
  }, [target, shown])

  const items = sets[shown] ?? []
  return (
    <div className="pointer-events-none absolute inset-0" style={{ transformStyle: 'preserve-3d' }} aria-hidden>
      {items.map((it, i) => (
        <div key={shown + it.slot} className="absolute" style={{ ...slotStyle(it.slot, k), width: 'max-content', transformOrigin: 'right center', transform: `translateZ(${SLOTS[it.slot].z * k}px) scale(${k})` }}>
          <div className="sat-float" style={{ animationDelay: `${-i * 1.7}s`, animationDuration: `${5.5 + i * 0.9}s` }}>
            <div className={`sat ${phase === 'in' ? 'sat-in' : 'sat-out'}`} style={{ animationDelay: phase === 'in' ? `${120 + i * 110}ms` : '0ms' }}>
              <SatCard it={it} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export const box = 'rounded-2xl bg-[#141416]/95 px-4 py-3 text-white shadow-[0_24px_40px_-14px_rgba(0,0,0,.8)] ring-1 ring-white/10'

export function SatCard({ it }: { it: Item }) {
  switch (it.kind) {
    case 'user':
      return <div className="max-w-[190px] rounded-[18px] rounded-br-md bg-fill px-4 py-2.5 text-[14px] font-medium leading-snug text-white shadow-[0_18px_34px_-12px_rgba(224,42,30,.7)]">{it.text}</div>
    case 'ai':
      return <div className={`max-w-[190px] rounded-[18px] rounded-bl-md text-[14px] leading-snug ${box} py-2.5`}>{it.text}</div>
    case 'typing':
      return <div className={`flex gap-1.5 ${box} rounded-bl-md py-3.5`}>{[0, 1, 2].map((k) => <span key={k} className="dot h-2 w-2 rounded-full bg-white/60" />)}</div>
    case 'chip':
      return <div className={`whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-medium ${it.active ? 'bg-fill text-white shadow-[0_14px_30px_-12px_rgba(224,42,30,.8)]' : 'bg-[#141416]/95 text-white ring-1 ring-white/10 shadow-[0_18px_30px_-14px_rgba(0,0,0,.8)]'}`}>{it.text}</div>
    case 'check':
      return (
        <div className={`flex max-w-[200px] items-center gap-2.5 text-[14px] font-medium leading-snug ${box} py-2.5`}>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${it.lock ? 'bg-fill' : 'bg-ok/20 text-ok'}`}>
            {it.lock
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z" /></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
          </span>
          {it.text}
        </div>
      )
    case 'stat':
      return (
        <div className={`${box} min-w-[140px]`}>
          <div className={`font-display text-[20px] font-semibold leading-none tabular-nums ${it.ok ? 'text-ok' : ''}`}>{it.value}</div>
          <div className="mt-1.5 text-[12px] text-white/60">{it.label}</div>
        </div>
      )
    case 'gauge': {
      const r = 20, circ = 2 * Math.PI * r
      return (
        <div className={`flex items-center gap-3 ${box}`}>
          <svg width="52" height="52" viewBox="0 0 52 52" className="-rotate-90"><circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="6" /><circle cx="26" cy="26" r={r} fill="none" stroke="#3ddc84" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(circ * it.value) / 100} ${circ}`} /></svg>
          <div><div className="font-display text-[18px] font-semibold leading-none">{it.value}%</div><div className="mt-1 text-[12px] text-white/60">нагрузка</div></div>
        </div>
      )
    }
    case 'bars': {
      const data = it.data ?? mockPlan.finance.revenue_forecast
      const max = Math.max(...data.map((m) => Math.max(m.revenue_rub, m.expenses_rub)))
      return (
        <div className={box}>
          <div className="flex h-14 items-end gap-[3px]">
            {data.map((m) => <span key={m.month} className="w-[7px] rounded-t-sm bg-accent" style={{ height: `${(m.revenue_rub / max) * 100}%` }} />)}
          </div>
          <div className="mt-2 text-[12px] text-white/60">выручка за 12 месяцев</div>
        </div>
      )
    }
  }
}
