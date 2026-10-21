import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../../api'
import { conveyor } from '../../api/conveyor'
import type { Company, MatchItem, MemberRole, ParsedNeed, Purpose, RegistryCompany, Sphere } from '../../types/conveyor'
import type { Plan } from '../../types/plan'
import type { Template } from '../../lib/projectCalc'
import CityPicker from '../components/CityPicker'
import { innHint } from '../../lib/inn'
import { plural, rub } from '../../lib/format'
import { Card, Chip, Screen, SectionTitle, Stat } from '../ui'
import { ErrorText, Label, MoneyInput, Steps, ghostBtn, input, memberRoles, primaryBtn, purposes } from './parts'
import ApplicationForm from './ApplicationForm'

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.')
type Path = 'current' | 'new_point' | 'no_business'
const PATHS: Record<Path, string[]> = {
  current: ['Цель', 'Компания', 'Что нужно', 'Продукт', 'Заявка'],
  new_point: ['Цель', 'Компания', 'Проект', 'Что нужно', 'Продукт', 'Заявка'],
  no_business: ['Цель', 'Проект', 'Основатель', 'Что нужно', 'Продукт', 'Заявка'],
}

export interface Need { purpose: Purpose | null; amount_rub: number | null; term_months: number | null; has_collateral: boolean }
export interface CalculatedPlan { plan_id: string; plan: Plan }

// Три пути (docs/CONVEYOR.md, раздел 3): кредит текущему бизнесу; новая точка или направление — сначала расчёт проекта;
// бизнеса пока нет — расчёт проекта, заявка как будущий ИП на демо-продукт «Старт».
// ?plan=<id> — пришли из чата подбора бизнеса с готовым планом: шаг «Проект» пропускаем.
export default function NewApplication() {
  const planParam = new URLSearchParams(useLocation().search).get('plan')
  const [path, setPath] = useState<Path>('current')
  const [step, setStep] = useState(0)
  const [company, setCompany] = useState<Company | null>(null)
  const [project, setProject] = useState<CalculatedPlan | null>(null)
  const [preset, setPreset] = useState<CalculatedPlan | null>(null)
  const [presetError, setPresetError] = useState('')
  useEffect(() => {
    if (!planParam) return
    api.getPlan(planParam).then((r) => setPreset({ plan_id: r.plan_id, plan: r.plan })).catch(() => setPresetError('Не удалось открыть план из чата. Можно посчитать проект заново.'))
  }, [planParam])
  const [need, setNeed] = useState<Need>({ purpose: null, amount_rub: null, term_months: 24, has_collateral: false })
  const [appId, setAppId] = useState<string | null>(null)
  const nav = useNavigate()
  const steps = preset && path !== 'current' ? PATHS[path].filter((s) => s !== 'Проект') : PATHS[path], name = steps[step]
  const next = () => setStep(step + 1), back = () => setStep(step - 1)

  const usePlan = (c: CalculatedPlan) => {
    setProject(c)
    const credit = c.plan.credit
    setNeed({ purpose: need.purpose === 'new_direction' ? 'new_direction' : 'new_location', amount_rub: credit.amount_rub ?? (c.plan.finance.funding_gap_rub || null), term_months: credit.recommended_term_months ?? 36, has_collateral: false })
  }
  const fromPlan = (c: CalculatedPlan) => { usePlan(c); next() }

  return (
    <Screen title="Новая заявка" bodyClass="wizard">
      <div data-span={12}><Steps items={steps} current={step} /></div>
      {presetError && <div data-span={12}><ErrorText>{presetError}</ErrorText></div>}
      {name === 'Цель' && <GoalStep preset={preset} onPick={(p) => { setPath(p); if (preset && p !== 'current') usePlan(preset); else setProject(null); setStep(1) }} />}
      {name === 'Компания' && <CompanyStep onDone={(c) => { setCompany(c); next() }} />}
      {name === 'Проект' && <ProjectStep company={company} noBusiness={path === 'no_business'} initial={project} onBack={back} onDone={fromPlan} />}
      {name === 'Основатель' && <FounderStep onBack={back} onDone={(c) => { setCompany(c); next() }} />}
      {name === 'Что нужно' && company && <NeedStep company={company} need={need} setNeed={setNeed} project={project} onBack={back} onDone={next} />}
      {name === 'Продукт' && company && <ProductStep company={company} need={need} planId={project?.plan_id ?? null} onBack={back} onDone={(id) => { setAppId(id); next() }} />}
      {name === 'Заявка' && appId && <ApplicationForm id={appId} onSubmitted={() => nav(`/applications/${appId}`)} />}
    </Screen>
  )
}

