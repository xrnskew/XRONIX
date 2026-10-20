import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api'
import { bank } from '../../api/bank'
import dict from '../../data/dictionaries.json'
import type { BankApplication, BankStats, Check, DecisionKind, DeclineReason, InfoRequestKind, QueueItem, Status } from '../../types/conveyor'
import { rub } from '../../lib/format'
import { useCabinet } from '../../phone/CabinetContext'
import PlanRoute from '../../phone/PlanRoute'
import PlanScreen from '../../phone/screens/Plan'
import { Card, Logo, Screen, SectionTitle, Skeleton, Stat } from '../../phone/ui'
import { ErrorText, MoneyInput, StatusBadge, dateRu, ghostBtn, input, memberRoles, primaryBtn, productNames, purposes } from '../../phone/conveyor/parts'

// Рабочее место кредитного аналитика (/bank): очередь, карточка заявки с проверками и скорингом, решение, сводка.
// Контракт: /contracts/conveyor.md, «Рабочее место аналитика». Логика решений — docs/CONVEYOR.md, раздел 7.

const statuses = dict.statuses as Record<Status, { title: string }>
const declineReasons = dict.decline_reasons as Record<DeclineReason, { text: string }>
const infoKinds = dict.info_request_kinds as Record<InfoRequestKind, { title: string; text: string }>
const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.')

const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
)
const tabs = [
  { to: '/bank', label: 'Очередь', d: 'M4 6h16M4 12h16M4 18h10', end: true },
  { to: '/bank/stats', label: 'Сводка', d: 'M4 19V9m6 10V5m6 14v-7m4 7H2', end: false },
]

