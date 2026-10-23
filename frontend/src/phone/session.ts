import type { AiReply, Answer, ChatDetail, ChatMessage, Plan, PlanRecord, PlanSummary } from '../types/plan'
import { knownPlan, latestPlanId } from '../lib/planAlias.ts'
import { uid } from '../lib/uid.ts'

export interface SessionApi {
  createChat(): Promise<{ chat_id: string }>
  getChat(id: string): Promise<ChatDetail>
  deleteChat(id: string): Promise<void>
  sendMessage(id: string, text: string, answers?: Answer[], requestId?: string): Promise<AiReply>
  waitGeneration?(id: string): Promise<AiReply>
  listPlans(): Promise<PlanSummary[]>
  getPlan(id: string): Promise<PlanRecord>
}
interface Conversation {
  id: string | null
  messages: ChatMessage[]
  busy: boolean
  failed: { text: string; answers?: Answer[]; requestId?: string } | null
}
export interface SessionSnapshot {
  chatId: string | null
  messages: ChatMessage[]
  busy: boolean
  canRetry: boolean
  plan: Plan | null
  planId: string | null
  planLoading: boolean
  planError: string | null
}

// Requests belong to a conversation and a login generation, never to the visible screen.
// Keeping pending conversations lets a user return to one while its request finishes.
export class CabinetSession {
  private conversations = new Set<Conversation>()
  private active: Conversation
  private generation = 0
  private navigation = 0
  private planRequest = 0
  private planChatId: string | null = null
  private listeners = new Set<() => void>()
  private snapshot: SessionSnapshot

