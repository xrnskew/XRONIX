// Синтетические внешние системы для мок-режима. Те же компании-сценарии, что в /contracts/integrations.md.
// Все данные выдуманы, совпадение с реальными компаниями случайно.
import type { Bki, Fns } from '../lib/creditRules.ts'
import type { Collateral, Financials, ProductId, Purpose, RegistryCompany } from '../types/conveyor.ts'

export interface External { registry: RegistryCompany; fns: Fns; bki: Bki }
const ul = (inn: string, ogrn: string, name: string, registered_at: string, code: string, okvedName: string, head: string, address = 'г. Москва, ул. Синтетическая, д. 1'): RegistryCompany =>
  ({ inn, ogrn, name, kind: inn.length === 10 ? 'ul' : 'ip', status: 'active', registered_at, okved: { code, name: okvedName }, address, head_name: head, source: 'mock-egrul v1' })
const clean: Fns = { mass_address: false, tax_debt_rub: 0, head_disqualified: false }
const bki = (months: number, loans: number, o30 = 0, o90 = 0): Bki => ({
  has_history: months > 0, history_months: months, overdue_30_24m: o30, overdue_90_12m: o90,
  loans: loans ? [{ lender: 'Синтетический банк', monthly_payment_rub: loans, balance_rub: loans * 15 }] : [],
})

export const SCENARIOS: Record<string, External> = {
  '7715881399': { registry: ul('7715881399', '1227798698797', 'ООО «Северная выпечка»', '2022-03-15', '10.71', 'Производство хлеба и хлебобулочных изделий недлительного хранения', 'Орлова Елена Викторовна'), fns: clean, bki: bki(36, 40_000) },
  '777309114120': { registry: ul('777309114120', '324777075364552', 'ИП Лебедев Андрей Сергеевич', '2024-06-10', '56.10', 'Деятельность ресторанов и услуги по доставке продуктов питания', 'Лебедев Андрей Сергеевич', 'г. Казань'), fns: clean, bki: bki(18, 85_000) },
  '7768151886': { registry: ul('7768151886', '1207744729400', 'ООО «Вектор Логистик»', '2020-02-01', '49.41', 'Деятельность автомобильного грузового транспорта', 'Зайцев Пётр Олегович'), fns: clean, bki: bki(60, 150_000) },
  '7755761690': { registry: ul('7755761690', '1237787168970', 'ООО «Ромашка Трейд»', '2023-01-20', '47.19', 'Торговля розничная прочая в неспециализированных магазинах', 'Белов Игорь Андреевич'), fns: clean, bki: bki(30, 60_000, 2, 1) },
  '776846978815': { registry: ul('776846978815', '326770932081968', 'ИП Соколова Мария Игоревна', '2026-05-12', '96.02', 'Предоставление услуг парикмахерскими и салонами красоты', 'Соколова Мария Игоревна'), fns: clean, bki: bki(0, 0) },
  '7772731777': { registry: ul('7772731777', '1217784864880', 'ООО «Альфа-Сервис Плюс»', '2021-09-01', '82.99', 'Деятельность по предоставлению прочих вспомогательных услуг для бизнеса', 'Ким Олег Борисович', 'г. Москва, ул. Массовая, д. 5'), fns: { ...clean, mass_address: true }, bki: bki(24, 0) },
}

// Параметры заявки, на которых каждый сценарий даёт свой исход. Кнопка «Заполнить примером» в демо.
export interface DemoFill { purpose: Purpose; product_id: ProductId; amount_rub: number; term_months: number; financials: Financials; collateral: Collateral | null }
export const demoFinancials: Record<string, DemoFill> = {
  '7715881399': { purpose: 'equipment', product_id: 'fast', amount_rub: 1_500_000, term_months: 24, collateral: null, financials: { revenue_12m_rub: 24_000_000, expenses_12m_rub: 19_200_000, loan_payments_monthly_rub: 40_000 } },
  '777309114120': { purpose: 'new_location', product_id: 'fast', amount_rub: 2_000_000, term_months: 24, collateral: null, financials: { revenue_12m_rub: 14_400_000, expenses_12m_rub: 10_600_000, loan_payments_monthly_rub: 85_000 } },
  '7768151886': { purpose: 'equipment', product_id: 'secured', amount_rub: 12_000_000, term_months: 60, collateral: { kind: 'vehicle', description: 'Три грузовика 2022 года', value_rub: 15_000_000 }, financials: { revenue_12m_rub: 120_000_000, expenses_12m_rub: 100_000_000, loan_payments_monthly_rub: 150_000 } },
  '7755761690': { purpose: 'working_capital', product_id: 'fast', amount_rub: 1_000_000, term_months: 24, collateral: null, financials: { revenue_12m_rub: 15_000_000, expenses_12m_rub: 13_500_000, loan_payments_monthly_rub: 60_000 } },
  '776846978815': { purpose: 'equipment', product_id: 'fast', amount_rub: 600_000, term_months: 24, collateral: null, financials: { revenue_12m_rub: 1_800_000, expenses_12m_rub: 1_300_000, loan_payments_monthly_rub: 0 } },
  '7772731777': { purpose: 'working_capital', product_id: 'fast', amount_rub: 900_000, term_months: 24, collateral: null, financials: { revenue_12m_rub: 18_000_000, expenses_12m_rub: 15_000_000, loan_payments_monthly_rub: 0 } },
}

