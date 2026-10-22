import { useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api'
import type { AiReply, Answer, ChatSummary, Question } from '../../types/plan'
import { Chip, Conveyor, Logo, Wide, Icon } from '../ui'
import { useCabinet } from '../CabinetContext'
import { rub } from '../../lib/format'
import CityPicker from '../components/CityPicker'
import { submittedAnswers } from '../answers'
import { planPath } from '../PlanRoute'

const starters = ['Кофейня с собой', 'Пекарня', 'Автомойка', 'Магазин одежды']
const starterIcons: Record<string, string> = {
  'Кофейня с собой': 'M5 8h11v6a5 5 0 01-5 5h-1a5 5 0 01-5-5zM16 10h2a2 2 0 010 4h-2M8 3v2M11 3v2',
  'Пекарня': 'M4 12a8 5 0 0116 0v6a1 1 0 01-1 1H5a1 1 0 01-1-1zM9 9.5l1 4M14 9l1 4',
  'Автомойка': 'M5 16l1.5-5h11L19 16M4 16h16v3H4zM7 19v1M17 19v1M9 7.5c0-1 1-2 1-3.5M13 7.5c0-1 1-2 1-3.5',
  'Магазин одежды': 'M8 4L4 7l2 3 2-1v11h8V9l2 1 2-3-4-3c0 1.5-1.8 3-4 3S8 5.5 8 4z',
}
const starterHints: Record<string, string> = {
  'Кофейня с собой': 'Кофе с собой в проходном месте',
  'Пекарня': 'Своя выпечка и кофе рядом с домом',
  'Автомойка': 'Ручная мойка на 2–3 поста',
  'Магазин одежды': 'Небольшой шоурум в торговом центре',
}

export default function Chat() {
  const { messages, busy, canRetry, send, retry, newChat, openChat, openPlan, chatId, demoAnswers, user, saveProfile, demo } = useCabinet()
  const [cityDraft, setCityDraft] = useState('')
  const [citySaving, setCitySaving] = useState(false)
  const [cityError, setCityError] = useState('')
  const needsCity = !demo && !!user && !user.city?.trim()
  const [view, setView] = useState<'chat' | 'list'>('chat')
  const [text, setText] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const list = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const wide = useContext(Wide)
  const conveyorOn = useContext(Conveyor)

  useEffect(() => { setAnswers({}); setText('') }, [chatId])

  // Прокручиваем только сам список сообщений. scrollIntoView здесь нельзя: он двигает и страницу с презентацией.
  useEffect(() => { if (view === 'chat') list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }) }, [messages, busy, view])

  if (view === 'list') return <ChatList onClose={() => setView('chat')} onOpen={async (id) => { if (await openChat(id)) setView('chat') }} onNew={() => { newChat(); setView('chat') }} />

  const submit = (t: string, ans?: Answer[]) => {
    if (!t.trim() || busy) return
    if (needsCity) { setText(t); setCityError('Сначала выберите город для расчёта.'); return }
    setText(''); send(t, ans)
  }
  const chooseCity = async (city: string) => {
    if (!city.trim() || citySaving) return
    setCitySaving(true); setCityError('')
    try { await saveProfile({ city: city.trim() }) }
    catch (e) { setCityError(e instanceof ApiError ? e.message : 'Не удалось сохранить город. Попробуйте ещё раз.') }
    finally { setCitySaving(false) }
  }
  const submitAnswers = (qs: Question[]) => {
    // в текст уходят все вопросы (пропущенные — как «—»), в answers только отвеченные: пустой ответ backend отклоняет
    const given = (q: Question) => answers[q.id]?.trim()
    submit(qs.map((q) => `${q.text} ${given(q) || '—'}`).join('\n'), qs.filter(given).map((q) => ({ question_id: q.id, answer: given(q)! })))
    setAnswers({})
  }
  const last = messages[messages.length - 1]

  return (
    <div className="flex h-full flex-col">
      <header className={`flex items-center gap-3 pb-3 ${wide ? 'border-b border-white/5 px-8 pb-4 pt-6' : 'px-5 pt-2'}`}>
        <Logo size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-bold leading-tight">ИИ-консультант</h1>
          <p className="flex items-center gap-1.5 text-[13px] text-muted"><span className={`h-1.5 w-1.5 rounded-full ${busy ? 'animate-pulse bg-accent' : 'bg-ok'}`} aria-hidden />{busy ? 'думает над ответом' : 'на связи'}</p>
        </div>
        <IconBtn label="Новый диалог" onClick={() => { newChat(); setAnswers({}) }}><path d="M12 5v14M5 12h14" /></IconBtn>
        {!wide && <IconBtn label="Все диалоги" onClick={() => setView('list')}><path d="M4 6h16M4 12h16M4 18h10" /></IconBtn>}
      </header>

      {needsCity && <div className={`${wide ? 'px-8' : 'px-4'} max-h-[50%] overflow-y-auto overscroll-contain pb-3`}>
        <div className="rounded-2xl bg-surface p-4 ring-1 ring-white/10">
          <p className="mb-3 text-[13px] text-muted">Выберите город: от него зависят аренда, спрос и расчёты плана.</p>
          <CityPicker value={cityDraft} onChange={setCityDraft} onSelect={chooseCity} disabled={citySaving} />
          <button type="button" onClick={() => chooseCity(cityDraft)} disabled={!cityDraft.trim() || citySaving}
            className="mt-3 h-10 rounded-xl bg-fill px-4 text-[14px] font-semibold text-white disabled:opacity-35">{citySaving ? 'Сохраняем…' : 'Выбрать город'}</button>
          {cityError && <p role="alert" className="mt-2 text-[13px] text-accent">{cityError}</p>}
        </div>
      </div>}

      <div ref={list} className={`flex-1 space-y-3 overflow-y-auto overscroll-contain pb-3 ${wide ? 'thin-scroll px-8 pt-5' : 'no-scrollbar px-4'}`} aria-live="polite">
        {wide && messages.length === 1 && !busy && (
          <div className="rise flex min-h-full flex-col justify-center pb-10">
            <h2 className="font-display text-[34px] font-semibold leading-[1.1] tracking-tight">Какой бизнес хотите открыть?</h2>
            <p className="mt-3 max-w-[520px] text-[16px] leading-snug text-muted">Опишите идею своими словами. ИИ задаст несколько вопросов и соберёт план: шаги, деньги и кредит, который бизнес потянет.</p>
            <div className="mt-8 grid grid-cols-2 gap-3">
              {starters.map((s) => (
                <button key={s} type="button" onClick={() => submit(`Хочу открыть: ${s.toLowerCase()}`)}
                  className="card-ring group flex items-start gap-3.5 rounded-2xl bg-surface/90 p-4 text-left transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-surface-2">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent-soft transition-colors group-hover:bg-fill group-hover:text-white" aria-hidden><Icon d={starterIcons[s]} /></span>
                  <span className="min-w-0">
                    <span className="block text-[16px] font-semibold">{s}</span>
                    <span className="mt-1 block text-[13px] text-muted">{starterHints[s]}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!(wide && messages.length === 1 && !busy) && messages.map((m, index) => (
          <div key={m.id} className={`rise flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} ${wide ? 'gap-3' : ''}`}>
            {wide && m.role === 'assistant' && <div className="mt-1"><Logo size={30} /></div>}
            <div className={`${wide ? 'max-w-[78%]' : 'max-w-[88%]'} whitespace-pre-line px-4 py-3 text-[15px] leading-snug ${
              m.role === 'user' ? 'rounded-[22px] rounded-br-md bg-fill text-white'
              : m.error ? 'rounded-[22px] rounded-bl-md bg-accent/12 text-accent ring-1 ring-accent/30'
              : 'card-ring rounded-[22px] rounded-bl-md bg-surface'}`}>
              {m.text ?? <Reply reply={m.reply!} active={m === last && !busy} answers={m === last ? demoAnswers ?? answers : submittedAnswers(messages, index)} setAnswers={setAnswers} onSubmit={submitAnswers} onOpen={() => { if (m.reply?.type === 'plan') { void openPlan(m.reply.plan_id, m.reply.plan); nav(planPath('/plan', m.reply.plan_id)) } }} onCredit={conveyorOn && m.reply?.type === 'plan' ? () => nav(`/new?plan=${encodeURIComponent((m.reply as { plan_id: string }).plan_id)}`) : undefined} />}
              {m.error && canRetry && m === last && (
                <button onClick={retry} disabled={busy} className="mt-2 block h-9 rounded-full bg-fill px-4 text-[14px] font-semibold text-white disabled:opacity-40">Повторить</button>
              )}
            </div>
          </div>
        ))}
        {!wide && messages.length === 1 && !busy && (
          <div className="rise flex flex-wrap gap-2 pt-1">
            {starters.map((s) => <Chip key={s} onClick={() => submit(`Хочу открыть: ${s.toLowerCase()}`)}>{s}</Chip>)}
          </div>
        )}
        {busy && (
          <div className={`flex ${wide ? 'gap-3' : ''}`} role="status" aria-label="ИИ печатает">
            {wide && <div className="mt-1"><Logo size={30} /></div>}
            <Thinking />
          </div>
        )}
      </div>

      <form className={`flex items-center gap-2 ${wide ? 'px-8 pb-6 pt-3' : 'px-3 pb-2 pt-2'}`} onSubmit={(e) => { e.preventDefault(); submit(text) }}>
        <label className="sr-only" htmlFor="msg">Сообщение</label>
        <input id="msg" value={text} onChange={(e) => setText(e.target.value)} placeholder="Хочу открыть кофейню с собой" maxLength={4000}
          className={`${wide ? 'h-14 rounded-2xl text-[16px]' : 'h-12 rounded-full text-[15px]'} min-w-0 flex-1 bg-surface px-5 outline-none ring-1 ring-white/5 placeholder:text-muted focus:ring-2 focus:ring-accent`} />
        <button aria-label="Отправить" className={`flex ${wide ? 'h-14 w-14 rounded-2xl' : 'h-12 w-12 rounded-full'} shrink-0 items-center justify-center bg-fill text-white shadow-[0_8px_20px_-8px_rgba(255,69,56,.8)] transition-opacity disabled:opacity-35`} disabled={busy || !text.trim()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
    </div>
  )
}

// «Печатает» с подсказкой: ответ ИИ может идти до 3 минут, без неё долгие точки выглядят как зависание
function Thinking() {
  const [sec, setSec] = useState(0)
  useEffect(() => { const t = window.setInterval(() => setSec((s) => s + 1), 1000); return () => clearInterval(t) }, [])
  const hint = sec >= 60 ? 'Сложный план, нужно ещё немного времени. Ответ придёт в течение 3 минут.' : sec >= 12 ? 'Считаю план, это может занять пару минут.' : null
  return (
    <div className="card-ring rounded-[22px] rounded-bl-md bg-surface px-4 py-4">
      <div className="flex gap-1.5"><span className="dot h-2 w-2 rounded-full bg-muted" /><span className="dot h-2 w-2 rounded-full bg-muted" /><span className="dot h-2 w-2 rounded-full bg-muted" /></div>
      {hint && <p className="rise mt-2.5 max-w-[260px] text-[13px] leading-snug text-muted">{hint}</p>}
    </div>
  )
}

const IconBtn = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text active:bg-surface-3">
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
  </button>
)

function ChatList({ onClose, onOpen, onNew }: { onClose: () => void; onOpen: (id: string) => Promise<void>; onNew: () => void }) {
  const { deleteChat } = useCabinet()
  const [items, setItems] = useState<ChatSummary[] | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const load = () => { setError(null); setItems(null); api.listChats().then(setItems).catch((e) => setError(e instanceof ApiError ? e.message : 'Не удалось загрузить диалоги.')) }
  useEffect(load, [])

  const open = async (id: string) => {
    setOpening(id)
    try { await onOpen(id) } catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось открыть диалог.'); setOpening(null) }
  }
  const remove = async (id: string) => {
    setRemoving(true); setError(null)
    try { await deleteChat(id); setItems((l) => l?.filter((c) => c.id !== id) ?? null); setConfirm(null) }
    catch (e) { setError(e instanceof ApiError && e.code !== 'NETWORK' ? e.message : 'Не удалось удалить диалог. Попробуйте позже.') }
    finally { setRemoving(false) }
  }
  const date = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-5 pb-3 pt-2">
        <IconBtn label="Назад к чату" onClick={onClose}><path d="M15 5l-7 7 7 7" /></IconBtn>
        <h1 className="flex-1 text-[22px] font-bold tracking-tight">Диалоги</h1>
      </header>
      <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-4">
        <button onClick={onNew} className="flex h-12 w-full items-center justify-center rounded-2xl bg-fill text-[15px] font-semibold text-white active:bg-brand-deep">Новый диалог</button>
        {error && (
          <div role="alert" className="rounded-2xl bg-accent/12 p-3.5 text-[14px] leading-snug text-accent">
            {error}<button onClick={load} className="mt-2 block h-9 rounded-full bg-fill px-4 text-[14px] font-semibold text-white">Повторить</button>
          </div>
        )}
        {!items && !error && [0, 1, 2].map((i) => <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-surface" aria-hidden />)}
        {items?.length === 0 && <p className="px-2 py-10 text-center text-[15px] leading-snug text-muted">Диалогов пока нет. Опишите идею бизнеса в новом диалоге.</p>}
        {items?.map((c) => confirm === c.id ? (
          <div key={c.id} className="card-ring rounded-2xl bg-surface-2 p-3.5" role="group" aria-label={`Удалить диалог «${c.title}»`}>
            <p className="text-[14px] leading-snug">Удалить «{c.title}»{c.plan_id ? ' вместе с планом' : ''}?</p>
            <div className="mt-2.5 flex gap-2">
              <button onClick={() => remove(c.id)} disabled={removing} className="h-9 rounded-full bg-fill px-4 text-[14px] font-semibold text-white disabled:opacity-50">{removing ? 'Удаляем…' : 'Удалить'}</button>
              <button onClick={() => setConfirm(null)} disabled={removing} className="h-9 rounded-full px-4 text-[14px] text-muted">Отмена</button>
            </div>
          </div>
        ) : (
          <div key={c.id} className="card-ring flex items-center rounded-2xl bg-surface">
            <button onClick={() => open(c.id)} disabled={!!opening} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-3.5 text-left active:bg-surface-2 disabled:opacity-60">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{c.title}</div>
                <div className="mt-0.5 text-[12px] text-muted">{opening === c.id ? 'Открываем…' : date(c.updated_at)}</div>
              </div>
              {c.plan_id && <span className="shrink-0 rounded-full bg-ok/15 px-2.5 py-0.5 text-[12px] font-medium text-ok">План готов</span>}
            </button>
            <button type="button" onClick={() => { setConfirm(c.id); setError(null) }} aria-label={`Удалить диалог «${c.title}»`}
              className="mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2 active:text-accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Reply({ reply, active, answers, setAnswers, onSubmit, onOpen, onCredit }: {
  reply: AiReply
  active: boolean
  answers: Record<string, string>
  setAnswers: (a: Record<string, string>) => void
  onSubmit: (q: Question[]) => void
  onOpen: () => void
  onCredit?: () => void // рабочая версия: перейти к заявке на кредит по этому плану
}) {
  if (reply.type === 'message') return <>{reply.text}</>
  if (reply.type === 'plan')
    return (
      <div className="space-y-3">
        <div className="text-[13px] text-muted">План готов</div>
        <div className="text-[17px] font-semibold leading-tight">{reply.plan.title}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className="text-[12px] text-muted">Нужно на старт</div><div className="font-semibold tabular-nums">{rub(reply.plan.finance.startup_cost_rub)}</div></div>
          <div><div className="text-[12px] text-muted">Окупаемость</div><div className="font-semibold">{reply.plan.finance.payback_months ?? '—'} мес.</div></div>
        </div>
        <button onClick={onOpen} className={`h-11 w-full rounded-xl text-[15px] font-semibold ${onCredit ? 'bg-surface-2 text-text' : 'bg-fill text-white active:bg-brand-deep'}`}>Открыть план</button>
        {onCredit && <button onClick={onCredit} className="h-11 w-full rounded-xl bg-fill text-[15px] font-semibold text-white active:bg-brand-deep">Подобрать кредит</button>}
      </div>
    )
  // достаточно ответить хотя бы на один вопрос: остальные уйдут как «—», а ИИ сам просит пропускать то, чего вы не знаете
  const done = reply.questions.some((q) => answers[q.id]?.trim())
  return (
    <fieldset disabled={!active} className="space-y-4 border-0 p-0 disabled:opacity-60">
      <legend className="mb-3 p-0">{reply.text}</legend>
      {reply.questions.map((q) => {
        // У выбора города подпись своя — у CityPicker, без неё вопрос выводился дважды
        const city = q.kind !== 'choice' && (/city|location|town/i.test(q.id) || /город|насел[её]нн.{0,5}пункт/i.test(q.text))
        return <div key={q.id} className="space-y-2">
          {!city && <div className="text-[14px] font-semibold">{q.text}</div>}
          {q.kind === 'choice' ? (
            <div className="flex flex-wrap gap-1.5">
              {q.options?.map((o) => <Chip key={o} active={answers[q.id] === o} onClick={() => setAnswers({ ...answers, [q.id]: o })}>{o}</Chip>)}
            </div>
          ) : city ? (
            <CityPicker label={q.text} value={answers[q.id] ?? ''} onChange={(value) => setAnswers({ ...answers, [q.id]: value })} />
          ) : (
            <input aria-label={q.text} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none focus:ring-2 focus:ring-accent" placeholder="Ваш ответ" />
          )}
        </div>
      })}
      {active && <button disabled={!done} onClick={() => onSubmit(reply.questions)} className="h-11 w-full rounded-xl bg-fill text-[15px] font-semibold text-white transition-opacity disabled:opacity-35">Ответить</button>}
    </fieldset>
  )
}
