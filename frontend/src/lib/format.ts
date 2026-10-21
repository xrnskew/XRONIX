const nf = new Intl.NumberFormat('ru-RU')
// Дробь с запятой, как принято в русском тексте: 23.5 → «23,5»
export const decimal = (n: number | string | null | undefined) => String(n).replace('.', ',')
export const rub = (n: number | null | undefined) => (n == null ? '—' : `${nf.format(Math.round(n))} ₽`)
export const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')} млн` : n >= 1000 ? `${Math.round(n / 1000)} тыс` : String(n)

// Аннуитетный платёж. Финально считает бэк, здесь — для калькулятора на экране.
export function annuity(amount: number, ratePercent: number, months: number) {
  const r = ratePercent / 100 / 12
  if (r === 0) return amount / months
  return (amount * r) / (1 - Math.pow(1 + r, -months))
}

// Крупное число и единица раздельно: «1,5» и «млн ₽» (для больших цифр на карточках)
export function shortParts(n: number): { value: string; unit: string } {
  if (n >= 1_000_000) return { value: (n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ','), unit: 'млн ₽' }
  if (n >= 1000) return { value: String(Math.round(n / 1000)), unit: 'тыс ₽' }
  return { value: String(n), unit: '₽' }
}

// Русское склонение: plural(3, ['шаг', 'шага', 'шагов']) -> 'шага'
export function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b > 1 && b < 5) return forms[1]
  return b === 1 ? forms[0] : forms[2]
}
