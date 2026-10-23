import spheres from '../data/spheres.v1.json' with { type: 'json' }
import type { Question } from '../types/plan'

// Подсказки к вопросам анкеты в чате: что значит поле и какое значение типично для сферы.
// Числа берём из шаблонов (contracts/templates/spheres.v1.json), поэтому подсказка не расходится с расчётом плана.
type TemplateQuestion = { id: string; kind: string; unit?: string; default?: number; min?: number; max?: number }
const defs = spheres.spheres as unknown as Record<string, { title: string; questions: TemplateQuestion[] }>

const STEMS: [string, RegExp][] = [
  ['bakery', /пекарн|булочн|выпечк/i],
  ['coffee', /кофейн|кофе с собой|кофе-?точк/i],
  ['car_wash', /автомойк|мойк/i],
  ['clothing_store', /одежд|шоурум/i],
  ['beauty_salon', /салон красоты|барбершоп|парикмахерск|маникюр|красот/i],
  ['pickup_point', /пункт выдачи|пвз|маркетплейс/i],
]

// Сфера по репликам человека: берём самую свежую реплику, где упомянута ровно одна сфера («кофейня или пекарня» не считается)
export function detectSphere(userTexts: string[]): string | null {
  for (let i = userTexts.length - 1; i >= 0; i--) {
    const found = STEMS.filter(([, re]) => re.test(userTexts[i])).map(([key]) => key)
    if (found.length === 1) return found[0]
  }
  return null
}

const MEANING: Record<string, string> = {
  area_m2: 'От площади зависят аренда и ремонт.',
  customers_per_day: 'Выручка в месяц = покупатели в день × средний чек × 30.',
  avg_check_rub: 'Сколько рублей в среднем тратит один покупатель.',
}
const nf = new Intl.NumberFormat('ru-RU')

export interface QuestionHint { placeholder: string; hint: string | null }

export function hintFor(q: Pick<Question, 'id'>, sphere: string | null): QuestionHint {
  const t = sphere ? defs[sphere]?.questions.find((x) => x.id === q.id) : undefined
  const meaning = MEANING[q.id]
  if (t && t.kind === 'number' && t.default != null && sphere) {
    const unit = t.unit ? ` ${t.unit}` : ''
    return {
      placeholder: `Например, ${nf.format(t.default)}`,
      hint: `${meaning ? `${meaning} ` : ''}Для сферы «${defs[sphere].title.toLowerCase()}» обычно около ${nf.format(t.default)}${unit}, допустимо ${nf.format(t.min ?? 0)}–${nf.format(t.max ?? 0)}.`,
    }
  }
  if (meaning) return { placeholder: 'Ваш ответ', hint: meaning }
  if (/own_funds|funds|money/i.test(q.id)) return { placeholder: 'Например, 900 000 или «нет»', hint: null }
  return { placeholder: 'Ваш ответ', hint: null }
}
