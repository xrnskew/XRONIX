// Контрольные суммы ИНН и ОГРН по алгоритму ФНС. Та же проверка, что validInn/validOgrn в /contracts/check.mjs.

const weighted = (digits: number[], weights: number[]) => weights.reduce((s, w, i) => s + w * digits[i], 0) % 11 % 10

export function validInn(inn: string): boolean {
  if (!/^(\d{10}|\d{12})$/.test(inn)) return false
  const d = [...inn].map(Number)
  if (d.length === 10) return weighted(d, [2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9]
  return weighted(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && weighted(d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11]
}

export function validOgrn(ogrn: string): boolean {
  if (ogrn.length === 13) return Number(BigInt(ogrn.slice(0, 12)) % 11n % 10n) === Number(ogrn[12])
  if (ogrn.length === 15) return Number(BigInt(ogrn.slice(0, 14)) % 13n % 10n) === Number(ogrn[14])
  return false
}

// Что сказать человеку про ИНН. done: поле покинуто — 10 цифр больше не могут оказаться началом ИНН ИП.
export function innHint(raw: string, done = false): string | null {
  const inn = raw.replace(/\s/g, '')
  if (!inn) return null
  if (!/^\d+$/.test(inn)) return 'Только цифры'
  if (inn.length > 12 || (done && inn.length !== 10 && inn.length !== 12)) return 'В ИНН 10 цифр у компании и 12 у ИП'
  if (inn.length === 12 || (inn.length === 10 && done)) return validInn(inn) ? null : 'ИНН с ошибкой: не сходится контрольная цифра'
  return null
}
