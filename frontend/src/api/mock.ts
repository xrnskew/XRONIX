import type { Api } from './index'
import type { AiReply, ChatMessageDto, ChatSummary, Experience, PlanRecord, Profile } from '../types/plan'
import { mockProfile } from '../mocks/data'
import { calculatePlan, templates } from '../lib/projectCalc'
import { EXPERIENCE_OPTIONS, SPHERE_WORDS, findCity, parseAmount, parseExperience } from '../lib/parseText'
import type { Sphere } from '../types/conveyor'
import { ApiError, setToken } from './client'
import { uid } from '../lib/uid'
import { DEMO_ANALYST, DEMO_CLIENT, demoAccount } from './demoAccounts'

// Мок-бэкенд в памяти: те же вызовы и формы ответов, что в /contracts/api.md.
// Подсказка для демо: сообщение со словом «!ошибка» вернёт ошибку ИИ, чтобы показать экран ошибки.
const delay = (ms = 600) => new Promise((r) => setTimeout(r, ms))
const now = () => new Date().toISOString()

interface ConsultState { sphere: Sphere | null; city: string | null; own_funds_rub: number | null; experience: Experience | null; experience_asked: boolean }
interface MockChat extends ChatSummary { messages: ChatMessageDto[]; step: number; state: ConsultState; asked: string | null }
const chats = new Map<string, MockChat>()
const plans = new Map<string, PlanRecord>()
// Планы из расчёта проекта (mockConveyor) открываются тем же экраном плана
// Как сервер при пересчёте (POST /plans/calculate): создаётся чат с этим планом, но без сообщений
export const registerMockPlan = (plan_id: string, plan: PlanRecord['plan'], withChat = true) => {
  const chat_id = withChat ? uid() : ''
  if (withChat) chats.set(chat_id, { id: chat_id, title: plan.title, updated_at: now(), plan_id, messages: [], step: 0, state: { sphere: null, city: null, own_funds_rub: null, experience: null, experience_asked: false }, asked: null })
  plans.set(plan_id, { plan_id, chat_id, created_at: now(), plan })
}
// Один реестр планов на оба мока, как одна таблица plans на бэкенде: план из чата годится для заявки
export const findMockPlan = (plan_id: string) => plans.get(plan_id)?.plan ?? null
let user: Profile = { id: 'u_mock', name: '', email: '', city: null, experience: null, budget_rub: null, tags: [] }
export const mockUserName = () => user.name || 'Будущий предприниматель'
export const mockUser = () => user

const session = () => { setToken('mock-token'); return { token: 'mock-token', user } }

