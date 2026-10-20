// Конвейер v2. Источник правды: /contracts/schemas/{common,conveyor,parse-need}.schema.json и /contracts/conveyor.md

export type Purpose = 'working_capital' | 'equipment' | 'new_location' | 'new_direction' | 'real_estate' | 'refinance'
export type Sphere = 'coffee' | 'bakery' | 'car_wash' | 'clothing_store' | 'beauty_salon' | 'pickup_point' | 'other'
export type MemberRole = 'owner' | 'director' | 'cfo' | 'accountant' | 'employee'
export type CollateralKind = 'real_estate' | 'equipment' | 'vehicle' | 'goods' | 'guarantor'
export type ProductId = 'fast' | 'secured' | 'mortgage' | 'revolving' | 'start' // start — демо-продукт XRONIX
export type Status = 'draft' | 'submitted' | 'checking' | 'info_requested' | 'scoring' | 'manual_review' | 'approved' | 'counter_offer' | 'signing' | 'funded' | 'declined' | 'withdrawn' | 'cancelled'
export type Actor = 'client' | 'system' | 'analyst'
export type InfoRequestKind = 'authority_document' | 'financials' | 'collateral' | 'other'
export type DeclineReason = 'company_inactive' | 'business_too_young' | 'overdue_90' | 'tax_debt' | 'head_disqualified' | 'low_score' | 'high_debt_load' | 'analyst_decision' | 'own_funds_low' | 'plan_required'
export type CompanyStatus = 'active' | 'liquidating' | 'liquidated' | 'bankrupt' | 'not_registered'

export interface RegistryCompany {
  inn: string; ogrn: string | null; name: string; kind: 'ip' | 'ul' | 'person'; status: CompanyStatus // person — будущий ИП
  registered_at: string | null; okved: { code: string; name: string } | null; address: string; head_name: string; source: string
}
export interface Company { id: string; registry: RegistryCompany; member_role: MemberRole; authority_confirmed: boolean; business_months: number }

export interface ParsedNeed {
  purpose: Purpose | null; sphere: Sphere | null; city: string | null
  amount_rub: number | null; term_months: number | null; has_collateral: boolean | null
  confidence: Partial<Record<'purpose' | 'sphere' | 'city' | 'amount_rub' | 'term_months' | 'has_collateral', number>>
}

export interface MatchRequest { purpose: Purpose; amount_rub: number; term_months: number; has_collateral: boolean; company_id?: string | null; plan_id?: string | null }
export interface MatchItem {
  product_id: ProductId; name: string; demo: boolean; eligible: boolean; can_apply: boolean; reasons: string[]
  rate_from_percent: number | null; monthly_payment_rub: number | null; url: string | null
}

export interface Financials { revenue_12m_rub: number | null; expenses_12m_rub: number | null; loan_payments_monthly_rub: number | null }
export interface Collateral { kind: CollateralKind; description: string; value_rub: number }

export interface ApplicationDraft {
  version?: number; company_id?: string; product_id?: ProductId; purpose?: Purpose
  amount_rub?: number; term_months?: number; plan_id?: string | null
  financials?: Financials; collateral?: Collateral | null; consent_bki?: boolean; info_response?: string | null
}

export interface ScheduleItem { month: number; payment_rub: number; principal_rub: number; interest_rub: number; balance_rub: number }
export interface Offer {
  id: string; kind: 'approve' | 'counter'; product_id: ProductId; amount_rub: number; term_months: number; rate_percent: number
  monthly_payment_rub: number; total_payment_rub: number; explanation: string[]; schedule: ScheduleItem[]; status: 'pending' | 'accepted' | 'rejected'
}
export interface Decline { reasons: { code: DeclineReason; text: string; advice: string }[]; comment?: string | null }
export interface InfoRequest { items: { kind: InfoRequestKind; text: string }[]; comment: string | null }
export interface TimelineItem { status: Status; at: string; actor: Actor; text: string }
export interface AppDocument { id: string; kind: InfoRequestKind; filename: string; uploaded_at: string }

export interface Application {
  id: string; number: string; status: Status; status_info: { title: string; now: string; action: string | null }
  version: number; created_at: string; updated_at: string; company: Company
  product_id: ProductId; purpose: Purpose; amount_rub: number; term_months: number; plan_id: string | null
  financials: Financials; collateral: Collateral | null; consent_bki: boolean; documents: AppDocument[]
  missing_fields: string[]; info_request: InfoRequest | null; offer: Offer | null; decline: Decline | null; timeline: TimelineItem[]
}
export interface ApplicationListItem { id: string; number: string; status: Status; status_title: string; company_name: string; product_id: ProductId; amount_rub: number; updated_at: string }

export interface FeedItem { id: string; kind: 'status_change' | 'info_request' | 'offer' | 'tip'; title: string; text: string; application_id: string | null; created_at: string; read: boolean }

// Статусы, в которых заявка движется сама: экран опрашивает сервер
export const AUTO_STATUSES: Status[] = ['submitted', 'checking', 'scoring']
export const FINAL_STATUSES: Status[] = ['funded', 'declined', 'withdrawn', 'cancelled']

// ---- рабочее место аналитика: /contracts/schemas/bank.schema.json ----
export type Grade = 'A' | 'B' | 'C' | 'D'
export type DecisionKind = 'approve' | 'counter' | 'decline' | 'request_info'
export interface Check { kind: 'completeness' | 'egrul' | 'fns' | 'bki'; result: 'ok' | 'warn' | 'fail' | 'error'; summary: string; details: Record<string, unknown>; source: string; checked_at: string }
export interface Scoring { score: number; grade: Grade; factors: { code: string; name: string; value_text: string; points: number }[]; debt_load_percent: number | null; rules_version: string }
export interface Recommendation { kind: DecisionKind; text: string; amount_rub?: number | null; term_months?: number | null; rate_percent?: number | null }
export interface BankEvent { id: string; from_status: Status | null; to_status: Status; actor: Actor; actor_name: string; reason: string | null; at: string }
export interface QueueItem { id: string; number: string; status: Status; company_name: string; inn: string; product_id: ProductId; amount_rub: number; term_months: number; grade: Grade | null; submitted_at: string | null; waiting_minutes: number }
export interface BankApplication { application: Application; applicant: { name: string; email: string; member_role: MemberRole }; checks: Check[]; scoring: Scoring | null; recommendation: Recommendation | null; events: BankEvent[] }
export interface DecisionRequest { kind: DecisionKind; version: number; amount_rub?: number; term_months?: number; rate_percent?: number; decline_reasons?: DeclineReason[]; info_items?: { kind: InfoRequestKind; text: string }[]; comment: string }
export interface BankStats { by_status: Partial<Record<Status, number>>; auto_decision_share: number; avg_minutes_to_decision: number | null }
