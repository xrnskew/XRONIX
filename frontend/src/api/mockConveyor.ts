import type { ConveyorApi } from './conveyor'
import type { AppDocument, Application, ApplicationDraft, Company, FeedItem, InfoRequestKind, MemberRole, ParsedNeed, Purpose, Sphere, Status, TimelineItem } from '../types/conveyor'
import dict from '../data/dictionaries.json'
import rules from '../data/credit_rules.v1.json'
import { alfaProducts } from '../data/alfaProducts'
import { validInn } from '../lib/inn'
import { businessMonths, decide, declineText, matchProducts, payment, rateFor, schedule, score, stopFactors, type Input } from '../lib/creditRules'
import { external, personExternal } from './mockData'
import { parseNeedText } from '../lib/parseText'
import { CalcError, calculatePlan, templates } from '../lib/projectCalc'
import type { Plan } from '../types/plan'
import { ApiError } from './client'
import { findMockPlan, mockUserName, registerMockPlan } from './mock'

// Мок конвейера в памяти: те же вызовы и ответы, что в /contracts/conveyor.md. Заявка проходит этапы сама по таймеру.
// Ручное рассмотрение в моке завершает «демо-аналитик» через несколько секунд: настоящего рабочего места банка здесь нет.
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms))
const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const stageMs = () => (rules.checks.stage_delay_seconds.min + Math.random() * (rules.checks.stage_delay_seconds.max - rules.checks.stage_delay_seconds.min)) * 1000
const statuses = dict.statuses as Record<Status, { title: string; now: string; action: string | null }>
const roles = dict.member_roles as Record<MemberRole, { title: string; needs_authority: boolean }>

type Rec = Omit<Application, 'status_info' | 'company' | 'missing_fields'> & { company_id: string; info_response: string | null }
const companies = new Map<string, Company>()
const apps = new Map<string, Rec>()
const feed: FeedItem[] = []
const plans = new Map<string, Plan>()
let counter = 100

const notFound = () => new ApiError('NOT_FOUND', 'Заявка не найдена.', 404)
const conflict = () => new ApiError('VERSION_CONFLICT', 'Заявку уже изменили. Показываем актуальную версию.', 409)
const invalid = () => new ApiError('INVALID_TRANSITION', 'Это действие недоступно в текущем статусе заявки.', 409)

const isPerson = (r: Rec) => companies.get(r.company_id)?.registry.kind === 'person'
function missing(r: Rec): string[] {
  const m: string[] = []
  // у будущего ИП бизнеса ещё нет: из финансов нужны только личные платежи по кредитам
  const fields = isPerson(r) ? (['loan_payments_monthly_rub'] as const) : (['revenue_12m_rub', 'expenses_12m_rub', 'loan_payments_monthly_rub'] as const)
  for (const k of fields) if (r.financials[k] == null) m.push(`financials.${k}`)
  if (alfaProducts.find((p) => p.id === r.product_id)?.collateral && !r.collateral) m.push('collateral')
  if (!r.consent_bki) m.push('consent_bki')
  return m
}

function view(r: Rec): Application {
  const { company_id, info_response: _, ...rest } = r
  return structuredClone({ ...rest, status_info: statuses[r.status], company: companies.get(company_id)!, missing_fields: r.status === 'draft' ? missing(r) : [] })
}

const clientText: Partial<Record<Status, string>> = {
  submitted: 'Заявка подана', checking: 'Проверяем данные компании', info_requested: 'Банку нужны данные', scoring: 'Проверки пройдены, оцениваем заявку',
  manual_review: 'Заявку рассматривает специалист', approved: 'Заявка одобрена', counter_offer: 'Банк предложил другие условия', signing: 'Условия приняты',
  funded: 'Деньги выданы', declined: 'Банк не может выдать кредит', withdrawn: 'Заявка отозвана', cancelled: 'Вы отказались от условий',
}

function move(r: Rec, to: Status, actor: TimelineItem['actor'], text = clientText[to] ?? statuses[to].title) {
  r.status = to; r.version += 1; r.updated_at = now()
  r.timeline.push({ status: to, at: r.updated_at, actor, text })
  if (actor !== 'client') {
    const kind: FeedItem['kind'] = to === 'info_requested' ? 'info_request' : to === 'approved' || to === 'counter_offer' ? 'offer' : 'status_change'
    feed.unshift({ id: uid(), kind, title: `Заявка ${r.number}: ${statuses[to].title.toLowerCase()}`, text: statuses[to].action ?? statuses[to].now, application_id: r.id, created_at: r.updated_at, read: false })
  }
}

