// Простой разбор текста предпринимателя правилами: запасной вариант, пока модель Дани недоступна (мок-режим).
import { cities, normalizeCity } from '../data/cities.ts'
import type { ParsedNeed, Purpose, Sphere } from '../types/conveyor.ts'
import type { Experience } from '../types/plan.ts'

export const PURPOSE_WORDS: [Purpose, RegExp][] = [
  ['new_location', /втор(ую|ой|ое)|ещё одн|еще одн|нов(ую|ой) точк|открыть|филиал/i], ['equipment', /оборудован|станок|кофемашин|печь|техник/i],
  ['real_estate', /помещени|недвижим|купить офис|склад в собственность/i], ['refinance', /рефинанс|перекредит/i],
  ['new_direction', /нов(ое|ый) направлени|запустить доставк|новый продукт/i], ['working_capital', /оборот|закупк|товар|зарплат/i],
]
export const SPHERE_WORDS: [Sphere, RegExp][] = [['coffee', /кофе/i], ['bakery', /пекарн|выпечк|хлеб/i], ['car_wash', /мойк/i], ['clothing_store', /одежд|шоурум/i], ['beauty_salon', /салон|парикмахер|маникюр|барбер/i], ['pickup_point', /пункт выдачи|пвз/i]]
const byPopulation = [...cities].sort((a, b) => b.population - a.population)
export function parseAmount(t: string): number | null {
  const s = t.toLowerCase().replace(/\s+/g, ' ')
  if (/полтора (ляма|млн|миллиона)/.test(s)) return 1_500_000
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(млн|миллион\w*|лям\w*|тыс\w*|к(?![а-яё])|т\.р)/)
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * (/^(млн|милл|лям)/.test(m[2]) ? 1_000_000 : 1000))
  const n = s.match(/(\d[\d ]{4,})\s*(₽|руб)/)
  return n ? Number(n[1].replace(/ /g, '')) : null
}
export function parseTerm(t: string): number | null {
  const m = t.toLowerCase().match(/(\d+|год|два|три|пять)\s*(год|года|лет|мес)/)
  if (!m) return /на год(?![а-яё])/i.test(t) ? 12 : null
  const n = ({ год: 1, два: 2, три: 3, пять: 5 } as Record<string, number>)[m[1]] ?? Number(m[1])
  return m[2].startsWith('мес') ? n : n * 12
}


// «в Казани» → «Казань»: ищем основу названия с начала слова, крупные города первыми
export function findCity(text: string): string | null {
  const words = ' ' + normalizeCity(text) + ' '
  return byPopulation.find((c) => c.name.length > 4 && words.includes(' ' + normalizeCity(c.name).slice(0, -1)))?.name ?? null
}

export function parseNeedText(text: string): ParsedNeed {
  const r: ParsedNeed = { purpose: null, sphere: null, city: null, amount_rub: null, term_months: null, has_collateral: null, confidence: {} }
  const p = PURPOSE_WORDS.find(([, re]) => re.test(text)); if (p) { r.purpose = p[0]; r.confidence.purpose = 0.75 }
  const s = SPHERE_WORDS.find(([, re]) => re.test(text)); if (s) { r.sphere = s[0]; r.confidence.sphere = 0.9 }
  r.city = findCity(text); if (r.city) r.confidence.city = 0.85
  r.amount_rub = parseAmount(text); if (r.amount_rub) r.confidence.amount_rub = 0.8
  r.term_months = parseTerm(text); if (r.term_months) r.confidence.term_months = 0.65
  if (/без залога/i.test(text)) { r.has_collateral = false; r.confidence.has_collateral = 0.9 } else if (/залог|поручител/i.test(text)) { r.has_collateral = true; r.confidence.has_collateral = 0.6 }
  return r
}

// Ответ на вопрос «Есть ли у вас опыт в этом бизнесе?» → значение state.experience (contracts/ai.md, правило 9).
// Подписи вариантов из dictionaries.experiences и обычные слова; непонятный ответ — null.
export const EXPERIENCE_OPTIONS = ['Нет опыта', 'Работал наёмным', 'Был свой бизнес']
export function parseExperience(text: string): Experience | null {
  const t = text.toLowerCase().replace(/ё/g, 'е')
  if (/(был|была|есть|имел\w*|открывал\w*|владел\w*)\s+(свой|своя|свое|свою)\s+(бизнес|дел\w*|кофейн\w*|точк\w*)|свой бизнес|владелец|владел/.test(t)) return 'owner'
  if (/наемн|работал|работала|сотрудник|бариста|менеджер/.test(t)) return 'employee'
  if (/нет опыта|без опыта|опыта нет|новичок|не было|впервые|^\s*нет\W*$/.test(t)) return 'none'
  return null
}
