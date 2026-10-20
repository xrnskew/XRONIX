// Проверка контрактов: примеры против схем и смысловые правила плана.
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { readFileSync, readdirSync } from 'node:fs'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
for (const f of readdirSync(new URL('./schemas/', import.meta.url))) ajv.addSchema(read(`./schemas/${f}`))

const id = (n) => `https://xronix/schemas/${n}.schema.json`

// Правила, которые схема выразить не может. Бэкенд вызывает после проверки по схеме и ПЕРЕД сохранением.
// Возвращает список нарушений; пустой список значит план годен.
export function checkPlan(plan) {
  const e = []
  const f = plan.finance
  if (f.funding_gap_rub !== Math.max(0, f.startup_cost_rub - f.own_funds_rub)) e.push('funding_gap_rub != startup_cost_rub - own_funds_rub')
  if (f.monthly_profit_rub !== f.monthly_revenue_rub - f.monthly_expenses_rub) e.push('monthly_profit_rub != revenue - expenses')
  f.revenue_forecast.forEach((m, i) => { if (m.month !== i + 1) e.push(`revenue_forecast[${i}].month должен быть ${i + 1}`) })
  plan.steps.forEach((s, i) => { if (s.order !== i + 1) e.push(`steps[${i}].order должен быть ${i + 1}`) })
  const c = plan.credit
  if (c.needed) {
    for (const k of ['amount_rub', 'recommended_term_months', 'estimated_rate_percent', 'monthly_payment_rub', 'debt_load_percent', 'verdict'])
      if (c[k] == null) e.push(`credit.${k} обязателен при needed=true`)
    if (c.amount_rub != null && c.amount_rub < f.funding_gap_rub * 0.5) e.push('credit.amount_rub сильно меньше funding_gap_rub')
  } else {
    for (const k of ['amount_rub', 'recommended_term_months', 'estimated_rate_percent', 'monthly_payment_rub', 'debt_load_percent', 'verdict'])
      if (c[k] != null) e.push(`credit.${k} должен быть null при needed=false`)
  }
  return e
}

// Поля, которые бэкенд пересчитывает сам и перезаписывает поверх ответа ИИ (см. ai.md).
export function annuity(amount, ratePercent, months) {
  const r = ratePercent / 100 / 12
  return Math.round(r === 0 ? amount / months : (amount * r) / (1 - Math.pow(1 + r, -months)))
}
export function verdictFor(loadPercent) {
  return loadPercent <= 35 ? 'ok' : loadPercent <= 50 ? 'risky' : 'not_recommended'
}

const cases = [
  ['plan.coffee.json', id('plan')],
  ['plan.no-credit.json', id('plan')],
  ['reply.message.json', id('reply')],
  ['reply.questions.json', id('reply')],
  ['reply.plan.front.json', id('reply')],
  ['reply.message.json', id('ai-reply')],
  ['reply.questions.json', id('ai-reply')],
  ['reply.plan.ai.json', id('ai-reply')],
  ['request.respond.json', id('ai-request')],
  ['request.summarize.json', id('summarize') + '#/definitions/request'],
  ['response.summarize.json', id('summarize') + '#/definitions/response'],
  ['user.json', id('profile')],
  ['error.json', id('error')],
]
// Эти пары обязаны НЕ проходить: у ответа ИИ не должно быть plan_id, у ответа фронту он обязателен.
const negative = [
  ['reply.plan.front.json', id('ai-reply')],
  ['reply.plan.ai.json', id('reply')],
]

// ---- v2: конвейер ----
const def = (file, d) => `https://xronix/schemas/${file}.schema.json#/definitions/${d}`
cases.push(
  ['need.request.json', def('parse-need', 'request')],
  ['need.response.json', def('parse-need', 'response')],
  ['need.empty.json', def('parse-need', 'response')],
  ['consult.request.json', def('consult', 'request')],
  ['consult.request.answers.json', def('consult', 'request')],
  ['consult.response.questions.json', def('consult', 'response')],
  ['consult.response.ready.json', def('consult', 'response')],
  ['registry.company.json', def('conveyor', 'registry_company')],
  ['company.json', def('conveyor', 'company')],
  ['company.create.json', def('conveyor', 'company_create')],
  ['match.request.json', def('conveyor', 'match_request')],
  ['match.response.json', def('conveyor', 'match_response')],
  ['application.create.json', def('conveyor', 'application_draft')],
  ['application.patch.json', def('conveyor', 'application_draft')],
  ['application.draft.json', def('conveyor', 'application')],
  ['application.approved.json', def('conveyor', 'application')],
  ['application.declined.json', def('conveyor', 'application')],
  ['application.info_requested.json', def('conveyor', 'application')],
  ['template.coffee.json', def('conveyor', 'template')],
  ['plan.calc.request.json', def('conveyor', 'plan_calc_request')],
  ['plan.calc.response.json', def('conveyor', 'plan_calc_response')],
  ['bank.application.json', def('bank', 'bank_application')],
  ['decision.counter.json', def('bank', 'decision_request')],
  ['decision.request_info.json', def('bank', 'decision_request')],
  ['bank.stats.json', def('bank', 'stats')],
  ['fns.json', def('integrations', 'fns')],
  ['bki.request.json', def('integrations', 'bki_request')],
  ['bki.report.json', def('integrations', 'bki_report')],
)
for (const [file, d] of [['application.list.json', def('conveyor', 'application_list_item')], ['feed.json', def('conveyor', 'feed_item')], ['bank.queue.json', def('bank', 'queue_item')]])
  read(`./examples/${file}`).forEach((_, i) => cases.push([`${file}#${i}`, d]))

