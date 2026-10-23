import test from 'node:test'
import assert from 'node:assert/strict'
import { shortParts } from '../src/lib/format.ts'

test('shortParts: прибыль в млн, тыс и рублях', () => {
  assert.deepEqual(shortParts(3_058_000), { value: '3,1', unit: 'млн ₽' })
  assert.deepEqual(shortParts(442_365), { value: '442', unit: 'тыс ₽' })
  assert.deepEqual(shortParts(900), { value: '900', unit: '₽' })
})

test('shortParts: убыток со знаком «−» и теми же единицами, без сырого «-674721»', () => {
  assert.deepEqual(shortParts(-674_721), { value: '−675', unit: 'тыс ₽' })
  assert.deepEqual(shortParts(-1_500_000), { value: '−1,5', unit: 'млн ₽' })
  assert.deepEqual(shortParts(-400), { value: '−400', unit: '₽' })
  assert.deepEqual(shortParts(0), { value: '0', unit: '₽' })
})
