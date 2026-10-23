import test from 'node:test'
import assert from 'node:assert/strict'
import { unconfirmedMetro } from '../src/lib/planWarnings.ts'
test('historical metro assumptions remain visible as unverified rather than silently rewritten', () => {
  assert.equal(unconfirmedMetro({ business: { city: 'Южно-Сахалинск' }, summary: 'Кофейня у метро' }), true)
  assert.equal(unconfirmedMetro({ business: { city: 'Южно-Сахалинск' }, summary: 'Кофейня у остановки' }), false)
  assert.equal(unconfirmedMetro({ business: { city: 'Санкт-Петербург' }, summary: 'Кофейня у метро' }), false)
})

test('isLossMaking: прибыль не больше нуля — убыточный план, положительная — нет', async () => {
  const { isLossMaking } = await import('../src/lib/planWarnings.ts')
  const plan = (profit) => ({ finance: { monthly_profit_rub: profit } })
  assert.equal(isLossMaking(plan(-674721)), true)
  assert.equal(isLossMaking(plan(0)), true)
  assert.equal(isLossMaking(plan(442365)), false)
})
