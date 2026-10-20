import type { ConveyorApi } from './conveyor'
import type { BankApi } from './bank'
import type { AppDocument, Application, ApplicationDraft, BankEvent, Check, Company, DecisionRequest, FeedItem, Grade, InfoRequestKind, MemberRole, Recommendation, Scoring, Status, TimelineItem } from '../types/conveyor'
import dict from '../data/dictionaries.json'
import rules from '../data/credit_rules.v1.json'
import { validInn } from '../lib/inn'
import { allProducts, businessMonths, decide, declineText, matchProducts, payment, rateFor, schedule, score, stopFactors, type Input } from '../lib/creditRules'
import { DEMO_CLIENT } from './demoAccounts'
import { DEMO_FOUNDER_INN, demoFinancials, external, personExternal } from './mockData'
import { parseNeedText } from '../lib/parseText'
import { CalcError, calculatePlan, templates } from '../lib/projectCalc'
import type { Plan } from '../types/plan'
import { ApiError } from './client'
import { findMockPlan, mockUser, mockUserName, registerMockPlan } from './mock'

// Мок конвейера в памяти: те же вызовы и ответы, что в /contracts/conveyor.md. Заявка проходит этапы сама по таймеру,
// ручное рассмотрение ждёт решения аналитика в /bank. При запуске очередь засеяна заявками во всех статусах (раздел 12 CONVEYOR.md).
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms))
const uid = () => crypto.randomUUID()
let clockShift = 0 // засев «в прошлом»: у засеянных заявок реалистичное время ожидания
const now = () => new Date(Date.now() - clockShift).toISOString()
let instant = false
let seeding = false // засев: каждый этап «длится» полторы минуты, чтобы у очереди было реалистичное время решения
export const setMockInstant = (v: boolean) => { instant = v } // тесты: этапы без пауз
const stageMs = () => (rules.checks.stage_delay_seconds.min + Math.random() * (rules.checks.stage_delay_seconds.max - rules.checks.stage_delay_seconds.min)) * 1000
const statuses = dict.statuses as Record<Status, { title: string; now: string; action: string | null }>
const roles = dict.member_roles as Record<MemberRole, { title: string; needs_authority: boolean }>
const infoKinds = dict.info_request_kinds as Record<InfoRequestKind, { title: string; text: string }>
const nf = new Intl.NumberFormat('ru-RU')
const product = (id: string) => allProducts.find((p) => p.id === id)!

interface BankSide {
  applicant: { name: string; email: string; member_role: MemberRole }
  checks: Check[]; scoring: Scoring | null; recommendation: Recommendation | null; events: BankEvent[]
  submitted_at: string | null; decided_at: string | null; decided_by: 'system' | 'analyst' | null; status_since: string
}
type Rec = Omit<Application, 'status_info' | 'company' | 'missing_fields'> & { company_id: string; info_response: string | null; bank: BankSide }
const companies = new Map<string, Company>()
const apps = new Map<string, Rec>()
const feed: FeedItem[] = []
const plans = new Map<string, Plan>()
let counter = 100

const notFound = () => new ApiError('NOT_FOUND', 'Заявка не найдена.', 404)
const conflict = () => new ApiError('VERSION_CONFLICT', 'Заявку уже изменили. Показываем актуальную версию.', 409)
const invalid = () => new ApiError('INVALID_TRANSITION', 'Это действие недоступно в текущем статусе заявки.', 409)
const bad = (message: string) => new ApiError('VALIDATION_ERROR', message, 400)

const isPerson = (r: Rec) => companies.get(r.company_id)?.registry.kind === 'person'
function missing(r: Rec): string[] {
  const m: string[] = []
  // у будущего ИП бизнеса ещё нет: из финансов нужны только личные платежи по кредитам
  const fields = isPerson(r) ? (['loan_payments_monthly_rub'] as const) : (['revenue_12m_rub', 'expenses_12m_rub', 'loan_payments_monthly_rub'] as const)
  for (const k of fields) if (r.financials[k] == null) m.push(`financials.${k}`)
  if (product(r.product_id)?.collateral && !r.collateral) m.push('collateral')
  if (!r.consent_bki) m.push('consent_bki')
  return m
}

