import type { AlfaProduct } from '../data/alfaProducts'

export function creditParameters(product: AlfaProduct, amount: number, months: number) {
  return {
    amount: Math.round(Math.min(product.amountMax, Math.max(product.amountMin ?? 1, amount))),
    months: Math.round(Math.min(product.termMax, Math.max(product.termMin ?? 1, months))),
  }
}
export function creditAssessment(product: AlfaProduct, amount: number, months: number, load: number) {
  if (amount < (product.amountMin ?? 1) || amount > product.amountMax || months < (product.termMin ?? 1) || months > product.termMax)
    return { text: 'Параметры вне условий продукта', tone: 'warn' as const }
  return load > 50 ? { text: 'Высокая долговая нагрузка', tone: 'bad' as const }
    : load > 35 ? { text: 'Есть риск высокой нагрузки', tone: 'warn' as const }
    : { text: 'Нагрузка умеренная', tone: 'ok' as const }
}
