import type { AiReply, Plan, Profile } from '../types/plan'
import { DEMO_CLIENT } from '../api/demoAccounts'

export const mockPlan: Plan = {
  title: 'Кофейня у метро',
  summary: 'Кофе с собой в проходном месте: небольшая площадь, быстрый оборот, окупаемость за 11 месяцев при кредите на оборудование и аренду.',
  business: { sphere: 'Общепит', format: 'Кофе с собой', city: 'Москва' },
  steps: [
    { order: 1, title: 'Регистрация ИП', description: 'Подать заявление, выбрать УСН «доходы минус расходы».', duration_days: 5, cost_rub: 800 },
    { order: 2, title: 'Поиск точки', description: 'Павильон 8–12 м² у выхода из метро, договор аренды на 11 месяцев.', duration_days: 21, cost_rub: 120000 },
    { order: 3, title: 'Оборудование', description: 'Кофемашина, гриндер, холодильник, касса.', duration_days: 14, cost_rub: 650000 },
    { order: 4, title: 'Ремонт и вывеска', description: 'Стойка, освещение, вывеска, согласование с арендодателем.', duration_days: 14, cost_rub: 380000 },
    { order: 5, title: 'Запуск', description: 'Найм двух бариста, закупка сырья, открытие.', duration_days: 7, cost_rub: 350000 },
  ],
  opportunities: [
    { title: 'Высокий проходной поток', description: 'Утренний пик 7:30–10:00 даёт до 60% выручки.' },
    { title: 'Низкий порог входа', description: 'Небольшая площадь и один кассовый узел.' },
  ],
  risks: [
    { title: 'Рост аренды', level: 'high', mitigation: 'Договор на 3 года с фиксированной ставкой.' },
    { title: 'Сезонный спад летом', level: 'medium', mitigation: 'Холодные напитки и десерты в меню.' },
    { title: 'Текучка бариста', level: 'low', mitigation: 'Обучение и процент от выручки.' },
  ],
  finance: {
    startup_items: [
      { title: 'Регистрация', amount_rub: 800, assumption: 'Демонстрационный расчёт: бумажная подача; электронная может быть бесплатной.' },
      { title: 'Аренда до открытия', amount_rub: 60000, assumption: 'Пример: 10 м² × 6 000 ₽ за месяц.' },
      { title: 'Возвратный залог', amount_rub: 60000, assumption: 'Пример: один месячный платёж, отдельно от аренды.' },
      { title: 'Кофемашина', amount_rub: 450000, assumption: 'Пример: одна машина; цену уточнить у поставщика.' },
      { title: 'Кофемолка и другое оборудование', amount_rub: 200000, assumption: 'Пример: кофемолка, холодильник, касса и инвентарь.' },
      { title: 'Ремонт и вывеска', amount_rub: 380000, assumption: 'Пример: стойка, коммуникации, отделка и вывеска.' },
      { title: 'Первая закупка', amount_rub: 100000, assumption: 'Пример: стартовый запас зерна, молока и упаковки.' },
      { title: 'Подготовка открытия', amount_rub: 50000, assumption: 'Пример: обучение и реклама открытия.' },
      { title: 'Оборотный резерв', amount_rub: 200000, assumption: 'Пример: ожидаемый кассовый разрыв за первые два месяца по 100 000 ₽, после учёта поступлений.' },
    ],
    monthly_items: [
      { title: 'Аренда', amount_rub: 60000, assumption: 'Пример: 10 м² × 6 000 ₽.' },
      { title: 'Персонал и взносы', amount_rub: 160000, assumption: 'Пример: два бариста по 80 000 ₽ с учётом взносов.' },
      { title: 'Сырьё и упаковка', amount_rub: 150000, assumption: 'Пример: 25% выручки 600 000 ₽.' },
      { title: 'Коммунальные услуги', amount_rub: 15000, assumption: 'Примерный месячный расход.' },
      { title: 'Налоги', amount_rub: 30000, assumption: 'Примерная эффективная нагрузка 5% выручки; режим уточняется.' },
      { title: 'Эквайринг', amount_rub: 12000, assumption: 'Пример: 2% выручки.' },
      { title: 'Реклама и обслуживание', amount_rub: 23000, assumption: 'Пример: реклама 15 000 ₽ и обслуживание 8 000 ₽.' },
    ],
    startup_cost_rub: 1500800,
    own_funds_rub: 500000,
    funding_gap_rub: 1000800,
    monthly_revenue_rub: 600000,
    monthly_expenses_rub: 450000,
    monthly_profit_rub: 150000,
    payback_months: 11,
    revenue_forecast: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({
      month: m,
      revenue_rub: Math.round(200000 + Math.min(m, 6) * 70000 - (m > 8 ? 30000 : 0)),
      expenses_rub: Math.round(400000 + Math.min(m, 6) * 10000),
    })),
  },
  credit: {
    needed: true,
    amount_rub: 1000800,
    purpose: 'Оборудование и аренда',
    recommended_term_months: 24,
    estimated_rate_percent: 22,
    monthly_payment_rub: 51920,
    debt_load_percent: 35,
    verdict: 'ok',
    comment: 'Платёж около трети прогнозной прибыли: нагрузка умеренная, запас на сезонный спад есть.',
  },
  tags_update: ['общепит', 'старт', 'Москва', 'бюджет до 2 млн'],
}

export const mockProfile: Profile = {
  name: DEMO_CLIENT.name,
  email: DEMO_CLIENT.email,
  city: 'Москва',
  experience: 'Новичок',
  budget_rub: 500000,
  tags: ['общепит', 'новичок', 'Москва'],
}

export const mockQuestions: AiReply = {
  type: 'questions',
  text: 'Уточню пару моментов, чтобы план был точным',
  questions: [
    { id: 'budget', text: 'Какой стартовый бюджет?', kind: 'choice', options: ['до 500 тыс', '500 тыс – 2 млн', 'больше 2 млн'] },
    { id: 'experience', text: 'Есть опыт в общепите?', kind: 'choice', options: ['Нет', 'Работал наёмным', 'Свой бизнес был'] },
    { id: 'location', text: 'В каком городе открываетесь?', kind: 'text' },
  ],
}
