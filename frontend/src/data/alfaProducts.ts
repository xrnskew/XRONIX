import snapshot from './alfaProducts.snapshot.json' with { type: 'json' }

export interface AlfaProduct {
  id: string
  name: string
  short: string
  rateFrom: number | null
  discountRateFrom: number | null
  amountMin: number | null
  amountMax: number
  termMin: number | null
  termMax: number
  collateral: boolean
  minBusinessMonths: number | null
  note: string
  url: string
}

export const ALFA_AS_OF = snapshot.checkedAt
export const ALFA_DISCLAIMER = `Условия с официальных страниц Альфа-Банка, проверены ${ALFA_AS_OF.split('-').reverse().join('.')}. Ставки «от» не являются персональным предложением; точные условия определяет банк.`
export const alfaProducts: AlfaProduct[] = snapshot.products
export const productTerm = (p: AlfaProduct) => p.termMin == null ? `до ${p.termMax} мес.` : `${p.termMin}–${p.termMax} мес.`
export const alfaSnapshotIsStale = () => Date.now() - Date.parse(`${ALFA_AS_OF}T00:00:00+11:00`) > 8 * 86400000

export interface ProductMatch { product: AlfaProduct; fits: boolean; reasons: string[] }

// This is a range filter, not the bank's eligibility or approval decision.
export function matchProducts(amount: number, months: number): ProductMatch[] {
  return alfaProducts.map((product) => {
    const reasons: string[] = []
    if ((product.amountMin != null && amount < product.amountMin) || amount > product.amountMax) reasons.push('сумма вне диапазона продукта')
    if ((product.termMin != null && months < product.termMin) || months > product.termMax) reasons.push('срок вне диапазона продукта')
    return { product, fits: reasons.length === 0, reasons }
  }).sort((a, b) => Number(b.fits) - Number(a.fits) || Number(a.product.collateral) - Number(b.product.collateral))
}
