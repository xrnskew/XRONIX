import type { MatchItem } from '../types/conveyor'

// Причины, по которым продукт не подошёл, приходят строками (движок подбора: frontend/src/lib/creditRules.ts и backend, тексты совпадают).
// Здесь они разбираются по виду: что можно исправить самому, что зависит от типа бизнеса, что просто пояснение.
export type ReasonKind = 'amount' | 'term' | 'collateral' | 'own_funds' | 'purpose' | 'plan' | 'business' | 'age' | 'expired' | 'manager' | 'other'
// fix — человек может изменить; structural — зависит от типа бизнеса и не исправляется параметрами; info — просто пояснение демо
export type ReasonLevel = 'fix' | 'structural' | 'info'
export interface ReasonInfo { kind: ReasonKind; level: ReasonLevel; ownFundsNeeded?: number }

const rubs = (s: string) => Number(s.replace(/[^\d]/g, ''))

export function classifyReason(text: string): ReasonInfo {
  if (/^Сумма должна быть/.test(text)) return { kind: 'amount', level: 'fix' }
  if (/^Срок должен быть/.test(text)) return { kind: 'term', level: 'fix' }
  if (/^Нужен залог/.test(text)) return { kind: 'collateral', level: 'fix' }
  if (/^Своих денег должно быть/.test(text)) {
    const m = text.match(/запуска:\s*([\d\s  ]+)\s*₽/)
    return { kind: 'own_funds', level: 'fix', ...(m ? { ownFundsNeeded: rubs(m[1]) } : {}) }
  }
  if (/^Подходит только для покупки недвижимости|^Линия для пополнения оборота/.test(text)) return { kind: 'purpose', level: 'fix' }
  if (/^Нужен расчёт проекта/.test(text)) return { kind: 'plan', level: 'fix' }
  if (/^Продукт для действующего бизнеса/.test(text)) return { kind: 'business', level: 'structural' }
  if (/^Бизнес должен работать/.test(text)) return { kind: 'age', level: 'structural' }
  if (/^Акция закончилась/.test(text)) return { kind: 'expired', level: 'structural' }
  if (/менеджер банка/.test(text)) return { kind: 'manager', level: 'info' }
  return { kind: 'other', level: 'structural' }
}

const ORDER: Record<ReasonLevel, number> = { fix: 0, structural: 1, info: 2 }
export const sortedReasons = (reasons: string[]) =>
  reasons.map((text) => ({ text, ...classifyReason(text) })).sort((a, b) => ORDER[a.level] - ORDER[b.level])

export const BLOCKER_TITLE: Record<ReasonKind, string> = {
  amount: 'Сумма вне допустимого диапазона',
  term: 'Срок вне допустимого диапазона',
  collateral: 'Нужен залог или поручитель',
  own_funds: 'Не хватает своих денег',
  purpose: 'Цель не подходит продукту',
  plan: 'Нужен расчёт проекта',
  business: 'Продукт для действующего бизнеса',
  age: 'Бизнес слишком молодой',
  expired: 'Акция закончилась',
  manager: 'Оформляет менеджер банка',
  other: 'Другое условие',
}

export interface Blocker { kind: ReasonKind; title: string; count: number; ownFundsNeeded?: number }
// Что чаще всего мешает среди неподошедших продуктов: только то, что можно исправить самому, от самого частого
export function summarizeBlockers(items: MatchItem[]): Blocker[] {
  const by = new Map<ReasonKind, Blocker>()
  for (const item of items) {
    const seen = new Set<ReasonKind>()
    for (const text of item.reasons) {
      const r = classifyReason(text)
      if (r.level !== 'fix' || seen.has(r.kind)) continue
      seen.add(r.kind)
      const cur = by.get(r.kind)
      if (cur) cur.count++
      else by.set(r.kind, { kind: r.kind, title: BLOCKER_TITLE[r.kind], count: 1, ...(r.ownFundsNeeded ? { ownFundsNeeded: r.ownFundsNeeded } : {}) })
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count)
}