const brief = (id: string | null) => {
  const f = id ? (plans.get(id) ?? findMockPlan(id))?.finance : null
  return f ? { startup_cost_rub: f.startup_cost_rub, own_funds_rub: f.own_funds_rub, monthly_profit_rub: f.monthly_profit_rub, monthly_revenue_rub: f.monthly_revenue_rub } : null
}
function input(r: Rec): Input {
  const c = companies.get(r.company_id)!, person = c.registry.kind === 'person'
  const e = person ? { ...personExternal(c.registry.inn, c.registry.head_name), registry: c.registry } : external(c.registry.inn)
  return { ...e, financials: r.financials, product_id: r.product_id, amount_rub: r.amount_rub, term_months: r.term_months, collateral: r.collateral, plan: brief(r.plan_id), person }
}

function offerFor(r: Rec, kind: 'approve' | 'counter', amount: number, months: number, rate: number, explanation: string[]) {
  const s = schedule(amount, rate, months)
  r.offer = { id: uid(), kind, product_id: r.product_id, amount_rub: amount, term_months: months, rate_percent: rate, monthly_payment_rub: payment(amount, rate, months), total_payment_rub: s.reduce((a, x) => a + x.payment_rub, 0), explanation, schedule: s, status: 'pending' }
}

const later = (fn: () => void) => setTimeout(fn, stageMs())

function runPipeline(id: string) {
  later(() => {
    const r = apps.get(id); if (!r || r.status !== 'submitted') return
    move(r, 'checking', 'system')
    later(() => {
      if (r.status !== 'checking') return
      const company = companies.get(r.company_id)!
      if (!company.authority_confirmed) {
        r.info_request = { items: [{ kind: 'authority_document', text: (dict.info_request_kinds as Record<string, { text: string }>).authority_document.text }], comment: null }
        return move(r, 'info_requested', 'system', 'Нужен документ о полномочиях')
      }
      const stops = stopFactors(input(r))
      if (stops.length) { r.decline = { reasons: stops.map((s) => declineText(s.code, s.params)), comment: null }; return move(r, 'declined', 'system') }
      move(r, 'scoring', 'system')
      later(() => {
        if (r.status !== 'scoring') return
        const i = input(r), sc = score(i), d = decide(i, sc)
        if (d.kind === 'decline') { r.decline = { reasons: d.reasons.map((s) => declineText(s.code, s.params)), comment: null }; return move(r, 'declined', 'system') }
        if (d.kind === 'approve' || d.kind === 'counter') { offerFor(r, d.kind, d.amount_rub, d.term_months, d.rate_percent, d.explanation); return move(r, d.kind === 'approve' ? 'approved' : 'counter_offer', 'system') }
        move(r, 'manual_review', 'system')
        setTimeout(() => {
          if (r.status !== 'manual_review') return
          offerFor(r, 'approve', r.amount_rub, r.term_months, rateFor(r.product_id, sc.grade), ['Заявку одобрил кредитный специалист.', `Ставка учитывает кредитную оценку: класс ${sc.grade}.`])
          move(r, 'approved', 'analyst', 'Специалист одобрил заявку')
        }, 8000)
      })
    })
  })
}

