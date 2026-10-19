// Кредитные продукты Альфа-Банка для малого бизнеса.
// Ориентиры собраны из открытых источников (агрегаторы bankiros.ru, myfin.by, brobank.ru) на октябрь 2026,
// сам сайт банка из нашей среды недоступен. Цифры в источниках местами расходятся: берём консервативные.
// Перед защитой сверить с alfabank.ru/sme и поправить здесь, остальной код читает только этот файл.
export interface AlfaProduct {
  id: string
  name: string
  short: string
  rateFrom: number | null // % годовых, «от»
  amountMin: number
  amountMax: number
  termMin: number // месяцев
  termMax: number
  collateral: boolean
  minBusinessMonths: number | null
  note: string
}

export const ALFA_AS_OF = 'октябрь 2026'
export const ALFA_DISCLAIMER =
  'Ориентиры из открытых источников на ' + ALFA_AS_OF + '. Точные условия и ставку определяет банк при заявке.'

export const alfaProducts: AlfaProduct[] = [
  {
    id: 'fast',
    name: 'Быстрый бизнес-кредит',
    short: 'Без залога, решение до 2 дней',
    rateFrom: 13,
    amountMin: 300_000,
    amountMax: 50_000_000,
    termMin: 12,
    termMax: 120,
    collateral: false,
    minBusinessMonths: 6,
    note: 'Без залога до 50 млн ₽. Бизнесу нужен стаж от 6–12 месяцев.',
  },
  {
    id: 'secured',
    name: 'Кредит одной суммой с залогом',
    short: 'Крупная сумма под обеспечение',
    rateFrom: 14,
    amountMin: 300_000,
    amountMax: 150_000_000,
    termMin: 12,
    termMax: 120,
    collateral: true,
    minBusinessMonths: 6,
    note: 'С залогом до 150 млн ₽, ставка ниже, чем у беззалоговых продуктов.',
  },
  {
    id: 'mortgage',
    name: 'Бизнес-ипотека',
    short: 'Покупка коммерческой недвижимости',
    rateFrom: 18.5,
    amountMin: 300_000,
    amountMax: 150_000_000,
    termMin: 12,
    termMax: 120,
    collateral: true,
    minBusinessMonths: 12,
    note: 'Под залог приобретаемой или имеющейся недвижимости.',
  },
  {
    id: 'revolving',
    name: 'Возобновляемая кредитная линия',
    short: 'Пополнение оборотных средств',
    rateFrom: null,
    amountMin: 500_000,
    amountMax: 50_000_000,
    termMin: 12,
    termMax: 18,
    collateral: true,
    minBusinessMonths: 12,
    note: 'Лимит можно тратить и возвращать по мере необходимости. Ставка по запросу.',
  },
]

export interface ProductMatch {
  product: AlfaProduct
  fits: boolean // подходит по сумме и сроку
  reasons: string[]
}

// Стаж бизнеса не входит в подбор: у нового бизнеса он нулевой у всех продуктов, его показываем отдельным условием.
export function matchProducts(amount: number, months: number): ProductMatch[] {
  return alfaProducts
    .map((product) => {
      const reasons: string[] = []
      if (amount < product.amountMin || amount > product.amountMax) reasons.push('сумма вне диапазона продукта')
      if (months < product.termMin || months > product.termMax) reasons.push('срок вне диапазона продукта')
      return { product, fits: reasons.length === 0, reasons }
    })
    .sort((a, b) => Number(b.fits) - Number(a.fits) || Number(a.product.collateral) - Number(b.product.collateral))
}
