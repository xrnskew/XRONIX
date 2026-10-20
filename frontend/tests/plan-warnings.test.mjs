import test from 'node:test'
import assert from 'node:assert/strict'
import { unconfirmedMetro } from '../src/lib/planWarnings.ts'
test('historical metro assumptions remain visible as unverified rather than silently rewritten', () => {
  assert.equal(unconfirmedMetro({ business: { city: 'Южно-Сахалинск' }, summary: 'Кофейня у метро' }), true)
  assert.equal(unconfirmedMetro({ business: { city: 'Южно-Сахалинск' }, summary: 'Кофейня у остановки' }), false)
  assert.equal(unconfirmedMetro({ business: { city: 'Санкт-Петербург' }, summary: 'Кофейня у метро' }), false)
})