export const mockConveyor: ConveyorApi = {
  async registry(inn) {
    await delay(500)
    if (!validInn(inn)) throw new ApiError('INVALID_INN', 'ИНН с ошибкой: проверьте цифры.', 400)
    return structuredClone(external(inn).registry)
  },
  async listCompanies() { await delay(200); return structuredClone([...companies.values()]) },
  async addCompany(inn, member_role, future) {
    await delay(400)
    if (!validInn(inn)) throw new ApiError('INVALID_INN', 'ИНН с ошибкой: проверьте цифры.', 400)
    if (future) {
      if (inn.length !== 12) throw new ApiError('VALIDATION_ERROR', 'Личный ИНН состоит из 12 цифр.', 400)
      const same = [...companies.values()].find((c) => c.registry.inn === inn && c.registry.kind === 'person')
      if (same) return structuredClone(same)
      const c: Company = { id: uid(), registry: personExternal(inn, mockUserName()).registry, member_role: 'owner', authority_confirmed: true, business_months: 0 }
      companies.set(c.id, c)
      return structuredClone(c)
    }
    const existing = [...companies.values()].find((c) => c.registry.inn === inn)
    if (existing) { existing.member_role = member_role; existing.authority_confirmed ||= !roles[member_role].needs_authority; return structuredClone(existing) }
    const registry = external(inn).registry
    const c: Company = { id: uid(), registry, member_role, authority_confirmed: !roles[member_role].needs_authority, business_months: registry.registered_at ? businessMonths(registry.registered_at) : 0 }
    companies.set(c.id, c)
    return structuredClone(c)
  },
  async uploadAuthority(id) {
    await delay(500)
    const c = companies.get(id); if (!c) throw new ApiError('NOT_FOUND', 'Компания не найдена.', 404)
    c.authority_confirmed = true
    return structuredClone(c)
  },
  async parseNeed(text) { await delay(700); return parseNeedText(text) },
  async templates() { await delay(200); return templates() },
  async calculatePlan(b) {
    await delay(600)
    try {
      const plan = calculatePlan(b), plan_id = uid()
      plans.set(plan_id, plan); registerMockPlan(plan_id, structuredClone(plan))
      return { plan_id, plan: structuredClone(plan) }
    } catch (e) { throw e instanceof CalcError ? new ApiError('VALIDATION_ERROR', e.message, 400) : e }
  },
  async match(b) {
    await delay(450)
    const c = b.company_id ? companies.get(b.company_id) : null
    return { items: matchProducts(b, c ? c.business_months : null, { person: c?.registry.kind === 'person', plan: brief(b.plan_id ?? null) }) }
  },
  async createApplication(b) {
    await delay(300)
    if (!b.company_id || !companies.has(b.company_id) || !b.product_id) throw new ApiError('VALIDATION_ERROR', 'Выберите компанию и продукт.', 400)
    const t = now()
    const r: Rec = {
      id: uid(), number: `Z-2026-${String(++counter).padStart(6, '0')}`, status: 'draft', version: 1, created_at: t, updated_at: t,
      company_id: b.company_id, product_id: b.product_id, purpose: b.purpose ?? 'working_capital', amount_rub: b.amount_rub ?? 1_000_000, term_months: b.term_months ?? 24,
      plan_id: b.plan_id ?? null, financials: b.financials ?? { revenue_12m_rub: null, expenses_12m_rub: null, loan_payments_monthly_rub: null },
      collateral: b.collateral ?? null, consent_bki: b.consent_bki ?? false, documents: [], info_request: null, offer: null, decline: null, info_response: null,
      timeline: [{ status: 'draft', at: t, actor: 'client', text: 'Создан черновик' }],
    }
    apps.set(r.id, r)
    return view(r)
  },
  async patchApplication(id, b) {
    await delay(250)
    const r = apps.get(id); if (!r) throw notFound()
    if (b.version !== r.version) throw conflict()
    const allowed: (keyof ApplicationDraft)[] = r.status === 'draft' ? ['product_id', 'purpose', 'amount_rub', 'term_months', 'plan_id', 'financials', 'collateral', 'consent_bki'] : r.status === 'info_requested' ? ['financials', 'collateral', 'info_response'] : []
    if (!allowed.length) throw invalid()
    for (const k of allowed) if (b[k] !== undefined) (r as unknown as Record<string, unknown>)[k] = structuredClone(b[k])
    r.version += 1; r.updated_at = now()
    return view(r)
  },
  async submit(id, version) {
    await delay(400)
    const r = apps.get(id); if (!r) throw notFound()
    if (version !== r.version) throw conflict()
    if (r.status === 'draft') {
      const m = missing(r)
      if (m.length) throw new ApiError('INCOMPLETE_APPLICATION', 'Заполните все поля заявки перед подачей.', 422)
      move(r, 'submitted', 'client'); runPipeline(id)
    } else if (r.status === 'info_requested') {
      r.info_request = null; move(r, 'submitted', 'client', 'Данные отправлены'); runPipeline(id)
    } else throw invalid()
    return view(r)
  },
  async listApplications() {
    await delay(250)
    return [...apps.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((r) => ({
      id: r.id, number: r.number, status: r.status, status_title: statuses[r.status].title, company_name: companies.get(r.company_id)!.registry.name,
      product_id: r.product_id, amount_rub: r.offer?.amount_rub ?? r.amount_rub, updated_at: r.updated_at,
    }))
  },
  async getApplication(id) { await delay(150); const r = apps.get(id); if (!r) throw notFound(); return view(r) },
  async action(id, action, version) {
    await delay(400)
    const r = apps.get(id); if (!r) throw notFound()
    if (version !== r.version) throw conflict()
    const offerOpen = r.status === 'approved' || r.status === 'counter_offer'
    if (action === 'accept' && offerOpen) { r.offer!.status = 'accepted'; move(r, 'signing', 'client') }
    else if (action === 'reject-offer' && offerOpen) { r.offer!.status = 'rejected'; move(r, 'cancelled', 'client') }
    else if (action === 'sign' && r.status === 'signing') { move(r, 'funded', 'client', 'Договор подписан, деньги зачислены на счёт') }
    else if (action === 'withdraw' && (r.status === 'draft' || r.status === 'info_requested')) move(r, 'withdrawn', 'client')
    else throw invalid()
    return view(r)
  },
  async uploadDocument(id, kind: InfoRequestKind, file) {
    await delay(500)
    const r = apps.get(id); if (!r) throw notFound()
    const d: AppDocument = { id: uid(), kind, filename: file.name, uploaded_at: now() }
    r.documents.push(d)
    if (kind === 'authority_document') companies.get(r.company_id)!.authority_confirmed = true
    return d
  },
  async feed() { await delay(200); return structuredClone(feed.slice(0, 50)) },
  async markRead(ids) { for (const f of feed) if (ids.includes(f.id)) f.read = true },
}
