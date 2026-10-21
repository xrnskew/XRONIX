import { useState } from 'react'
import { conveyor } from '../../../api/conveyor'
import type { Company, ParsedNeed, Purpose } from '../../../types/conveyor'
import { plural, rub } from '../../../lib/format'
import { Card, Chip, SectionTitle } from '../../ui'
import { Label, MoneyInput, ghostBtn, input, primaryBtn, purposes } from '../parts'
import { type Need, type CalculatedPlan } from './types'

// Шаг мастера: 2. Потребность
export default function NeedStep({ company, need, setNeed, project, onBack, onDone }: { company: Company; need: Need; setNeed: (n: Need) => void; project: CalculatedPlan | null; onBack: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParsedNeed | null>(null)
  const [note, setNote] = useState('')
  const unsure = (k: keyof ParsedNeed['confidence']) => parsed?.confidence[k] != null && parsed.confidence[k]! < 0.7
  const set = (patch: Partial<Need>) => setNeed({ ...need, ...patch })

  const parse = async () => {
    setParsing(true); setNote('')
    try {
      const r = await conveyor.parseNeed(text)
      setParsed(r)
      const got = { ...need }
      if (r.purpose) got.purpose = r.purpose
      if (r.amount_rub) got.amount_rub = r.amount_rub
      if (r.term_months) got.term_months = r.term_months
      if (r.has_collateral != null) got.has_collateral = r.has_collateral
      setNeed(got)
      const filled = ['purpose', 'amount_rub', 'term_months', 'has_collateral'].filter((k) => r[k as keyof ParsedNeed] != null).length
      setNote(filled ? `Заполнили ${filled} ${plural(filled, ['поле', 'поля', 'полей'])}. Проверьте и поправьте, если что-то не так.` : 'Не получилось разобрать текст. Заполните поля ниже.')
    } catch { setNote('Разбор текста сейчас недоступен. Заполните поля ниже.') } finally { setParsing(false) }
  }

  const ready = need.purpose && need.amount_rub && need.amount_rub >= 10_000 && need.term_months && need.term_months >= 1
  return (
    <>
      {project ? (
        <Card span={12}>
          <p className="text-[15px] leading-snug">Сумма и срок — из расчёта «{project.plan.title}»: не хватает своих средств {rub(project.plan.finance.funding_gap_rub)}. Можно поправить.</p>
        </Card>
      ) : (
      <Card span={12}>
        <SectionTitle>Опишите своими словами</SectionTitle>
        <p className="mb-3 text-[14px] text-muted">Например: «Хочу открыть вторую пекарню, нужно около полутора миллионов на оборудование, лет на два». Можно пропустить и заполнить поля вручную.</p>
        <textarea aria-label="Опишите, на что нужны деньги" className={`${input} h-24 resize-none py-3`} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={parse} disabled={!text.trim() || parsing} className={ghostBtn}>{parsing ? 'Разбираем…' : 'Заполнить по описанию'}</button>
          {note && <p role="status" className="text-[14px] text-muted">{note}</p>}
        </div>
      </Card>
      )}
      <Card span={12}>
        <SectionTitle>На что нужны деньги</SectionTitle>
        <div className={`grid gap-2 rounded-xl sm:grid-cols-2 lg:grid-cols-3 ${unsure('purpose') ? 'ring-2 ring-warn/60 p-1' : ''}`}>
          {Object.entries(purposes).map(([k, p]) => (
            <button key={k} type="button" onClick={() => set({ purpose: k as Purpose })} aria-pressed={need.purpose === k}
              className={`rounded-xl p-3.5 text-left transition-colors ${need.purpose === k ? 'bg-fill text-white' : 'bg-surface-2 hover:bg-surface-3'}`}>
              <div className="text-[15px] font-semibold">{p.title}</div>
              <div className={`mt-0.5 text-[13px] leading-snug ${need.purpose === k ? 'text-white/80' : 'text-muted'}`}>{p.hint}</div>
            </button>
          ))}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Label text="Сумма" warn={unsure('amount_rub')}><MoneyInput id="amount" value={need.amount_rub} onChange={(v) => set({ amount_rub: v })} placeholder="1 500 000" /></Label>
          <Label text="Срок, месяцев" warn={unsure('term_months')}>
            <input id="term" className={`${input} tabular-nums`} inputMode="numeric" value={need.term_months ?? ''} onChange={(e) => set({ term_months: Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || null })} />
          </Label>
        </div>
        <div className="mt-5 text-[14px] font-medium">Есть что предложить в залог?</div>
        <div className="mt-2 flex gap-2">
          <Chip active={!need.has_collateral} onClick={() => set({ has_collateral: false })}>Нет</Chip>
          <Chip active={need.has_collateral} onClick={() => set({ has_collateral: true })}>{company.registry.kind === 'person' ? 'Да: залог или поручитель' : 'Да: недвижимость, оборудование, транспорт'}</Chip>
        </div>
        {company.registry.kind !== 'person' && company.business_months < 9 && <p className="mt-4 text-[13px] leading-snug text-warn">Бизнесу {company.business_months} мес. Кредиты Альфа-Банка для бизнеса требуют от 9 месяцев работы — на следующем шаге покажем, что доступно.</p>}
        <div className="mt-6 flex gap-3">
          <button onClick={onBack} className={ghostBtn}>Назад</button>
          <button onClick={onDone} disabled={!ready} className={primaryBtn}>Подобрать кредит</button>
        </div>
      </Card>
    </>
  )
}
