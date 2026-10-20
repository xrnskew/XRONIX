// Логика конвейера по /contracts/rules/credit_rules.v1.json — для мок-режима фронта.
// Источник правды о решении — бэкенд. Здесь та же логика, чтобы демо без сервера вело себя как настоящее.
import rules from '../data/credit_rules.v1.json' with { type: 'json' }
import dict from '../data/dictionaries.json' with { type: 'json' }
import { alfaProducts, type AlfaProduct } from '../data/alfaProducts.ts'
import type { Collateral, DeclineReason, Financials, MatchItem, MatchRequest, ProductId, RegistryCompany, ScheduleItem } from '../types/conveyor.ts'

export interface Fns { mass_address: boolean; tax_debt_rub: number; head_disqualified: boolean }
export interface Bki { has_history: boolean; history_months: number; loans: { lender: string; monthly_payment_rub: number; balance_rub: number }[]; overdue_30_24m: number; overdue_90_12m: number }
export type Grade = 'A' | 'B' | 'C' | 'D'
export interface Factor { code: string; name: string; value_text: string; points: number }

const product = (id: ProductId) => alfaProducts.find((p) => p.id === id) as AlfaProduct
const nf = new Intl.NumberFormat('ru-RU')
const rubText = (n: number) => `${nf.format(n)} ₽`

// ---- деньги ----
export function payment(amount: number, rate: number, months: number) {
  const r = rate / 100 / 12
  return Math.round(r === 0 ? amount / months : (amount * r) / (1 - Math.pow(1 + r, -months)))
}
export function schedule(amount: number, rate: number, months: number): ScheduleItem[] {
  const r = rate / 100 / 12, pay = payment(amount, rate, months), rows: ScheduleItem[] = []
  let balance = amount
  for (let month = 1; month <= months; month++) {
    const interest = Math.round(balance * r)
    const principal = month < months ? pay - interest : balance
    balance -= principal
    rows.push({ month, payment_rub: principal + interest, principal_rub: principal, interest_rub: interest, balance_rub: balance })
  }
  return rows
}

