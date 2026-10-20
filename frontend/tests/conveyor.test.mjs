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
