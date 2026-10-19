import type { AiReply, Answer, AuthResult, ChatDetail, ChatSummary, PlanRecord, PlanSummary, Profile } from '../types/plan'
import { USE_MOCKS, request, setToken } from './client'
import { mockApi } from './mock'

export { ApiError, USE_MOCKS, getToken, onUnauthorized, setToken } from './client'

// Контракт: /contracts/api.md
export interface Api {
  register(b: { email: string; password: string; name: string }): Promise<AuthResult>
  login(b: { email: string; password: string }): Promise<AuthResult>
  getMe(): Promise<Profile>
  patchMe(patch: Partial<Pick<Profile, 'name' | 'city' | 'experience' | 'budget_rub' | 'tags'>>): Promise<Profile>
  listChats(): Promise<ChatSummary[]>
  createChat(): Promise<{ chat_id: string }>
  getChat(id: string): Promise<ChatDetail>
  deleteChat(id: string): Promise<void>
  sendMessage(chatId: string, text: string, answers?: Answer[]): Promise<AiReply>
  listPlans(): Promise<PlanSummary[]>
  getPlan(id: string): Promise<PlanRecord>
}

const AI_TIMEOUT = 35_000 // ИИ думает до 30 секунд

const realApi: Api = {
  async register(b) { const r = await request<AuthResult>('POST', '/auth/register', b); setToken(r.token); return r },
  async login(b) { const r = await request<AuthResult>('POST', '/auth/login', b); setToken(r.token); return r },
  getMe: () => request('GET', '/me'),
  patchMe: (patch) => request('PATCH', '/me', patch),
  listChats: () => request('GET', '/chats'),
  createChat: () => request('POST', '/chats'),
  getChat: (id) => request('GET', `/chats/${id}`),
  deleteChat: (id) => request('DELETE', `/chats/${id}`),
  sendMessage: (chatId, text, answers) => request('POST', `/chats/${chatId}/messages`, answers?.length ? { text, answers } : { text }, AI_TIMEOUT),
  listPlans: () => request('GET', '/plans'),
  getPlan: (id) => request('GET', `/plans/${id}`),
}

export const api: Api = USE_MOCKS ? mockApi : realApi