export default function BankApp() {
  const { user, signOut } = useCabinet()
  return (
    <div className="flex h-svh">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-white/5 bg-[#09090b]/80 p-4 md:flex">
        <div className="mb-6 flex items-center gap-3 px-1">
          <Logo size={36} />
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold text-brand">XRONIX · Банк</div>
            <div className="text-[12px] text-muted">Рабочее место аналитика</div>
          </div>
        </div>
        <nav className="space-y-0.5" aria-label="Разделы">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors ${isActive ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface hover:text-text'}`}>
              <Icon d={t.d} />{t.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-3 border-t border-white/5 px-1 pt-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[14px] font-semibold" aria-hidden>{user?.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-[14px] font-medium">{user?.name}</div><div className="truncate text-[12px] text-muted">{user?.email}</div></div>
          <button onClick={signOut} title="Выйти" aria-label="Выйти" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-text"><Icon d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" size={18} /></button>
        </div>
      </aside>
      <main className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col">
        {/* узкий экран: боковой панели нет — разделы и выход строкой сверху */}
        <nav className="flex items-center gap-1 border-b border-white/5 px-3 py-2 md:hidden" aria-label="Разделы">
          {tabs.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `h-9 rounded-lg px-3 text-[14px] leading-9 ${isActive ? 'bg-surface-2 text-text' : 'text-muted'}`}>{t.label}</NavLink>)}
          <button onClick={signOut} className="ml-auto h-9 px-3 text-[14px] text-muted">Выйти</button>
        </nav>
        <div className="min-h-0 flex-1">
        <Routes>
          <Route path="/bank" element={<Queue />} />
          <Route path="/bank/stats" element={<Stats />} />
          <Route path="/bank/:id" element={<CardView />} />
          <Route path="/plan" element={<PlanRoute><PlanScreen /></PlanRoute>} />
          <Route path="*" element={<Navigate to="/bank" replace />} />
        </Routes>
        </div>
      </main>
    </div>
  )
}

// ---- очередь ----
const FILTERS: { label: string; statuses: Status[] }[] = [
  { label: 'Ждут решения', statuses: ['manual_review'] },
  { label: 'Ждут клиента', statuses: ['info_requested', 'approved', 'counter_offer', 'signing'] },
  { label: 'В обработке системой', statuses: ['submitted', 'checking', 'scoring'] },
  { label: 'Завершены', statuses: ['funded', 'declined', 'withdrawn', 'cancelled'] },
  { label: 'Все', statuses: [] },
]
const waited = (m: number) => (m < 60 ? `${m} мин` : m < 1440 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${Math.floor(m / 1440)} дн`)
const gradeTone = (g: string | null) => (g === 'A' ? 'text-ok' : g === 'B' ? 'text-text' : g === 'C' ? 'text-warn' : g === 'D' ? 'text-accent' : 'text-muted')

function Queue() {
  const [filter, setFilter] = useState(0)
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState('')
  const nav = useNavigate()
  useEffect(() => {
    setItems(null)
    const load = () => bank.queue(FILTERS[filter].statuses).then((l) => { setItems(l); setError('') }).catch((e) => setError(errText(e)))
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [filter])
  return (
    <Screen title="Очередь заявок" sub="Сверху — те, что ждут дольше всех">
      <div data-span={12} className="flex flex-wrap gap-2">
        {FILTERS.map((f, i) => <button key={f.label} onClick={() => setFilter(i)} aria-pressed={filter === i} className={`min-h-9 rounded-full px-3.5 text-[14px] transition-colors ${filter === i ? 'bg-fill text-white' : 'bg-surface-2 hover:bg-surface-3'}`}>{f.label}</button>)}
      </div>
      <ErrorText>{error}</ErrorText>
      {!items && !error && <Skeleton />}
      {items?.length === 0 && <Card span={12}><p className="text-[15px] text-muted">Здесь пусто.</p></Card>}
      {items && items.length > 0 && (
        <div data-span={12} className="card-ring overflow-x-auto rounded-[22px] bg-surface">
          <table className="w-full min-w-[820px] text-left text-[14px]">
            <thead className="text-[12px] uppercase tracking-wide text-muted">
              <tr>{['Заявка', 'Компания', 'Продукт', 'Сумма и срок', 'Класс', 'Статус', 'Ждёт'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.id} onClick={() => nav(`/bank/${q.id}`)} className="cursor-pointer border-t border-white/5 transition-colors hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums"><Link to={`/bank/${q.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{q.number}</Link></td>
                  <td className="px-4 py-3"><div className="font-medium">{q.company_name}</div><div className="text-[12px] text-muted tabular-nums">ИНН {q.inn}</div></td>
                  <td className="px-4 py-3">{productNames[q.product_id]}</td>
                  <td className="px-4 py-3 tabular-nums">{rub(q.amount_rub)}<div className="text-[12px] text-muted">{q.term_months} мес.</div></td>
                  <td className={`px-4 py-3 text-[16px] font-semibold ${gradeTone(q.grade)}`}>{q.grade ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={q.status} title={statuses[q.status].title} /></td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">{waited(q.waiting_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  )
}

// ---- карточка заявки ----
const checkTitle: Record<Check['kind'], string> = { completeness: 'Полнота и корректность', egrul: 'ЕГРЮЛ / ЕГРИП', fns: 'ФНС «Прозрачный бизнес»', bki: 'Бюро кредитных историй' }
const resultTone: Record<Check['result'], string> = { ok: 'bg-ok', warn: 'bg-warn', fail: 'bg-accent', error: 'bg-muted' }
const resultText: Record<Check['result'], string> = { ok: 'в порядке', warn: 'обратить внимание', fail: 'не пройдена', error: 'сервис недоступен' }

function CardView() {
  const { id = '' } = useParams()
  const [data, setData] = useState<BankApplication | null>(null)
  const [error, setError] = useState('')
  const load = () => bank.application(id).then((d) => { setData(d); setError('') }).catch((e) => setError(errText(e)))
  useEffect(() => { setData(null); load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const status = data?.application.status
  useEffect(() => {
    if (!status || !['submitted', 'checking', 'scoring'].includes(status)) return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <Screen title="Заявка">{error ? <ErrorText>{error}</ErrorText> : <Skeleton />}</Screen>
  const a = data.application, c = a.company.registry, f = a.financials, sc = data.scoring
  return (
    <Screen title={`Заявка ${a.number}`} sub={<span className="flex flex-wrap items-center gap-2"><Link to="/bank" className="underline underline-offset-2">Очередь</Link> · {c.name} · <StatusBadge status={a.status} title={a.status_info.title} /></span>}>
      <Card span={7}>
        <SectionTitle>Запрос клиента</SectionTitle>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-3">
          <Info label="Продукт" value={productNames[a.product_id]} />
          <Info label="Сумма" value={rub(a.amount_rub)} />
          <Info label="Срок" value={`${a.term_months} мес.`} />
          <Info label="Цель" value={purposes[a.purpose]?.title ?? a.purpose} />
          <Info label="Залог" value={a.collateral ? `${(dict.collateral_kinds as Record<string, { title: string }>)[a.collateral.kind].title}: ${rub(a.collateral.value_rub)}` : 'нет'} />
          <Info label="Подана" value={data.events.find((e) => e.to_status === 'submitted') ? dateRu(data.events.find((e) => e.to_status === 'submitted')!.at) : '—'} />
        </dl>
        {a.collateral?.description && <p className="mt-2 text-[13px] text-muted">{a.collateral.description}</p>}
        {a.plan_id && <Link to={`/plan?plan=${encodeURIComponent(a.plan_id)}`} className="mt-3 inline-block text-[14px] font-medium underline underline-offset-2">Расчёт проекта клиента</Link>}
      </Card>
      <Card span={5}>
        <SectionTitle>Заявитель и компания</SectionTitle>
        <dl className="space-y-2 text-[14px]">
          <Info label="Заявитель" value={`${data.applicant.name} · ${memberRoles[data.applicant.member_role].title}`} />
          <Info label={c.kind === 'person' ? 'Будущий ИП, личный ИНН' : 'ИНН / ОГРН'} value={c.kind === 'person' ? c.inn : `${c.inn} / ${c.ogrn}`} />
          {c.okved && <Info label="ОКВЭД" value={`${c.okved.code} · ${c.okved.name}`} />}
          <Info label="Финансы за 12 мес." value={f.revenue_12m_rub != null ? `выручка ${rub(f.revenue_12m_rub)}, расходы ${rub(f.expenses_12m_rub)}` : 'бизнеса ещё нет — по расчёту проекта'} />
          <Info label="Платежи по кредитам" value={`${rub(f.loan_payments_monthly_rub)} в месяц`} />
        </dl>
        {a.documents.length > 0 && <p className="mt-3 text-[13px] text-muted">Документы: {a.documents.map((d) => d.filename).join(', ')}</p>}
        {a.info_request === null && a.timeline.some((t) => t.text === 'Данные отправлены') && <p className="mt-2 text-[13px] text-muted">Клиент ответил на запрос данных.</p>}
      </Card>

      <Card span={7}>
        <SectionTitle>Проверки</SectionTitle>
        {!data.checks.length && <p className="text-[14px] text-muted">Проверки ещё не выполнялись.</p>}
        <ul className="space-y-2">
          {data.checks.map((ch) => (
            <li key={ch.kind} className="rounded-xl bg-surface-2 p-3">
              <details>
                <summary className="flex cursor-pointer list-none items-start gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${resultTone[ch.result]}`} aria-hidden />
                  <span className="min-w-0 flex-1"><span className="text-[14px] font-medium">{checkTitle[ch.kind]}</span><span className="text-[13px] text-muted"> · {resultText[ch.result]}</span><span className="block text-[14px] leading-snug">{ch.summary}</span></span>
                  <span className="shrink-0 text-[12px] text-muted">{ch.source}</span>
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2.5 text-[12px] text-muted">{JSON.stringify(ch.details, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ul>
      </Card>
      <Card span={5}>
        <SectionTitle>Скоринг</SectionTitle>
        {!sc ? <p className="text-[14px] text-muted">{a.status === 'declined' ? 'Не считался: сработал стоп-фактор на проверке.' : 'Ещё не посчитан.'}</p> : (
          <>
            <div className="flex items-end gap-5">
              <div><div className="text-[12px] text-muted">Балл</div><div className="font-display text-[40px] font-semibold leading-none tabular-nums">{sc.score}</div></div>
              <div><div className="text-[12px] text-muted">Класс</div><div className={`font-display text-[40px] font-semibold leading-none ${gradeTone(sc.grade)}`}>{sc.grade}</div></div>
              <Stat label="Нагрузка" value={sc.debt_load_percent == null ? '—' : `${String(sc.debt_load_percent).replace('.', ',')}%`} tone={sc.debt_load_percent != null && sc.debt_load_percent > 50 ? 'bad' : undefined} />
            </div>
            <table className="mt-4 w-full text-[13px]">
              <tbody>
                <tr className="text-muted"><td className="py-1">Базовый балл</td><td /><td className="py-1 text-right tabular-nums">50</td></tr>
                {sc.factors.map((x) => (
                  <tr key={x.code} className="border-t border-white/5"><td className="py-1.5">{x.name}</td><td className="py-1.5 text-muted">{x.value_text}</td><td className={`py-1.5 text-right font-semibold tabular-nums ${x.points > 0 ? 'text-ok' : x.points < 0 ? 'text-accent' : 'text-muted'}`}>{x.points > 0 ? '+' : ''}{x.points}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[12px] text-muted">Правила {sc.rules_version}. Итог в пределах 0–100.</p>
          </>
        )}
      </Card>

      <Card span={7}>
        <SectionTitle>Журнал</SectionTitle>
        <ol className="space-y-2">
          {[...data.events].reverse().map((e) => (
            <li key={e.id} className="text-[14px]">
              <span className="font-medium">{statuses[e.to_status].title}</span>
              <span className="text-muted"> · {e.actor_name} · {dateRu(e.at)}</span>
              {e.reason && <span className="block text-[13px] leading-snug text-muted">{e.reason}</span>}
            </li>
          ))}
        </ol>
      </Card>
      <div data-span={5} className="space-y-4">
        {data.recommendation && (
          <Card>
            <SectionTitle>Рекомендация системы</SectionTitle>
            <p className="text-[14px] leading-snug">{data.recommendation.text}</p>
            {data.recommendation.amount_rub != null && <p className="mt-2 text-[13px] text-muted">{rub(data.recommendation.amount_rub)} на {data.recommendation.term_months} мес. под {String(data.recommendation.rate_percent).replace('.', ',')}%</p>}
          </Card>
        )}
        {a.status === 'manual_review' ? <Decision data={data} onDone={setData} onConflict={load} /> : <Outcome data={data} />}
      </div>
    </Screen>
  )
}

const Info = ({ label, value }: { label: string; value: ReactNode }) => <div><dt className="text-[12px] text-muted">{label}</dt><dd className="leading-snug">{value}</dd></div>

function Outcome({ data }: { data: BankApplication }) {
  const a = data.application
  return (
    <Card>
      <SectionTitle>Итог</SectionTitle>
      <p className="text-[14px]">{a.status_info.title}. {a.status_info.now}</p>
      {a.offer && <p className="mt-2 text-[14px] tabular-nums">{a.offer.kind === 'counter' ? 'Встречное предложение' : 'Условия'}: {rub(a.offer.amount_rub)}, {a.offer.term_months} мес., {String(a.offer.rate_percent).replace('.', ',')}%, платёж {rub(a.offer.monthly_payment_rub)}</p>}
      {a.decline && <ul className="mt-2 space-y-1 text-[14px]">{a.decline.reasons.map((r) => <li key={r.code}>• {r.text}</li>)}{a.decline.comment && <li className="text-muted">Комментарий: {a.decline.comment}</li>}</ul>}
      {a.info_request && <ul className="mt-2 space-y-1 text-[14px]">{a.info_request.items.map((i) => <li key={i.kind}>• {i.text}</li>)}</ul>}
    </Card>
  )
}

// ---- решение аналитика ----
const KINDS: { kind: DecisionKind; label: string }[] = [
  { kind: 'approve', label: 'Одобрить' }, { kind: 'counter', label: 'Другие условия' }, { kind: 'request_info', label: 'Запросить данные' }, { kind: 'decline', label: 'Отказать' },
]
function Decision({ data, onDone, onConflict }: { data: BankApplication; onDone: (d: BankApplication) => void; onConflict: () => void }) {
  const a = data.application, rec = data.recommendation
  const [kind, setKind] = useState<DecisionKind>(rec?.kind === 'counter' ? 'counter' : 'approve')
  const [amount, setAmount] = useState<number | null>(rec?.amount_rub ?? a.amount_rub)
  const [term, setTerm] = useState<number | null>(rec?.term_months ?? a.term_months)
  const [rate, setRate] = useState(String(rec?.rate_percent ?? '').replace('.', ','))
  const [comment, setComment] = useState('')
  const [reasons, setReasons] = useState<DeclineReason[]>([])
  const [info, setInfo] = useState<InfoRequestKind[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const send = async () => {
    setBusy(true); setError('')
    const rateNum = Number(rate.replace(',', '.'))
    try {
      const body = kind === 'approve' || kind === 'counter'
        ? { kind, version: a.version, amount_rub: amount ?? undefined, term_months: term ?? undefined, rate_percent: rate ? rateNum : undefined, comment }
        : kind === 'request_info'
          ? { kind, version: a.version, info_items: info.map((k) => ({ kind: k, text: k === 'other' ? comment : infoKinds[k].text })), comment }
          : { kind, version: a.version, decline_reasons: reasons, comment }
      onDone(await bank.decide(a.id, body))
    } catch (e) {
      setError(errText(e))
      if (e instanceof ApiError && (e.code === 'VERSION_CONFLICT' || e.code === 'INVALID_TRANSITION')) onConflict()
    } finally { setBusy(false) }
  }

  const label = 'block text-[13px] text-muted'
  return (
    <Card>
      <SectionTitle>Решение</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-surface-2 p-1" role="tablist">
        {KINDS.map((k) => <button key={k.kind} role="tab" aria-selected={kind === k.kind} onClick={() => { setKind(k.kind); setError('') }} className={`h-9 rounded-lg text-[13px] font-medium ${kind === k.kind ? (k.kind === 'decline' ? 'bg-accent text-white' : 'bg-fill text-white') : 'text-muted hover:text-text'}`}>{k.label}</button>)}
      </div>
      <div className="mt-4 space-y-3">
        {(kind === 'approve' || kind === 'counter') && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>Сумма<div className="mt-1"><MoneyInput id="dec-amount" value={amount} onChange={setAmount} /></div></label>
              <label className={label}>Срок, мес.<input id="dec-term" className={`${input} mt-1 tabular-nums`} inputMode="numeric" value={term ?? ''} onChange={(e) => setTerm(Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || null)} /></label>
            </div>
            <label className={label}>Ставка, % годовых<input id="dec-rate" className={`${input} mt-1 tabular-nums`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d,.]/g, '').slice(0, 5))} /></label>
          </>
        )}
        {kind === 'request_info' && (
          <fieldset className="space-y-2"><legend className={label}>Что запросить</legend>
            {(Object.keys(infoKinds) as InfoRequestKind[]).map((k) => (
              <label key={k} className="flex items-center gap-2.5 text-[14px]"><input type="checkbox" className="h-4 w-4 accent-[#ff4538]" checked={info.includes(k)} onChange={() => setInfo(toggle(info, k))} />{infoKinds[k].title}</label>
            ))}
          </fieldset>
        )}
        {kind === 'decline' && (
          <fieldset className="space-y-2"><legend className={label}>Причины</legend>
            {(['low_score', 'high_debt_load', 'overdue_90', 'tax_debt', 'own_funds_low', 'analyst_decision'] as DeclineReason[]).map((k) => (
              <label key={k} className="flex items-start gap-2.5 text-[14px] leading-snug"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff4538]" checked={reasons.includes(k)} onChange={() => setReasons(toggle(reasons, k))} />{declineReasons[k].text.replace(/\{\w+\}\s?/g, '').replace(/ ₽\./, '.')}</label>
            ))}
          </fieldset>
        )}
        <label className={label}>{kind === 'approve' ? 'Комментарий клиенту (необязательно)' : kind === 'request_info' ? 'Комментарий клиенту' : 'Комментарий клиенту (обязательно)'}
          <textarea id="dec-comment" className={`${input} mt-1 h-20 resize-none py-2.5`} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      </div>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
      <div className="mt-3 flex gap-3">
        <button onClick={send} disabled={busy} className={kind === 'decline' ? `${ghostBtn} text-accent` : primaryBtn}>{busy ? 'Отправляем…' : KINDS.find((k) => k.kind === kind)!.label}</button>
      </div>
    </Card>
  )
}

// ---- сводка ----
function Stats() {
  const [s, setS] = useState<BankStats | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { bank.stats().then(setS).catch((e) => setError(errText(e))) }, [])
  if (!s) return <Screen title="Сводка">{error ? <ErrorText>{error}</ErrorText> : <Skeleton />}</Screen>
  const order: Status[] = ['submitted', 'checking', 'scoring', 'manual_review', 'info_requested', 'approved', 'counter_offer', 'signing', 'funded', 'declined', 'withdrawn', 'cancelled']
  const total = Object.values(s.by_status).reduce((a, b) => a + (b ?? 0), 0)
  const max = Math.max(1, ...Object.values(s.by_status).map((v) => v ?? 0))
  return (
    <Screen title="Сводка" sub="Все поданные заявки">
      <Card span={12}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Заявок подано" value={String(total)} />
          <Stat label="Ждут решения специалиста" value={String(s.by_status.manual_review ?? 0)} tone={s.by_status.manual_review ? 'warn' : undefined} />
          <Stat label="Решено автоматически" value={`${Math.round(s.auto_decision_share * 100)}%`} />
          <Stat label="Среднее время до решения" value={s.avg_minutes_to_decision == null ? '—' : `${String(s.avg_minutes_to_decision).replace('.', ',')} мин`} />
        </div>
      </Card>
      <Card span={12}>
        <SectionTitle>По статусам</SectionTitle>
        <ul className="space-y-2">
          {order.filter((k) => s.by_status[k]).map((k) => (
            <li key={k} className="grid grid-cols-[170px_1fr_40px] items-center gap-3 text-[14px]">
              <span>{statuses[k].title}</span>
              <span className="h-2.5 rounded-full bg-surface-3"><span className="block h-full rounded-full bg-accent" style={{ width: `${(s.by_status[k]! / max) * 100}%` }} /></span>
              <span className="text-right tabular-nums">{s.by_status[k]}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Screen>
  )
}
