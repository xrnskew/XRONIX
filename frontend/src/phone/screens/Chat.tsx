import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendMessage } from '../../api'
import type { AiReply, Answer, ChatMessage, Question } from '../../types/plan'
import { Chip, Logo } from '../ui'
import { useCabinet } from '../PlanContext'
import { rub } from '../../lib/format'

const greeting: ChatMessage = { id: 'g', role: 'assistant', text: 'Здравствуйте! Опишите идею: что хотите открыть и где. Я задам пару вопросов и соберу план.' }
const starters = ['Кофейня у метро', 'Пекарня', 'Автомойка', 'Магазин одежды']

export default function Chat() {
  const [msgs, setMsgs] = useState<ChatMessage[]>([greeting])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const end = useRef<HTMLDivElement>(null)
  const { setPlan } = useCabinet()
  const nav = useNavigate()

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function send(t: string, ans?: Answer[]) {
    if (!t.trim() || busy) return
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: 'user', text: t }])
    setText('')
    setBusy(true)
    try {
      const reply = await sendMessage('demo', t, ans)
      if (reply.type === 'plan') setPlan(reply.plan)
      setMsgs((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', reply }])
    } catch {
      setMsgs((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', text: 'Не удалось получить ответ. Проверьте соединение и отправьте сообщение ещё раз.' }])
    } finally { setBusy(false) }
  }

  const submitAnswers = (qs: Question[]) => {
    send(
      qs.map((q) => `${q.text} ${answers[q.id] ?? '—'}`).join('\n'),
      qs.map((q) => ({ question_id: q.id, answer: answers[q.id] ?? '' })),
    )
    setAnswers({})
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-5 pb-3 pt-2">
        <Logo size={40} />
        <div>
          <h1 className="text-[18px] font-bold leading-tight">ИИ-консультант</h1>
          <p className="flex items-center gap-1.5 text-[13px] text-muted"><span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />на связи</p>
        </div>
      </header>
      <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 pb-3">
        {msgs.map((m) => (
          <div key={m.id} className={`rise flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] whitespace-pre-line px-4 py-3 text-[15px] leading-snug ${m.role === 'user' ? 'rounded-[22px] rounded-br-md bg-accent text-white' : 'card-ring rounded-[22px] rounded-bl-md bg-surface'}`}>
              {m.text ?? <Reply reply={m.reply!} answers={answers} setAnswers={setAnswers} onSubmit={submitAnswers} onOpen={() => nav('/plan')} />}
            </div>
          </div>
        ))}
        {msgs.length === 1 && !busy && (
          <div className="rise flex flex-wrap gap-2 pt-1">
            {starters.map((s) => <Chip key={s} onClick={() => send(`Хочу открыть: ${s.toLowerCase()}`)}>{s}</Chip>)}
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
      <form className="flex items-center gap-2 px-3 pb-2 pt-2" onSubmit={(e) => { e.preventDefault(); send(text) }}>
        <label className="sr-only" htmlFor="msg">Сообщение</label>
        <input id="msg" value={text} onChange={(e) => setText(e.target.value)} placeholder="Хочу открыть кофейню у метро"
          className="h-12 min-w-0 flex-1 rounded-full bg-surface px-5 text-[15px] outline-none ring-1 ring-white/5 placeholder:text-muted focus:ring-2 focus:ring-accent" />
        <button aria-label="Отправить" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-[0_8px_20px_-8px_rgba(255,69,56,.8)] transition-opacity disabled:opacity-35" disabled={busy || !text.trim()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
    </div>
  )
}

function Reply({ reply, answers, setAnswers, onSubmit, onOpen }: {
  reply: AiReply
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
          <div><div className="text-[12px] text-muted">Окупаемость</div><div className="font-semibold">{reply.plan.finance.payback_months} мес.</div></div>
        </div>
        <button onClick={onOpen} className="h-11 w-full rounded-xl bg-accent text-[15px] font-semibold text-white active:bg-brand-deep">Открыть план</button>
      </div>
    )
  const done = reply.questions.every((q) => answers[q.id])
  return (
    <div className="space-y-4">
      <div>{reply.text}</div>
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
      <button disabled={!done} onClick={() => onSubmit(reply.questions)} className="h-11 w-full rounded-xl bg-accent text-[15px] font-semibold text-white transition-opacity disabled:opacity-35">Ответить</button>
    </div>
  )
}
