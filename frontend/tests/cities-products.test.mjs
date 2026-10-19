import test from 'node:test'
import assert from 'node:assert/strict'
import { findCities, cities } from '../src/data/cities.ts'
import { matchProducts, alfaProducts } from '../src/data/alfaProducts.ts'
test('South Sakhalinsk is found with incomplete name and without hyphen', () => {
  assert.ok(cities.length > 1000)
  for (const q of ['южно сахалинск', 'ЮЖНО-САХАЛИНСК', 'сахалинск', 'южно']) assert.ok(findCities(q).some(c => c.name === 'Южно-Сахалинск'), q)
  assert.equal(findCities('южно сахалинск')[0].region, 'Сахалинская область')
})
test('ё normalization and duplicate city names with distinct regions', () => {
  assert.ok(findCities('орел').some(c => c.name === 'Орёл'))
  assert.ok(findCities('киров', 30).filter(c => c.name === 'Киров').length >= 2)
  assert.deepEqual(findCities('несуществующийгородабв'), [])
})
test('rejects outdated unsecured limits and terms', () => {
  assert.equal(matchProducts(31_000_000, 24).find(p => p.product.id === 'fast').fits, false)
  assert.equal(matchProducts(1_000_000, 120).find(p => p.product.id === 'fast').fits, false)
  assert.equal(matchProducts(1_000_000, 120).find(p => p.product.id === 'secured').fits, true)
  assert.equal(matchProducts(100_000, 24).find(p => p.product.id === 'fast').fits, false)
})
test('all destinations are official HTTPS product pages without user data', () => {
  for (const p of alfaProducts) {
    const url = new URL(p.url)
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'alfabank.ru')
    assert.ok(url.pathname.startsWith('/sme/profits/')); assert.equal(url.search, '')
  }
})
