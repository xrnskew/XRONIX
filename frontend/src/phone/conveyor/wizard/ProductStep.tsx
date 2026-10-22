import { useEffect, useState } from 'react'
import { errorText } from '../../../api'
import { conveyor } from '../../../api/conveyor'
import type { Company, MatchItem } from '../../../types/conveyor'
import { decimal, rub } from '../../../lib/format'
import { Badge, Card } from '../../ui'
import { ErrorText, ghostBtn, primaryBtn, purposes } from '../parts'
import { type Need } from './types'
import type { Purpose } from '../../../types/conveyor'

type Suggestion = { key: string; title: string; detail: string; patch: Partial<Need> }
const TERMS = [12, 18, 24, 36, 48, 60, 84, 120]
const closest = <T,>(xs: T[], value: (x: T) => number, to: number) => [...xs].sort((a, b) => Math.abs(value(a) - to) - Math.abs(value(b) - to))
const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step)

// Шаг мастера: 3. Подбор продукта
export default function ProductStep({ company, need, setNeed, planId, onBack, onDone }: { company: Company; need: Need; setNeed: (n: Need) => void; planId: string | null; onBack: () => void; onDone: (applicationId: string) => void }) {
  const [items, setItems] = useState<MatchItem[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  const [tips, setTips] = useState<Suggestion[] | null>(null)

  useEffect(() => {
    conveyor.match({ purpose: need.purpose!, amount_rub: need.amount_rub!, term_months: need.term_months!, has_collateral: need.has_collateral, company_id: company.id, plan_id: planId })
      .then((r) => setItems(r.items)).catch((e) => setError(errorText(e)))
  }, [company.id, need, planId])

  // Подсказки, если ничего не подошло: пробуем менять по одному параметру в порядке залог → срок → цель → сумма
  // и оставляем то, после чего появляется подходящий продукт. Заполненные данные не теряются: меняем только Need
  const noFit = !!items && !items.some((i) => i.eligible && i.can_apply)
  useEffect(() => {
    if (!noFit) { setTips(null); return }
    let cancelled = false
    setTips(null)
    const base = { company_id: company.id, plan_id: planId, purpose: need.purpose!, amount_rub: need.amount_rub!, term_months: need.term_months!, has_collateral: need.has_collateral }
    const fitOf = async (patch: Partial<Need>) => {
      try {
        const r = await conveyor.match({ ...base, ...patch } as Parameters<typeof conveyor.match>[0])
        return r.items.find((i) => i.eligible && i.can_apply)?.name ?? null
      } catch { return null }
    }
    const first = async (patches: Partial<Need>[]) => { for (const patch of patches) { const name = await fitOf(patch); if (name) return { patch, name } } return null }
    const amount = need.amount_rub!, term = need.term_months!
    const amounts = [...new Set([0.8, 0.6, 0.5, 0.4, 0.3, 0.2].map((k) => roundTo(amount * k, 10_000)).concat(amount < 300_000 ? [300_000] : []))].filter((a) => a !== amount && a >= 10_000)
    const jobs: Promise<Suggestion | null>[] = [
      need.has_collateral ? Promise.resolve(null) : first([{ has_collateral: true }]).then((r) => r && { key: 'collateral', title: 'Добавить залог', detail: `Подойдёт: ${r.name}`, patch: r.patch }),
      first(closest(TERMS.filter((t) => t !== term), (t) => t, term).slice(0, 5).map((t) => ({ term_months: t }))).then((r) => r && { key: 'term', title: `Срок ${r.patch.term_months} мес. вместо ${term}`, detail: `Подойдёт: ${r.name}`, patch: r.patch }),
      first((Object.keys(purposes) as Purpose[]).filter((x) => x !== need.purpose).map((x) => ({ purpose: x }))).then((r) => r && { key: 'purpose', title: `Цель «${purposes[r.patch.purpose as Purpose].title}»`, detail: `Подойдёт: ${r.name}. Цель в заявке изменится`, patch: r.patch }),
      first(closest(amounts, (a) => a, amount).slice(0, 5).map((a) => ({ amount_rub: a }))).then((r) => r && { key: 'amount', title: `Сумма ${rub(r.patch.amount_rub!)} вместо ${rub(amount)}`, detail: `Подойдёт: ${r.name}`, patch: r.patch }),
    ]
    Promise.all(jobs).then((r) => { if (!cancelled) setTips(r.filter((x): x is Suggestion => !!x)) })
    return () => { cancelled = true }
  }, [noFit, company.id, need, planId])

  const apply = async (m: MatchItem) => {
    setCreating(m.product_id); setError('')
    try {
      const a = await conveyor.createApplication({ company_id: company.id, product_id: m.product_id, purpose: need.purpose!, amount_rub: need.amount_rub!, term_months: need.term_months!, plan_id: planId })
      onDone(a.id)
    } catch (e) { setError(errorText(e)); setCreating(null) }
  }

  const fits = items?.filter((i) => i.eligible && i.can_apply) ?? []
  const rest = items?.filter((i) => !(i.eligible && i.can_apply)) ?? []
  const Group = ({ title, n }: { title: string; n: number }) => <h2 data-span={12} className="flex items-baseline gap-2 pt-2 text-[15px] font-semibold">{title}<span className="text-[13px] font-normal text-muted tabular-nums">{n}</span></h2>
  const card = (m: MatchItem, fit: boolean) => (
    <Card key={m.product_id} span={6} className={fit ? 'ring-1 ring-ok/30' : ''}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold leading-snug">{m.name}</div>
          <span className="mt-1 inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-[12px] text-muted">Продукт XRONIX (демо)</span>
          {m.gov && (
            <span className="mt-2 block rounded-xl bg-steel/12 px-3 py-2 text-[12px] leading-snug text-steel">
              <span className="block font-medium">Господдержка: половину риска берёт Корпорация МСП</span>
              {m.valid_until && <span className="block text-steel/75">Акция до {new Date(`${m.valid_until}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>}
            </span>
          )}
        </div>
        {fit && <Badge tone="ok" dot>Подходит</Badge>}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div><div className="text-[12px] text-muted">Платёж в месяц</div><div className={`tabular-nums ${fit ? 'font-display text-[26px] font-semibold leading-tight tracking-tight' : 'text-[15px] font-semibold'}`}>{m.monthly_payment_rub != null ? `≈ ${rub(m.monthly_payment_rub)}` : '—'}</div></div>
        <div><div className="text-[12px] text-muted">Ставка</div><div className="text-[15px] font-semibold tabular-nums">{m.rate_from_percent != null ? `от ${decimal(m.rate_from_percent)}%` : 'по запросу'}</div></div>
      </div>
      {m.reasons.length > 0 && <ul className="mt-3 space-y-1 text-[13px] leading-snug text-muted">{m.reasons.map((r) => <li key={r} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current" aria-hidden />{r}</li>)}</ul>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {fit && <button onClick={() => apply(m)} disabled={!!creating} className={primaryBtn}>{creating === m.product_id ? 'Создаём…' : 'Подать заявку'}</button>}
      </div>
    </Card>
  )
  return (
    <>
      <div data-span={12} className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className="rounded-full bg-surface-2 px-3.5 py-1.5 font-display font-semibold tabular-nums">{rub(need.amount_rub)}</span>
        <span className="rounded-full bg-surface-2 px-3.5 py-1.5">{need.term_months} мес.</span>
        <span className="rounded-full bg-surface-2 px-3.5 py-1.5">{purposes[need.purpose!].title}</span>
        <span className="rounded-full bg-surface-2 px-3.5 py-1.5 text-muted">{company.registry.name}</span>
      </div>
      {items && !fits.length && <p data-span={12} className="text-[14px] leading-snug text-warn">С такими параметрами подходящего кредита нет. Причины — под каждым продуктом. Можно вернуться и поменять сумму, срок или залог.</p>}
      {noFit && (
        <Card span={12}>
          <div className="text-[15px] font-semibold">Что можно изменить, чтобы кредит подошёл</div>
          {!tips && <p className="mt-2 text-[13px] text-muted">Подбираем варианты…</p>}
          {tips && !tips.length && <p className="mt-2 text-[13px] leading-snug text-muted">По одному параметру подходящего варианта нет. Попробуйте изменить сразу несколько условий или обратитесь к специалисту.</p>}
          {tips && tips.length > 0 && (
            <ul className="mt-3 space-y-2.5">
              {tips.map((t) => (
                <li key={t.key} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
                  <div className="min-w-0"><div className="text-[14px] font-semibold">{t.title}</div><div className="text-[13px] text-muted">{t.detail}</div></div>
                  <button type="button" onClick={() => setNeed({ ...need, ...t.patch })} className={ghostBtn}>Применить</button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[12px] leading-snug text-muted">Остальные введённые данные сохранятся. Изменения можно отменить через «Назад».</p>
        </Card>
      )}
      <div data-span={12}><ErrorText>{error}</ErrorText></div>
      {!items && !error && [0, 1].map((i) => <div key={i} data-span={6} className="h-40 animate-pulse rounded-[22px] bg-surface" />)}
      {fits.length > 0 && <Group title="Подходят" n={fits.length} />}
      {fits.map((m) => card(m, true))}
      {rest.length > 0 && <Group title="Не подходят, и что мешает" n={rest.length} />}
      {rest.map((m) => card(m, false))}
      <div data-span={12}><button onClick={onBack} className={ghostBtn}>Назад</button></div>
      <p data-span={12} className="text-[12px] leading-snug text-muted">Платёж — предварительный, по минимальной ставке продукта. Точные условия банк определит после проверки заявки.</p>
    </>
  )
}
