import { useEffect, useState } from 'react'
import { errorText } from '../../../api'
import { conveyor } from '../../../api/conveyor'
import type { Company, MatchItem } from '../../../types/conveyor'
import { decimal, rub } from '../../../lib/format'
import { Badge, Card } from '../../ui'
import { ErrorText, ghostBtn, primaryBtn, purposes } from '../parts'
import { type Need } from './types'

// Шаг мастера: 3. Подбор продукта
export default function ProductStep({ company, need, planId, onBack, onDone }: { company: Company; need: Need; planId: string | null; onBack: () => void; onDone: (applicationId: string) => void }) {
  const [items, setItems] = useState<MatchItem[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState<string | null>(null)

  useEffect(() => {
    conveyor.match({ purpose: need.purpose!, amount_rub: need.amount_rub!, term_months: need.term_months!, has_collateral: need.has_collateral, company_id: company.id, plan_id: planId })
      .then((r) => setItems(r.items)).catch((e) => setError(errorText(e)))
  }, [company.id, need, planId])

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
          {m.demo && <span className="mt-1 inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-[12px] text-muted">Демо-продукт XRONIX, не продукт Альфа-Банка</span>}
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
        {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="text-[13px] text-muted underline-offset-2 hover:text-text hover:underline">Условия на сайте банка</a>}
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
