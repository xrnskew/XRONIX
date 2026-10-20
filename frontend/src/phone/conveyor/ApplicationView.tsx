import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../../api'
import { conveyor } from '../../api/conveyor'
import { AUTO_STATUSES, type Application, type Offer, type Status } from '../../types/conveyor'
import { rub } from '../../lib/format'
import { Card, Screen, SectionTitle, Skeleton, Stat } from '../ui'
import { ErrorText, StatusBadge, dateRu, ghostBtn, input, primaryBtn, productNames } from './parts'
import ApplicationForm from './ApplicationForm'

// Этапы на шкале: куда относится каждый статус
const STAGES = ['Подача', 'Проверка', 'Оценка', 'Решение', 'Подписание', 'Выдача']
const STAGE: Record<Status, number> = { draft: 0, submitted: 1, checking: 1, info_requested: 1, scoring: 2, manual_review: 3, approved: 3, counter_offer: 3, declined: 3, signing: 4, funded: 5, withdrawn: 0, cancelled: 3 }

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.')

export default function ApplicationView() {
  const { id = '' } = useParams()
  const [app, setApp] = useState<Application | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  const reload = () => conveyor.getApplication(id).then((a) => { if (alive.current) { setApp(a); setError('') } }).catch((e) => alive.current && setError(errText(e)))
  useEffect(() => { alive.current = true; setApp(null); reload(); return () => { alive.current = false } }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Пока заявка движется сама, опрашиваем раз в 2 с; у специалиста — реже
  const status = app?.status
  useEffect(() => {
    if (!status || !(AUTO_STATUSES.includes(status) || status === 'manual_review')) return
    const t = setInterval(reload, status === 'manual_review' ? 5000 : 2000)
    return () => clearInterval(t)
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (action: 'accept' | 'reject-offer' | 'sign' | 'withdraw') => {
    if (!app) return
    setBusy(true); setError('')
    try { setApp(await conveyor.action(app.id, action, app.version)) } catch (e) { setError(errText(e)); reload() } finally { setBusy(false) }
  }

  if (!app) return <Screen title="Заявка">{error ? <ErrorText>{error}</ErrorText> : <Skeleton />}</Screen>
  if (app.status === 'draft') return <Screen title={`Заявка ${app.number}`} sub="Черновик: заполните и подайте"><ApplicationForm id={app.id} onSubmitted={setApp} /></Screen>

  const auto = AUTO_STATUSES.includes(app.status)
  return (
    <Screen title={`Заявка ${app.number}`} sub={<span className="flex flex-wrap items-center gap-2">{app.company.registry.name} · {productNames[app.product_id]} · {rub(app.amount_rub)} на {app.term_months} мес. <StatusBadge status={app.status} title={app.status_info.title} /></span>}>
      <Card span={12}>
        <ol className="grid grid-cols-6 gap-1.5" aria-label="Этапы заявки">
          {STAGES.map((s, i) => {
            const cur = STAGE[app.status], done = i < cur || app.status === 'funded', bad = i === cur && (app.status === 'declined' || app.status === 'cancelled' || app.status === 'withdrawn')
            return (
              <li key={s} aria-current={i === cur ? 'step' : undefined}>
                <div className={`h-1.5 rounded-full ${bad ? 'bg-accent' : done ? 'bg-ok' : i === cur ? `bg-fill ${auto ? 'animate-pulse' : ''}` : 'bg-surface-3'}`} />
                <div className={`mt-1.5 truncate text-[12px] ${i === cur ? 'font-semibold text-text' : 'text-muted'}`}>{s}</div>
              </li>
            )
          })}
        </ol>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div><div className="text-[12px] uppercase tracking-wide text-muted">Что сейчас происходит</div><p className="mt-1 text-[15px] leading-snug">{app.status_info.now}</p></div>
          <div><div className="text-[12px] uppercase tracking-wide text-muted">Что нужно от вас</div><p className="mt-1 text-[15px] leading-snug">{app.status_info.action ?? (auto ? 'Ничего, статус обновится сам.' : 'Ничего.')}</p></div>
        </div>
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
        <ol className="space-y-2.5">
          {[...app.timeline].reverse().map((t, i) => (
            <li key={`${t.at}-${i}`} className="flex gap-3 text-[14px]">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i === 0 ? 'bg-accent' : 'bg-surface-3'}`} />
              <span className="flex-1">{t.text}<span className="block text-[12px] text-muted">{dateRu(t.at)} · {t.actor === 'client' ? 'вы' : t.actor === 'analyst' ? 'специалист банка' : 'банк, автоматически'}</span></span>
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
  return (
    <Card span={12} className="hero-card">
      <SectionTitle>{title ?? (changed ? 'Банк предлагает другие условия' : 'Условия кредита')}</SectionTitle>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label={changed && offer.amount_rub !== app.amount_rub ? `Сумма (вы просили ${rub(app.amount_rub)})` : 'Сумма'} value={rub(offer.amount_rub)} />
        <Stat label={changed && offer.term_months !== app.term_months ? `Срок (вы просили ${app.term_months} мес.)` : 'Срок'} value={`${offer.term_months} мес.`} />
        <Stat label="Ставка" value={`${String(offer.rate_percent).replace('.', ',')}%`} />
        <Stat label="Платёж в месяц" value={rub(offer.monthly_payment_rub)} tone="ok" />
      </div>
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
      <p className="text-[15px] leading-snug">{rub(offer.amount_rub)} на {offer.term_months} мес. под {String(offer.rate_percent).replace('.', ',')}% годовых, ежемесячный платёж {rub(offer.monthly_payment_rub)}. Деньги поступят на расчётный счёт компании.</p>
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
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
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
