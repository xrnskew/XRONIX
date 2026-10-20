import test from 'node:test'
import assert from 'node:assert/strict'
import { creditParameters, creditAssessment } from '../src/lib/credit.ts'
import { alfaProducts } from '../src/data/alfaProducts.ts'
const fast = alfaProducts.find(p => p.id === 'fast')
test('credit inputs and calculation use a single value within the selected product range', () => {
  const p = creditParameters(fast, 30_000, 120)
  assert.equal(p.amount, fast.amountMin)
  assert.equal(p.months, fast.termMax)
  assert.ok(p.amount >= 30_000)
})
test('out-of-range product never receives a favourable verdict despite a small payment', () => {
  assert.equal(creditAssessment(fast, 1_200_000, 120, 17).tone, 'warn')
  assert.equal(creditAssessment(fast, 30_000, 36, 1).tone, 'warn')
  assert.equal(creditAssessment(fast, 1_200_000, 48, 26).text, 'Нагрузка умеренная')
})
test('switching product clamps both term and amount and keeps boundary values valid', () => {
  for (const product of alfaProducts) {
    const low = creditParameters(product, -1, 0), high = creditParameters(product, Number.MAX_SAFE_INTEGER, 1000)
    assert.equal(low.amount, product.amountMin ?? 1)
    assert.equal(low.months, product.termMin ?? 1)
    assert.equal(high.amount, product.amountMax)
    assert.equal(high.months, product.termMax)
  }
})
