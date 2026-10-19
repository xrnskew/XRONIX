const nf = new Intl.NumberFormat('ru-RU')
export const rub = (n: number | null | undefined) => (n == null ? '—' : `${nf.format(Math.round(n))} ₽`)
export const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.0', '')} млн` : n >= 1000 ? `${Math.round(n / 1000)} тыс` : String(n)

// Аннуитетный платёж. Финально считает бэк, здесь — для калькулятора на экране.
export function annuity(amount: number, ratePercent: number, months: number) {
  const r = ratePercent / 100 / 12
  if (r === 0) return amount / months
  return (amount * r) / (1 - Math.pow(1 + r, -months))
}
