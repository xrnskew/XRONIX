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

let bad = 0
for (const [file, schema] of cases) {
  const ok = ajv.validate(schema, read(`./examples/${file}`))
  if (!ok) { bad++; console.error(`FAIL ${file} -> ${schema}\n`, ajv.errors) } else console.log(`ok   ${file}`)
}
for (const [file, schema] of negative) {
  if (ajv.validate(schema, read(`./examples/${file}`))) { bad++; console.error(`FAIL ${file} не должен проходить ${schema}`) } else console.log(`ok   ${file} отклонён ${schema.split('/').pop()}`)
}
for (const file of ['plan.coffee.json', 'plan.no-credit.json']) {
  const errs = checkPlan(read(`./examples/${file}`))
  if (errs.length) { bad++; console.error(`FAIL смысл ${file}:`, errs) } else console.log(`ok   смысл ${file}`)
}
const c = read('./examples/plan.coffee.json').credit
if (annuity(c.amount_rub, c.estimated_rate_percent, c.recommended_term_months) !== c.monthly_payment_rub) { bad++; console.error('FAIL платёж в примере не совпадает с формулой аннуитета') } else console.log('ok   аннуитет в примере')
process.exit(bad ? 1 : 0)
