import test from 'node:test'
import assert from 'node:assert/strict'
import { detectSphere, hintFor } from '../src/lib/questionHints.ts'

test('detectSphere: сфера по словам человека, неоднозначные фразы не считаются', () => {
  assert.equal(detectSphere(['Хочу пекарню в Самаре, своих 900 000']), 'bakery')
  assert.equal(detectSphere(['Хочу открыть: автомойка']), 'car_wash')
  assert.equal(detectSphere(['кофейня или пекарня, пока не решил']), null)
  assert.equal(detectSphere(['кофейня или пекарня', 'Кофейня']), 'coffee')
  assert.equal(detectSphere(['привет']), null)
})

test('hintFor: числа подсказки совпадают с шаблоном сферы', () => {
  const h = hintFor({ id: 'avg_check_rub' }, 'bakery')
  assert.match(h.placeholder, /^Например, 320$/)
  assert.match(h.hint, /около 320 ₽/)
  assert.match(h.hint, /допустимо 100–5\s000/)
  assert.match(hintFor({ id: 'area_m2' }, 'bakery').hint, /около 40 м²/)
})

test('hintFor: без сферы — смысл поля без чисел; для остальных вопросов подсказки нет', () => {
  const h = hintFor({ id: 'customers_per_day' }, null)
  assert.match(h.hint, /покупатели в день × средний чек/)
  assert.doesNotMatch(h.hint, /около/)
  assert.deepEqual(hintFor({ id: 'something_else' }, 'bakery'), { placeholder: 'Ваш ответ', hint: null })
})
