import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { errorText } from '../../api'
import { conveyor } from '../../api/conveyor'
import { AUTO_STATUSES, type Application, type Offer } from '../../types/conveyor'
import { decimal, rub } from '../../lib/format'
import { Card, Screen, SectionTitle, Skeleton, Stat } from '../ui'
import { ErrorText, StatusBadge, dateRu, ghostBtn, input, primaryBtn, productNames, whoseMove } from './parts'
import { ConveyorTrack } from './Track'
import { useCountUp } from '../../lib/useCountUp'
import { usePolling } from '../../lib/usePolling'
import ApplicationForm from './ApplicationForm'



// Отказ по стоп-фактору случается на проверке, до оценки: тогда крестик на «Проверке», а не на «Решении»
const stopStage = (a: Application) => a.status === 'declined' && !a.timeline.some((t) => t.status === 'scoring') ? 1 : undefined

export default function ApplicationView() {
  const { id = '' } = useParams()
  const [app, setApp] = useState<Application | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  const reload = () => conveyor.getApplication(id).then((a) => { if (alive.current) { setApp(a); setError('') } }).catch((e) => alive.current && setError(errorText(e)))
  useEffect(() => { alive.current = true; setApp(null); reload(); return () => { alive.current = false } }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Пока заявка движется сама, опрашиваем раз в 2 с; у специалиста — реже
  const status = app?.status
  usePolling(reload, status === 'manual_review' ? 5000 : 2000, !!status && (AUTO_STATUSES.includes(status) || status === 'manual_review'))

  const act = async (action: 'accept' | 'reject-offer' | 'sign' | 'withdraw') => {
    if (!app) return
    setBusy(true); setError('')
    try { setApp(await conveyor.action(app.id, action, app.version)) } catch (e) { setError(errorText(e)); reload() } finally { setBusy(false) }
  }

  if (!app) return <Screen title="Заявка">{error ? <ErrorText>{error}</ErrorText> : <Skeleton />}</Screen>
  if (app.status === 'draft') return <Screen title={`Заявка ${app.number}`} sub="Черновик: заполните и подайте"><ApplicationForm id={app.id} onSubmitted={setApp} /></Screen>

  const auto = AUTO_STATUSES.includes(app.status), yourMove = whoseMove(app.status) === 'you' && !!app.status_info.action
  return (
    <Screen title={`Заявка ${app.number}`} sub={<span className="flex flex-wrap items-center gap-2">{app.company.registry.name} · {productNames[app.product_id]} · {rub(app.amount_rub)} на {app.term_months} мес. <StatusBadge status={app.status} title={app.status_info.title} /></span>}>
      <Card span={12} className="sm:p-6">
        <ConveyorTrack status={app.status} stage={stopStage(app)} />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-surface-2/60 p-4">
            <div className="text-[13px] text-muted">Что сейчас происходит</div>
            <p className="mt-1 text-[15px] leading-snug">{app.status_info.now}</p>
          </div>
          <div className={`rounded-2xl p-4 ${yourMove ? 'bg-accent/10 ring-1 ring-accent/30' : 'bg-surface-2/60'}`}>
            <div className={`text-[13px] ${yourMove ? 'text-accent-soft' : 'text-muted'}`}>{yourMove ? 'Ваш ход' : 'Что нужно от вас'}</div>
            <p className="mt-1 text-[15px] leading-snug">{app.status_info.action ?? (auto ? 'Ничего, статус обновится сам.' : 'Ничего.')}</p>
          </div>
        </div>
        {app.plan_id && <Link to={`/plan?plan=${encodeURIComponent(app.plan_id)}`} className="mt-4 inline-block text-[14px] font-medium text-text underline underline-offset-2">Расчёт проекта, на который нужен кредит</Link>}
        <div className="mt-4"><ErrorText>{error}</ErrorText></div>
      </Card>

      {app.status === 'info_requested' && <InfoRequest app={app} onDone={setApp} />}
      {(app.status === 'approved' || app.status === 'counter_offer') && app.offer && (
        <OfferCard offer={app.offer} app={app}>
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={() => act('accept')} disabled={busy} className={primaryBtn}>Принять условия</button>
            <button onClick={() => act('reject-offer')} disabled={busy} className={ghostBtn}>Отказаться</button>
          </div>
        </OfferCard>
      )}
      {app.status === 'signing' && app.offer && <Signing offer={app.offer} busy={busy} onSign={() => act('sign')} />}
      {app.status === 'funded' && app.offer && <OfferCard offer={app.offer} app={app} title="Кредит выдан" schedule />}
      {app.status === 'declined' && app.decline && (
        <Card span={12}>
          <SectionTitle>Почему отказ и что можно сделать</SectionTitle>
          <ul className="space-y-3">
            {app.decline.reasons.map((r) => (
              <li key={r.code} className="rounded-xl bg-surface-2 p-3.5">
                <div className="text-[15px] font-medium">{r.text}</div>
                {r.advice && <div className="mt-1 text-[14px] text-muted">{r.advice}</div>}
              </li>
            ))}
          </ul>
          <Link to="/new" className={`${ghostBtn} mt-4 inline-flex items-center`}>Новая заявка</Link>
        </Card>
      )}

      <Card span={12}>
        <SectionTitle>История</SectionTitle>
        <ol className="relative ml-1.5 border-l border-white/10">
          {[...app.timeline].reverse().map((t, i) => (
            <li key={`${t.at}-${i}`} className="relative pb-4 pl-5 last:pb-0">
              <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${i === 0 ? 'bg-accent' : t.actor === 'client' ? 'bg-text/60' : 'bg-steel/70'}`} aria-hidden />
              <div className={`text-[15px] leading-snug ${i === 0 ? 'font-medium' : 'text-text/85'}`}>{t.text}</div>
              <div className="mt-0.5 text-[12px] text-muted">{dateRu(t.at)} · {t.actor === 'client' ? 'вы' : t.actor === 'analyst' ? 'специалист банка' : 'банк, автоматически'}</div>
            </li>
          ))}
        </ol>
        {(app.status === 'info_requested') && <button onClick={() => act('withdraw')} disabled={busy} className="mt-4 text-[13px] text-muted underline underline-offset-2 hover:text-accent">Отозвать заявку</button>}
      </Card>
    </Screen>
  )
}

function OfferCard({ offer, app, title, schedule, children }: { offer: Offer; app: Application; title?: string; schedule?: boolean; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const changed = offer.kind === 'counter'
  const payment = useCountUp(offer.monthly_payment_rub)
  return (
    <Card span={12} className="hero-card appear sm:p-6">
      <SectionTitle>{title ?? (changed ? 'Банк предлагает другие условия' : 'Условия кредита')}</SectionTitle>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-end">
        <div>
          <div className="text-[13px] text-muted">Платёж в месяц</div>
          <div className="mt-1 font-display text-[40px] font-semibold leading-none tracking-tight text-ok tabular-nums sm:text-[46px]">{rub(Math.round(payment))}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Сумма" value={rub(offer.amount_rub)} />
          <Stat label="Срок" value={`${offer.term_months} мес.`} />
          <Stat label="Ставка" value={`${decimal(offer.rate_percent)}%`} />
        </div>
      </div>
      {changed && (offer.amount_rub !== app.amount_rub || offer.term_months !== app.term_months) && (
        <p className="mt-4 text-[13px] text-muted">Вы просили: <span className="line-through decoration-muted/70">{rub(app.amount_rub)} на {app.term_months} мес.</span></p>
      )}
      <ul className="mt-4 space-y-1 text-[14px] leading-snug text-text/80">{offer.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
      <p className="mt-2 text-[13px] text-muted">Всего выплатите {rub(offer.total_payment_rub)}, из них проценты {rub(offer.total_payment_rub - offer.amount_rub)}.</p>
      {children}
      {schedule && (
        <div className="mt-4">
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="text-[14px] font-medium text-text underline underline-offset-2">{open ? 'Скрыть график' : 'График платежей'}</button>
          {open && (
            <div className="mt-3 overflow-x-auto rounded-xl bg-surface-2">
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-muted"><tr>{['Месяц', 'Платёж', 'Долг', 'Проценты', 'Остаток'].map((h) => <th key={h} className="px-3 py-2 text-right font-medium first:text-left">{h}</th>)}</tr></thead>
                <tbody>{offer.schedule.map((r) => <tr key={r.month} className="border-t border-white/5">{[r.month, rub(r.payment_rub), rub(r.principal_rub), rub(r.interest_rub), rub(r.balance_rub)].map((c, i) => <td key={i} className="px-3 py-1.5 text-right first:text-left">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function Signing({ offer, busy, onSign }: { offer: Offer; busy: boolean; onSign: () => void }) {
  const [agree, setAgree] = useState(false)
  return (
    <Card span={12}>
      <SectionTitle>Кредитный договор</SectionTitle>
      <p className="text-[15px] leading-snug">{rub(offer.amount_rub)} на {offer.term_months} мес. под {decimal(offer.rate_percent)}% годовых, ежемесячный платёж {rub(offer.monthly_payment_rub)}. Деньги поступят на расчётный счёт компании.</p>
      <p className="mt-2 text-[13px] text-muted">Подписание в демо смоделировано: настоящая электронная подпись и перевод денег не выполняются.</p>
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-[15px]">
        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#ff4538]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        С условиями договора ознакомлен и согласен
      </label>
      <button onClick={onSign} disabled={!agree || busy} className={`${primaryBtn} mt-4`}>{busy ? 'Подписываем…' : 'Подписать'}</button>
    </Card>
  )
}

function InfoRequest({ app, onDone }: { app: Application; onDone: (a: Application) => void }) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const needsDoc = app.info_request?.items.some((i) => i.kind === 'authority_document') ?? false
  const send = async () => {
    setBusy(true); setError('')
    try {
      if (file) await conveyor.uploadDocument(app.id, needsDoc ? 'authority_document' : 'other', file)
      let a = app
      if (text.trim()) a = await conveyor.patchApplication(app.id, { version: a.version, info_response: text.trim() })
      onDone(await conveyor.submit(app.id, a.version))
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <Card span={12}>
      <SectionTitle>Что нужно банку</SectionTitle>
      <ul className="space-y-2">{app.info_request?.items.map((i) => <li key={i.kind} className="rounded-xl bg-warn/10 p-3.5 text-[15px] leading-snug">{i.text}</li>)}</ul>
      {app.info_request?.comment && <p className="mt-2 text-[14px] text-muted">Комментарий специалиста: {app.info_request.comment}</p>}
      <div className="mt-4 grid gap-4">
        <label className="block text-[13px] text-muted">Файл{needsDoc ? ' — доверенность или приказ' : ''}
          <input type="file" className="mt-1 block w-full text-[14px] text-text file:mr-3 file:h-10 file:rounded-lg file:border-0 file:bg-surface-2 file:px-4 file:text-text" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="block text-[13px] text-muted">Комментарий для банка
          <textarea className={`${input} mt-1 h-20 resize-none py-3`} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      <ErrorText>{error}</ErrorText>
      <button onClick={send} disabled={busy || (needsDoc ? !file : !file && !text.trim())} className={`${primaryBtn} mt-4`}>{busy ? 'Отправляем…' : 'Отправить и продолжить'}</button>
    </Card>
  )
}
