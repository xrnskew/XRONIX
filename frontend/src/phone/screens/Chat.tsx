import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendMessage } from '../../api'
import type { AiReply, ChatMessage, Question } from '../../types/plan'
import { Chip } from '../ui'
import { useCabinet } from '../PlanContext'
import { rub } from '../../lib/format'

const greeting: ChatMessage = { id: 'g', role: 'assistant', text: 'Здравствуйте! Опишите идею: что хотите открыть и где. Я задам пару вопросов и соберу план.' }

export default function Chat() {
  const [msgs, setMsgs] = useState<ChatMessage[]>([greeting])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const end = useRef<HTMLDivElement>(null)
  const { setPlan } = useCabinet()
  const nav = useNavigate()

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function send(t: string) {
    if (!t.trim() || busy) return
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: 'user', text: t }])
    setText('')
    setBusy(true)
    try {
      const reply = await sendMessage('demo', t)
      if (reply.type === 'plan') setPlan(reply.plan)
      setMsgs((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', reply }])
    } catch (e) {
      setMsgs((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', text: 'Не удалось получить ответ. Проверьте соединение и отправьте сообщение ещё раз.' }])
    } finally { setBusy(false) }
  }

  const submitAnswers = (qs: Question[]) => {
    send(qs.map((q) => `${q.text} ${answers[q.id] ?? '—'}`).join('\n'))
    setAnswers({})
  }

  return (
    <div className="flex h-full flex-col">
      <h1 className="px-5 pb-2 pt-2 text-[22px] font-semibold">Чат с ИИ</h1>
      <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 pb-3">
        {msgs.map((m) => (
          <div key={m.id} className={`rise flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[15px] leading-snug ${m.role === 'user' ? 'bg-accent text-white' : 'bg-surface'}`}>
              {m.text ?? <Reply reply={m.reply!} answers={answers} setAnswers={setAnswers} onSubmit={submitAnswers} onOpen={() => nav('/plan')} />}
            </div>
          </div>
        ))}
        {busy && <div className="text-[13px] text-muted" role="status">ИИ думает…</div>}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(text) }}>
        <label className="sr-only" htmlFor="msg">Сообщение</label>
        <input id="msg" value={text} onChange={(e) => setText(e.target.value)} placeholder="Хочу открыть кофейню у метро"
          className="h-11 flex-1 rounded-full bg-surface px-4 text-[15px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent" />
        <button className="h-11 rounded-full bg-accent px-5 text-[15px] font-semibold text-white disabled:opacity-40" disabled={busy || !text.trim()}>Отправить</button>
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
      <div className="space-y-2">
        <div className="font-semibold">{reply.plan.title}</div>
        <div className="text-muted">Нужно {rub(reply.plan.finance.startup_cost_rub)}, окупаемость {reply.plan.finance.payback_months} мес.</div>
        <button onClick={onOpen} className="h-10 w-full rounded-xl bg-accent text-[14px] font-semibold text-white">Открыть план</button>
      </div>
    )
  const done = reply.questions.every((q) => answers[q.id])
  return (
    <div className="space-y-3">
      <div>{reply.text}</div>
      {reply.questions.map((q) => (
        <div key={q.id} className="space-y-1.5">
          <div className="text-[14px] font-medium">{q.text}</div>
          {q.kind === 'choice' ? (
            <div className="flex flex-wrap gap-1.5">
              {q.options?.map((o) => <Chip key={o} active={answers[q.id] === o} onClick={() => setAnswers({ ...answers, [q.id]: o })}>{o}</Chip>)}
            </div>
          ) : (
            <input aria-label={q.text} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              className="h-10 w-full rounded-xl bg-surface-2 px-3 text-[14px] outline-none focus:ring-2 focus:ring-accent" placeholder="Ваш ответ" />
          )}
        </div>
      ))}
      <button disabled={!done} onClick={() => onSubmit(reply.questions)} className="h-10 w-full rounded-xl bg-accent text-[14px] font-semibold text-white disabled:opacity-40">Ответить</button>
    </div>
  )
}
