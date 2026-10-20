import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api'
import { conveyor } from '../../api/conveyor'
import type { Company, MatchItem, MemberRole, ParsedNeed, Purpose, RegistryCompany } from '../../types/conveyor'
import { innHint } from '../../lib/inn'
import { plural, rub } from '../../lib/format'
import { Card, Chip, Screen, SectionTitle } from '../ui'
import { ErrorText, Label, MoneyInput, Steps, ghostBtn, input, memberRoles, primaryBtn, purposes } from './parts'
import ApplicationForm from './ApplicationForm'

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.')
const STEPS = ['Компания', 'Что нужно', 'Продукт', 'Заявка']

export interface Need { purpose: Purpose | null; amount_rub: number | null; term_months: number | null; has_collateral: boolean }

export default function NewApplication() {
  const [step, setStep] = useState(0)
  const [company, setCompany] = useState<Company | null>(null)
  const [need, setNeed] = useState<Need>({ purpose: null, amount_rub: null, term_months: 24, has_collateral: false })
  const [appId, setAppId] = useState<string | null>(null)
  const nav = useNavigate()

  return (
    <Screen title="Новая заявка">
      <div data-span={12}><Steps items={STEPS} current={step} /></div>
      {step === 0 && <CompanyStep onDone={(c) => { setCompany(c); setStep(1) }} />}
      {step === 1 && company && <NeedStep company={company} need={need} setNeed={setNeed} onBack={() => setStep(0)} onDone={() => setStep(2)} />}
      {step === 2 && company && <ProductStep company={company} need={need} onBack={() => setStep(1)} onDone={(id) => { setAppId(id); setStep(3) }} />}
      {step === 3 && appId && <ApplicationForm id={appId} onSubmitted={() => nav(`/applications/${appId}`)} />}
    </Screen>
  )
}

// ---- 1. Компания по ИНН ----
function CompanyStep({ onDone }: { onDone: (c: Company) => void }) {
  const [list, setList] = useState<Company[] | null>(null)
  const [inn, setInn] = useState('')
  const [blurred, setBlurred] = useState(false)
  const [found, setFound] = useState<RegistryCompany | null>(null)
  const [role, setRole] = useState<MemberRole | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { conveyor.listCompanies().then(setList).catch(() => setList([])) }, [])
  const clean = inn.replace(/\D/g, '')
  const hint = innHint(inn, blurred)
  const canSearch = (clean.length === 10 || clean.length === 12) && !innHint(clean, true)

  const search = async () => {
    setBusy(true); setError(''); setFound(null)
    try { setFound(await conveyor.registry(clean)) } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  const confirm = async () => {
    if (!role) return
    setBusy(true); setError('')
    try { onDone(await conveyor.addCompany(clean, role)) } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }

  return (
    <>
      {list && list.length > 0 && (
        <Card span={12}>
          <SectionTitle>Ваши компании</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {list.map((c) => (
              <button key={c.id} onClick={() => onDone(c)} className="rounded-xl bg-surface-2 p-3.5 text-left transition-colors hover:bg-surface-3">
                <div className="font-semibold">{c.registry.name}</div>
                <div className="mt-0.5 text-[13px] text-muted">ИНН {c.registry.inn} · {memberRoles[c.member_role].title}</div>
              </button>
            ))}
          </div>
        </Card>
      )}
      <Card span={12}>
        <SectionTitle>{list?.length ? 'Другая компания' : 'Ваша компания'}</SectionTitle>
        <p className="mb-4 text-[14px] text-muted">Введите ИНН — остальное подтянем из реестра. Повторно вводить реквизиты не придётся.</p>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); if (canSearch) search() }}>
          <div className="flex-1">
            <Label text="ИНН компании или ИП">
              <input id="inn" className={`${input} tabular-nums`} inputMode="numeric" autoComplete="off" value={inn} maxLength={14} placeholder="10 или 12 цифр"
                onChange={(e) => { setInn(e.target.value); setFound(null); setBlurred(false) }} onBlur={() => setBlurred(true)} aria-invalid={!!hint} aria-describedby="inn-hint" />
            </Label>
            <p id="inn-hint" className="mt-1 min-h-[18px] text-[12px] text-accent">{hint}</p>
          </div>
          <button className={`${primaryBtn} sm:mt-[22px]`} disabled={!canSearch || busy}>{busy && !found ? 'Ищем…' : 'Найти'}</button>
        </form>
        <ErrorText>{error}</ErrorText>
        {found && (
          <div className="mt-4 rounded-2xl bg-surface-2 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[17px] font-semibold">{found.name}</div>
              <span className={`text-[13px] ${found.status === 'active' ? 'text-ok' : 'text-accent'}`}>{found.status === 'active' ? 'Действует' : 'Не действует'}</span>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
              <div><dt className="text-[12px] text-muted">{found.kind === 'ip' ? 'ОГРНИП' : 'ОГРН'}</dt><dd className="tabular-nums">{found.ogrn}</dd></div>
              <div><dt className="text-[12px] text-muted">Зарегистрирована</dt><dd>{new Date(found.registered_at).toLocaleDateString('ru-RU')}</dd></div>
              <div><dt className="text-[12px] text-muted">{found.kind === 'ip' ? 'Предприниматель' : 'Руководитель'}</dt><dd>{found.head_name}</dd></div>
              <div><dt className="text-[12px] text-muted">Основной ОКВЭД</dt><dd>{found.okved.code} · {found.okved.name}</dd></div>
            </dl>
            <p className="mt-2 text-[12px] text-muted">Источник: {found.source}</p>
            <div className="mt-4 text-[14px] font-medium">Кто вы в компании?</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(memberRoles).map(([k, r]) => <Chip key={k} active={role === k} onClick={() => setRole(k as MemberRole)}>{r.title}</Chip>)}
            </div>
            {role && memberRoles[role].needs_authority && <p className="mt-2 text-[13px] leading-snug text-warn">Банк попросит доверенность или приказ о полномочиях. Его можно будет загрузить в заявке.</p>}
            <button onClick={confirm} disabled={!role || busy} className={`${primaryBtn} mt-4`}>Это моя компания</button>
          </div>
        )}
      </Card>
    </>
  )
}