// Контрольные суммы ИНН и ОГРН по алгоритму ФНС. Бэкенд и мок проверяют так же.
export function validInn(inn) {
  const d = [...inn].map(Number)
  const sum = (w, n) => w.reduce((s, k, i) => s + k * d[i], 0) % 11 % 10
  if (d.length === 10) return sum([2, 4, 10, 3, 5, 9, 4, 6, 8], 9) === d[9]
  if (d.length === 12) return sum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && sum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11]
  return false
}
export function validOgrn(ogrn) {
  if (ogrn.length === 13) return Number(BigInt(ogrn.slice(0, 12)) % 11n % 10n) === Number(ogrn[12])
  if (ogrn.length === 15) return Number(BigInt(ogrn.slice(0, 14)) % 13n % 10n) === Number(ogrn[14])
  return false
}

// График аннуитета: платёж по формуле, последний платёж закрывает остаток, итог = сумма платежей.
export function checkOffer(o) {
  const e = []
  if (annuity(o.amount_rub, o.rate_percent, o.term_months) !== o.monthly_payment_rub) e.push('monthly_payment_rub не по формуле аннуитета')
  if (o.schedule.length !== o.term_months) e.push('в графике не term_months строк')
  if (o.schedule.reduce((s, r) => s + r.principal_rub, 0) !== o.amount_rub) e.push('сумма principal_rub != amount_rub')
  if (o.schedule.at(-1)?.balance_rub !== 0) e.push('остаток после последнего платежа не 0')
  if (o.schedule.reduce((s, r) => s + r.payment_rub, 0) !== o.total_payment_rub) e.push('total_payment_rub != сумма платежей')
  o.schedule.forEach((r, i) => { if (r.payment_rub !== r.principal_rub + r.interest_rub) e.push(`schedule[${i}]: payment != principal + interest`) })
  return e
}

let bad = 0
const fail = (msg) => { bad++; console.error(`FAIL ${msg}`) }
const inns = []
const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (typeof v.inn === 'string') inns.push(v); Object.values(v).forEach(walk) } }
for (const f of readdirSync(new URL('./examples/', import.meta.url))) walk(read(`./examples/${f}`))
for (const c of inns) {
  if (!validInn(c.inn)) fail(`ИНН ${c.inn} не проходит контрольную сумму`)
  if (c.ogrn && !validOgrn(c.ogrn)) fail(`ОГРН ${c.ogrn} не проходит контрольную сумму`)
}
console.log(`ok   контрольные суммы: ${inns.length} записей с ИНН`)
for (const f of ['application.approved.json']) { const errs = checkOffer(read(`./examples/${f}`).offer); if (errs.length) fail(`${f}: ${errs}`); else console.log(`ok   график ${f}`) }
const sc = read('./examples/bank.application.json').scoring
if (sc.score !== Math.min(100, Math.max(0, 50 + sc.factors.reduce((s, f) => s + f.points, 0)))) fail('scoring.score != 50 + сумма факторов (в рамках 0–100)')
else console.log('ok   скоринг в примере')
const dict = read('./dictionaries.json'), common = read('./schemas/common.schema.json').definitions
for (const [k, enumName] of [['statuses', 'status'], ['purposes', 'purpose'], ['spheres', 'sphere'], ['member_roles', 'member_role'], ['collateral_kinds', 'collateral_kind'], ['info_request_kinds', 'info_request_kind'], ['decline_reasons', 'decline_reason']]) {
  const a = Object.keys(dict[k]).sort().join(), b = [...common[enumName].enum].sort().join()
  if (a !== b) fail(`dictionaries.${k} не совпадает с common.${enumName}`)
}
console.log('ok   справочники совпадают со схемами')
for (const f of ['need.response.json', 'need.empty.json']) {
  const n = read(`./examples/${f}`)
  for (const k of Object.keys(n.confidence)) if (n[k] === null) fail(`${f}: confidence.${k} при значении null`)
}

const example = (name) => { const [file, i] = name.split('#'); const v = read(`./examples/${file}`); return i === undefined ? v : v[Number(i)] }
for (const [file, schema] of cases) {
  const ok = ajv.validate(schema, example(file))
  if (!ok) { bad++; console.error(`FAIL ${file} -> ${schema}\n`, ajv.errors) } else console.log(`ok   ${file}`)
}
for (const [file, schema] of negative) {
  if (ajv.validate(schema, read(`./examples/${file}`))) { bad++; console.error(`FAIL ${file} не должен проходить ${schema}`) } else console.log(`ok   ${file} отклонён ${schema.split('/').pop()}`)
}
for (const file of ['plan.coffee.json', 'plan.no-credit.json', 'plan.calc.response.json']) {
  const v = read(`./examples/${file}`), plan = v.plan ?? v
  const errs = checkPlan(plan)
  for (const [items, total] of [['startup_items', 'startup_cost_rub'], ['monthly_items', 'monthly_expenses_rub']])
    if (plan.finance[items] && plan.finance[items].reduce((s, r) => s + r.amount_rub, 0) !== plan.finance[total]) errs.push(`${items} не сходится с ${total}`)
  if (errs.length) { bad++; console.error(`FAIL смысл ${file}:`, errs) } else console.log(`ok   смысл ${file}`)
}
const c = read('./examples/plan.coffee.json').credit
if (annuity(c.amount_rub, c.estimated_rate_percent, c.recommended_term_months) !== c.monthly_payment_rub) { bad++; console.error('FAIL платёж в примере не совпадает с формулой аннуитета') } else console.log('ok   аннуитет в примере')
process.exit(bad ? 1 : 0)