// ---- 0. Цель ----
const GOALS: { path: Path; title: string; text: string }[] = [
  { path: 'current', title: 'Кредит для текущего бизнеса', text: 'Оборот, оборудование, недвижимость или рефинансирование. Сразу к подбору кредита.' },
  { path: 'new_point', title: 'Открыть новую точку или направление', text: 'Сначала посчитаем проект: вложения, расходы, прибыль. Сумма из расчёта попадёт в заявку.' },
  { path: 'no_business', title: 'У меня пока нет бизнеса', text: 'Посчитаем запуск и подадим заявку как будущий ИП на демо-продукт «Старт».' },
]
function GoalStep({ preset, onPick }: { preset: CalculatedPlan | null; onPick: (p: Path) => void }) {
  const goals = preset ? [
    { path: 'new_point' as Path, title: 'У меня есть бизнес — это будет новая точка', text: 'Выберите компанию: сумма и срок кредита придут из плана.' },
    { path: 'no_business' as Path, title: 'Бизнеса пока нет', text: 'Заявка как будущий ИП на демо-продукт «Старт»: нужен залог или поручитель и не меньше 20% своих денег.' },
  ] : GOALS
  return (
    <>
      {preset && (
        <Card span={12} className="hero-card">
          <div className="text-[13px] text-text/60">План из чата</div>
          <div className="mt-1 text-[18px] font-semibold">{preset.plan.title}</div>
          <p className="mt-1 text-[14px] text-text/80">Запуск {rub(preset.plan.finance.startup_cost_rub)}, своих {rub(preset.plan.finance.own_funds_rub)}, не хватает {rub(preset.plan.finance.funding_gap_rub)}. Как будете запускать?</p>
        </Card>
      )}
      {goals.map((g) => (
        <button key={g.path} onClick={() => onPick(g.path)} data-span={12} className="card-ring block w-full rounded-[22px] bg-surface p-5 text-left transition-colors hover:bg-surface-2 lg:p-6">
          <div className="text-[18px] font-semibold">{g.title}</div>
          <div className="mt-1 text-[14px] leading-snug text-muted">{g.text}</div>
        </button>
      ))}
    </>
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

  useEffect(() => { conveyor.listCompanies().then((l) => setList(l.filter((c) => c.registry.kind !== 'person'))).catch(() => setList([])) }, [])
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
              <div><dt className="text-[12px] text-muted">Зарегистрирована</dt><dd>{found.registered_at ? new Date(found.registered_at).toLocaleDateString('ru-RU') : '—'}</dd></div>
              <div><dt className="text-[12px] text-muted">{found.kind === 'ip' ? 'Предприниматель' : 'Руководитель'}</dt><dd>{found.head_name}</dd></div>
              <div><dt className="text-[12px] text-muted">Основной ОКВЭД</dt><dd>{found.okved ? `${found.okved.code} · ${found.okved.name}` : '—'}</dd></div>
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
function NeedStep({ company, need, setNeed, project, onBack, onDone }: { company: Company; need: Need; setNeed: (n: Need) => void; project: CalculatedPlan | null; onBack: () => void; onDone: () => void }) {
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

// ---- 3. Подбор продукта ----
function ProductStep({ company, need, planId, onBack, onDone }: { company: Company; need: Need; planId: string | null; onBack: () => void; onDone: (applicationId: string) => void }) {
  const [items, setItems] = useState<MatchItem[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState<string | null>(null)

  useEffect(() => {
    conveyor.match({ purpose: need.purpose!, amount_rub: need.amount_rub!, term_months: need.term_months!, has_collateral: need.has_collateral, company_id: company.id, plan_id: planId })
      .then((r) => setItems(r.items)).catch((e) => setError(errText(e)))
  }, [company.id, need, planId])

  const apply = async (m: MatchItem) => {
    setCreating(m.product_id); setError('')
    try {
      const a = await conveyor.createApplication({ company_id: company.id, product_id: m.product_id, purpose: need.purpose!, amount_rub: need.amount_rub!, term_months: need.term_months!, plan_id: planId })
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
            <div className="min-w-0">
              <div className="text-[16px] font-semibold leading-snug">{m.name}</div>
              {m.demo && <span className="mt-1 inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-[12px] text-muted">Демо-продукт XRONIX, не продукт Альфа-Банка</span>}
            </div>
            <span className={`shrink-0 text-[13px] font-medium ${m.eligible && m.can_apply ? 'text-ok' : 'text-muted'}`}>{m.eligible && m.can_apply ? 'Подходит' : 'Не подходит'}</span>
          </div>
          <div className="mt-3 flex gap-6 text-[14px]">
            <div><div className="text-[12px] text-muted">Ставка</div><div className="font-semibold tabular-nums">{m.rate_from_percent != null ? `от ${String(m.rate_from_percent).replace('.', ',')}%` : 'по запросу'}</div></div>
            <div><div className="text-[12px] text-muted">Платёж в месяц</div><div className="font-semibold tabular-nums">{m.monthly_payment_rub != null ? `≈ ${rub(m.monthly_payment_rub)}` : '—'}</div></div>
          </div>
          {m.reasons.length > 0 && <ul className="mt-3 space-y-1 text-[13px] leading-snug text-muted">{m.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {m.eligible && m.can_apply && <button onClick={() => apply(m)} disabled={!!creating} className={primaryBtn}>{creating === m.product_id ? 'Создаём…' : 'Подать заявку'}</button>}
            {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="text-[13px] text-muted underline-offset-2 hover:text-text hover:underline">Условия на сайте банка</a>}
          </div>
        </Card>
      ))}
      <div data-span={12}><button onClick={onBack} className={ghostBtn}>Назад</button></div>
      <p data-span={12} className="text-[12px] leading-snug text-muted">Платёж — предварительный, по минимальной ставке продукта. Точные условия банк определит после проверки заявки.</p>
    </>
  )
}

// ---- Проект: расчёт по шаблону сферы (contracts/templates.md) ----
const cityFromAddress = (address?: string) => address?.match(/г\.\s*([^,]+)/)?.[1]?.trim() ?? ''

function ProjectStep({ company, noBusiness, initial, onBack, onDone }: { company: Company | null; noBusiness: boolean; initial: CalculatedPlan | null; onBack: () => void; onDone: (c: CalculatedPlan) => void }) {
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
    try { setResult(await conveyor.calculatePlan({ sphere, city: city.trim(), own_funds_rub: own ?? 0, answers })) } catch (e) { setError(errText(e)) } finally { setBusy(false) }
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

// ---- Основатель: бизнеса ещё нет, заявка как будущий ИП по личному ИНН ----
function FounderStep({ onBack, onDone }: { onBack: () => void; onDone: (c: Company) => void }) {
  const [list, setList] = useState<Company[]>([])
  const [inn, setInn] = useState('')
  const [blurred, setBlurred] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { conveyor.listCompanies().then((l) => setList(l.filter((c) => c.registry.kind === 'person'))).catch(() => {}) }, [])
  const clean = inn.replace(/\D/g, '')
  const hint = clean && clean.length !== 12 && blurred ? 'Личный ИНН — 12 цифр' : innHint(inn, blurred)
  const ok = clean.length === 12 && !innHint(clean, true)
  const go = async () => {
    setBusy(true); setError('')
    try { onDone(await conveyor.addCompany(clean, 'owner', true)) } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  return (
    <Card span={12}>
      <SectionTitle>Заявка как будущий ИП</SectionTitle>
      <p className="mb-4 text-[14px] leading-snug text-muted">Бизнеса ещё нет — кредит оформим на вас, а ИП нужно будет зарегистрировать до подписания договора. Для проверки кредитной истории нужен личный ИНН: 12 цифр, есть в Госуслугах и в налоговой.</p>
      {list.map((c) => (
        <button key={c.id} onClick={() => onDone(c)} className="mb-3 block w-full rounded-xl bg-surface-2 p-3.5 text-left hover:bg-surface-3">
          <div className="font-semibold">{c.registry.name}</div><div className="text-[13px] text-muted">ИНН {c.registry.inn}</div>
        </button>
      ))}
      <form className="flex flex-col gap-3 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); if (ok) go() }}>
        <div className="flex-1">
          <Label text="Личный ИНН">
            <input id="person-inn" className={`${input} tabular-nums`} inputMode="numeric" autoComplete="off" value={inn} maxLength={14} placeholder="12 цифр"
              onChange={(e) => { setInn(e.target.value); setBlurred(false) }} onBlur={() => setBlurred(true)} aria-invalid={!!hint} aria-describedby="person-inn-hint" />
          </Label>
          <p id="person-inn-hint" className="mt-1 min-h-[18px] text-[12px] text-accent">{hint}</p>
        </div>
        <button className={`${primaryBtn} sm:mt-[22px]`} disabled={!ok || busy}>{busy ? 'Сохраняем…' : 'Продолжить'}</button>
      </form>
      <ErrorText>{error}</ErrorText>
      <button onClick={onBack} className={`${ghostBtn} mt-2`}>Назад</button>
    </Card>
  )
}
