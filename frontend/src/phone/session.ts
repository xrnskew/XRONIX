import type { AiReply, Answer, ChatDetail, ChatMessage, Plan, PlanRecord, PlanSummary } from '../types/plan'

export interface SessionApi {
  createChat(): Promise<{ chat_id: string }>
  getChat(id: string): Promise<ChatDetail>
  deleteChat(id: string): Promise<void>
  sendMessage(id: string, text: string, answers?: Answer[]): Promise<AiReply>
  listPlans(): Promise<PlanSummary[]>
  getPlan(id: string): Promise<PlanRecord>
}
interface Conversation {
  id: string | null
  messages: ChatMessage[]
  busy: boolean
  failed: { text: string; answers?: Answer[] } | null
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
    this.update({ plan: reply?.type === 'plan' ? reply.plan : null, planId: reply?.type === 'plan' ? reply.plan_id : null, planLoading: false, planError: null })
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

  send = async (text: string, answers?: Answer[], retry = false) => {
    const conversation = this.active
    if (conversation.busy || !text.trim()) return
    const generation = this.generation
    if (retry) conversation.messages = conversation.messages.filter((m) => !m.error)
    else conversation.messages = [...conversation.messages, { id: crypto.randomUUID(), role: 'user', text, answers }]
    conversation.failed = null
    conversation.busy = true
    this.update()
    try {
      if (!conversation.id) {
        conversation.id = (await this.api.createChat()).chat_id
        if (!this.current(generation)) return
        if (this.active === conversation) this.update()
      }
      const reply = await this.api.sendMessage(conversation.id, text, answers)
      if (!this.current(generation)) return
      conversation.messages = [...conversation.messages, { id: crypto.randomUUID(), role: 'assistant', reply }]
      if (this.active === conversation) {
        if (reply.type === 'plan') { this.planRequest++; this.planChatId = conversation.id; this.update({ plan: reply.plan, planId: reply.plan_id, planLoading: false, planError: null }) }
        else this.update()
      }
    } catch (e) {
      if (!this.current(generation)) return
      conversation.failed = { text, answers }
      conversation.messages = [...conversation.messages, { id: crypto.randomUUID(), role: 'assistant', text: this.errorText(e), error: true }]
    } finally {
      if (this.current(generation)) {
        conversation.busy = false
        if (this.active === conversation) this.update()
      }
    }
  }
  retry = async () => { const failure = this.active.failed; if (failure) await this.send(failure.text, failure.answers, true) }

  openChat = async (id: string): Promise<boolean> => {
    const navigation = ++this.navigation
    const generation = this.generation
    this.planRequest++
    let conversation = [...this.conversations].find((c) => c.id === id)
    // A pending request owns the optimistic messages; a GET must not overwrite them.
    if (!conversation?.busy) {
      const chat = await this.api.getChat(id)
      if (!this.current(generation) || navigation !== this.navigation) return false
      const messages: ChatMessage[] = [this.greeting, ...chat.messages.map((m): ChatMessage => m.role === 'user' && m.reply.type === 'message'
        ? { id: m.id, role: 'user', text: m.reply.text }
        : { id: m.id, role: m.role, reply: m.reply })]
      if (conversation) { conversation.messages = messages; conversation.failed = null }
      else { conversation = { id, messages, busy: false, failed: null }; this.conversations.add(conversation) }
    }
    if (!this.current(generation) || navigation !== this.navigation) return false
    this.active = conversation
    this.selectReply(conversation)
    return true
  }

  openPlan = async (id: string, cached?: Plan): Promise<void> => {
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
