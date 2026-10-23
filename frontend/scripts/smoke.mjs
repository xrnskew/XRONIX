// Дымовая проверка кабинета на моках: основные экраны и сценарии, которые уже согласованы и не должны ломаться.
// Запуск: npm run dev -- --port 5199   (в другом окне)   затем   node scripts/smoke.mjs
// Нужен Playwright (SMOKE_URL — другой адрес, SMOKE_CHROMIUM — путь к Chromium). Код выхода 1, если что-то не прошло.
import { existsSync } from 'node:fs'

const BASE = process.env.SMOKE_URL ?? 'http://localhost:5199'
const pw = await import('playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'))
const chromePath = process.env.SMOKE_CHROMIUM ?? ['/opt/pw-browsers/chromium'].find(existsSync)
const browser = await pw.chromium.launch(chromePath ? { executablePath: chromePath } : {})

const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && extra ? ` (${extra})` : ''}`) }
const errors = []
const U = `${BASE}/app`

async function page(width = 1440, height = 1000) {
  const p = await browser.newPage({ viewport: { width, height } })
  p.on('pageerror', (e) => errors.push(e.message))
  return p
}
async function loginClient(p) {
  await p.goto(U); await p.waitForTimeout(700)
  await p.getByRole('button', { name: /Войти/ }).first().click(); await p.getByRole('button', { name: /← Назад/ }).click()
  await p.getByRole('button', { name: /^Клиент/ }).click(); await p.waitForTimeout(1500)
}
const text = (p, sel = 'main') => p.locator(sel).innerText()
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

// --- вход: подписи полей видны
{
  const p = await page(); await p.goto(U); await p.waitForTimeout(700)
  await p.getByRole('button', { name: /Войти/ }).first().click(); await p.waitForTimeout(400)
  check('вход: подписи «Почта» и «Пароль» видны', (await p.locator('label:visible', { hasText: 'Почта' }).count()) > 0 && (await p.locator('label:visible', { hasText: 'Пароль' }).count()) > 0)
  await p.close()
}

// --- клиент: чат, подсказки анкеты, теги ответов, карточка плана, история, панель
{
  const p = await page(); await loginClient(p)
  await p.waitForTimeout(1800) // счётчики и диалоги панели подгружаются отдельным запросом
  const side = await text(p, 'aside')
  check('панель: Новая заявка, План, Финансы и кредит, разделы', /Новая заявка/.test(side) && /\nПлан\n/.test('\n' + side + '\n') && /Финансы и кредит/.test(side) && /БИЗНЕС/i.test(side) && /КРЕДИТ/i.test(side))
  check('панель: счётчик «Заявки» и «Лента»', /Заявки\s*\n?\s*\d/.test(side) && /Лента\s*\n?\s*\d/.test(side))
  await p.goto(`${U}#/chat`); await p.waitForTimeout(800)
  check('чат: статус «готов к диалогу», а не «на связи»', /готов к диалогу/.test(await text(p)) && !/на связи/.test(await text(p)))
  await p.getByPlaceholder('Хочу открыть кофейню с собой').fill('Хочу пекарню в Самаре, своих 900 000'); await p.keyboard.press('Enter'); await p.waitForTimeout(3500)
  const q1 = await text(p)
  check('анкета: подсказка «можно пропустить» и пример в поле', /пропускайте/.test(q1) && (await p.locator('input[placeholder^="Например"]').count()) > 0)
  await p.locator('input[placeholder^="Например"]:enabled').first().fill('900000'); await p.getByRole('button', { name: 'Ответить' }).click(); await p.waitForTimeout(3500)
  await p.getByRole('button', { name: 'Нет опыта' }).click(); await p.getByRole('button', { name: 'Ответить' }).click(); await p.waitForTimeout(5000)
  const chat = await text(p)
  check('ответы анкеты тегами («Опыт: Нет опыта»)', /Опыт:\s*Нет опыта/.test(chat))
  check('карточка «План готов»: цифры, окупаемость, структура бюджета', /План готов/.test(chat) && /Окупаемость/.test(chat) && /Из чего складывается старт/.test(chat))
  check('кнопка «Все диалоги» на десктопе и недавние диалоги в панели', (await p.getByRole('button', { name: 'Все диалоги', exact: true }).count()) > 0 && /НЕДАВНИЕ ДИАЛОГИ/i.test(await text(p, 'aside')))
  await p.getByRole('button', { name: 'Все диалоги', exact: true }).click(); await p.waitForTimeout(900)
  check('список диалогов открывается и содержит диалог', /Диалоги/.test(await text(p)) && /пекарн/i.test(await text(p)))
  await p.getByRole('button', { name: /пекарн/i }).first().click(); await p.waitForTimeout(1200)
  check('диалог из списка открывается', /пекарню в Самаре/.test(await text(p)))
  check('чат: нет горизонтального переполнения', !(await overflow(p)))

  // план и финансы
  await p.locator('aside').getByRole('link', { name: 'План', exact: true }).click(); await p.waitForTimeout(1500)
  const plan = (await text(p)).replace(/\n/g, ' ')
  check('план: якоря разделов, налоги, график', /Бюджет\s+Выручка\s+Шаги\s+Риски\s+Налоги/.test(plan) && /346\.20/.test(plan) && /₽ в месяц, по месяцам года/.test(plan))
  await p.locator('aside').getByRole('link', { name: /Финансы/ }).click(); await p.waitForTimeout(1200)
  check('финансы открываются из панели', /Откуда взять/.test(await text(p)))

  // мастер заявки
  await p.goto(`${U}#/new`); await p.waitForTimeout(1200)
  const goal = await text(p)
  check('новая заявка: «Шаг 1 из 5–6», кнопка по плану, три карточки', /Шаг 1 из 5–6/.test(goal) && /Подать заявку по этому плану/.test(goal) && /кредит на текущие задачи/.test(goal) && /новую точку/.test(goal) && /Бизнеса пока нет/.test(goal))
  await p.getByRole('button', { name: /Бизнеса пока нет/ }).click(); await p.waitForTimeout(1200)
  check('«Бизнеса пока нет» открывает новый чат', p.url().endsWith('/chat') && /Какой бизнес хотите открыть/.test(await text(p)))
  await p.waitForTimeout(1200)
  await p.locator('aside').getByRole('link', { name: 'План', exact: true }).click(); await p.waitForTimeout(1500)
  check('после нового чата «План» в меню по-прежнему открывает последний план', /Пекарня/.test(await text(p)) && !/Плана пока нет/.test(await text(p)))
  await p.goto(`${U}#/new`); await p.waitForTimeout(900)
  await p.getByRole('button', { name: /Подать заявку по этому плану/ }).click(); await p.waitForTimeout(1200)
  const wiz = (await text(p)).replace(/\n+/g, ' ')
  check('кнопка по плану: шаги Цель → Основатель, без «Проект»', /Основатель/.test(wiz) && !/Цель\s+\d\s+Проект/.test(wiz))
  const reset = p.getByRole('button', { name: 'Начать заново' })
  const resetStyle = await reset.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, deco: c.textDecorationLine } })
  check('«Начать заново» выглядит как кнопка (фон, без подчёркивания)', resetStyle.bg !== 'rgba(0, 0, 0, 0)' && resetStyle.deco === 'none', JSON.stringify(resetStyle))
  await p.goto(`${U}#/profile`); await p.waitForTimeout(600); await p.goto(`${U}#/new`); await p.waitForTimeout(900)
  check('возврат в мастер: тот же шаг «Основатель»', /Основатель/.test(await text(p)))
  await p.getByRole('button', { name: /Подставить тестовый/ }).click(); await p.waitForTimeout(300)
  await p.getByRole('button', { name: 'Продолжить' }).click(); await p.waitForTimeout(1500)
  const need = await text(p)
  check('«Что нужно»: цель, сумма и срок подписаны «Рекомендовано по вашему плану»', (need.match(/Рекомендовано по вашему плану/g) || []).length === 3)
  await p.locator('#amount').fill('1000000'); await p.waitForTimeout(300)
  check('«Что нужно»: изменили сумму — «По плану рекомендовано» и «Вернуть»', /По плану рекомендовано/.test(await text(p)) && (await p.getByRole('button', { name: 'Вернуть' }).count()) === 1)
  await p.getByRole('button', { name: /Подробный расчёт/ }).click(); await p.waitForTimeout(1300)
  check('«Подробный расчёт» открывает «Финансы и кредит»', /Откуда взять/.test(await text(p)))
  await p.goto(`${U}#/new`); await p.waitForTimeout(1000)
  check('из финансов возврат в мастер на тот же шаг', /На что нужны деньги/.test(await text(p)))

  // подбор продукта: заметное «подходящего кредита нет», причины с действиями, пересчёт плана при изменении своих средств
  await p.locator('#amount').fill('5000000'); await p.getByRole('button', { name: 'Подобрать кредит' }).click(); await p.waitForTimeout(2500)
  const noFit = await text(p)
  check('подбор: заметное уведомление «Подходящего кредита пока нет» и главные причины', /Подходящего кредита пока нет/.test(noFit) && /Сумма вне допустимого диапазона/.test(noFit) && /Нужен залог или поручитель/.test(noFit))
  check('подбор: причины отказа с иконками и действиями («Добавить залог →»)', /Можно исправить/.test(noFit) && /Добавить залог →/.test(noFit) && /Не зависит от суммы, срока и залога/.test(noFit))
  await p.getByRole('button', { name: 'Изменить свои средства', exact: true }).first().click(); await p.waitForTimeout(400)
  await p.locator('#own-funds').fill('90000'); await p.getByRole('button', { name: 'Пересчитать план' }).click(); await p.waitForTimeout(3500)
  const replan = await text(p)
  check('свои средства: план пересчитан на 90 000 ₽, появилась причина «Не хватает своих денег»', /План пересчитан: своих 90\s000/.test(replan) && /Не хватает своих денег/.test(replan))
  await p.getByRole('button', { name: 'Изменить свои средства', exact: true }).first().click(); await p.waitForTimeout(400)
  await p.getByRole('button', { name: /^Указать/ }).first().click(); await p.getByRole('button', { name: 'Пересчитать план' }).click(); await p.waitForTimeout(3500)
  check('«Указать нужную сумму» и пересчёт: причина про свои деньги ушла', !/Не хватает своих денег/.test(await text(p)))
  await p.goto(`${U}#/finance`); await p.waitForTimeout(1500)
  await p.getByRole('button', { name: 'Изменить свои средства' }).first().click(); await p.waitForTimeout(400)
  await p.locator('#own-funds').fill('800000'); await p.getByRole('button', { name: 'Пересчитать план' }).click(); await p.waitForTimeout(3500)
  check('«Финансы и кредит»: свои средства меняются и пересчитывают план', /800\s000/.test(await text(p)) && /План пересчитан/.test(await text(p)))
  // рассинхрон: старый чат хранит прежний план, а после пересчёта везде должен быть актуальный
  await p.goto(`${U}#/chat`); await p.waitForTimeout(900)
  await p.getByRole('button', { name: 'Все диалоги', exact: true }).click(); await p.waitForTimeout(900)
  await p.getByRole('button', { name: /пекарн/i }).first().click(); await p.waitForTimeout(2200)
  check('старый чат после пересчёта: карточка плана показывает актуальные цифры', /План обновлён: свои деньги 800\s000/.test(await text(p)))
  await p.locator('aside').getByRole('link', { name: /Финансы/ }).click(); await p.waitForTimeout(1500)
  const fin = (await text(p)).replace(/\n/g, ' ')
  check('«Финансы и кредит» после открытия старого чата не откатываются на прежнюю сумму', /Свои средства\s+800\s000/.test(fin))
  await p.getByRole('button', { name: 'Начать заново' }).count()
  await p.close()
}

