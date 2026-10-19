import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Answer, ChatMessage, Plan, Profile } from '../types/plan'
import { ApiError, USE_MOCKS, api, getToken, onUnauthorized, setToken } from '../api'
import { mockPlan, mockProfile } from '../mocks/data'

type Status = 'booting' | 'out' | 'in'
type ProfilePatch = Partial<Pick<Profile, 'name' | 'city' | 'experience' | 'budget_rub' | 'tags'>>

export const greeting: ChatMessage = { id: 'g', role: 'assistant', text: 'Здравствуйте! Опишите идею: что хотите открыть и где. Я задам пару вопросов и соберу план.' }

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

  // только для презентации слева: после своего входа пользователь управляет телефоном сам
  userControlled: boolean
  demoLogin: () => Promise<void>
  showDemoPlan: () => void
}
const C = createContext<Ctx | null>(null)

const skipKey = (id?: string) => `xronix_onboarding_skipped_${id ?? ''}`
const wasSkipped = (id?: string) => { try { return localStorage.getItem(skipKey(id)) === '1' } catch { return false } }

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.')

export function CabinetProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(getToken() ? 'booting' : 'out')
  const [user, setUser] = useState<Profile | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(false)
  const [userControlled, setUserControlled] = useState(false)

  const [plan, setPlan] = useState<Plan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([greeting])
  const [busy, setBusy] = useState(false)
  const failed = useRef<{ text: string; answers?: Answer[] } | null>(null)
  const [canRetry, setCanRetry] = useState(false)

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

  const reset = useCallback(() => {
    setUser(null); setPlan(null); setChatId(null); setMessages([greeting]); setSkipped(false)
    failed.current = null; setCanRetry(false)
  }, [])

  const signOut = useCallback(() => { setToken(null); reset(); setUserControlled(false); setStatus('out') }, [reset])

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

  const signIn: Ctx['signIn'] = async (email, password) => { const r = await api.login({ email, password }); setUserControlled(true); await enter(r.user) }
  const signUp: Ctx['signUp'] = async (name, email, password) => { const r = await api.register({ name, email, password }); setUserControlled(true); await enter(r.user) }

  const saveProfile: Ctx['saveProfile'] = async (patch) => { setUser(await api.patchMe(patch)) }

  const push = (m: Omit<ChatMessage, 'id'>) => setMessages((all) => [...all, { id: crypto.randomUUID(), ...m }])

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

  const needsOnboarding = !!user && !skipped && !wasSkipped(user.id) && user.city == null && user.experience == null && user.budget_rub == null

  const value: Ctx = {
    status, user, notice, needsOnboarding, skipOnboarding: () => { try { localStorage.setItem(skipKey(user?.id), '1') } catch { /* хранилище недоступно */ } setSkipped(true) },
    signIn, signUp, signOut, saveProfile,
    plan, planLoading, planError, reloadPlan,
    messages, busy, canRetry, send, retry, newChat, openChat,
    demoLogin: async () => { if (USE_MOCKS && status !== 'in') await enter((await api.login({ email: mockProfile.email, password: 'demo1234' })).user) },
    userControlled,
    showDemoPlan: () => { if (USE_MOCKS && !plan) setPlan(mockPlan) },
  }
  return <C.Provider value={value}>{children}</C.Provider>
}

export const useCabinet = () => {
  const c = useContext(C)
  if (!c) throw new Error('CabinetProvider отсутствует')
  return c
}
