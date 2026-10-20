import type { Api } from './index'
import type { AiReply, ChatMessageDto, ChatSummary, PlanRecord, Profile } from '../types/plan'
import { mockPlan, mockProfile, mockQuestions } from '../mocks/data'
import { ApiError, setToken } from './client'

// Мок-бэкенд в памяти: те же вызовы и формы ответов, что в /contracts/api.md.
// Подсказка для демо: сообщение со словом «!ошибка» вернёт ошибку ИИ, чтобы показать экран ошибки.
const delay = (ms = 600) => new Promise((r) => setTimeout(r, ms))
const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

interface MockChat extends ChatSummary { messages: ChatMessageDto[]; step: number }
const chats = new Map<string, MockChat>()
const plans = new Map<string, PlanRecord>()
let user: Profile = { id: 'u_mock', name: '', email: '', city: null, experience: null, budget_rub: null, tags: [] }

const session = () => { setToken('mock-token'); return { token: 'mock-token', user } }

export const mockApi: Api = {
  async register({ email, name }) {
    await delay()
    user = { id: uid(), name, email, city: null, experience: null, budget_rub: null, tags: [] }
    return session()
  },
  async login({ email }) {
    await delay()
    user = email === mockProfile.email ? { ...mockProfile, id: 'u_demo' } : { id: uid(), email, name: email.split('@')[0], city: null, experience: null, budget_rub: null, tags: [] }
    if (email.startsWith('analyst@')) user = { ...user, role: 'analyst' } // в моке аналитик — любой адрес analyst@…
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
    chats.set(id, { id, title: 'Новый диалог', updated_at: now(), plan_id: null, messages: [], step: 0 })
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
  async sendMessage(chatId, text) {
    await delay(900)
    const c = chats.get(chatId)
    if (!c) throw new ApiError('NOT_FOUND', 'Диалог не найден.', 404)
    if (text.includes('!ошибка')) throw new ApiError('AI_UNAVAILABLE', 'Консультант сейчас недоступен. Попробуйте ещё раз через минуту.', 502)
    c.messages.push({ id: uid(), role: 'user', created_at: now(), reply: { type: 'message', text } })
    if (c.step === 0) c.title = text.replace(/^Хочу открыть:\s*/i, '').slice(0, 60)
    c.step += 1
    let reply: AiReply
    if (c.step === 1) reply = mockQuestions
    else {
      const plan_id = uid()
      const plan = structuredClone(mockPlan)
      plan.business.city = user.city?.trim() || 'Город не указан'
      plan.tags_update = plan.tags_update.filter((tag) => tag !== mockPlan.business.city)
      if (user.city) plan.tags_update.push(user.city)
      plans.set(plan_id, { plan_id, chat_id: chatId, created_at: now(), plan })
      c.plan_id = plan_id
      c.title = mockPlan.title
      c.step = 0
      reply = { type: 'plan', text: 'План готов', plan_id, plan }
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
