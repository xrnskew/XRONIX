import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validInn, validOgrn, innHint } from '../src/lib/inn.ts'
import { payment, schedule, score, decide, stopFactors, matchProducts, businessMonths } from '../src/lib/creditRules.ts'
import { SCENARIOS, demoFinancials, generated } from '../src/api/mockData.ts'

const contract = (p) => JSON.parse(readFileSync(new URL(`../../contracts/${p}`, import.meta.url), 'utf8'))
const NOW = new Date('2026-10-20T12:00:00Z')

test('копии справочников и правил совпадают с контрактами', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../src/data/dictionaries.json', import.meta.url))), contract('dictionaries.json'))
  assert.deepEqual(JSON.parse(readFileSync(new URL('../src/data/credit_rules.v1.json', import.meta.url))), contract('rules/credit_rules.v1.json'))
})

test('ИНН и ОГРН: контрольные суммы и подсказки', () => {
  for (const s of Object.values(SCENARIOS)) { assert.ok(validInn(s.registry.inn), s.registry.inn); assert.ok(validOgrn(s.registry.ogrn), s.registry.ogrn) }
  assert.equal(validInn('7715881398'), false)
  assert.equal(innHint('7715881398'), null, 'пока печатают, 10 цифр могут быть началом ИНН ИП')
  assert.match(innHint('7715881398', true), /контрольная/)
  assert.equal(innHint('77158813a'), 'Только цифры')
})

test('график совпадает с примером контракта', () => {
  const o = contract('examples/application.approved.json').offer
  assert.equal(payment(o.amount_rub, o.rate_percent, o.term_months), o.monthly_payment_rub)
  assert.deepEqual(schedule(o.amount_rub, o.rate_percent, o.term_months), o.schedule)
})

const run = (inn, extra = {}) => {
  const s = SCENARIOS[inn], d = demoFinancials[inn]
  const input = { registry: s.registry, fns: s.fns, bki: s.bki, financials: d.financials, product_id: d.product_id, amount_rub: d.amount_rub, term_months: d.term_months, collateral: d.collateral, now: NOW, ...extra }
  const stops = stopFactors(input)
  if (stops.length) return { kind: 'decline', reasons: stops }
  const sc = score(input)
  return { ...decide(input, sc), sc }
}

test('компании-сценарии дают исходы из contracts/integrations.md', () => {
  const north = run('7715881399')
  assert.equal(north.kind, 'approve'); assert.equal(north.sc.score, 100); assert.equal(north.sc.debt_load_percent, 29.7)
  const lebedev = run('777309114120')
  assert.equal(lebedev.kind, 'counter'); assert.equal(lebedev.sc.grade, 'B'); assert.equal(lebedev.term_months, 60)
  assert.equal(run('7768151886').kind, 'manual')
  assert.deepEqual(run('7755761690').reasons.map((r) => r.code), ['overdue_90'])
  const sok = run('776846978815')
  assert.deepEqual(sok.reasons.map((r) => r.code), ['business_too_young']); assert.equal(sok.reasons[0].params.eligible_date, '12.02.2027')
  assert.ok(run('7772731777').sc.factors.some((f) => f.code === 'mass_address'))
})

test('пример скоринга в контракте считается так же', () => {
  const ex = contract('examples/bank.application.json').scoring
  const r = run('7715881399')
  assert.deepEqual(r.sc.factors.map((f) => [f.code, f.points]), ex.factors.map((f) => [f.code, f.points]))
})

test('встречное предложение уменьшает сумму, если срока не хватает', () => {
  const r = run('777309114120', { financials: { revenue_12m_rub: 9_600_000, expenses_12m_rub: 6_240_000, loan_payments_monthly_rub: 85_000 } })
  assert.equal(r.kind, 'counter')
  assert.ok(r.amount_rub < 2_000_000 && r.amount_rub % 10_000 === 0, String(r.amount_rub))
})

