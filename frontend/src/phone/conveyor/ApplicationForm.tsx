import { useEffect, useRef, useState } from 'react'
import { ApiError, USE_MOCKS } from '../../api'
import { conveyor } from '../../api/conveyor'
import { demoFinancials } from '../../api/mockData'
import type { Application, ApplicationDraft, Collateral, CollateralKind, Financials } from '../../types/conveyor'
import { rub } from '../../lib/format'
import { Card, Chip, SectionTitle, Skeleton } from '../ui'
import { ErrorText, Label, MoneyInput, collateralKinds, input, primaryBtn, productNames, purposes } from './parts'

const FIELD_TEXT: Record<string, string> = {
  'financials.revenue_12m_rub': 'выручка за 12 месяцев',
  'financials.expenses_12m_rub': 'расходы за 12 месяцев',
  'financials.loan_payments_monthly_rub': 'платежи по текущим кредитам (0, если кредитов нет)',
  collateral: 'залог',
  consent_bki: 'согласие на запрос кредитной истории',
}

// Черновик заявки: сохраняется сам через полсекунды после правки, подача — кнопкой.
export default function ApplicationForm({ id, onSubmitted }: { id: string; onSubmitted: (a: Application) => void }) {
  const [app, setApp] = useState<Application | null>(null)
  const [fin, setFin] = useState<Financials>({ revenue_12m_rub: null, expenses_12m_rub: null, loan_payments_monthly_rub: null })
  const [col, setCol] = useState<Collateral | null>(null)
  const [consent, setConsent] = useState(false)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const version = useRef(1)
  const pending = useRef<Promise<void>>(Promise.resolve())
  const dirty = useRef(false)

  const load = (a: Application) => { setApp(a); version.current = a.version; setFin(a.financials); setCol(a.collateral); setConsent(a.consent_bki) }
  useEffect(() => { conveyor.getApplication(id).then(load).catch(() => setError('Не удалось загрузить заявку.')) }, [id])

  // Сохраняем последовательно, чтобы версия всегда была свежей
  const save = (patch: ApplicationDraft) => {
    pending.current = pending.current.then(async () => {
      setSaved('saving')
      try { const a = await conveyor.patchApplication(id, { ...patch, version: version.current }); version.current = a.version; setApp(a); setSaved('saved') }
      catch (e) {
        if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') { load(await conveyor.getApplication(id)); setError('Заявку изменили в другой вкладке. Показываем актуальную версию.') }
        else setError(e instanceof ApiError ? e.message : 'Не удалось сохранить черновик.')
        setSaved('idle')
      }
    })
    return pending.current
  }
  useEffect(() => {
    if (!app || !dirty.current) return
    const t = setTimeout(() => { dirty.current = false; save({ financials: fin, collateral: col, consent_bki: consent }) }, 500)
    return () => clearTimeout(t)
  }, [fin, col, consent]) // eslint-disable-line react-hooks/exhaustive-deps
  const edit = <T,>(setter: (v: T) => void) => (v: T) => { dirty.current = true; setter(v) }

  if (!app) return error ? <ErrorText>{error}</ErrorText> : <Skeleton />
  const needsCollateral = app.product_id === 'secured'
  const example = USE_MOCKS ? demoFinancials[app.company.registry.inn] : undefined

  const submit = async () => {
    setSubmitting(true); setError('')
    try {
      if (dirty.current) { dirty.current = false; await save({ financials: fin, collateral: col, consent_bki: consent }) } else await pending.current
      onSubmitted(await conveyor.submit(id, version.current))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось подать заявку. Попробуйте ещё раз.')
      conveyor.getApplication(id).then(load).catch(() => {})
    } finally { setSubmitting(false) }
  }

  return (
    <>
      <Card span={12}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>Заявка {app.number}</SectionTitle>
          <span className="text-[13px] text-muted" role="status">{saved === 'saving' ? 'Сохраняем…' : saved === 'saved' ? 'Черновик сохранён' : ''}</span>
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[12px] text-muted">Компания</dt><dd>{app.company.registry.name}</dd></div>
          <div><dt className="text-[12px] text-muted">Продукт</dt><dd>{productNames[app.product_id]}</dd></div>
          <div><dt className="text-[12px] text-muted">Сумма и срок</dt><dd className="tabular-nums">{rub(app.amount_rub)} · {app.term_months} мес.</dd></div>
          <div><dt className="text-[12px] text-muted">Цель</dt><dd>{purposes[app.purpose].title}</dd></div>
        </dl>
        {example && <button onClick={() => { dirty.current = true; setFin(example.financials); if (example.collateral) setCol(example.collateral); setConsent(true) }} className="mt-3 text-[13px] text-muted underline underline-offset-2 hover:text-text">Демо: заполнить данными компании-сценария</button>}
      </Card>

      <Card span={needsCollateral ? 6 : 12}>
        <SectionTitle>Финансы за последние 12 месяцев</SectionTitle>
        <div className={`grid gap-4 ${needsCollateral ? '' : 'sm:grid-cols-3'}`}>
          <Label text="Выручка"><MoneyInput id="revenue" value={fin.revenue_12m_rub} onChange={edit((v) => setFin({ ...fin, revenue_12m_rub: v }))} /></Label>
          <Label text="Расходы"><MoneyInput id="expenses" value={fin.expenses_12m_rub} onChange={edit((v) => setFin({ ...fin, expenses_12m_rub: v }))} /></Label>
          <Label text="Платежи по кредитам в месяц" hint="Все текущие кредиты и лизинг. Нет кредитов — 0."><MoneyInput id="loans" value={fin.loan_payments_monthly_rub} onChange={edit((v) => setFin({ ...fin, loan_payments_monthly_rub: v }))} /></Label>
        </div>
      </Card>

      {needsCollateral && (
        <Card span={6}>
          <SectionTitle>Залог</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {Object.entries(collateralKinds).map(([k, c]) => <Chip key={k} active={col?.kind === k} onClick={() => edit(setCol)({ kind: k as CollateralKind, description: col?.description ?? '', value_rub: col?.value_rub ?? 0 })}>{c.title}</Chip>)}
          </div>
          {col && (
            <div className="mt-4 grid gap-4">
              <Label text="Что именно"><input id="col-desc" className={input} maxLength={300} value={col.description} onChange={(e) => edit(setCol)({ ...col, description: e.target.value })} placeholder="Например: два грузовика 2022 года" /></Label>
              <Label text="Оценочная стоимость"><MoneyInput id="col-value" value={col.value_rub || null} onChange={edit((v) => setCol({ ...col, value_rub: v ?? 0 }))} /></Label>
            </div>
          )}
        </Card>
      )}

      <Card span={12}>
        <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-snug">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#ff4538]" checked={consent} onChange={(e) => edit(setConsent)(e.target.checked)} />
          <span>Согласен на запрос кредитной истории компании в бюро кредитных историй<span className="block text-[13px] text-muted">В демо запрос смоделирован, данные синтетические.</span></span>
        </label>
        {app.missing_fields.length > 0 && (
          <div className="mt-4 rounded-xl bg-surface-2 p-3.5 text-[14px]">
            <div className="font-medium">Чтобы подать заявку, заполните:</div>
            <ul className="mt-1 text-muted">{app.missing_fields.map((f) => <li key={f}>• {FIELD_TEXT[f] ?? f}</li>)}</ul>
          </div>
        )}
        <div className="mt-4"><ErrorText>{error}</ErrorText></div>
        <button onClick={submit} disabled={submitting || app.missing_fields.length > 0 || saved === 'saving'} className={`${primaryBtn} mt-4`}>{submitting ? 'Отправляем…' : 'Подать заявку'}</button>
      </Card>
    </>
  )
}
