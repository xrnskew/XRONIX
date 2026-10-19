import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AiReply, Answer, ChatMessage, Plan, Profile } from '../types/plan'
import { ApiError, api, getToken, onUnauthorized, setToken } from '../api'
import { mockPlan, mockProfile, mockQuestions } from '../mocks/data'

type Status = 'booting' | 'out' | 'in'
type ProfilePatch = Partial<Pick<Profile, 'name' | 'city' | 'experience' | 'budget_rub' | 'tags'>>

export const greeting: ChatMessage = { id: 'g', role: 'assistant', text: 'Здравствуйте! Опишите идею: что хотите открыть и где. Я задам пару вопросов и соберу план.' }

const DEMO_IDEA = 'Хочу открыть кофейню у метро'
const DEMO_ANSWERS = { budget: '500 тыс – 2 млн', experience: 'Нет', location: 'Москва' }

interface Ctx {
  status: Status
  user: Profile | null
  notice: string | null
  needsOnboarding: boolean
  skipOnboarding: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  signOut: () => void
  saveProfile: (patch: ProfilePatch) => Promise<void>

  plan: Plan | null
  planLoading: boolean
  planError: string | null
  reloadPlan: () => Promise<void>

  messages: ChatMessage[]
  busy: boolean
  canRetry: boolean
  send: (text: string, answers?: Answer[]) => Promise<void>
  retry: () => Promise<void>
  newChat: () => void
  openChat: (id: string) => Promise<void>

  // Автопоказ (презентация слева): телефон показывает заготовленные данные, а не настоящую сессию.
  demo: boolean
  demoAnswers: Record<string, string> | null
  demoEnter: () => void
  demoExit: () => void
  playDemoChat: (o: { instant?: boolean; onStep?: (n: number) => void }) => void
  stopDemo: () => void
  showDemoPlan: () => void // кнопка «Показать пример» на пустой вкладке плана (только на моках)
}
const C = createContext<Ctx | null>(null)

const skipKey = (id?: string) => `xronix_onboarding_skipped_${id ?? ''}`
const wasSkipped = (id?: string) => { try { return localStorage.getItem(skipKey(id)) === '1' } catch { return false } }

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.')
const uid = () => crypto.randomUUID()