test('подбор: без залога кредит с залогом не подходит, стаж проверяется', () => {
  const items = matchProducts({ purpose: 'equipment', amount_rub: 1_500_000, term_months: 24, has_collateral: false }, 55)
  assert.equal(items[0].product_id, 'fast'); assert.ok(items[0].eligible)
  assert.equal(items[0].monthly_payment_rub, 78_933)
  assert.ok(!items.find((i) => i.product_id === 'secured').eligible)
  assert.ok(!matchProducts({ purpose: 'equipment', amount_rub: 600_000, term_months: 24, has_collateral: false }, 5)[0].eligible)
})

test('сгенерированные компании детерминированы и с верными реквизитами', () => {
  const a = generated('7707083893'), b = generated('7707083893')
  assert.deepEqual(a, b)
  assert.ok(validOgrn(a.registry.ogrn))
  assert.equal(businessMonths('2022-03-15', NOW), 55)
})

// ---- расчёт проекта (contracts/templates.md) ----
import { calculatePlan, templates, cityK, CalcError } from '../src/lib/projectCalc.ts'

const planRules = (p) => {
  const f = p.finance, c = p.credit, e = []
  const sum = (l) => l.reduce((s, r) => s + r.amount_rub, 0)
  if (sum(f.startup_items) !== f.startup_cost_rub) e.push('startup_items')
  if (sum(f.monthly_items) !== f.monthly_expenses_rub) e.push('monthly_items')
  if (f.funding_gap_rub !== Math.max(0, f.startup_cost_rub - f.own_funds_rub)) e.push('gap')
  if (f.monthly_profit_rub !== f.monthly_revenue_rub - f.monthly_expenses_rub) e.push('profit')
  if (f.payback_months !== (f.monthly_profit_rub > 0 ? Math.ceil(f.startup_cost_rub / f.monthly_profit_rub) : null)) e.push('payback')
  if (f.revenue_forecast.map((m) => m.month).join() !== '1,2,3,4,5,6,7,8,9,10,11,12') e.push('forecast')
  if (p.steps.some((s, i) => s.order !== i + 1)) e.push('steps')
  for (const k of ['amount_rub', 'recommended_term_months', 'estimated_rate_percent', 'monthly_payment_rub', 'debt_load_percent', 'verdict']) if ((c[k] === null) === c.needed) e.push(`credit.${k}`)
  if (c.needed && (c.amount_rub < f.funding_gap_rub || c.monthly_payment_rub !== payment(c.amount_rub, c.estimated_rate_percent, c.recommended_term_months))) e.push('credit')
  if (!p.summary.includes(p.finance.payback_months ? `около ${p.finance.payback_months} мес` : 'не окупается')) e.push('summary')
  return e
}

test('шаблоны совпадают с контрактом, пример расчёта воспроизводится', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../src/data/spheres.v1.json', import.meta.url))), contract('templates/spheres.v1.json'))
  const req = contract('examples/plan.calc.request.json')
  assert.deepEqual(calculatePlan(req), contract('examples/plan.calc.response.json').plan)
  assert.deepEqual(templates().find((t) => t.sphere === 'coffee'), contract('examples/template.coffee.json'))
})

test('каждая сфера в любом городе даёт план по всем правилам', () => {
  for (const t of templates()) for (const city of ['Москва', 'Казань', 'Абаза', 'Несуществующий'])
    for (const own of [0, 500_000, 50_000_000]) {
      const p = calculatePlan({ sphere: t.sphere, city, own_funds_rub: own, answers: {} })
      assert.deepEqual(planRules(p), [], `${t.sphere} ${city} ${own}`)
    }
  assert.equal(cityK('Москва'), 1); assert.equal(cityK('Казань'), 0.55); assert.equal(cityK('Нигдебург'), 0.45)
})

test('ответ вне диапазона и неизвестный вариант отклоняются', () => {
  assert.throws(() => calculatePlan({ sphere: 'coffee', city: 'Москва', own_funds_rub: 0, answers: { area_m2: 1 } }), CalcError)
  assert.throws(() => calculatePlan({ sphere: 'coffee', city: 'Москва', own_funds_rub: 0, answers: { format: 'yacht' } }), CalcError)
})

test('прибыль новой точки учитывается в нагрузке наполовину', () => {
  const base = { registry: SCENARIOS['777309114120'].registry, fns: SCENARIOS['777309114120'].fns, bki: SCENARIOS['777309114120'].bki, ...demoFinancials['777309114120'], now: NOW }
  const without = score(base).debt_load_percent, withPlan = score({ ...base, plan_profit_rub: 200_000 }).debt_load_percent
  assert.ok(withPlan < without, `${withPlan} < ${without}`)
})

