import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api'
import type { AiReply, Answer, ChatSummary, Question } from '../../types/plan'
import { Chip, Logo } from '../ui'
import { useCabinet } from '../CabinetContext'
import { rub } from '../../lib/format'

const starters = ['Кофейня у метро', 'Пекарня', 'Автомойка', 'Магазин одежды']

export default function Chat() {
  const { messages, busy, canRetry, send, retry, newChat, openChat } = useCabinet()
  const [view, setView] = useState<'chat' | 'list'>('chat')
  const [text, setText] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const end = useRef<HTMLDivElement>(null)
  const nav = useNavigate()

  useEffect(() => { if (view === 'chat') end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy, view])

  if (view === 'list') return <ChatList onClose={() => setView('chat')} onOpen={async (id) => { await openChat(id); setView('chat') }} onNew={() => { newChat(); setView('chat') }} />

  const submit = (t: string, ans?: Answer[]) => { if (!t.trim() || busy) return; setText(''); send(t, ans) }
  const submitAnswers = (qs: Question[]) => {
    submit(qs.map((q) => `${q.text} ${answers[q.id] ?? '—'}`).join('\n'), qs.map((q) => ({ question_id: q.id, answer: answers[q.id] ?? '' })))
    setAnswers({})
  }
  const last = messages[messages.length - 1]

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-5 pb-3 pt-2">
        <Logo size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-bold leading-tight">ИИ-консультант</h1>
          <p className="flex items-center gap-1.5 text-[13px] text-muted"><span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />на связи</p>
        </div>
        <IconBtn label="Новый диалог" onClick={() => { newChat(); setAnswers({}) }}><path d="M12 5v14M5 12h14" /></IconBtn>
        <IconBtn label="Все диалоги" onClick={() => setView('list')}><path d="M4 6h16M4 12h16M4 18h10" /></IconBtn>
      </header>

      <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 pb-3" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`rise flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] whitespace-pre-line px-4 py-3 text-[15px] leading-snug ${
              m.role === 'user' ? 'rounded-[22px] rounded-br-md bg-accent text-white'
              : m.error ? 'rounded-[22px] rounded-bl-md bg-accent/12 text-accent ring-1 ring-accent/30'
              : 'card-ring rounded-[22px] rounded-bl-md bg-surface'}`}>
              {m.text ?? <Reply reply={m.reply!} active={m === last && !busy} answers={answers} setAnswers={setAnswers} onSubmit={submitAnswers} onOpen={() => nav('/plan')} />}
              {m.error && canRetry && m === last && (
                <button onClick={retry} disabled={busy} className="mt-2 block h-9 rounded-full bg-accent px-4 text-[14px] font-semibold text-white disabled:opacity-40">Повторить</button>
              )}
            </div>
          </div>
        ))}
        {messages.length === 1 && !busy && (
          <div className="rise flex flex-wrap gap-2 pt-1">
            {starters.map((s) => <Chip key={s} onClick={() => submit(`Хочу открыть: ${s.toLowerCase()}`)}>{s}</Chip>)}
          </div>
        )}
        {busy && (
          <div className="flex" role="status" aria-label="ИИ печатает">
            <div className="card-ring flex gap-1.5 rounded-[22px] rounded-bl-md bg-surface px-4 py-4">
              <span className="dot h-2 w-2 rounded-full bg-muted" /><span className="dot h-2 w-2 rounded-full bg-muted" /><span className="dot h-2 w-2 rounded-full bg-muted" />
            </div>
          </div>
        )}
        <div ref={end} />
      </div>

      <form className="flex items-center gap-2 px-3 pb-2 pt-2" onSubmit={(e) => { e.preventDefault(); submit(text) }}>
        <label className="sr-only" htmlFor="msg">Сообщение</label>
        <input id="msg" value={text} onChange={(e) => setText(e.target.value)} placeholder="Хочу открыть кофейню у метро" maxLength={4000}
          className="h-12 min-w-0 flex-1 rounded-full bg-surface px-5 text-[15px] outline-none ring-1 ring-white/5 placeholder:text-muted focus:ring-2 focus:ring-accent" />
        <button aria-label="Отправить" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-[0_8px_20px_-8px_rgba(255,69,56,.8)] transition-opacity disabled:opacity-35" disabled={busy || !text.trim()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
    </div>
  )
}

const IconBtn = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text active:bg-surface-3">
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
  </button>
)

function ChatList({ onClose, onOpen, onNew }: { onClose: () => void; onOpen: (id: string) => Promise<void>; onNew: () => void }) {
  const [items, setItems] = useState<ChatSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const load = () => { setError(null); setItems(null); api.listChats().then(setItems).catch((e) => setError(e instanceof ApiError ? e.message : 'Не удалось загрузить диалоги.')) }
  useEffect(load, [])

  const open = async (id: string) => {
    setOpening(id)
    try { await onOpen(id) } catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось открыть диалог.'); setOpening(null) }
  }
  const date = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-5 pb-3 pt-2">
        <IconBtn label="Назад к чату" onClick={onClose}><path d="M15 5l-7 7 7 7" /></IconBtn>
        <h1 className="flex-1 text-[22px] font-bold tracking-tight">Диалоги</h1>
      </header>
      <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        <button onClick={onNew} className="flex h-12 w-full items-center justify-center rounded-2xl bg-accent text-[15px] font-semibold text-white active:bg-brand-deep">Новый диалог</button>
        {error && (
          <div role="alert" className="rounded-2xl bg-accent/12 p-3.5 text-[14px] leading-snug text-accent">
            {error}<button onClick={load} className="mt-2 block h-9 rounded-full bg-accent px-4 text-[14px] font-semibold text-white">Повторить</button>
          </div>
        )}
        {!items && !error && [0, 1, 2].map((i) => <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-surface" aria-hidden />)}
        {items?.length === 0 && <p className="px-2 py-10 text-center text-[15px] leading-snug text-muted">Диалогов пока нет. Опишите идею бизнеса в новом диалоге.</p>}
        {items?.map((c) => (
          <button key={c.id} onClick={() => open(c.id)} disabled={!!opening} className="card-ring flex w-full items-center gap-3 rounded-2xl bg-surface p-3.5 text-left active:bg-surface-2 disabled:opacity-60">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{c.title}</div>
              <div className="mt-0.5 text-[12px] text-muted">{opening === c.id ? 'Открываем…' : date(c.updated_at)}</div>
            </div>
            {c.plan_id && <span className="shrink-0 rounded-full bg-ok/15 px-2.5 py-0.5 text-[12px] font-medium text-ok">План готов</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function Reply({ reply, active, answers, setAnswers, onSubmit, onOpen }: {
  reply: AiReply
  active: boolean
  answers: Record<string, string>
  setAnswers: (a: Record<string, string>) => void
  onSubmit: (q: Question[]) => void
  onOpen: () => void
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
        <button onClick={onOpen} className="h-11 w-full rounded-xl bg-accent text-[15px] font-semibold text-white active:bg-brand-deep">Открыть план</button>
      </div>
    )
  const done = reply.questions.every((q) => answers[q.id]?.trim())
  return (
    <fieldset disabled={!active} className="space-y-4 border-0 p-0 disabled:opacity-60">
      <legend className="mb-3 p-0">{reply.text}</legend>
      {reply.questions.map((q) => (
        <div key={q.id} className="space-y-2">
          <div className="text-[14px] font-semibold">{q.text}</div>
          {q.kind === 'choice' ? (
            <div className="flex flex-wrap gap-1.5">
              {q.options?.map((o) => <Chip key={o} active={answers[q.id] === o} onClick={() => setAnswers({ ...answers, [q.id]: o })}>{o}</Chip>)}
            </div>
          ) : (
            <input aria-label={q.text} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none focus:ring-2 focus:ring-accent" placeholder="Ваш ответ" />
          )}
        </div>
      ))}
      {active && <button disabled={!done} onClick={() => onSubmit(reply.questions)} className="h-11 w-full rounded-xl bg-accent text-[15px] font-semibold text-white transition-opacity disabled:opacity-35">Ответить</button>}
    </fieldset>
  )
}
