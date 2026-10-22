// Расчёт проекта без ИИ: шаблон сферы + формулы из /contracts/templates.md.
// Эталон для бэкенда (POST /api/plans/calculate) и движок мок-режима фронта.
import spheres from '../data/spheres.v1.json' with { type: 'json' }
import { cities, normalizeCity } from '../data/cities.ts'
import { alfaProducts } from '../data/alfaProducts.ts'
import { payment } from './creditRules.ts'
import type { Experience, Plan } from '../types/plan.ts'
import type { Sphere } from '../types/conveyor.ts'

export interface Question { id: string; text: string; kind: 'number' | 'choice'; unit?: string | null; default: number | string; min?: number; max?: number; options?: { value: string; label: string }[] }
export interface Template { sphere: Sphere; title: string; questions: Question[] }
export interface CalcRequest { sphere: Sphere; city: string; own_funds_rub: number; answers: Record<string, number | string>; experience?: Experience }

type StartupItem = { title: string; kind: 'fixed' | 'per_m2' | 'per_answer' | 'rent_months'; rub?: number; months?: number; answer?: string; days: number; assumption: string }
type SphereDef = Template & {
  sphere_label: string; startup: StartupItem[]
  monthly: { rent_per_m2: number; salary_per_staff: number; cogs_percent: number; other_rub: number; cogs_title: string }
  revenue: { qty: string; price: string; days_per_month: number }; ramp: number[]
  opportunities: Plan['opportunities']; risks: Plan['risks']
}
const defs = spheres.spheres as unknown as Record<string, Omit<SphereDef, 'sphere'>>
const { title: erTitle, level: erLevel, mitigation: erMitigation } = spheres.experience_risk
const taxNote = spheres.tax_note as NonNullable<Plan['tax_note']>
const experienceRisk: Plan['risks'][number] = { title: erTitle, level: erLevel as Plan['risks'][number]['level'], mitigation: erMitigation }

export const templates = (): Template[] => Object.entries(defs).map(([sphere, d]) => ({ sphere: sphere as Sphere, title: d.title, questions: d.questions as Question[] }))

export class CalcError extends Error {}

const groups = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const shortRub = (n: number) => n >= 1_000_000 ? `${(Math.round(n / 100_000) / 10).toString().replace('.', ',')} млн ₽` : `${groups(Math.round(n / 1000))} тыс ₽`

export function cityK(city: string) {
  const c = cities.find((x) => normalizeCity(x.name) === normalizeCity(city))
  if (!c) return spheres.unknown_city_k
  return spheres.city_tiers.find((t) => c.population >= t.min_population)!.k
}

function answersFor(d: Omit<SphereDef, 'sphere'>, given: Record<string, number | string>) {
  const a: Record<string, number | string> = {}
  for (const q of d.questions as Question[]) {
    const v = given[q.id] ?? q.default
    if (q.kind === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n) || (q.min != null && n < q.min) || (q.max != null && n > q.max)) throw new CalcError(`${q.text}: от ${q.min} до ${q.max}${q.unit ? ' ' + q.unit : ''}`)
      a[q.id] = n
    } else {
      if (!q.options?.some((o) => o.value === v)) throw new CalcError(`${q.text}: выберите вариант из списка`)
      a[q.id] = String(v)
    }
  }
  return a
}