// Любой другой корректный ИНН: компания выводится из хеша ИНН, одна и та же при каждом запросе.
function fnv(s: string) { let h = 0x811c9dc5; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return h }
const pick = <T,>(list: T[], n: number) => list[n % list.length]
const NAMES = ['Горизонт', 'Северный ветер', 'Твой мастер', 'Добрый хлеб', 'Сфера', 'Кедр', 'Мегаполис', 'Пятый элемент', 'Луч', 'Вектор']
const PEOPLE = ['Иванов Сергей Петрович', 'Смирнова Анна Олеговна', 'Кузнецов Дмитрий Ильич', 'Попова Ольга Викторовна', 'Васильев Артём Максимович']
const OKVED: [string, string][] = [['56.10', 'Деятельность ресторанов'], ['47.71', 'Торговля розничная одеждой'], ['45.20', 'Техническое обслуживание и ремонт автотранспорта'], ['62.01', 'Разработка компьютерного программного обеспечения'], ['10.71', 'Производство хлеба'], ['96.02', 'Услуги парикмахерских'], ['52.29', 'Транспортная обработка грузов']]

export function generated(inn: string): External {
  const h = fnv(inn), year = 2015 + (h % 11), month = 1 + ((h >>> 4) % 12), day = 1 + ((h >>> 8) % 28)
  const yy = String(year).slice(2), digits = (n: number) => String(h).padStart(10, '7').repeat(2).slice(0, n)
  const ip = inn.length === 12
  const base = ip ? `3${yy}77${digits(9)}` : `1${yy}77${digits(7)}`
  const ogrn = base + String(Number(BigInt(base) % (ip ? 13n : 11n) % 10n))
  const [code, okvedName] = pick(OKVED, h >>> 12)
  const head = pick(PEOPLE, h >>> 16)
  const trouble = (h >>> 20) % 5 === 0 // примерно каждая пятая компания с проблемой
  const kindOfTrouble = (h >>> 24) % 3
  return {
    registry: { inn, ogrn, name: ip ? `ИП ${head}` : `ООО «${pick(NAMES, h >>> 2)}»`, kind: ip ? 'ip' : 'ul', status: 'active', registered_at: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, okved: { code, name: okvedName }, address: 'г. Москва', head_name: head, source: 'mock-egrul v1' },
    fns: { mass_address: trouble && kindOfTrouble === 0, tax_debt_rub: trouble && kindOfTrouble === 1 ? 40_000 : 0, head_disqualified: false },
    bki: bki(12 + (h % 60), ((h >>> 6) % 4) * 25_000, trouble && kindOfTrouble === 2 ? 1 : 0),
  }
}

export const external = (inn: string): External => SCENARIOS[inn] ?? generated(inn)

// Будущий ИП: регистрации нет, ЕГРЮЛ не проверяется, кредитная история — личная (по личному ИНН).
export const DEMO_FOUNDER_INN = '772519083310' // чистая личная история 24 мес. — для сценария «Старт» в README
export function personExternal(inn: string, name: string): External {
  const bkiData = inn === DEMO_FOUNDER_INN ? bki(24, 0) : generated(inn).bki
  return {
    registry: { inn, ogrn: null, name: `${name} (будущий ИП)`, kind: 'person', status: 'not_registered', registered_at: null, okved: null, address: '', head_name: name, source: 'xronix' },
    fns: clean, bki: bkiData,
  }
}