  private api: SessionApi
  private greeting: ChatMessage
  private errorText: (e: unknown) => string
  constructor(api: SessionApi, greeting: ChatMessage, errorText: (e: unknown) => string) {
    this.api = api; this.greeting = greeting; this.errorText = errorText
    this.active = this.draft()
    this.snapshot = { chatId: null, messages: this.active.messages, busy: false, canRetry: false, plan: null, planId: null, planLoading: false, planError: null }
  }
  private draft(): Conversation {
    const conversation = { id: null, messages: [this.greeting], busy: false, failed: null }
    this.conversations.add(conversation)
    return conversation
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<SessionSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, chatId: this.active.id, messages: this.active.messages, busy: this.active.busy, canRetry: !!this.active.failed, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  private current(generation: number) { return generation === this.generation }
  private selectReply(conversation: Conversation) {
    const reply = [...conversation.messages].reverse().find((m) => m.reply?.type === 'plan')?.reply
    this.planChatId = conversation.id
    if (reply?.type !== 'plan') { this.update({ plan: null, planId: null, planLoading: false, planError: null }); return }
    // план из чата мог быть пересчитан (другие свои деньги): показываем актуальный, а не тот, что навсегда записан в сообщении
    const latest = latestPlanId(reply.plan_id)
    if (latest === reply.plan_id) { this.update({ plan: reply.plan, planId: reply.plan_id, planLoading: false, planError: null }); return }
    const have = knownPlan(latest)
    this.update({ plan: have, planId: latest, planLoading: !have, planError: null })
    if (!have) void this.openPlan(latest)
  }
  reset = () => {
    this.generation++
    this.conversations.clear()
    this.newChat()
  }
  newChat = () => {
    this.navigation++
    this.planRequest++
    this.active = this.draft()
    this.planChatId = null
    this.update({ plan: null, planId: null, planLoading: false, planError: null })
  }
  // Presentation-only data uses the same snapshot without making backend calls.
  present = (patch: Partial<SessionSnapshot>) => {
    if (patch.messages) this.active.messages = patch.messages
    if (patch.busy !== undefined) this.active.busy = patch.busy
    if (patch.chatId !== undefined) this.active.id = patch.chatId
    this.update(patch)
  }

  send = async (text: string, answers?: Answer[], retry = false, requestId: string = uid()) => {
    const conversation = this.active
    if (conversation.busy || !text.trim()) return
    const generation = this.generation
    if (retry) conversation.messages = conversation.messages.filter((m) => !m.error)
    else conversation.messages = [...conversation.messages, { id: uid(), role: 'user', text, answers }]
    conversation.failed = null
    conversation.busy = true
    this.update()
    try {
      if (!conversation.id) {
        conversation.id = (await this.api.createChat()).chat_id
        if (!this.current(generation)) return
        if (this.active === conversation) this.update()
      }
      const reply = await this.api.sendMessage(conversation.id, text, answers, requestId)
      if (!this.current(generation)) return
      conversation.messages = [...conversation.messages, { id: uid(), role: 'assistant', reply }]
      if (this.active === conversation) {
        if (reply.type === 'plan') { this.planRequest++; this.planChatId = conversation.id; this.update({ plan: reply.plan, planId: reply.plan_id, planLoading: false, planError: null }) }
        else this.update()
      }
    } catch (e) {
      if (!this.current(generation)) return
      conversation.failed = { text, answers, requestId: e instanceof Error && ['NETWORK', 'TIMEOUT'].includes((e as Error & { code?: string }).code ?? '') ? requestId : undefined }
      conversation.messages = [...conversation.messages, { id: uid(), role: 'assistant', text: this.errorText(e), error: true }]
    } finally {
      if (this.current(generation)) {
        conversation.busy = false
        if (this.active === conversation) this.update()
      }
    }
  }
  retry = async () => { const failure = this.active.failed; if (failure) await this.send(failure.text, failure.answers, true, failure.requestId) }

  openChat = async (id: string): Promise<boolean> => {
    const navigation = ++this.navigation
    const generation = this.generation
    this.planRequest++
    let conversation = [...this.conversations].find((c) => c.id === id)
    // A pending request owns the optimistic messages; a GET must not overwrite them.
    if (!conversation?.busy) {
      const chat = await this.api.getChat(id)
      // Сервер создаёт такой чат при пересчёте плана: в нём есть план, но нет сообщений. Показываем план карточкой, а не пустой экран
      const planOnly: ChatMessage[] = []
      if (!chat.messages.length) {
        try {
          const rec = (await this.api.listPlans()).find((p) => p.chat_id === id)
          if (rec) { const r = await this.api.getPlan(latestPlanId(rec.plan_id)); planOnly.push({ id: `plan-${r.plan_id}`, role: 'assistant', reply: { type: 'plan', text: 'План готов', plan_id: r.plan_id, plan: r.plan } }) }
        } catch { /* пустой чат остаётся пустым */ }
      }
      if (!this.current(generation) || navigation !== this.navigation) return false
      const messages: ChatMessage[] = [this.greeting, ...chat.messages.map((m): ChatMessage => m.role === 'user' && m.reply.type === 'message'
        ? { id: m.id, role: 'user', text: m.reply.text, answers: m.answers }
        : { id: m.id, role: m.role, reply: m.reply }), ...planOnly]
      if (conversation) { conversation.messages = messages; conversation.failed = null }
      else { conversation = { id, messages, busy: false, failed: null }; this.conversations.add(conversation) }
      const job = chat.generation
      if (job?.status === 'failed') {
        conversation.failed = { text: job.request.text, answers: job.request.answers }
        conversation.messages.push({ id: `error-${job.id}`, role: 'assistant', text: 'Генерация завершилась с ошибкой. Можно повторить отправку.', error: true })
      }
      if (job && ['queued', 'running'].includes(job.status) && this.api.waitGeneration) {
        const pending = conversation
        const last = pending.messages.at(-1)
        if (last?.role !== 'user' || last.text !== job.request.text) {
          pending.messages.push({ id: `pending-${job.id}`, role: 'user', text: job.request.text, answers: job.request.answers })
        }
        pending.busy = true
        void this.api.waitGeneration(job.id).then(async () => {
          if (!this.current(generation)) return
          const fresh = await this.api.getChat(id)
          if (!this.current(generation)) return
          pending.messages = [this.greeting, ...fresh.messages.map((m): ChatMessage => m.role === 'user' && m.reply.type === 'message'
            ? { id: m.id, role: 'user', text: m.reply.text, answers: m.answers }
            : { id: m.id, role: m.role, reply: m.reply })]
          pending.failed = null
        }).catch((e) => {
          if (!this.current(generation)) return
          pending.failed = { text: job.request.text, answers: job.request.answers,
            requestId: ['NETWORK', 'TIMEOUT'].includes((e as { code?: string }).code ?? '') ? job.request_id : undefined }
          pending.messages.push({ id: `error-${job.id}`, role: 'assistant', text: this.errorText(e), error: true })
        }).finally(() => {
          if (!this.current(generation)) return
          pending.busy = false
          if (this.active === pending) this.selectReply(pending)
        })
      }
    }
    if (!this.current(generation) || navigation !== this.navigation) return false
    this.active = conversation
    this.selectReply(conversation)
    return true
  }

  openPlan = async (requested: string, given?: Plan): Promise<void> => {
    // если план пересчитывали, открываем последний в цепочке; переданный готовый план относится к исходному и не годится
    const id = latestPlanId(requested)
    const cached = id === requested ? given : knownPlan(id) ?? undefined
    const request = ++this.planRequest
    const generation = this.generation
    if (cached) { this.planChatId = this.active.id; this.update({ plan: cached, planId: id, planLoading: false, planError: null }); return }
    this.update({ plan: null, planId: id, planLoading: true, planError: null })
    try {
      const record = await this.api.getPlan(id)
      if (!this.current(generation) || request !== this.planRequest) return
      this.planChatId = record.chat_id
      this.update({ plan: record.plan, planLoading: false })
    } catch (e) {
      if (this.current(generation) && request === this.planRequest) this.update({ plan: null, planLoading: false, planError: this.errorText(e) })
    }
  }
  reloadPlan = async () => {
    if (this.snapshot.planId) return this.openPlan(this.snapshot.planId)
    const request = ++this.planRequest
    const generation = this.generation
    this.update({ planLoading: true, planError: null })
    try {
      const list = await this.api.listPlans()
      if (!this.current(generation) || request !== this.planRequest) return
      if (list.length) await this.openPlan(list[0].plan_id)
      else this.update({ plan: null, planId: null, planLoading: false })
    } catch (e) {
      if (this.current(generation) && request === this.planRequest) this.update({ planLoading: false, planError: this.errorText(e) })
    }
  }
  deleteChat = async (id: string) => {
    const generation = this.generation
    await this.api.deleteChat(id)
    if (!this.current(generation)) return
    for (const conversation of this.conversations) if (conversation.id === id) this.conversations.delete(conversation)
    if (this.active.id === id) this.newChat()
    else if (this.planChatId === id) { this.planRequest++; this.planChatId = null; this.update({ plan: null, planId: null, planLoading: false, planError: null }) }
  }
}
