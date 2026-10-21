import { useEffect, useState } from 'react'
import { errorText } from '../../../api'
import { conveyor } from '../../../api/conveyor'
import type { Company, Sphere } from '../../../types/conveyor'
import type { Plan } from '../../../types/plan'
import type { Template } from '../../../lib/projectCalc'
import CityPicker from '../../components/CityPicker'
import { rub } from '../../../lib/format'
import { Card, Chip, SectionTitle, Stat } from '../../ui'
import { ErrorText, Label, MoneyInput, ghostBtn, input, primaryBtn } from '../parts'
import { type CalculatedPlan } from './types'

// Шаг мастера: Проект: расчёт по шаблону сферы (contracts/templates.md)
const cityFromAddress = (address?: string) => address?.match(/г\.\s*([^,]+)/)?.[1]?.trim() ?? ''

export default function ProjectStep({ company, noBusiness, initial, onBack, onDone }: { company: Company | null; noBusiness: boolean; initial: CalculatedPlan | null; onBack: () => void; onDone: (c: CalculatedPlan) => void }) {
  const [list, setList] = useState<Template[] | null>(null)
  const [sphere, setSphere] = useState<Sphere | null>(null)
  const [city, setCity] = useState(initial?.plan.business.city ?? cityFromAddress(company?.registry.address))
  const [own, setOwn] = useState<number | null>(initial?.plan.finance.own_funds_rub ?? null)
  const [answers, setAnswers] = useState<Record<string, number | string>>({})
  const [result, setResult] = useState<CalculatedPlan | null>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { conveyor.templates().then(setList).catch(() => setError('Не удалось загрузить шаблоны расчёта.')) }, [])
  const tpl = list?.find((t) => t.sphere === sphere)
  const pick = (t: Template) => { setSphere(t.sphere); setAnswers(Object.fromEntries(t.questions.map((q) => [q.id, q.default]))); setResult(null) }
  const set = (id: string, v: number | string) => { setAnswers({ ...answers, [id]: v }); setResult(null) }

  const calc = async () => {
    if (!sphere) return
    setBusy(true); setError('')
    try { setResult(await conveyor.calculatePlan({ sphere, city: city.trim(), own_funds_rub: own ?? 0, answers })) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <>
      <Card span={12}>
        <SectionTitle>Какой бизнес считаем</SectionTitle>
        {!list && !error && <div className="h-12 animate-pulse rounded-xl bg-surface-2" />}
        <div className="flex flex-wrap gap-2">{list?.map((t) => <Chip key={t.sphere} active={sphere === t.sphere} onClick={() => pick(t)}>{t.title}</Chip>)}</div>
        <p className="mt-2 text-[13px] text-muted">Другой сферы пока нет в шаблонах. Цены в расчёте — оценка, их можно поправить ниже.</p>
        {tpl && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CityPicker value={city} onChange={(v) => { setCity(v); setResult(null) }} />
            <Label text="Свои деньги на запуск"><MoneyInput id="own" value={own} onChange={(v) => { setOwn(v); setResult(null) }} placeholder="0" /></Label>
            {tpl.questions.map((q) => q.kind === 'choice' ? (
              <div key={q.id} className="text-[13px] text-muted">{q.text}
                <div className="mt-1.5 flex flex-wrap gap-2">{q.options?.map((o) => <Chip key={o.value} active={answers[q.id] === o.value} onClick={() => set(q.id, o.value)}>{o.label}</Chip>)}</div>
              </div>
            ) : (
              <Label key={q.id} text={`${q.text}${q.unit ? `, ${q.unit}` : ''}`} hint={`от ${q.min} до ${q.max}`}>
                <input id={`q-${q.id}`} className={`${input} tabular-nums`} inputMode="numeric" value={answers[q.id] ?? ''} onChange={(e) => set(q.id, Number(e.target.value.replace(/\D/g, '').slice(0, 7)) || 0)} />
              </Label>
            ))}
          </div>
        )}
        <div className="mt-4"><ErrorText>{error}</ErrorText></div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={onBack} className={ghostBtn}>Назад</button>
          {tpl && <button onClick={calc} disabled={busy || !city.trim()} className={result ? ghostBtn : primaryBtn}>{busy ? 'Считаем…' : result ? 'Пересчитать' : 'Рассчитать'}</button>}
        </div>
      </Card>
      {result && <PlanSummary plan={result.plan} />}
      {result && (
        <div data-span={12} className="flex flex-wrap gap-3">
          <button onClick={() => onDone(result)} className={primaryBtn}>{noBusiness ? 'Дальше: заявка как будущий ИП' : result.plan.credit.needed ? 'Дальше: кредит на запуск' : 'Дальше'}</button>
        </div>
      )}
    </>
  )
}

const verdictTone = { ok: 'ok', risky: 'warn', not_recommended: 'bad' } as const
function PlanSummary({ plan }: { plan: Plan }) {
  const f = plan.finance, c = plan.credit
  return (
    <>
      <Card span={12} className="hero-card">
        <div className="text-[13px] text-text/60">{plan.business.sphere} · {plan.business.city}</div>
        <div className="mt-1 text-[20px] font-semibold">{plan.title}</div>
        <p className="mt-1 text-[14px] leading-snug text-text/80">{plan.summary}</p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Запуск" value={rub(f.startup_cost_rub)} />
          <Stat label="Прибыль в месяц" value={rub(f.monthly_profit_rub)} tone={f.monthly_profit_rub > 0 ? 'ok' : 'bad'} />
          <Stat label="Окупаемость" value={f.payback_months ? `${f.payback_months} мес.` : 'не окупается'} tone={f.payback_months ? undefined : 'bad'} />
          <Stat label="Не хватает своих" value={rub(f.funding_gap_rub)} tone={f.funding_gap_rub ? 'warn' : 'ok'} />
        </div>
      </Card>
      {[['Запуск, разово', f.startup_items], ['Расходы в месяц', f.monthly_items]].map(([title, items]) => (
        <Card key={title as string} span={6}>
          <SectionTitle>{title as string}</SectionTitle>
          <ul className="space-y-2 text-[14px]">
            {(items as Plan['finance']['startup_items'])?.map((i) => (
              <li key={i.title} className="flex justify-between gap-3"><span className="min-w-0"><span className="block">{i.title}</span><span className="block text-[12px] leading-snug text-muted">{i.assumption}</span></span><span className="shrink-0 tabular-nums">{rub(i.amount_rub)}</span></li>
            ))}
          </ul>
        </Card>
      ))}
      {c.needed && c.verdict && (
        <Card span={12}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SectionTitle>Кредит на запуск</SectionTitle>
            <span className={`text-[14px] font-medium ${verdictTone[c.verdict] === 'ok' ? 'text-ok' : verdictTone[c.verdict] === 'warn' ? 'text-warn' : 'text-accent'}`}>Нагрузка {c.debt_load_percent}% прибыли</span>
          </div>
          <p className="text-[14px] leading-snug">{rub(c.amount_rub)} на {c.recommended_term_months} мес., платёж около {rub(c.monthly_payment_rub)} в месяц. {c.comment}</p>
        </Card>
      )}
    </>
  )
}