export function calculatePlan(req: CalcRequest): Plan {
  const d = defs[req.sphere]
  if (!d) throw new CalcError('Для этой сферы пока нет шаблона расчёта.')
  const a = answersFor(d, req.answers)
  const k = cityK(req.city), area = Number(a.area_m2), staff = Number(a.staff)
  const m = d.monthly, tax = spheres.tax_percent

  const rent = Math.round(m.rent_per_m2 * area * k)
  const startup_items = d.startup.map((s) => {
    const amount = s.kind === 'fixed' ? s.rub! : s.kind === 'per_m2' ? s.rub! * area : s.kind === 'per_answer' ? s.rub! * Number(a[s.answer!]) : rent * s.months!
    return { title: s.title, amount_rub: amount, assumption: s.assumption.replace('{rub}', groups(s.rub ?? 0)) }
  })
  const startup = startup_items.reduce((x, s) => x + s.amount_rub, 0)

  const revenue = Math.round(Number(a[d.revenue.qty]) * Number(a[d.revenue.price]) * d.revenue.days_per_month)
  const salaries = Math.round(staff * m.salary_per_staff * (0.6 + 0.4 * k) * (1 + spheres.payroll_tax_percent / 100))
  const variable = (rev: number) => Math.round(rev * m.cogs_percent / 100) + Math.round(rev * tax / 100)
  const monthly_items = [
    { title: 'Аренда', amount_rub: rent, assumption: `${groups(m.rent_per_m2)} ₽ за м² в Москве × ${area} м² × коэффициент города ${k}` },
    { title: 'Зарплаты', amount_rub: salaries, assumption: staff === 0 ? 'Наёмных сотрудников нет: работает сам предприниматель' : `${staff} чел., с учётом уровня зарплат в городе и страховых взносов ${spheres.payroll_tax_percent}%` },
    ...(m.cogs_percent > 0 ? [{ title: m.cogs_title, amount_rub: Math.round(revenue * m.cogs_percent / 100), assumption: `${m.cogs_percent}% выручки` }] : []),
    { title: `Налог УСН ${tax}%`, amount_rub: Math.round(revenue * tax / 100), assumption: 'УСН «доходы»' },
    { title: 'Прочие расходы', amount_rub: m.other_rub, assumption: 'Коммунальные услуги, связь, эквайринг, бухгалтерия' },
  ]
  const expenses = monthly_items.reduce((x, s) => x + s.amount_rub, 0)
  const profit = revenue - expenses
  const revenue_forecast = d.ramp.map((r, i) => {
    const rev = Math.round(revenue * r)
    return { month: i + 1, revenue_rub: rev, expenses_rub: rent + salaries + m.other_rub + variable(rev) }
  })
  const payback = profit > 0 ? Math.ceil(startup / profit) : null
  const gap = Math.max(0, startup - req.own_funds_rub)

  let credit: Plan['credit']
  if (gap > 0) {
    const cfg = spheres.credit
    const raw = Math.ceil(gap / cfg.round_to_rub) * cfg.round_to_rub
    const main = alfaProducts.find((p) => p.id === cfg.product_id)!
    const product = raw <= main.amountMax ? main : alfaProducts.find((p) => p.id === cfg.fallback_product_id)!
    const amount = Math.max(raw, product.amountMin ?? 0)
    const term = Math.min(product.termMax, Math.max(product.termMin ?? 1, cfg.term_months))
    const rate = product.rateFrom ?? 0
    const pay = payment(amount, rate, term)
    const load = profit > 0 ? Math.round(pay / profit * 100) : 100
    const verdict = load <= 35 ? 'ok' : load <= 50 ? 'risky' : 'not_recommended'
    const top = [...startup_items].sort((x, y) => y.amount_rub - x.amount_rub).slice(0, 2).map((s) => s.title.toLowerCase())
    credit = {
      needed: true, amount_rub: amount, purpose: `Запуск: ${top.join(', ')}`, recommended_term_months: term, estimated_rate_percent: rate,
      monthly_payment_rub: pay, debt_load_percent: load, verdict, recommended_product_id: product.id as Plan['credit']['recommended_product_id'],
      comment: verdict === 'ok' ? `Платёж — около ${load}% плановой прибыли: нагрузка умеренная.` : verdict === 'risky' ? `Платёж — ${load}% плановой прибыли: запас небольшой, лучше увеличить свои средства или срок.` : `Платёж — ${load}% плановой прибыли: бизнес вряд ли потянет такой кредит. Уменьшите масштаб или добавьте свои средства.`,
    }
  } else credit = { needed: false, amount_rub: null, purpose: null, recommended_term_months: null, estimated_rate_percent: null, monthly_payment_rub: null, debt_load_percent: null, verdict: null, recommended_product_id: null, comment: 'Стартовые расходы покрываются собственными средствами.' }

  const format = (d.questions as Question[]).find((q) => q.id === 'format')?.options?.find((o) => o.value === a.format)?.label ?? d.title
  return {
    title: `${d.title}, ${req.city}`,
    summary: `${format}: запуск — ${shortRub(startup)}, на плановом уровне прибыль ${shortRub(profit)} в месяц, ${payback ? `окупаемость — около ${payback} мес` : 'при таких параметрах бизнес не окупается'}. Расчёт по шаблону, цены — оценка.`,
    business: { sphere: d.sphere_label, format, city: req.city, ...(req.experience ? { experience: req.experience } : {}) },
    steps: d.startup.map((s, i) => ({ order: i + 1, title: s.title, description: startup_items[i].assumption, duration_days: s.days, cost_rub: startup_items[i].amount_rub })),
    opportunities: d.opportunities,
    // «нет опыта» добавляет последним риском experience_risk (contracts/templates.md); формулы от опыта не зависят
    risks: req.experience === 'none' ? [...d.risks, experienceRisk] : d.risks,
    finance: {
      startup_cost_rub: startup, own_funds_rub: req.own_funds_rub, funding_gap_rub: gap,
      monthly_revenue_rub: revenue, monthly_expenses_rub: expenses, monthly_profit_rub: profit, payback_months: payback,
      revenue_forecast, startup_items, monthly_items,
    },
    credit,
    tax_note: { text: taxNote.text, sources: taxNote.sources, checked_at: taxNote.checked_at },
    tags_update: [d.sphere_label.toLowerCase(), req.city],
  }
}