// ---- 2. Потребность ----
function NeedStep({ company, need, setNeed, onBack, onDone }: { company: Company; need: Need; setNeed: (n: Need) => void; onBack: () => void; onDone: () => void }) {
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
      <Card span={12}>
        <SectionTitle>Опишите своими словами</SectionTitle>
        <p className="mb-3 text-[14px] text-muted">Например: «Хочу открыть вторую пекарню, нужно около полутора миллионов на оборудование, лет на два». Можно пропустить и заполнить поля вручную.</p>
        <textarea aria-label="Опишите, на что нужны деньги" className={`${input} h-24 resize-none py-3`} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={parse} disabled={!text.trim() || parsing} className={ghostBtn}>{parsing ? 'Разбираем…' : 'Заполнить по описанию'}</button>
          {note && <p role="status" className="text-[14px] text-muted">{note}</p>}
        </div>
      </Card>
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
          <Chip active={need.has_collateral} onClick={() => set({ has_collateral: true })}>Да: недвижимость, оборудование, транспорт</Chip>
        </div>
        {company.business_months < 9 && <p className="mt-4 text-[13px] leading-snug text-warn">Бизнесу {company.business_months} мес. Кредиты Альфа-Банка для бизнеса требуют от 9 месяцев работы — на следующем шаге покажем, что доступно.</p>}
        <div className="mt-6 flex gap-3">
          <button onClick={onBack} className={ghostBtn}>Назад</button>
          <button onClick={onDone} disabled={!ready} className={primaryBtn}>Подобрать кредит</button>
        </div>
      </Card>
    </>
  )
}

// ---- 3. Подбор продукта ----
function ProductStep({ company, need, onBack, onDone }: { company: Company; need: Need; onBack: () => void; onDone: (applicationId: string) => void }) {
  const [items, setItems] = useState<MatchItem[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState<string | null>(null)

  useEffect(() => {
    conveyor.match({ purpose: need.purpose!, amount_rub: need.amount_rub!, term_months: need.term_months!, has_collateral: need.has_collateral, company_id: company.id })
      .then((r) => setItems(r.items)).catch((e) => setError(errText(e)))
  }, [company.id, need])

  const apply = async (m: MatchItem) => {
    setCreating(m.product_id); setError('')
    try {
      const a = await conveyor.createApplication({ company_id: company.id, product_id: m.product_id, purpose: need.purpose!, amount_rub: need.amount_rub!, term_months: need.term_months! })
      onDone(a.id)
    } catch (e) { setError(errText(e)); setCreating(null) }
  }

  const fits = items?.filter((i) => i.eligible && i.can_apply) ?? []
  return (
    <>
      <Card span={12}>
        <p className="text-[15px]">{rub(need.amount_rub)} на {need.term_months} мес. · {purposes[need.purpose!].title.toLowerCase()} · {company.registry.name}</p>
        {items && !fits.length && <p className="mt-2 text-[14px] leading-snug text-warn">С такими параметрами подходящего кредита нет. Причины — под каждым продуктом. Можно вернуться и поменять сумму, срок или залог.</p>}
        <ErrorText>{error}</ErrorText>
      </Card>
      {!items && !error && [0, 1].map((i) => <div key={i} data-span={6} className="h-40 animate-pulse rounded-[22px] bg-surface" />)}
      {items?.map((m) => (
        <Card key={m.product_id} span={6} className={m.eligible && m.can_apply ? '' : 'opacity-75'}>
          <div className="flex items-start justify-between gap-3">
            <div className="text-[16px] font-semibold leading-snug">{m.name}</div>
            <span className={`shrink-0 text-[13px] font-medium ${m.eligible && m.can_apply ? 'text-ok' : 'text-muted'}`}>{m.eligible && m.can_apply ? 'Подходит' : 'Не подходит'}</span>
          </div>
          <div className="mt-3 flex gap-6 text-[14px]">
            <div><div className="text-[12px] text-muted">Ставка</div><div className="font-semibold tabular-nums">{m.rate_from_percent != null ? `от ${String(m.rate_from_percent).replace('.', ',')}%` : 'по запросу'}</div></div>
            <div><div className="text-[12px] text-muted">Платёж в месяц</div><div className="font-semibold tabular-nums">{m.monthly_payment_rub != null ? `≈ ${rub(m.monthly_payment_rub)}` : '—'}</div></div>
          </div>
          {m.reasons.length > 0 && <ul className="mt-3 space-y-1 text-[13px] leading-snug text-muted">{m.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {m.eligible && m.can_apply && <button onClick={() => apply(m)} disabled={!!creating} className={primaryBtn}>{creating === m.product_id ? 'Создаём…' : 'Подать заявку'}</button>}
            <a href={m.url} target="_blank" rel="noreferrer" className="text-[13px] text-muted underline-offset-2 hover:text-text hover:underline">Условия на сайте банка</a>
          </div>
        </Card>
      ))}
      <div data-span={12}><button onClick={onBack} className={ghostBtn}>Назад</button></div>
      <p data-span={12} className="text-[12px] leading-snug text-muted">Платёж — предварительный, по минимальной ставке продукта. Точные условия банк определит после проверки заявки.</p>
    </>
  )
}
