import type { Plan } from '../types/plan'

// Пересчёт плана (другие свои деньги) создаёт на сервере НОВЫЙ план, а прежний остаётся записан в сообщении чата.
// Чтобы везде был один актуальный план, запоминаем связь «прежний → новый» в браузере и всегда идём по цепочке до последнего.
// Ограничение: связь хранится в этом браузере (localStorage), на другом устройстве старый чат покажет свой исходный план.
const KEY = 'xronix_plan_aliases'
const known = new Map<string, Plan>() // планы, которые уже есть в памяти: не нужно запрашивать повторно

const read = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string> } catch { return {} } }

export function latestPlanId(id: string): string {
  const map = read()
  let cur = id
  for (let i = 0; i < 10 && map[cur] && map[cur] !== cur; i++) cur = map[cur] // защита от цикла
  return cur
}

export function recordSuccessor(fromId: string, toId: string, plan?: Plan) {
  if (plan) known.set(toId, plan)
  if (fromId === toId) return
  const map = read(); map[fromId] = toId
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch { /* хранилище недоступно */ }
}

// Чат, который сервер создаёт при пересчёте (в нём только сам план, без сообщений): он дублирует исходный чат, в списках его прячем
export const isRecalculated = (planId: string | null | undefined): boolean => !!planId && Object.values(read()).includes(planId)

export const knownPlan = (id: string): Plan | null => known.get(id) ?? null
export const rememberPlan = (id: string, plan: Plan) => { known.set(id, plan) }