export const mockApi: Api = {
  async register({ email, name }) {
    await delay()
    user = { id: uid(), name, email, city: null, experience: null, budget_rub: null, tags: [] }
    return session()
  },
  // Демо-учётки проверяют пароль, как бэкенд; любая другая почта входит с любым паролем
  async login({ email, password }) {
    await delay()
    const demo = demoAccount(email, password)
    if (demo === 'wrong') throw new ApiError('INVALID_CREDENTIALS', 'Неверная почта или пароль.', 401)
    if (demo === DEMO_CLIENT) user = { ...mockProfile, id: 'u_demo', role: 'client' }
    else if (demo === DEMO_ANALYST) user = { id: 'u_analyst', email: demo.email, name: demo.name, role: 'analyst', city: null, experience: null, budget_rub: null, tags: [] }
    else user = { id: uid(), email, name: email.split('@')[0], city: null, experience: null, budget_rub: null, tags: [] }
    return session()
  },
  async logout() { setToken(null) },
  async logoutAll() { setToken(null) },
  async changePassword() { setToken(null) },
  async forgotPassword() { return { message: 'В демо-режиме письма не отправляются.' } },
  async resetPassword() { throw new ApiError('RESET_TOKEN_INVALID', 'Для восстановления откройте рабочую версию сайта.') },
  async getMe() { await delay(150); return user },
  async patchMe(patch) { await delay(250); user = { ...user, ...patch }; return user },

  async listChats() {
    await delay(250)
    return [...chats.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(({ id, title, updated_at, plan_id }) => ({ id, title, updated_at, plan_id }))
  },
  async createChat() {
    await delay(150)
    const id = uid()
    chats.set(id, { id, title: 'Новый диалог', updated_at: now(), plan_id: null, messages: [], step: 0, state: { sphere: null, city: null, own_funds_rub: null, experience: null, experience_asked: false }, asked: null })
    return { chat_id: id }
  },
  async getChat(id) {
    await delay(250)
    const c = chats.get(id)
    if (!c) throw new ApiError('NOT_FOUND', 'Диалог не найден.', 404)
    return { id, messages: c.messages }
  },
  async deleteChat(id) {
    await delay(250)
    if (!chats.delete(id)) throw new ApiError('NOT_FOUND', 'Диалог не найден.', 404)
    for (const [pid, p] of plans) if (p.chat_id === id) plans.delete(pid)
  },
  // Чат подбора бизнеса без модели — так же ведёт себя бэкенд, когда /ai/consult недоступен (contracts/conveyor.md):
  // по очереди узнаём сферу, город и свои деньги, затем считаем план по шаблону сферы.
  async sendMessage(chatId, text) {
    await delay(900)
    const c = chats.get(chatId)
    if (!c) throw new ApiError('NOT_FOUND', 'Диалог не найден.', 404)
    if (text.includes('!ошибка')) throw new ApiError('AI_UNAVAILABLE', 'Консультант сейчас недоступен. Попробуйте ещё раз через минуту.', 502)
    c.messages.push({ id: uid(), role: 'user', created_at: now(), reply: { type: 'message', text } })
    if (c.step === 0) c.title = text.slice(0, 60)
    c.step += 1
    const st = c.state
    const sphere = SPHERE_WORDS.find(([, re]) => re.test(text))?.[0]
    if (sphere) st.sphere = sphere
    st.city = findCity(text) ?? st.city ?? (user.city?.trim() || null)
    const amount = parseAmount(text)
    if (c.asked === 'own_funds') st.own_funds_rub = amount ?? (/нет|ноль|без своих|^0/i.test(text.split('\n').pop() ?? '') ? 0 : st.own_funds_rub)
    else if (amount != null && /есть|свои|своих|накоп|отлож|вложить|бюджет/i.test(text)) st.own_funds_rub = amount
    // Опыт: ответ на заданный вопрос или явные слова в сообщении; непонятный ответ — null, повторно не спрашиваем
    // ответ приходит строкой «Вопрос? Ответ» — разбираем только ответ, слова вопроса не мешают
    const answerPart = (text.split('\n').pop() ?? '').split('?').pop() ?? ''
    if (c.asked === 'experience') { st.experience = parseExperience(answerPart); st.experience_asked = true }
    else if (!st.experience_asked) { const e = parseExperience(text.includes('?') ? answerPart : text); if (e) { st.experience = e; st.experience_asked = true } }
    const sphereNames = templates().map((x) => x.title.toLowerCase()).join(', ')
    let reply: AiReply
    if (!st.sphere) { c.asked = 'sphere'; reply = { type: 'questions', text: 'Какой бизнес хотите открыть?', questions: [{ id: 'sphere', text: `Что открываем? Сейчас считаю: ${sphereNames}.`, kind: 'text' }] } }
    else if (!st.city) { c.asked = 'city'; reply = { type: 'questions', text: 'Где будет бизнес?', questions: [{ id: 'city', text: 'В каком городе открываетесь?', kind: 'text' }] } }
    else if (st.own_funds_rub == null) { c.asked = 'own_funds'; reply = { type: 'questions', text: 'Осталось пара вопросов перед расчётом.', questions: [{ id: 'own_funds', text: 'Сколько своих денег готовы вложить в запуск? Если нет — напишите «нет».', kind: 'text' }] } }
    else if (!st.experience_asked) { c.asked = 'experience'; reply = { type: 'questions', text: 'Почти готово.', questions: [{ id: 'experience', text: 'Есть ли у вас опыт в этом бизнесе?', kind: 'choice', options: EXPERIENCE_OPTIONS }] } }
    else {
      const plan_id = uid()
      const plan = calculatePlan({ sphere: st.sphere, city: st.city, own_funds_rub: st.own_funds_rub, answers: {}, ...(st.experience ? { experience: st.experience } : {}) })
      plans.set(plan_id, { plan_id, chat_id: chatId, created_at: now(), plan })
      c.plan_id = plan_id; c.title = plan.title; c.step = 0; c.asked = null
      st.experience = null; st.experience_asked = false // опыт — свойство бизнеса: для следующего бизнеса в этом чате спросим снова
      reply = { type: 'plan', text: 'План готов. Цифры посчитаны по шаблону сферы: площадь, поток и чек можно поправить в расчёте проекта.', plan_id, plan }
    }
    c.messages.push({ id: uid(), role: 'assistant', created_at: now(), reply })
    c.updated_at = now()
    return reply
  },

  async listPlans() {
    await delay(200)
    return [...plans.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((p) => ({ plan_id: p.plan_id, chat_id: p.chat_id, title: p.plan.title, created_at: p.created_at }))
  },
  async getPlan(id) {
    await delay(200)
    const p = plans.get(id)
    if (!p) throw new ApiError('NOT_FOUND', 'План не найден.', 404)
    return p
  },
}
