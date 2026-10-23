import test from 'node:test'
import assert from 'node:assert/strict'
import { CabinetSession } from '../src/phone/session.ts'
import { submittedAnswers } from '../src/phone/answers.ts'

const greeting = { id: 'g', role: 'assistant', text: 'Здравствуйте' }
const planReply = (name) => ({ type: 'plan', text: 'Готово', plan_id: name, plan: { title: name } })
const detail = (id) => ({ id, messages: [{ id: `${id}-reply`, role: 'assistant', reply: planReply(id) }] })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function create(overrides = {}) {
  let id = 0
  const api = { createChat: async () => ({ chat_id: `chat-${++id}` }), getChat: async (id) => detail(id), deleteChat: async () => {}, sendMessage: async () => planReply('default'), listPlans: async () => [], getPlan: async (id) => ({ plan_id: id, chat_id: 'record-chat', plan: { title: id } }), ...overrides }
  return new CabinetSession(api, greeting, (e) => e.message)
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('opening an older chat selects its plan, not the last generated plan', async () => {
  const s = create()
  await s.openChat('bakery'); await s.openChat('coffee')
  assert.equal(s.getSnapshot().plan.title, 'coffee')
  assert.equal(s.getSnapshot().planId, 'coffee')
  await s.openPlan('earlier', { title: 'earlier' })
  assert.equal(s.getSnapshot().planId, 'earlier')
  assert.equal(s.getSnapshot().plan.title, 'earlier')
})
test('a chat with no plan never inherits another chat plan', async () => {
  const s = create({ getChat: async (id) => id === 'empty' ? { id, messages: [] } : detail(id) })
  await s.openChat('coffee'); await s.openChat('empty')
  assert.equal(s.getSnapshot().plan, null)
})
test('late replies stay in their original conversation; a new chat can send independently', async () => {
  const coffee = deferred(), bakery = deferred()
  const s = create({ sendMessage: (id) => id === 'chat-1' ? coffee.promise : bakery.promise })
  const first = s.send('coffee'); await tick()
  s.newChat()
  assert.equal(s.getSnapshot().busy, false)
  const second = s.send('bakery'); await tick()
  coffee.resolve(planReply('coffee')); await first
  assert.equal(s.getSnapshot().busy, true)
  assert.equal(s.getSnapshot().plan, null)
  assert.equal(s.getSnapshot().messages.length, 2)
  bakery.resolve(planReply('bakery')); await second
  assert.equal(s.getSnapshot().plan.title, 'bakery')
  await s.openChat('chat-1')
  assert.equal(s.getSnapshot().plan.title, 'chat-1') // refreshed persisted conversation
})
test('returning to a pending conversation restores busy and receives only its own reply', async () => {
  const result = deferred()
  const s = create({ sendMessage: () => result.promise, getChat: async () => { throw Error('must not overwrite a pending request') } })
  const request = s.send('coffee'); await tick()
  s.newChat(); await s.openChat('chat-1')
  assert.equal(s.getSnapshot().busy, true)
  assert.equal(s.getSnapshot().messages[1].text, 'coffee')
  result.resolve(planReply('coffee')); await request
  assert.equal(s.getSnapshot().plan.title, 'coffee')
  assert.equal(s.getSnapshot().busy, false)
})
test('a late error does not add retry or error UI to a different chat', async () => {
  const result = deferred(); const s = create({ sendMessage: () => result.promise })
  const request = s.send('coffee'); await tick(); s.newChat()
  result.reject(Error('offline')); await request
  assert.equal(s.getSnapshot().canRetry, false)
  assert.deepEqual(s.getSnapshot().messages, [greeting])
})
test('reset invalidates pending creation, replies and selected-plan loads', async () => {
  const creation = deferred(); let sent = false
  const s = create({ createChat: () => creation.promise, sendMessage: async () => { sent = true; return planReply('old') } })
  const request = s.send('old session'); s.reset()
  creation.resolve({ chat_id: 'old' }); await request
  assert.equal(sent, false)
  assert.equal(s.getSnapshot().chatId, null)
  const response = deferred(); const p = create({ getPlan: () => response.promise })
  const load = p.openPlan('private'); p.reset()
  response.resolve({ chat_id: 'private', plan: { title: 'private' } }); await load
  assert.equal(p.getSnapshot().plan, null)
})
test('last navigation wins when chat requests complete out of order', async () => {
  const first = deferred(), second = deferred()
  const s = create({ getChat: (id) => id === 'first' ? first.promise : second.promise })
  const a = s.openChat('first'), b = s.openChat('second')
  second.resolve(detail('second')); assert.equal(await b, true)
  first.resolve(detail('first')); assert.equal(await a, false)
  assert.equal(s.getSnapshot().chatId, 'second')
  assert.equal(s.getSnapshot().plan.title, 'second')
})
test('a failed plan deep link clears stale data and retries the same plan', async () => {
  let succeeds = false; const ids = []
  const s = create({ getPlan: async (id) => { ids.push(id); if (!succeeds) throw Error('Not found'); return { chat_id: 'c', plan: { title: id } } } })
  await s.openChat('coffee'); await s.openPlan('missing')
  assert.equal(s.getSnapshot().plan, null)
  assert.equal(s.getSnapshot().planError, 'Not found')
  succeeds = true; await s.reloadPlan()
  assert.deepEqual(ids, ['missing', 'missing'])
  assert.equal(s.getSnapshot().plan.title, 'missing')
})
test('duplicate send is guarded synchronously before React rerenders', async () => {
  const response = deferred(); let count = 0
  const s = create({ sendMessage: () => { count++; return response.promise } })
  const a = s.send('first'), b = s.send('duplicate'); await tick()
  assert.equal(count, 1)
  response.resolve(planReply('first')); await Promise.all([a, b])
  assert.equal(s.getSnapshot().messages.filter(m => m.role === 'user').length, 1)
})
test('saved questionnaires recover their selected answers without changing the API contract', () => {
  const question = { id: 'q', role: 'assistant', reply: { type: 'questions', questions: [{ id: 'credit', text: 'Нужен кредит?' }] } }
  assert.deepEqual(submittedAnswers([question, { role: 'user', text: 'Нужен кредит? Нет' }], 0), { credit: 'Нет' })
  assert.deepEqual(submittedAnswers([question, { role: 'user', text: 'custom', answers: [{ question_id: 'credit', answer: 'Нет' }] }], 0), { credit: 'Нет' })
  assert.deepEqual(submittedAnswers([question], 0), {})
})

test('a refreshed session resumes a persisted job without sending it again', async () => {
  const pending = deferred(); let finished = false, sends = 0
  const questions = { id: 'questions', role: 'assistant', reply: { type: 'questions', questions: [{ id: 'place', text: 'Помещение?' }] } }
  const user = { id: 'answer', role: 'user', reply: { type: 'message', text: 'Гараж' }, answers: [{ question_id: 'place', answer: 'Гараж' }] }
  const s = create({
    getChat: async (id) => ({ id, messages: finished ? [questions, user, ...detail(id).messages] : [questions, user], generation: finished ? null : { id: 'job', status: 'running', request_id: 'stable-request-id', request: { text: 'Гараж', answers: user.answers } } }),
    waitGeneration: async () => { await pending.promise; finished = true; return planReply('resumed') },
    sendMessage: async () => { sends++; return planReply('duplicate') },
  })
  await s.openChat('saved')
  assert.equal(s.getSnapshot().busy, true)
  assert.deepEqual(s.getSnapshot().messages.at(-1).answers, user.answers)
  pending.resolve(); await tick(); await tick()
  assert.equal(s.getSnapshot().busy, false)
  assert.equal(s.getSnapshot().planId, 'saved')
  assert.equal(sends, 0)
  assert.equal(s.getSnapshot().messages.filter(m => m.role === 'user').length, 1)
})

test('a resumed job cannot publish into a new login or another visible chat', async () => {
  const pending = deferred()
  const s = create({ getChat: async (id) => ({ ...detail(id), generation: { id: 'job', status: 'running', request: { text: 'idea', answers: [] } } }), waitGeneration: () => pending.promise })
  await s.openChat('old')
  s.reset()
  pending.resolve(planReply('private')); await tick(); await tick()
  assert.equal(s.getSnapshot().chatId, null)
  assert.equal(s.getSnapshot().plan, null)
  assert.deepEqual(s.getSnapshot().messages, [greeting])
})

test('retry after an uncertain network result reuses its idempotency key', async () => {
  const keys = []; let attempt = 0
  const s = create({ sendMessage: async (id, text, answers, key) => {
    keys.push(key)
    if (!attempt++) throw Object.assign(Error('offline'), { code: 'NETWORK' })
    return planReply('once')
  } })
  await s.send('idea'); await s.retry()
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  assert.equal(s.getSnapshot().planId, 'once')
})

test('retry after a confirmed server failure creates a new attempt', async () => {
  const keys = []; let attempt = 0
  const s = create({ sendMessage: async (id, text, answers, key) => {
    keys.push(key)
    if (!attempt++) throw Object.assign(Error('failed'), { code: 'AI_UNAVAILABLE' })
    return planReply('retry')
  } })
  await s.send('idea'); await s.retry()
  assert.notEqual(keys[0], keys[1])
})

test('uid works without crypto.randomUUID (plain http on a LAN address is not a secure context)', async () => {
  const { uid } = await import('../src/lib/uid.ts')
  const original = crypto.randomUUID
  try {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    const ids = new Set(Array.from({ length: 50 }, uid))
    assert.equal(ids.size, 50)
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  } finally {
    Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true })
  }
})

test('чат без сообщений, но с планом (его создаёт сервер при пересчёте) открывается карточкой плана, а не пустым экраном', async () => {
  const s = create({
    getChat: async (id) => id === 'plan-only' ? { id, messages: [] } : detail(id),
    listPlans: async () => [{ plan_id: 'p-recalc', chat_id: 'plan-only', title: 'Кофейня, Самара', created_at: '' }],
    getPlan: async (id) => ({ plan_id: id, chat_id: 'plan-only', created_at: '', plan: { title: 'Пересчитанный' } }),
  })
  await s.openChat('plan-only')
  const snap = s.getSnapshot()
  assert.equal(snap.messages.at(-1).reply.type, 'plan')
  assert.equal(snap.planId, 'p-recalc')
  assert.equal(snap.plan.title, 'Пересчитанный')
})

test('пустой чат без плана остаётся пустым, сбой запроса планов его не ломает', async () => {
  const s = create({ getChat: async (id) => ({ id, messages: [] }), listPlans: async () => { throw new Error('offline') } })
  await s.openChat('empty')
  assert.equal(s.getSnapshot().plan, null)
  assert.equal(s.getSnapshot().messages.length, 1) // только приветствие
})
