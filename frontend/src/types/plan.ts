// Типы повторяют /contracts/schemas. При правке контрактов обновлять здесь.
export type RiskLevel = 'low' | 'medium' | 'high'
export type CreditVerdict = 'ok' | 'risky' | 'not_recommended'

export interface Plan {
  title: string
  summary: string
  business: { sphere: string; format: string; city: string }
  steps: { order: number; title: string; description: string; duration_days: number | null; cost_rub: number | null }[]
  opportunities: { title: string; description: string }[]
  risks: { title: string; level: RiskLevel; mitigation: string }[]
  finance: {
    startup_cost_rub: number
    own_funds_rub: number
    funding_gap_rub: number
    monthly_revenue_rub: number
    monthly_expenses_rub: number
    monthly_profit_rub: number
    payback_months: number | null
    revenue_forecast: { month: number; revenue_rub: number; expenses_rub: number }[]
  }
  credit: {
    needed: boolean
    // при needed=false все поля, кроме comment, равны null
    amount_rub: number | null
    purpose: string | null
    recommended_term_months: number | null
    estimated_rate_percent: number | null
    monthly_payment_rub: number | null
    debt_load_percent: number | null
    verdict: CreditVerdict | null
    recommended_product_id?: 'fast' | 'secured' | 'mortgage' | 'revolving' | null
    comment: string
  }
  tags_update: string[]
}

export interface Question {
  id: string
  text: string
  kind: 'choice' | 'text'
  options?: string[]
}

export type AiReply =
  | { type: 'message'; text: string }
  | { type: 'questions'; text: string; questions: Question[] }
  | { type: 'plan'; text: string; plan_id: string; plan: Plan }

// Сообщение в интерфейсе: текст пользователя, ответ ИИ или ошибка
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  reply?: AiReply
  text?: string
  error?: boolean
  answers?: Answer[]
}

export interface Profile {
  id?: string
  name: string
  email: string
  city: string | null
  experience: string | null
  budget_rub: number | null
  tags: string[]
}

export interface Answer {
  question_id: string
  answer: string
}

// Ответы API (см. /contracts/api.md)
export interface AuthResult { token: string; user: Profile }
export interface ChatSummary { id: string; title: string; updated_at: string; plan_id: string | null }
export interface ChatMessageDto { id: string; role: 'user' | 'assistant'; created_at: string; reply: AiReply }
export interface ChatDetail { id: string; messages: ChatMessageDto[] }
export interface PlanSummary { plan_id: string; chat_id: string; title: string; created_at: string }
export interface PlanRecord { plan_id: string; chat_id: string; created_at: string; plan: Plan }
