import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { AiReply, Answer, ChatMessage, Plan, Profile } from '../types/plan'
import { ApiError, api, USE_MOCKS, errorText, getToken, onUnauthorized, setToken } from '../api'
import { mockPlan, mockProfile, mockQuestions } from '../mocks/data'
import { CabinetSession } from './session'
import { uid } from '../lib/uid'

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
  signOut: () => Promise<void>
  saveProfile: (patch: ProfilePatch) => Promise<void>

  plan: Plan | null
  planId: string | null
  openPlan: (id: string, cached?: Plan) => Promise<void>
  planLoading: boolean
  planError: string | null
  reloadPlan: () => Promise<void>

  chatId: string | null
  messages: ChatMessage[]
  busy: boolean
  canRetry: boolean
  send: (text: string, answers?: Answer[]) => Promise<void>
  retry: () => Promise<void>
  newChat: () => void
  openChat: (id: string) => Promise<boolean>
  deleteChat: (id: string) => Promise<void> // вместе с диалогом удаляется и его план

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


export function CabinetProvider({ children, restoreSession = true }: { children: ReactNode; restoreSession?: boolean }) {
  const [status, setStatus] = useState<Status>(restoreSession && (!USE_MOCKS || getToken()) ? 'booting' : 'out')
  const [user, setUser] = useState<Profile | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(false)
  const [demo, setDemo] = useState(false)
  const [demoAnswers, setDemoAnswers] = useState<Record<string, string> | null>(null)

  const [session] = useState(() => new CabinetSession(api, greeting, errorText))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const { reloadPlan, openPlan, send, retry, openChat, deleteChat } = session
  // Новый диалог сбрасывает план текущего чата, но «План» и «Финансы» в меню остаются доступны: подгружаем последний сохранённый план
  const newChat = useCallback(() => { session.newChat(); if (!demoRef.current) void session.reloadPlan() }, [session])
  const setPlan = (plan: Plan | null) => session.present({ plan })
  const setMessages = (messages: ChatMessage[]) => session.present({ messages })
  const setBusy = (busy: boolean) => session.present({ busy })
  const setChatId = (chatId: string | null) => session.present({ chatId })
  const timers = useRef<number[]>([])
  const demoRef = useRef(false)
  const authGeneration = useRef(0)

  const stopDemo = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setDemoAnswers(null)
    setBusy(false)
  }, [])

  const reset = useCallback(() => {
    stopDemo()
    authGeneration.current++; session.reset()
    setUser(null); setSkipped(false); setDemo(false); demoRef.current = false
  }, [stopDemo, session])

  const signOut = useCallback(async () => {
    try { await api.logout(); setToken(null); reset(); setNotice(null); setStatus('out') }
    catch { setNotice('Не удалось завершить сессию на сервере. Проверьте соединение и повторите выход.') }
  }, [reset])

  // restore: сессия найдена при открытии сайта — возвращаем последний диалог; явный вход начинает с чистого экрана, прошлые диалоги — по кнопке «Все диалоги»
  const enter = useCallback(async (u: Profile, restore: boolean) => {
    let savedChat: string | null = null
    if (restore) { try { savedChat = localStorage.getItem(`xronix_chat_${u.id}`) } catch { /* storage unavailable */ } }
    reset(); setUser(u); setNotice(null); setStatus('in')
    await reloadPlan()
    if (savedChat) { try { await session.openChat(savedChat) } catch { /* removed chat */ } }
  }, [reset, reloadPlan, session])

  useEffect(() => {
    onUnauthorized(() => { reset(); setNotice('Сессия истекла. Войдите снова.'); setStatus('out') })
    return () => onUnauthorized(null)
  }, [reset])

  useEffect(() => {
    if (!restoreSession || (USE_MOCKS && !getToken())) return
    const generation = authGeneration.current
    let mounted = true
    api.getMe().then((u) => { if (mounted && generation === authGeneration.current) return enter(u, true) }).catch((e) => {
      if (!mounted || generation !== authGeneration.current) return
      if (!(e instanceof ApiError && e.code === 'UNAUTHORIZED')) setNotice(errorText(e))
      setStatus('out')
    })
    return () => { mounted = false }
  }, [enter, restoreSession])

  useEffect(() => {
    if (!user?.id || demo || status !== 'in') return
    try {
      const key = `xronix_chat_${user.id}`
      if (state.chatId) localStorage.setItem(key, state.chatId) // переживает закрытие вкладки и браузера
      else localStorage.removeItem(key)
    } catch { /* storage unavailable */ }
  }, [user?.id, state.chatId, demo, status])

  const signIn: Ctx['signIn'] = async (email, password) => { await enter((await api.login({ email, password })).user, false) }
  const signUp: Ctx['signUp'] = async (name, email, password) => { await enter((await api.register({ name, email, password })).user, false) }
  const saveProfile: Ctx['saveProfile'] = async (patch) => { const generation = authGeneration.current; const updated = await api.patchMe(patch); if (generation === authGeneration.current) setUser(updated) }

  // ---- автопоказ: ничего не вызывает у бэкенда, только заготовленные данные ----
  const demoEnter = useCallback(() => {
    if (demoRef.current) { session.present({ plan: mockPlan, planId: 'demo' }); return }
    reset()
    demoRef.current = true
    setDemo(true); setUser({ ...mockProfile, id: 'u_demo' }); setPlan(mockPlan); setStatus('in')
  }, [reset])
  const demoExit = useCallback(() => { setToken(null); reset(); setStatus('out') }, [reset])

  const playDemoChat: Ctx['playDemoChat'] = ({ instant, onStep }) => {
    stopDemo()
    session.present({ plan: mockPlan, planId: 'demo' })
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

  const needsOnboarding = !!user && !demo && !skipped && !wasSkipped(user.id) && user.city == null

  const value: Ctx = {
    status, user, notice, needsOnboarding,
    skipOnboarding: () => { try { localStorage.setItem(skipKey(user?.id), '1') } catch { /* хранилище недоступно */ } setSkipped(true) },
    signIn, signUp, signOut, saveProfile,
    ...state, reloadPlan, openPlan,
    send, retry, newChat, openChat, deleteChat,
    demo, demoAnswers, demoEnter, demoExit, playDemoChat, stopDemo,
    showDemoPlan: () => setPlan(state.plan ?? mockPlan),
  }
  return <C.Provider value={value}>{children}</C.Provider>
}

export const useCabinet = () => {
  const c = useContext(C)
  if (!c) throw new Error('CabinetProvider отсутствует')
  return c
}
