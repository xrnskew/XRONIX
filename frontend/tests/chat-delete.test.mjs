import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
const { deleteFailure, DELETE_TEXT } = await import('../src/lib/chatErrors.ts')
const { hideChat, isHiddenChat } = await import('../src/lib/hiddenChats.ts')

test('deleteFailure: заявка по плану диалога, занятый ответом диалог и прочее', () => {
  assert.equal(deleteFailure({ code: 'INVALID_TRANSITION' }), 'protected')
  assert.equal(deleteFailure({ code: 'RATE_LIMITED' }), 'busy')
  assert.equal(deleteFailure({ code: 'NETWORK' }), 'other')
  assert.equal(deleteFailure(new Error('x')), 'other')
  assert.equal(deleteFailure(null), 'other')
})

test('тексты отказа понятны человеку и не повторяют общий ответ сервера', () => {
  assert.match(DELETE_TEXT.protected, /оформлена заявка/)
  assert.match(DELETE_TEXT.protected, /убрать диалог из списка/)
  assert.doesNotMatch(Object.values(DELETE_TEXT).join(' '), /для этой роли/)
})

test('hideChat: скрытый диалог запоминается и переживает перезагрузку', () => {
  assert.equal(isHiddenChat('c1'), false)
  hideChat('c1'); hideChat('c1'); hideChat('c2')
  assert.equal(isHiddenChat('c1'), true)
  assert.equal(isHiddenChat('c3'), false)
  assert.deepEqual(JSON.parse(store.get('xronix_hidden_chats')), ['c1', 'c2'])
})