export function businessMonths(registeredAt: string, now = new Date()) {
  const d = new Date(`${registeredAt}T00:00:00Z`)
  let m = (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + now.getUTCMonth() - d.getUTCMonth()
  if (now.getUTCDate() < d.getUTCDate()) m -= 1
  return Math.max(0, m)
}
const ageText = (m: number) => {
  const y = Math.floor(m / 12), mm = m % 12
  return [y ? `${y} ${y === 1 ? 'год' : y < 5 ? 'года' : 'лет'}` : '', mm ? `${mm} мес.` : ''].filter(Boolean).join(' ') || 'меньше месяца'
}

// ---- подбор ----
export function matchProducts(req: MatchRequest, months: number | null): MatchItem[] {
  return alfaProducts.map((p) => {
    const reasons: string[] = []
    if ((p.amountMin != null && req.amount_rub < p.amountMin) || req.amount_rub > p.amountMax) reasons.push(`Сумма должна быть ${p.amountMin ? `от ${rubText(p.amountMin)} ` : ''}до ${rubText(p.amountMax)}.`)
    if ((p.termMin != null && req.term_months < p.termMin) || req.term_months > p.termMax) reasons.push(`Срок должен быть ${p.termMin ? `от ${p.termMin} ` : ''}до ${p.termMax} мес.`)
    if (p.collateral && !req.has_collateral) reasons.push('Нужен залог: недвижимость, оборудование или транспорт.')
    if (p.id === 'mortgage' && req.purpose !== 'real_estate') reasons.push('Подходит только для покупки недвижимости.')
    if (p.id === 'revolving' && req.purpose !== 'working_capital') reasons.push('Линия для пополнения оборота.')
    if (months != null && p.minBusinessMonths != null && months < p.minBusinessMonths) reasons.push(`Бизнес должен работать не меньше ${p.minBusinessMonths} месяцев, у вас ${ageText(months)}.`)
    const canApply = (rules.applicable_products as string[]).includes(p.id)
    if (!canApply) reasons.push('Заявку на этот продукт в демо оформляет менеджер банка.')
    const fits = reasons.length === (canApply ? 0 : 1)
    return {
      product_id: p.id as ProductId, name: p.name, eligible: fits, can_apply: canApply, reasons,
      rate_from_percent: p.rateFrom, url: p.url,
      monthly_payment_rub: p.rateFrom != null && p.id !== 'revolving' ? payment(req.amount_rub, p.rateFrom, Math.min(p.termMax, Math.max(p.termMin ?? 1, req.term_months))) : null,
    }
  }).sort((a, b) => Number(b.eligible && b.can_apply) - Number(a.eligible && a.can_apply) || (a.rate_from_percent ?? 99) - (b.rate_from_percent ?? 99))
}

// ---- конвейер ----
export interface Input {
  registry: RegistryCompany; fns: Fns; bki: Bki; financials: Financials
  product_id: ProductId; amount_rub: number; term_months: number; collateral: Collateral | null
  plan_profit_rub?: number | null; now?: Date
}

export function stopFactors(i: Input): { code: DeclineReason; params: Record<string, string> }[] {
  const s = rules.stop_factors, out: { code: DeclineReason; params: Record<string, string> }[] = []
  const p = product(i.product_id), months = businessMonths(i.registry.registered_at, i.now)
  if (s.inactive_statuses.includes(i.registry.status)) out.push({ code: 'company_inactive', params: {} })
  if (p.minBusinessMonths != null && months < p.minBusinessMonths) {
    const d = new Date(`${i.registry.registered_at}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + p.minBusinessMonths)
    out.push({ code: 'business_too_young', params: { min_months: String(p.minBusinessMonths), eligible_date: d.toISOString().slice(0, 10).split('-').reverse().join('.') } })
  }
  if (i.bki.overdue_90_12m > s.overdue_90_12m_max) out.push({ code: 'overdue_90', params: {} })
  if (i.fns.tax_debt_rub > s.tax_debt_max_rub) out.push({ code: 'tax_debt', params: { limit_rub: nf.format(s.tax_debt_max_rub) } })
  if (s.head_disqualified && i.fns.head_disqualified) out.push({ code: 'head_disqualified', params: {} })
  return out
}

export function rateFor(productId: ProductId, grade: Grade) {
  const premium = (rules.decision.rate_premium_by_grade as Record<Grade, number | null>)[grade] ?? 0
  return (product(productId).rateFrom ?? 0) + premium
}

const monthlyProfit = (i: Input) => {
  const f = i.financials
  if (f.revenue_12m_rub == null || f.expenses_12m_rub == null) return null
  return (f.revenue_12m_rub - f.expenses_12m_rub) / 12 + (i.plan_profit_rub ?? 0) * rules.scoring.new_project_profit_share
}
const existingPayments = (i: Input) => Math.max(i.financials.loan_payments_monthly_rub ?? 0, i.bki.loans.reduce((s, l) => s + l.monthly_payment_rub, 0))
export function debtLoad(i: Input, amount = i.amount_rub, months = i.term_months, rate = product(i.product_id).rateFrom ?? 0) {
  const profit = monthlyProfit(i)
  if (profit == null || profit <= 0) return null
  return Math.round((existingPayments(i) + payment(amount, rate, months)) / profit * 1000) / 10
}

const band = <T extends { points: number }>(list: T[], pick: (b: T) => number | null, v: number) => list.find((b) => pick(b) == null || v <= (pick(b) as number)) as T

export function score(i: Input) {
  const sc = rules.scoring, factors: Factor[] = []
  const months = businessMonths(i.registry.registered_at, i.now)
  factors.push({ code: 'business_age', name: 'Стаж бизнеса', value_text: ageText(months), points: band(sc.business_age, (b) => b.max_months, months).points })
  const load = debtLoad(i)
  factors.push({ code: 'debt_load', name: 'Долговая нагрузка', value_text: load == null ? 'нет прибыли' : `${String(load).replace('.', ',')}% прибыли`, points: load == null ? sc.debt_load_no_profit_points : band(sc.debt_load, (b) => b.max_percent, load).points })
  const h = sc.credit_history, b = i.bki
  const [hp, ht] = !b.has_history ? [h.no_history, 'нет истории'] : b.overdue_30_24m > 0 ? [h.overdue_30, `просрочки 30+: ${b.overdue_30_24m}`] : b.history_months >= h.clean_min_months ? [h.clean, `чистая, ${b.history_months} мес.`] : [h.short_clean, `чистая, ${b.history_months} мес.`]
  factors.push({ code: 'credit_history', name: 'Кредитная история', value_text: ht as string, points: hp as number })
  const revenue = i.financials.revenue_12m_rub ?? 0, ratio = revenue > 0 ? i.amount_rub / revenue : Infinity
  factors.push({ code: 'amount_to_revenue', name: 'Сумма к годовой выручке', value_text: revenue > 0 ? `${Math.round(ratio * 100)}%` : 'выручки нет', points: band(sc.amount_to_revenue, (x) => x.max_ratio, ratio).points })
  const cv = i.collateral?.value_rub ?? 0
  factors.push({ code: 'collateral', name: 'Залог', value_text: cv ? `${rubText(cv)}` : 'нет', points: cv >= i.amount_rub ? sc.collateral.full_coverage : cv > 0 ? sc.collateral.partial : sc.collateral.none })
  if (i.fns.mass_address) factors.push({ code: 'mass_address', name: 'Массовый адрес', value_text: 'да', points: sc.mass_address })
  if (i.fns.tax_debt_rub > 0) factors.push({ code: 'tax_debt', name: 'Недоимка по налогам', value_text: rubText(i.fns.tax_debt_rub), points: sc.small_tax_debt })
  const ind = (sc.industry.by_okved_prefix as Record<string, number>)[i.registry.okved.code.slice(0, 2)] ?? sc.industry.default
  factors.push({ code: 'industry', name: 'Отрасль', value_text: `ОКВЭД ${i.registry.okved.code}`, points: ind })
  const value = Math.min(sc.max, Math.max(sc.min, sc.base + factors.reduce((s, f) => s + f.points, 0)))
  const grade = sc.grades.find((g) => value >= g.min_score)!.grade as Grade
  return { score: value, grade, factors, debt_load_percent: load }
}

export type Decision =
  | { kind: 'decline'; reasons: { code: DeclineReason; params: Record<string, string> }[] }
  | { kind: 'approve' | 'counter'; amount_rub: number; term_months: number; rate_percent: number; explanation: string[] }
  | { kind: 'manual'; recommendation: string }

export function decide(i: Input, s: ReturnType<typeof score>): Decision {
  const d = rules.decision, p = product(i.product_id), rate = rateFor(i.product_id, s.grade)
  if (s.grade === 'D') return { kind: 'decline', reasons: [{ code: 'low_score', params: {} }] }
  const load = debtLoad(i, i.amount_rub, i.term_months, rate)
  if (load != null && load > d.max_debt_load_percent) {
    if (!d.counter_offer_grades.includes(s.grade)) return { kind: 'manual', recommendation: `Класс ${s.grade}, нагрузка ${load}%: встречное предложение или залог.` }
    const longer = debtLoad(i, i.amount_rub, p.termMax, rate)
    if (longer != null && longer <= d.max_debt_load_percent)
      return { kind: 'counter', amount_rub: i.amount_rub, term_months: p.termMax, rate_percent: rate, explanation: [`На ${i.term_months} мес. платёж занял бы ${String(load).replace('.', ',')}% прибыли, банк допускает до ${d.max_debt_load_percent}%.`, `Увеличили срок до ${p.termMax} мес.: сумма та же, платёж меньше.`] }
    const profit = monthlyProfit(i)!, r = rate / 100 / 12, n = p.termMax
    const maxPay = profit * d.max_debt_load_percent / 100 - existingPayments(i)
    const amount = Math.floor(maxPay * (1 - Math.pow(1 + r, -n)) / r / d.amount_round_to_rub) * d.amount_round_to_rub
    if (maxPay <= 0 || amount < (p.amountMin ?? 0)) return { kind: 'manual', recommendation: `Нагрузка ${load}% даже на максимальный срок: нужен залог или меньшая сумма.` }
    return { kind: 'counter', amount_rub: amount, term_months: n, rate_percent: rate, explanation: [`Запрошенная сумма дала бы нагрузку ${String(load).replace('.', ',')}% прибыли, банк допускает до ${d.max_debt_load_percent}%.`, `Предлагаем ${rubText(amount)} на ${n} мес.`] }
  }
  if (load == null) return { kind: 'manual', recommendation: 'Нет данных о прибыли: нужна оценка специалиста.' }
  if (s.grade === 'A' && i.amount_rub <= d.auto_approve_max_amount_rub)
    return { kind: 'approve', amount_rub: i.amount_rub, term_months: i.term_months, rate_percent: rate, explanation: ['Заявка одобрена на запрошенных условиях.', s.grade === 'A' ? 'Ставка — базовая для продукта: кредитная оценка высокая.' : ''].filter(Boolean) }
  return { kind: 'manual', recommendation: s.grade === 'A' ? `Сумма больше ${rubText(d.auto_approve_max_amount_rub)}: решение принимает специалист. Система рекомендует одобрить.` : `Класс ${s.grade}: решение принимает специалист.` }
}

export function declineText(code: DeclineReason, params: Record<string, string>) {
  const r = (dict.decline_reasons as Record<string, { text: string; advice: string }>)[code]
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '')
  return { code, text: fill(r.text), advice: fill(r.advice) }
}
