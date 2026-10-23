import type { Template } from './projectCalc'
import type { Answer, Plan } from '../types/plan'

// Восстановление вводных плана для пересчёта: сфера — по названию плана («Пекарня, Самара»), ответы анкеты — из сообщений чата.
// Чистые функции без обращений к серверу, чтобы их можно было проверять тестами.
export function inferTemplate(templates: Template[], plan: Pick<Plan, 'title' | 'business'>): Template | null {
  const head = plan.title.split(',')[0].trim().toLowerCase()
  const format = plan.business.format?.trim().toLowerCase()
  return templates.find((t) => head === t.title.toLowerCase())
    ?? templates.find((t) => head.startsWith(t.title.toLowerCase()))
    ?? templates.find((t) => format === t.title.toLowerCase())
    ?? null
}

const toNumber = (s: string) => {
  const t = s.replace(/[\s  ]/g, '').replace(',', '.').replace(/[^\d.]/g, '')
  return t && /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
}

// Берём только то, что подходит вопросу шаблона и укладывается в его границы: остальное расчёт заменит значением по умолчанию.
// Если человек отвечал на вопрос несколько раз, действует последний ответ.
export function answersFromChat(messages: { answers?: Answer[] }[], tpl: Template): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  for (const m of messages) for (const a of m.answers ?? []) {
    const q = tpl.questions.find((x) => x.id === a.question_id)
    if (!q) continue
    if (q.kind === 'choice') {
      const o = q.options?.find((x) => x.value === a.answer || x.label === a.answer)
      if (o) out[q.id] = o.value
    } else {
      const n = toNumber(String(a.answer))
      if (Number.isFinite(n) && (q.min == null || n >= q.min) && (q.max == null || n <= q.max)) out[q.id] = Math.round(n)
    }
  }
  return out
}
