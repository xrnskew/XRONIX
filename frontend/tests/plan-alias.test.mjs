import test from 'node:test'
import assert from 'node:assert/strict'

// заглушка localStorage: в Node его нет
const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
const { latestPlanId, recordSuccessor, knownPlan } = await import('../src/lib/planAlias.ts')

test('latestPlanId: без пересчёта план остаётся тем же', () => {
  assert.equal(latestPlanId('a1'), 'a1')
})

test('recordSuccessor: прежний план ведёт на пересчитанный, цепочка идёт до последнего', () => {
  recordSuccessor('a', 'b', { title: 'Пересчитанный' })
  assert.equal(latestPlanId('a'), 'b')
  recordSuccessor('b', 'c')
  assert.equal(latestPlanId('a'), 'c')
  assert.equal(latestPlanId('b'), 'c')
  assert.equal(knownPlan('b').title, 'Пересчитанный')
  assert.equal(knownPlan('zzz'), null)
})

test('recordSuccessor: тот же id не создаёт связь, цикл не зацикливает', () => {
  recordSuccessor('x', 'x')
  assert.equal(latestPlanId('x'), 'x')
  recordSuccessor('p', 'q'); recordSuccessor('q', 'p')
  assert.ok(['p', 'q'].includes(latestPlanId('p')))
})

test('latestPlanId переживает перезагрузку: связь читается из localStorage', () => {
  recordSuccessor('old-1', 'new-1')
  assert.match(store.get('xronix_plan_aliases'), /"old-1":"new-1"/)
  assert.equal(latestPlanId('old-1'), 'new-1')
})
