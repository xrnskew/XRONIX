// Черновик типов по разделам 5.2–5.3 документа. Финально фиксируются в /contracts.
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
    payback_months: number
    revenue_forecast: { month: number; revenue_rub: number; expenses_rub: number }[]
  }
  credit: {
    needed: boolean
    amount_rub: number
    purpose: string
    recommended_term_months: number
    estimated_rate_percent: number
    monthly_payment_rub: number
    debt_load_percent: number
    verdict: CreditVerdict
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

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  reply?: AiReply
  text?: string
}

export interface Profile {
  name: string
  email: string
  city: string
  experience: string
  budget_rub: number
  tags: string[]
}