// ---- демо-продукт «Старт» и будущий ИП (contracts/conveyor.md) ----
import { personExternal, DEMO_FOUNDER_INN } from '../src/api/mockData.ts'
import { parseNeedText } from '../src/lib/parseText.ts'

test('«Старт»: будущий ИП с планом и 20%+ своих — одобрение с условием регистрации', () => {
  assert.ok(validInn(DEMO_FOUNDER_INN))
  const plan = calculatePlan({ sphere: 'coffee', city: 'Казань', own_funds_rub: 500_000, answers: {} })
  const brief = { startup_cost_rub: plan.finance.startup_cost_rub, own_funds_rub: plan.finance.own_funds_rub, monthly_profit_rub: plan.finance.monthly_profit_rub, monthly_revenue_rub: plan.finance.monthly_revenue_rub }
  const ext = personExternal(DEMO_FOUNDER_INN, 'Мария Новикова')
  const i = { ...ext, financials: { revenue_12m_rub: null, expenses_12m_rub: null, loan_payments_monthly_rub: 0 }, product_id: 'start', amount_rub: plan.credit.amount_rub, term_months: 36, collateral: { kind: 'guarantor', description: 'Поручитель — супруг', value_rub: 1_000_000 }, plan: brief, person: true, now: NOW }
  assert.deepEqual(stopFactors(i), [])
  const sc = score(i), d = decide(i, sc)
  assert.ok(sc.factors.some((f) => f.code === 'own_share') && !sc.factors.some((f) => f.code === 'business_age'))
  assert.equal(d.kind, 'approve', JSON.stringify(sc))
  assert.match(d.explanation.at(-1), /зарегистрировать ИП/)
  assert.equal(d.rate_percent, 27)
})

test('«Старт»: без плана и с малой долей своих — стоп-факторы', () => {
  const ext = personExternal(DEMO_FOUNDER_INN, 'Мария')
  const base = { ...ext, financials: { revenue_12m_rub: null, expenses_12m_rub: null, loan_payments_monthly_rub: 0 }, product_id: 'start', amount_rub: 1_000_000, term_months: 36, collateral: null, person: true, now: NOW }
  assert.deepEqual(stopFactors({ ...base, plan: null }).map((s) => s.code), ['plan_required'])
  assert.deepEqual(stopFactors({ ...base, plan: { startup_cost_rub: 1_400_000, own_funds_rub: 100_000, monthly_profit_rub: 200_000, monthly_revenue_rub: 800_000 } }).map((s) => s.code), ['own_funds_low'])
})

test('подбор для будущего ИП: продукты Альфы недоступны, «Старт» с пометкой демо', () => {
  const plan = { startup_cost_rub: 1_400_000, own_funds_rub: 500_000, monthly_profit_rub: 200_000, monthly_revenue_rub: 800_000 }
  const items = matchProducts({ purpose: 'new_location', amount_rub: 900_000, term_months: 36, has_collateral: true }, 0, { person: true, plan })
  assert.equal(items[0].product_id, 'start'); assert.ok(items[0].eligible && items[0].demo)
  assert.ok(items.filter((i) => i.product_id !== 'start').every((i) => !i.eligible && !i.demo))
  const noPlan = matchProducts({ purpose: 'new_location', amount_rub: 900_000, term_months: 36, has_collateral: true }, 0, { person: true, plan: null })
  assert.ok(!noPlan.find((i) => i.product_id === 'start').eligible)
})

test('разбор текста: сфера, город, сумма, срок, залог', () => {
  const r = parseNeedText('Хочу открыть вторую пекарню в Казани, нужно 1,5 млн на два года, без залога')
  assert.deepEqual([r.purpose, r.sphere, r.city, r.amount_rub, r.term_months, r.has_collateral], ['new_location', 'bakery', 'Казань', 1_500_000, 24, false])
  assert.equal(parseNeedText('пополнить оборот на 900к').amount_rub, 900_000)
})