export function CabinetProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(getToken() ? 'booting' : 'out')
  const [user, setUser] = useState<Profile | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(false)
  const [demo, setDemo] = useState(false)
  const [demoAnswers, setDemoAnswers] = useState<Record<string, string> | null>(null)

  const [plan, setPlan] = useState<Plan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([greeting])
  const [busy, setBusy] = useState(false)
  const failed = useRef<{ text: string; answers?: Answer[] } | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const timers = useRef<number[]>([])
  const demoRef = useRef(false)

  const reloadPlan = useCallback(async () => {
    setPlanLoading(true)
    setPlanError(null)
    try {
      const list = await api.listPlans()
      setPlan(list.length ? (await api.getPlan(list[0].plan_id)).plan : null)
    } catch (e) {
      setPlanError(errText(e))
    } finally {
      setPlanLoading(false)
    }
  }, [])

  const stopDemo = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setDemoAnswers(null)
    setBusy(false)
  }, [])

  const reset = useCallback(() => {
    stopDemo()
    setUser(null); setPlan(null); setChatId(null); setMessages([greeting]); setSkipped(false); setDemo(false); demoRef.current = false
    failed.current = null; setCanRetry(false)
  }, [stopDemo])

  const signOut = useCallback(() => { setToken(null); reset(); setStatus('out') }, [reset])

  const enter = useCallback(async (u: Profile) => {
    reset(); setUser(u); setNotice(null); setStatus('in')
    await reloadPlan()
  }, [reset, reloadPlan])

  useEffect(() => {
    onUnauthorized(() => { reset(); setNotice('Сессия истекла. Войдите снова.'); setStatus('out') })
    return () => onUnauthorized(null)
  }, [reset])

  useEffect(() => {
    if (!getToken()) return
    api.getMe().then(enter).catch((e) => {
      if (!(e instanceof ApiError && e.code === 'UNAUTHORIZED')) setNotice(errText(e))
      setStatus('out')
    })
  }, [enter])

  const signIn: Ctx['signIn'] = async (email, password) => { await enter((await api.login({ email, password })).user) }
  const signUp: Ctx['signUp'] = async (name, email, password) => { await enter((await api.register({ name, email, password })).user) }
  const saveProfile: Ctx['saveProfile'] = async (patch) => { setUser(await api.patchMe(patch)) }

  const push = (m: Omit<ChatMessage, 'id'>) => setMessages((all) => [...all, { id: uid(), ...m }])

  const run = async (text: string, answers: Answer[] | undefined, isRetry: boolean) => {
    if (busy) return
    if (isRetry) setMessages((all) => all.filter((m) => !m.error))
    else push({ role: 'user', text })
    failed.current = null; setCanRetry(false); setBusy(true)
    try {
      let id = chatId
      if (!id) { id = (await api.createChat()).chat_id; setChatId(id) }
      const reply = await api.sendMessage(id, text, answers)
      if (reply.type === 'plan') setPlan(reply.plan)
      push({ role: 'assistant', reply })
    } catch (e) {
      failed.current = { text, answers }; setCanRetry(true)
      push({ role: 'assistant', text: errText(e), error: true })
    } finally {
      setBusy(false)
    }
  }

  const send: Ctx['send'] = (text, answers) => run(text, answers, false)
  const retry = async () => { if (failed.current) await run(failed.current.text, failed.current.answers, true) }
  const newChat = () => { setChatId(null); setMessages([greeting]); failed.current = null; setCanRetry(false) }

  const openChat = async (id: string) => {
    const c = await api.getChat(id)
    setChatId(id)
    failed.current = null; setCanRetry(false)
    setMessages([greeting, ...c.messages.map((m): ChatMessage => (m.role === 'user' && m.reply.type === 'message' ? { id: m.id, role: 'user', text: m.reply.text } : { id: m.id, role: m.role, reply: m.reply }))])
  }

  // ---- автопоказ: ничего не вызывает у бэкенда, только заготовленные данные ----
  const demoEnter = useCallback(() => {
    if (demoRef.current) return
    reset()
    demoRef.current = true
    setDemo(true); setUser({ ...mockProfile, id: 'u_demo' }); setPlan(mockPlan); setStatus('in')
  }, [reset])
  const demoExit = useCallback(() => { setToken(null); reset(); setStatus('out') }, [reset])

  const playDemoChat: Ctx['playDemoChat'] = ({ instant, onStep }) => {
    stopDemo()
    const msg = (m: Omit<ChatMessage, 'id'>): ChatMessage => ({ id: uid(), ...m })
    const idea = msg({ role: 'user', text: DEMO_IDEA })
    const questions = msg({ role: 'assistant', reply: mockQuestions })
    const answersMsg = msg({ role: 'user', text: ['Какой стартовый бюджет? ' + DEMO_ANSWERS.budget, 'Есть опыт в общепите? ' + DEMO_ANSWERS.experience, 'В каком городе открываетесь? ' + DEMO_ANSWERS.location].join('\n') })
    const planReply: AiReply = { type: 'plan', text: 'План готов', plan_id: 'demo', plan: mockPlan }
    const planMsg = msg({ role: 'assistant', reply: planReply })
    setChatId(null)
    onStep?.(0)
    if (instant) { setMessages([greeting, idea, questions, answersMsg, planMsg]); onStep?.(4); return }
    setMessages([greeting])
    const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }
    later(700, () => { setMessages([greeting, idea]); setBusy(true); onStep?.(1) })
    later(2100, () => { setBusy(false); setMessages([greeting, idea, questions]); onStep?.(2) })
    later(3300, () => setDemoAnswers(DEMO_ANSWERS))
    later(4900, () => { setDemoAnswers(null); setMessages([greeting, idea, questions, answersMsg]); setBusy(true); onStep?.(3) })
    later(6500, () => { setBusy(false); setMessages([greeting, idea, questions, answersMsg, planMsg]); onStep?.(4) })
  }

  const needsOnboarding = !!user && !demo && !skipped && !wasSkipped(user.id) && user.city == null && user.experience == null && user.budget_rub == null

  const value: Ctx = {
    status, user, notice, needsOnboarding,
    skipOnboarding: () => { try { localStorage.setItem(skipKey(user?.id), '1') } catch { /* хранилище недоступно */ } setSkipped(true) },
    signIn, signUp, signOut, saveProfile,
    plan, planLoading, planError, reloadPlan,
    messages, busy, canRetry, send, retry, newChat, openChat,
    demo, demoAnswers, demoEnter, demoExit, playDemoChat, stopDemo,
    showDemoPlan: () => setPlan((p) => p ?? mockPlan),
  }
  return <C.Provider value={value}>{children}</C.Provider>
}

export const useCabinet = () => {
  const c = useContext(C)
  if (!c) throw new Error('CabinetProvider отсутствует')
  return c
}