function view(r: Rec): Application {
  const { company_id, info_response: _, bank: __, ...rest } = r
  return structuredClone({ ...rest, status_info: statuses[r.status], company: companies.get(company_id)!, missing_fields: r.status === 'draft' ? missing(r) : [] })
}

const clientText: Partial<Record<Status, string>> = {
  submitted: 'Заявка подана', checking: 'Проверяем данные компании', info_requested: 'Банку нужны данные', scoring: 'Проверки пройдены, оцениваем заявку',
  manual_review: 'Заявку рассматривает специалист', approved: 'Заявка одобрена', counter_offer: 'Банк предложил другие условия', signing: 'Условия приняты',
  funded: 'Деньги выданы', declined: 'Банк не может выдать кредит', withdrawn: 'Заявка отозвана', cancelled: 'Вы отказались от условий',
}
const DECISIONS: Status[] = ['approved', 'counter_offer', 'declined']

function move(r: Rec, to: Status, actor: TimelineItem['actor'], text = clientText[to] ?? statuses[to].title, reason: string | null = null) {
  const from = r.status
  if (seeding) clockShift = Math.max(0, clockShift - 90_000)
  r.status = to; r.version += 1; r.updated_at = now(); r.bank.status_since = r.updated_at
  r.timeline.push({ status: to, at: r.updated_at, actor, text })
  const analyst = actor === 'analyst' ? mockUser().name || 'Аналитик' : null
  r.bank.events.push({ id: uid(), from_status: from === to ? null : from, to_status: to, actor, actor_name: actor === 'client' ? r.bank.applicant.name : analyst ?? 'Система', reason, at: r.updated_at })
  if (to === 'submitted' && !r.bank.submitted_at) r.bank.submitted_at = r.updated_at
  if (DECISIONS.includes(to)) { r.bank.decided_at = r.updated_at; r.bank.decided_by = actor === 'analyst' ? 'analyst' : 'system' }
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

// Результаты внешних проверок для аналитика: та же синтетика, что у integrations-mock (contracts/integrations.md)
function runChecks(r: Rec, i: Input, authorityOk: boolean): Check[] {
  const at = now(), c = i.registry, out: Check[] = []
  const miss = missing(r)
  out.push({ kind: 'completeness', result: !authorityOk ? 'warn' : miss.length ? 'fail' : 'ok', summary: !authorityOk ? 'Заявитель не руководитель: нет документа о полномочиях' : miss.length ? `Не заполнено: ${miss.join(', ')}` : 'Все поля заполнены, реквизиты корректны', details: { missing: miss, authority_confirmed: authorityOk }, source: 'backend', checked_at: at })
  if (c.kind === 'person') out.push({ kind: 'egrul', result: 'warn', summary: 'Будущий ИП: бизнес не зарегистрирован, ЕГРЮЛ не проверяется', details: { inn: c.inn }, source: 'xronix', checked_at: at })
  else {
    const months = c.registered_at ? businessMonths(c.registered_at) : 0
    const active = c.status === 'active'
    out.push({ kind: 'egrul', result: active ? 'ok' : 'fail', summary: active ? `Действует с ${new Date(c.registered_at!).toLocaleDateString('ru-RU')} · ${months} мес.` : 'Компания не действует', details: { ...c }, source: c.source, checked_at: at })
  }
  const f = i.fns, limit = rules.stop_factors.tax_debt_max_rub
  const fnsBad = f.head_disqualified || f.tax_debt_rub > limit, fnsWarn = f.mass_address || f.tax_debt_rub > 0
  out.push({ kind: 'fns', result: fnsBad ? 'fail' : fnsWarn ? 'warn' : 'ok', summary: [f.mass_address ? 'массовый адрес' : '', f.tax_debt_rub ? `недоимка ${nf.format(f.tax_debt_rub)} ₽` : '', f.head_disqualified ? 'руководитель дисквалифицирован' : ''].filter(Boolean).join(', ') || 'Недоимки нет, адрес не массовый', details: { inn: c.inn, ...f, source: 'mock-fns v1' }, source: 'mock-fns v1', checked_at: at })
  const b = i.bki, loans = b.loans.reduce((s, l) => s + l.monthly_payment_rub, 0)
  out.push({ kind: 'bki', result: b.overdue_90_12m ? 'fail' : b.overdue_30_24m || !b.has_history ? 'warn' : 'ok', summary: !b.has_history ? 'Кредитной истории нет' : `История ${b.history_months} мес.${b.overdue_90_12m ? `, просрочки 90+: ${b.overdue_90_12m}` : b.overdue_30_24m ? `, просрочки 30+: ${b.overdue_30_24m}` : ', без просрочек'}, платежи ${nf.format(loans)} ₽/мес.`, details: { inn: c.inn, ...b, source: 'mock-bki v1' }, source: 'mock-bki v1', checked_at: at })
  return out
}

function recommend(r: Rec, i: Input, grade: Grade, d: ReturnType<typeof decide>): Recommendation {
  if (d.kind === 'decline') return { kind: 'decline', text: d.reasons.map((x) => declineText(x.code, x.params).text).join(' ') }
  if (d.kind !== 'manual') return { kind: d.kind, text: d.explanation.join(' '), amount_rub: d.amount_rub, term_months: d.term_months, rate_percent: d.rate_percent }
  return { kind: grade === 'C' ? 'counter' : 'approve', text: d.recommendation, amount_rub: r.amount_rub, term_months: r.term_months, rate_percent: rateFor(i.product_id, grade) }
}

const step = (fn: () => void) => (instant ? fn() : void setTimeout(fn, stageMs()))

function runPipeline(id: string) {
  step(() => {
    const r = apps.get(id); if (!r || r.status !== 'submitted') return
    move(r, 'checking', 'system')
    step(() => {
      if (r.status !== 'checking') return
      const company = companies.get(r.company_id)!, i = input(r)
      r.bank.checks = runChecks(r, i, company.authority_confirmed)
      if (!company.authority_confirmed) {
        r.info_request = { items: [{ kind: 'authority_document', text: infoKinds.authority_document.text }], comment: null }
        return move(r, 'info_requested', 'system', 'Нужен документ о полномочиях', 'Заявитель не руководитель, нет доверенности')
      }
      const stops = stopFactors(i)
      if (stops.length) {
        r.decline = { reasons: stops.map((s) => declineText(s.code, s.params)), comment: null }
        r.bank.recommendation = { kind: 'decline', text: r.decline.reasons.map((x) => x.text).join(' ') }
        return move(r, 'declined', 'system', undefined, `Стоп-фактор: ${stops.map((s) => s.code).join(', ')}`)
      }
      move(r, 'scoring', 'system')
      step(() => {
        if (r.status !== 'scoring') return
        const sc = score(i), d = decide(i, sc)
        r.bank.scoring = { ...sc, rules_version: rules.version }
        r.bank.recommendation = recommend(r, i, sc.grade, d)
        const why = `Балл ${sc.score}, класс ${sc.grade}`
        if (d.kind === 'decline') { r.decline = { reasons: d.reasons.map((s) => declineText(s.code, s.params)), comment: null }; return move(r, 'declined', 'system', undefined, why) }
        if (d.kind !== 'manual') { offerFor(r, d.kind, d.amount_rub, d.term_months, d.rate_percent, d.explanation); return move(r, d.kind === 'approve' ? 'approved' : 'counter_offer', 'system', undefined, why) }
        move(r, 'manual_review', 'system', undefined, `${why}: ${d.recommendation}`)
      })
    })
  })
}

function newRec(b: ApplicationDraft & { company_id: string; product_id: Rec['product_id'] }): Rec {
  const t = now(), u = mockUser(), company = companies.get(b.company_id)!
  return {
    id: uid(), number: `Z-2026-${String(++counter).padStart(6, '0')}`, status: 'draft', version: 1, created_at: t, updated_at: t,
    company_id: b.company_id, product_id: b.product_id, purpose: b.purpose ?? 'working_capital', amount_rub: b.amount_rub ?? 1_000_000, term_months: b.term_months ?? 24,
    plan_id: b.plan_id ?? null, financials: b.financials ?? { revenue_12m_rub: null, expenses_12m_rub: null, loan_payments_monthly_rub: null },
    collateral: b.collateral ?? null, consent_bki: b.consent_bki ?? false, documents: [], info_request: null, offer: null, decline: null, info_response: null,
    timeline: [{ status: 'draft', at: t, actor: 'client', text: 'Создан черновик' }],
    bank: {
      applicant: { name: u.name || 'Клиент', email: u.email || DEMO_CLIENT.email, member_role: company.member_role },
      checks: [], scoring: null, recommendation: null, events: [{ id: uid(), from_status: null, to_status: 'draft', actor: 'client', actor_name: u.name || 'Клиент', reason: null, at: t }],
      submitted_at: null, decided_at: null, decided_by: null, status_since: t,
    },
  }
}

function addCompanySync(inn: string, member_role: MemberRole, future = false, name = mockUserName()): Company {
  if (future) {
    const same = [...companies.values()].find((c) => c.registry.inn === inn && c.registry.kind === 'person')
    if (same) return same
    const c: Company = { id: uid(), registry: personExternal(inn, name).registry, member_role: 'owner', authority_confirmed: true, business_months: 0 }
    companies.set(c.id, c); return c
  }
  const existing = [...companies.values()].find((c) => c.registry.inn === inn && c.registry.kind !== 'person')
  if (existing) { existing.member_role = member_role; existing.authority_confirmed ||= !roles[member_role].needs_authority; return existing }
  const registry = external(inn).registry
  const c: Company = { id: uid(), registry, member_role, authority_confirmed: !roles[member_role].needs_authority, business_months: registry.registered_at ? businessMonths(registry.registered_at) : 0 }
  companies.set(c.id, c); return c
}

// ---- засев: заявки демо-клиента во всех статусах, чтобы у аналитика была очередь ----
function seed() {
  const wasInstant = instant
  instant = true; seeding = true
  const put = (inn: string, role: MemberRole, minutesAgo: number, patch: Partial<Rec> = {}, after?: (r: Rec) => void, future = false) => {
    clockShift = minutesAgo * 60_000
    const c = addCompanySync(inn, role, future), d = demoFinancials[inn]
    const r = newRec({ company_id: c.id, product_id: d?.product_id ?? 'fast', purpose: d?.purpose, amount_rub: d?.amount_rub, term_months: d?.term_months, financials: d?.financials, collateral: d?.collateral, consent_bki: true })
    Object.assign(r, patch)
    r.bank.applicant = { name: DEMO_CLIENT.name, email: DEMO_CLIENT.email, member_role: role }
    r.bank.events[0].actor_name = DEMO_CLIENT.name
    apps.set(r.id, r)
    move(r, 'submitted', 'client'); runPipeline(r.id)
    after?.(r)
  }
  put('7715881399', 'director', 26 * 60, {}, (r) => { r.offer!.status = 'accepted'; move(r, 'signing', 'client'); r.offer!.status = 'accepted'; move(r, 'funded', 'client', 'Договор подписан, деньги зачислены на счёт') })
  put('7755761690', 'director', 5 * 60)
  put('777309114120', 'owner', 3 * 60)
  put('7772731777', 'accountant', 2 * 60)
  put('7768151886', 'director', 47)
  put('777309114120', 'owner', 22, { amount_rub: 2_000_000, term_months: 24, financials: { revenue_12m_rub: 9_600_000, expenses_12m_rub: 7_800_000, loan_payments_monthly_rub: 85_000 } })
  const plan = calculatePlan({ sphere: 'bakery', city: 'Самара', own_funds_rub: 900_000, answers: {} }), planId = uid()
  plans.set(planId, plan); registerMockPlan(planId, plan)
  clockShift = 0
  instant = wasInstant; seeding = false
  // Будущий ИП с планом пекарни и поручителем — заявка на «Старт»
  clockShift = 9 * 60_000; instant = true; seeding = true
  const founder = addCompanySync(DEMO_FOUNDER_INN, 'owner', true, 'Мария Новикова')
  const fr = newRec({ company_id: founder.id, product_id: 'start', purpose: 'new_location', amount_rub: Math.min(3_000_000, plan.credit.amount_rub ?? 2_000_000), term_months: 36, plan_id: planId, financials: { revenue_12m_rub: null, expenses_12m_rub: null, loan_payments_monthly_rub: 0 }, collateral: { kind: 'guarantor', description: 'Поручитель — супруга, официальный доход', value_rub: 1_500_000 }, consent_bki: true })
  fr.bank.applicant = { name: 'Мария Новикова', email: DEMO_CLIENT.email, member_role: 'owner' }
  fr.bank.events[0].actor_name = 'Мария Новикова'
  apps.set(fr.id, fr); move(fr, 'submitted', 'client'); runPipeline(fr.id)
  clockShift = 0; instant = wasInstant; seeding = false
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
    if (future && inn.length !== 12) throw bad('Личный ИНН состоит из 12 цифр.')
    return structuredClone(addCompanySync(inn, member_role, future))
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
    } catch (e) { throw e instanceof CalcError ? bad(e.message) : e }
  },
  async match(b) {
    await delay(450)
    const c = b.company_id ? companies.get(b.company_id) : null
    return { items: matchProducts(b, c ? c.business_months : null, { person: c?.registry.kind === 'person', plan: brief(b.plan_id ?? null) }) }
  },
  async createApplication(b) {
    await delay(300)
    if (!b.company_id || !companies.has(b.company_id) || !b.product_id) throw bad('Выберите компанию и продукт.')
    const r = newRec(b as ApplicationDraft & { company_id: string; product_id: Rec['product_id'] })
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
      if (missing(r).length) throw new ApiError('INCOMPLETE_APPLICATION', 'Заполните все поля заявки перед подачей.', 422)
      move(r, 'submitted', 'client'); runPipeline(id)
    } else if (r.status === 'info_requested') {
      r.info_request = null; move(r, 'submitted', 'client', 'Данные отправлены', r.info_response); runPipeline(id)
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

// ---- рабочее место аналитика (contracts/conveyor.md, «Рабочее место аналитика») ----
const analystOnly = () => { if (mockUser().role !== 'analyst') throw notFound() }
const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
const bankView = (r: Rec) => structuredClone({ application: view(r), applicant: r.bank.applicant, checks: r.bank.checks, scoring: r.bank.scoring, recommendation: r.bank.recommendation, events: r.bank.events })

export const mockBank: BankApi = {
  async queue(filter) {
    await delay(250); analystOnly()
    return [...apps.values()].filter((r) => r.status !== 'draft' && (!filter?.length || filter.includes(r.status)))
      .map((r) => ({ id: r.id, number: r.number, status: r.status, company_name: companies.get(r.company_id)!.registry.name, inn: companies.get(r.company_id)!.registry.inn, product_id: r.product_id, amount_rub: r.amount_rub, term_months: r.term_months, grade: r.bank.scoring?.grade ?? null, submitted_at: r.bank.submitted_at, waiting_minutes: minutesSince(r.bank.status_since) }))
      .sort((a, b) => b.waiting_minutes - a.waiting_minutes)
  },
  async application(id) { await delay(200); analystOnly(); const r = apps.get(id); if (!r || r.status === 'draft') throw notFound(); return bankView(r) },
  async decide(id, q: DecisionRequest) {
    await delay(400); analystOnly()
    const r = apps.get(id); if (!r) throw notFound()
    if (r.status !== 'manual_review') throw invalid()
    if (q.version !== r.version) throw conflict()
    const p = product(r.product_id), grade = r.bank.scoring?.grade ?? 'B'
    const comment = q.comment?.trim() ?? ''
    const person = isPerson(r)
    if (q.kind === 'approve' || q.kind === 'counter') {
      const amount = q.amount_rub ?? r.amount_rub, months = q.term_months ?? r.term_months, rate = q.rate_percent ?? rateFor(r.product_id, grade)
      if ((p.amountMin != null && amount < p.amountMin) || amount > p.amountMax) throw bad(`Сумма для этого продукта — от ${nf.format(p.amountMin ?? 0)} до ${nf.format(p.amountMax)} ₽.`)
      if ((p.termMin != null && months < p.termMin) || months > p.termMax) throw bad(`Срок для этого продукта — от ${p.termMin ?? 1} до ${p.termMax} мес.`)
      if (p.rateFrom != null && rate < p.rateFrom) throw bad(`Ставка не может быть ниже ${String(p.rateFrom).replace('.', ',')}%.`)
      if (q.kind === 'counter' && amount === r.amount_rub && months === r.term_months) throw bad('Во встречном предложении измените сумму или срок.')
      if (q.kind === 'counter' && !comment) throw bad('Объясните клиенту, почему условия другие.')
      const explanation = [q.kind === 'approve' ? 'Заявку одобрил кредитный специалист.' : 'Кредитный специалист предложил другие условия.', comment, person ? rules.start.condition_text : ''].filter(Boolean)
      offerFor(r, q.kind, amount, months, rate, explanation)
      move(r, q.kind === 'approve' ? 'approved' : 'counter_offer', 'analyst', q.kind === 'approve' ? 'Специалист одобрил заявку' : 'Специалист предложил другие условия', comment || null)
    } else if (q.kind === 'request_info') {
      if (!q.info_items?.length) throw bad('Укажите, какие данные нужны.')
      r.info_request = { items: q.info_items.map((x) => ({ kind: x.kind, text: x.text.trim() || infoKinds[x.kind].text })), comment: comment || null }
      move(r, 'info_requested', 'analyst', 'Специалисту нужны данные', comment || null)
    } else if (q.kind === 'decline') {
      if (!q.decline_reasons?.length) throw bad('Выберите причину отказа.')
      if (!comment) throw bad('Комментарий к отказу обязателен.')
      r.decline = { reasons: q.decline_reasons.map((code) => declineText(code, { min_months: '9', eligible_date: '', limit_rub: nf.format(rules.stop_factors.tax_debt_max_rub), max_amount_rub: '', min_share: String(rules.start.min_own_share * 100) })), comment }
      move(r, 'declined', 'analyst', 'Специалист отказал', comment)
    } else throw bad('Неизвестное решение.')
    return bankView(r)
  },
  async stats() {
    await delay(200); analystOnly()
    const list = [...apps.values()].filter((r) => r.status !== 'draft')
    const by_status: Partial<Record<Status, number>> = {}
    for (const r of list) by_status[r.status] = (by_status[r.status] ?? 0) + 1
    const decided = list.filter((r) => r.bank.decided_at && r.bank.submitted_at)
    const auto = decided.filter((r) => r.bank.decided_by === 'system').length
    const mins = decided.map((r) => (Date.parse(r.bank.decided_at!) - Date.parse(r.bank.submitted_at!)) / 60_000)
    return { by_status, auto_decision_share: decided.length ? Math.round(auto / decided.length * 100) / 100 : 0, avg_minutes_to_decision: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length * 10) / 10 : null }
  },
}

seed()
