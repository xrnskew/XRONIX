import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyReason, sortedReasons, summarizeBlockers } from '../src/lib/creditReasons.ts'
import { answersFromChat, inferTemplate } from '../src/lib/replanCore.ts'
import { templates } from '../src/lib/projectCalc.ts'

test('classifyReason: что можно исправить, что зависит от типа бизнеса', () => {
  assert.deepEqual(classifyReason('Сумма должна быть от 100 000 ₽ до 3 000 000 ₽.'), { kind: 'amount', level: 'fix' })
  assert.deepEqual(classifyReason('Срок должен быть от 12 до 60 мес.'), { kind: 'term', level: 'fix' })
  assert.equal(classifyReason('Нужен залог: недвижимость, оборудование или транспорт.').kind, 'collateral')
  assert.equal(classifyReason('Нужен залог или поручитель.').level, 'fix')
  assert.equal(classifyReason('Подходит только для покупки недвижимости.').kind, 'purpose')
  assert.equal(classifyReason('Линия для пополнения оборота.').level, 'fix')
  assert.equal(classifyReason('Нужен расчёт проекта: посчитайте его в чате или в мастере.').kind, 'plan')
  assert.equal(classifyReason('Продукт для действующего бизнеса: нужны зарегистрированные ИП или компания.').level, 'structural')
  assert.equal(classifyReason('Бизнес должен работать не меньше 9 месяцев, у вас 3 мес.').kind, 'age')
  assert.equal(classifyReason('Акция закончилась 15 ноября.').kind, 'expired')
  assert.equal(classifyReason('Заявку на этот продукт в демо оформляет менеджер банка.').level, 'info')
  assert.equal(classifyReason('что-то неизвестное').level, 'structural')
})

test('classifyReason: сколько своих денег нужно берётся из текста причины', () => {
  const r = classifyReason('Своих денег должно быть не меньше 20% стоимости запуска: 760 000 ₽, у вас 90 000 ₽.')
  assert.equal(r.kind, 'own_funds'); assert.equal(r.ownFundsNeeded, 760000)
  assert.equal(classifyReason('Своих денег должно быть не меньше 20% стоимости запуска: 1 520 000 ₽, у вас 0 ₽.').ownFundsNeeded, 1520000)
})

test('sortedReasons и summarizeBlockers: исправимое выше, считаются только исправимые причины', () => {
  const items = [
    { reasons: ['Продукт для действующего бизнеса: нужны зарегистрированные ИП или компания.', 'Нужен залог: недвижимость, оборудование или транспорт.'] },
    { reasons: ['Нужен залог или поручитель.', 'Своих денег должно быть не меньше 20% стоимости запуска: 760 000 ₽, у вас 90 000 ₽.'] },
    { reasons: ['Заявку на этот продукт в демо оформляет менеджер банка.'] },
  ]
  assert.equal(sortedReasons(items[0].reasons)[0].kind, 'collateral')
  const b = summarizeBlockers(items)
  assert.deepEqual(b.map((x) => [x.kind, x.count]), [['collateral', 2], ['own_funds', 1]])
  assert.equal(b[1].ownFundsNeeded, 760000)
})

test('inferTemplate: сфера по названию плана', () => {
  const t = templates()
  assert.equal(inferTemplate(t, { title: 'Пекарня, Самара', business: { sphere: 'Общепит', format: 'Пекарня', city: 'Самара' } })?.sphere, 'bakery')
  assert.equal(inferTemplate(t, { title: 'Кофейня у метро', business: { sphere: 'Общепит', format: 'Кофе с собой', city: 'Москва' } })?.sphere, 'coffee')
  assert.equal(inferTemplate(t, { title: 'Что-то своё', business: { sphere: 'x', format: 'y', city: 'z' } }), null)
})

test('answersFromChat: ответы анкеты по шаблону, мусор и значения вне границ отбрасываются', () => {
  const bakery = templates().find((x) => x.sphere === 'bakery')
  const msgs = [
    { answers: [{ question_id: 'area_m2', answer: '100' }, { question_id: 'customers_per_day', answer: '1 200' }, { question_id: 'avg_check_rub', answer: 'не знаю' }] },
    { answers: [{ question_id: 'area_m2', answer: '55 м²' }, { question_id: 'experience', answer: 'Нет опыта' }, { question_id: 'staff', answer: '99999' }] },
  ]
  assert.deepEqual(answersFromChat(msgs, bakery), { area_m2: 55, customers_per_day: 1200 })
})