// --- аналитик: очередь, карточка, сводка
{
  const p = await page(); await p.goto(U); await p.waitForTimeout(700)
  await p.getByRole('button', { name: /Аналитик банка/ }).click(); await p.waitForTimeout(1800)
  const q = await text(p)
  check('очередь: вкладки со счётчиками', /Ждут решения\s*\d/.test(q) && /Все\s*\d/.test(q))
  await p.getByRole('link', { name: /Z-2026/ }).first().click(); await p.waitForTimeout(1500)
  const card = await text(p)
  check('карточка заявки: рекомендация, решение, скоринг', /Рекомендация системы/.test(card) && /Решение/.test(card) && /Скоринг/.test(card))
  await p.goto(`${U}#/bank/stats`); await p.waitForTimeout(1200)
  check('сводка: легенда по смыслу статусов', /ждём клиента/.test(await text(p)) && /одобрено и выдано/.test(await text(p)))
  await p.close()
}

// --- адаптив: телефонная ширина без переполнения на ключевых экранах
{
  const p = await page(390, 844); await loginClient(p)
  let bad = []
  for (const r of ['#/chat', '#/plan', '#/finance', '#/applications', '#/new', '#/feed', '#/profile']) {
    await p.goto(`${U}${r}`); await p.waitForTimeout(900)
    if (await overflow(p)) bad.push(r)
  }
  check('390 px: нет горизонтального переполнения', bad.length === 0, bad.join(', '))
  await p.close()
}

check('нет ошибок JavaScript на страницах', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} из ${results.length} проверок прошли`)
process.exit(failed.length ? 1 : 0)
