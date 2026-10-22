import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, errorText } from '../../api'
import { bank } from '../../api/bank'
import dict from '../../data/dictionaries.json'
import type { BankApplication, Check, DecisionKind, DeclineReason, InfoRequestKind } from '../../types/conveyor'
import { decimal, rub } from '../../lib/format'
import { Card, Screen, SectionTitle, Skeleton, Stat } from '../../phone/ui'
import { ErrorText, MoneyInput, StatusBadge, dateRu, ghostBtn, input, memberRoles, primaryBtn, productNames, purposes } from '../../phone/conveyor/parts'
import { usePolling } from '../../lib/usePolling'
import { statuses, declineReasons, infoKinds, gradeTone, gradeToneClass } from './shared'

// Карточка заявки: данные, проверки и журнал слева; рекомендация, решение и скоринг справа
const checkTitle: Record<Check['kind'], string> = { completeness: 'Полнота и корректность', egrul: 'ЕГРЮЛ / ЕГРИП', fns: 'ФНС «Прозрачный бизнес»', bki: 'Бюро кредитных историй' }
const resultTone: Record<Check['result'], string> = { ok: 'bg-ok', warn: 'bg-warn', fail: 'bg-accent', error: 'bg-muted' }
const resultText: Record<Check['result'], string> = { ok: 'в порядке', warn: 'обратить внимание', fail: 'не пройдена', error: 'сервис недоступен' }
const resultCard: Record<Check['result'], string> = { ok: 'bg-surface-2', warn: 'tint tone-warn', fail: 'tint tone-bad', error: 'bg-surface-2' }
// Тон рекомендации: одобрить — зелёный, другие условия и запрос данных — жёлтый, отказ — красный
const recTone: Record<string, string> = { approve: 'tone-ok', counter: 'tone-warn', request_info: 'tone-warn', decline: 'tone-bad' }
const recLabel: Record<string, string> = { approve: 'Одобрить', counter: 'Другие условия', request_info: 'Запросить данные', decline: 'Отказать' }

export default function CardView() {
  const { id = '' } = useParams()
  const [data, setData] = useState<BankApplication | null>(null)
  const [error, setError] = useState('')
  const load = () => bank.application(id).then((d) => { setData(d); setError('') }).catch((e) => setError(errorText(e)))
  useEffect(() => { setData(null); load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const status = data?.application.status
  usePolling(load, 2000, !!status && ['submitted', 'checking', 'scoring'].includes(status))

  if (!data) return <Screen title="Заявка">{error ? <ErrorText>{error}</ErrorText> : <Skeleton />}</Screen>
  const a = data.application, c = a.company.registry, f = a.financials, sc = data.scoring
  return (
    <Screen title={`Заявка ${a.number}`} sub={<span className="flex flex-wrap items-center gap-2"><Link to="/bank" className="underline underline-offset-2">Очередь</Link> · {c.name} · <StatusBadge status={a.status} title={a.status_info.title} /></span>}>
      {/* слева — данные заявки; справа — оценка и решение, на широком экране колонка закреплена */}
      <div data-span={7} className="stack space-y-4">
        <Card>
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
        <Card>
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

        <Card>
          <SectionTitle>Проверки</SectionTitle>
          {!data.checks.length && <p className="text-[14px] text-muted">Проверки ещё не выполнялись.</p>}
          <ul className="space-y-2">
            {data.checks.map((ch) => (
              <li key={ch.kind} className={`rounded-xl p-3 ${resultCard[ch.result]}`}>
                <details open={ch.result === 'fail' || ch.result === 'warn'}>
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
        <Card>
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
      </div>
      <div data-span={5} className="stack space-y-4 self-start min-[1100px]:sticky min-[1100px]:top-0">
        {data.recommendation && (
          <Card className={`tint ${recTone[data.recommendation.kind] ?? 'tone-muted'}`}>
            <SectionTitle>Рекомендация системы</SectionTitle>
            <p className="mb-2 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: 'color-mix(in srgb, var(--tone) 18%, transparent)', color: 'var(--tone)' }}>{recLabel[data.recommendation.kind] ?? data.recommendation.kind}</p>
            <p className="text-[14px] leading-snug">{data.recommendation.text}</p>
            {data.recommendation.amount_rub != null && <p className="mt-2 text-[13px] text-muted">{rub(data.recommendation.amount_rub)} на {data.recommendation.term_months} мес. под {decimal(data.recommendation.rate_percent)}%</p>}
          </Card>
        )}
        {a.status === 'manual_review' ? <Decision data={data} onDone={setData} onConflict={load} /> : <Outcome data={data} />}
        <Card className={sc ? `tint ${gradeToneClass(sc.grade)}` : a.status === 'declined' ? 'tint tone-bad' : ''}>
          <SectionTitle>Скоринг</SectionTitle>
          {!sc ? <p className="text-[14px] text-muted">{a.status === 'declined' ? 'Не считался: сработал стоп-фактор на проверке.' : 'Ещё не посчитан.'}</p> : (
            <>
              <div className="flex items-end gap-5">
                <div><div className="text-[12px] text-muted">Балл</div><div className="font-display text-[40px] font-semibold leading-none tabular-nums">{sc.score}</div></div>
                <div><div className="text-[12px] text-muted">Класс</div><div className={`font-display text-[40px] font-semibold leading-none ${gradeTone(sc.grade)}`}>{sc.grade}</div></div>
                <Stat label="Нагрузка" value={sc.debt_load_percent == null ? '—' : `${decimal(sc.debt_load_percent)}%`} tone={sc.debt_load_percent != null && sc.debt_load_percent > 50 ? 'bad' : undefined} />
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.07]" role="img" aria-label={`Балл ${sc.score} из 100`}><div className="fill-in h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, sc.score))}%`, background: 'var(--tone)' }} /></div>
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

      </div>
    </Screen>
  )
}

const Info = ({ label, value }: { label: string; value: ReactNode }) => <div><dt className="text-[12px] text-muted">{label}</dt><dd className="leading-snug">{value}</dd></div>

function Outcome({ data }: { data: BankApplication }) {
  const a = data.application
  const tone = a.decline ? 'tint tone-bad' : a.offer ? 'tint tone-ok' : a.info_request ? 'tint tone-warn' : ''
  return (
    <Card className={tone}>
      <SectionTitle>Итог</SectionTitle>
      <p className="text-[14px]">{a.status_info.title}. {a.status_info.now}</p>
      {a.offer && <p className="mt-2 text-[14px] tabular-nums">{a.offer.kind === 'counter' ? 'Встречное предложение' : 'Условия'}: {rub(a.offer.amount_rub)}, {a.offer.term_months} мес., {decimal(a.offer.rate_percent)}%, платёж {rub(a.offer.monthly_payment_rub)}</p>}
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
  const [rate, setRate] = useState(decimal(rec?.rate_percent ?? ''))
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
      setError(errorText(e))
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
