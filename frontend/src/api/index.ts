import type { AiReply, Answer, AuthResult, ChatDetail, ChatSummary, Generation, PlanRecord, PlanSummary, Profile } from '../types/plan'
import { ApiError, USE_MOCKS, request, setToken } from './client'
import { mockApi } from './mock'
import { uid } from '../lib/uid'

export { ApiError, USE_MOCKS, getToken, onUnauthorized, setToken } from './client'

// Контракт: /contracts/api.md
export interface Api {
  register(b: { email: string; password: string; name: string }): Promise<AuthResult>
  login(b: { email: string; password: string }): Promise<AuthResult>
  logout(): Promise<void>
  logoutAll(): Promise<void>
  changePassword(current_password: string, new_password: string): Promise<void>
  forgotPassword(email: string): Promise<{ message: string }>
  resetPassword(token: string, new_password: string): Promise<void>
  waitGeneration?(id: string): Promise<AiReply>
  getMe(): Promise<Profile>
  patchMe(patch: Partial<Pick<Profile, 'name' | 'city' | 'experience' | 'budget_rub' | 'tags'>>): Promise<Profile>
  listChats(): Promise<ChatSummary[]>
  createChat(): Promise<{ chat_id: string }>
  getChat(id: string): Promise<ChatDetail>
  deleteChat(id: string): Promise<void>
  sendMessage(chatId: string, text: string, answers?: Answer[], requestId?: string): Promise<AiReply>
  listPlans(): Promise<PlanSummary[]>
  getPlan(id: string): Promise<PlanRecord>
}

async function waitGeneration(id: string): Promise<AiReply> {
  const deadline = Date.now() + 225_000
  let failures = 0
  while (Date.now() < deadline) {
    try {
      const job = await request<Generation>('GET', `/generations/${id}`)
      failures = 0
      if (job.status === 'succeeded' && job.reply) return job.reply
      if (job.status === 'failed') throw new ApiError(job.error_code ?? 'AI_UNAVAILABLE', 'Запрос завершился с ошибкой. Можно повторить отправку.')
    } catch (e) {
      if (!(e instanceof ApiError) || !['NETWORK', 'TIMEOUT'].includes(e.code) || ++failures >= 3) throw e
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new ApiError('TIMEOUT', 'Результат ещё не получен. Откройте диалог снова, чтобы проверить состояние.')
}

const realApi: Api = {
  async register(b) { const r = await request<AuthResult>('POST', '/auth/register', b); setToken(r.token); return r },
  async login(b) { const r = await request<AuthResult>('POST', '/auth/login', b); setToken(r.token); return r },
  logout: () => request('POST', '/auth/logout'),
  logoutAll: () => request('POST', '/auth/logout-all'),
  changePassword: (current_password, new_password) => request('POST', '/auth/change-password', { current_password, new_password }),
  forgotPassword: (email) => request('POST', '/auth/forgot-password', { email }),
  resetPassword: (token, new_password) => request('POST', '/auth/reset-password', { token, new_password }),
  waitGeneration,
  getMe: () => request('GET', '/me'),
  patchMe: (patch) => request('PATCH', '/me', patch),
  listChats: () => request('GET', '/chats'),
  createChat: () => request('POST', '/chats'),
  getChat: (id) => request('GET', `/chats/${id}`),
  deleteChat: (id) => request('DELETE', `/chats/${id}`),
  async sendMessage(chatId, text, answers, requestId = uid()) {
    const job = await request<Generation>('POST', `/chats/${chatId}/generations`, { text, answers: answers ?? [], request_id: requestId })
    if (job.status === 'succeeded' && job.reply) return job.reply
    if (job.status === 'failed') throw new ApiError(job.error_code ?? 'AI_UNAVAILABLE', 'Запрос завершился с ошибкой. Повторите отправку.')
    return waitGeneration(job.id)
  },
  listPlans: () => request('GET', '/plans'),
  getPlan: (id) => request('GET', `/plans/${id}`),
}

export const api: Api = USE_MOCKS ? mockApi : realApi
