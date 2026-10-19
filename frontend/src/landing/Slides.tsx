import type { ReactNode } from 'react'
import TypedPrompt from './TypedPrompt'
import { ALFA_DISCLAIMER, alfaProducts } from '../data/alfaProducts'
import { mockPlan, mockProfile } from '../mocks/data'
import { plural, short } from '../lib/format'

export const pad = 'px-6 sm:px-12 lg:px-16'
const slide = `snap flex min-h-svh flex-col justify-center py-24 ${pad}`
const h2 = 'font-display text-[clamp(28px,3.2vw,44px)] font-semibold leading-[1.1] tracking-tight max-w-[20ch]'
const lead = 'mt-6 max-w-[54ch] text-[18px] leading-relaxed text-white/70'

const Section = ({ id, tint, children }: { id: string; tint?: boolean; children: ReactNode }) => (
  <section id={id} className={`${slide} ${tint ? 'bg-black/30' : ''}`}>{children}</section>
)

export function Hero({ onTry, onHow }: { onTry: () => void; onHow: () => void }) {
  return (
    <section id="top" className={`${slide} -mt-16`}>
      <h1 className="font-display text-[clamp(36px,5.2vw,72px)] font-semibold leading-[1.02] tracking-tight">
        Идея бизнеса. План. Кредит под него.
      </h1>
      <p className={lead}>Предприниматель пишет, что хочет открыть. ИИ уточняет детали, считает, сколько нужно денег, и показывает, потянет ли бизнес кредит.</p>
      <div className="mt-10"><TypedPrompt /></div>
      <div className="mt-8 flex flex-wrap gap-3">
        <button onClick={onTry} className="h-12 rounded-full bg-fill px-7 text-[16px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(239,49,36,.9)] transition-transform hover:-translate-y-0.5 active:translate-y-0 active:bg-brand-deep">Попробовать самому</button>
        <button onClick={onHow} className="h-12 rounded-full px-6 text-[16px] font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/10">Как это работает</button>
      </div>
    </section>
  )
}

export function Problem() {
  const rows = [
    ['Сколько денег нужно', 'Расходы вспоминают уже по ходу запуска, когда деньги на исходе.'],
    ['Какой кредит брать', 'Продуктов много, различия неочевидны, сумма и срок выбираются наугад.'],
    ['Выдержит ли бизнес платёж', 'Нагрузку считают после того, как договор уже подписан.'],
  ]
  return (
    <Section id="problem" tint>
      <h2 className={h2}>Начинающий предприниматель не знает три вещи</h2>
      <dl className="mt-12 max-w-[680px] divide-y divide-white/10 border-y border-white/10">
        {rows.map(([t, d]) => (
          <div key={t} className="grid gap-2 py-7 sm:grid-cols-[1fr_1.1fr] sm:gap-10">
            <dt className="font-display text-[22px] font-semibold leading-snug tracking-tight">{t}</dt>
            <dd className="text-[16px] leading-relaxed text-white/65">{d}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

// activeStep: 0 = все шаги в обычном виде, 1..4 = автопоказ дошёл до этого шага
export function How({ activeStep }: { activeStep: number }) {
  const steps = [
    ['Вы описываете идею', 'Одной фразой, как другу: «хочу кофейню у метро».'],
    ['ИИ уточняет', '3–6 вопросов, на часть можно ответить одним нажатием.'],
    ['Сервер проверяет', 'Ответ ИИ сверяется со схемой, платёж пересчитывается по формуле аннуитета.'],
    ['Вы получаете план', 'Шаги, риски, финансовая модель и подходящий кредит. Теги и память обновляются.'],
  ]
  const live = activeStep > 0
  return (
    <Section id="how">
      <h2 className={h2}>Один диалог вместо недель расчётов</h2>
      <ol className="relative mt-12 max-w-[580px]">
        <span className="absolute bottom-4 left-[15px] top-4 w-px bg-white/15" aria-hidden />
        {steps.map(([t, d], i) => {
          const n = i + 1
          const state = !live ? 'idle' : n < activeStep ? 'done' : n === activeStep ? 'active' : 'next'
          return (
            <li key={t} aria-current={state === 'active' ? 'step' : undefined} className={`relative flex gap-5 pb-8 transition-opacity duration-500 last:pb-0 ${state === 'next' ? 'opacity-40' : ''}`}>
              <span className={`relative z-10 flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-full font-display text-[13px] font-semibold transition-all duration-500 ${state === 'next' ? 'bg-[#1b1b1e] text-white/60 ring-1 ring-white/20' : 'bg-fill text-white'} ${state === 'active' ? 'scale-110 shadow-[0_0_0_6px_rgba(239,49,36,.25)]' : ''}`}>
                {state === 'done' ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> : n}
              </span>
              <div><div className="text-[20px] font-semibold leading-tight">{t}</div><div className="mt-1 text-[16px] leading-relaxed text-white/65">{d}</div></div>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

export function PlanSlide() {
  const f = mockPlan
  const stats = [
    [String(f.steps.length), plural(f.steps.length, ['шаг запуска', 'шага запуска', 'шагов запуска']), 'со сроком и стоимостью'],
    [String(f.risks.length), plural(f.risks.length, ['риск', 'риска', 'рисков']), 'и меры защиты от каждого'],
    [String(f.finance.revenue_forecast.length), 'месяцев', 'прогноза выручки и расходов'],
  ]
  return (
    <Section id="plan" tint>
      <h2 className={h2}>План, который можно выполнять</h2>
      <p className={lead}>Не абстрактный совет, а последовательность действий: что сделать, за сколько дней и во сколько это обойдётся.</p>
      <dl className="mt-12 grid max-w-[680px] gap-x-8 gap-y-8 sm:grid-cols-3">
        {stats.map(([n, a, b]) => (
          <div key={a}>
            <dt className="font-display text-[56px] font-semibold leading-none tabular-nums text-brand">{n}</dt>
            <dd className="mt-3 text-[17px] font-semibold leading-snug">{a}</dd>
            <dd className="mt-1 text-[14px] leading-snug text-white/55">{b}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

export function Credit() {
  const zones = [
    { w: '35%', c: 'bg-ok', t: 'до 35%', d: 'кредит подходит' },
    { w: '15%', c: 'bg-warn', t: '36–50%', d: 'есть риски' },
    { w: '50%', c: 'bg-accent', t: 'больше 50%', d: 'не рекомендуем' },
  ]
  return (
    <Section id="credit">
      <h2 className={h2}>Кредит из реальных продуктов Альфа-Банка</h2>
      <p className={lead}>Кабинет считает платёж и нагрузку на прибыль, а затем подбирает продукты банка по сумме и сроку.</p>

      <div className="mt-10 max-w-[680px] overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[15px]">
          <caption className="sr-only">Кредитные продукты Альфа-Банка для бизнеса</caption>
          <thead className="border-b border-white/15 text-[13px] text-white/55">
            <tr><th className="py-2 pr-4 font-medium">Продукт</th><th className="py-2 pr-4 font-medium">Ставка</th><th className="py-2 pr-4 font-medium">Сумма до</th><th className="py-2 font-medium">Срок</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {alfaProducts.map((p) => (
              <tr key={p.id}>
                <td className="py-3.5 pr-4 font-semibold">{p.name}</td>
                <td className="py-3.5 pr-4 tabular-nums">{p.rateFrom ? `от ${String(p.rateFrom).replace('.', ',')}%` : 'по запросу'}</td>
                <td className="py-3.5 pr-4 tabular-nums">{short(p.amountMax)} ₽</td>
                <td className="py-3.5 tabular-nums">{p.termMin}–{p.termMax} мес.</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10 max-w-[680px]">
        <div className="text-[15px] font-semibold">Вердикт по долговой нагрузке</div>
        <div className="mt-1 text-[14px] text-white/55">Платёж в месяц ÷ прибыль в месяц</div>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full" role="img" aria-label="Шкала: до 35% подходит, 36–50% есть риски, больше 50% не рекомендуем">
          {zones.map((z) => <div key={z.t} className={z.c} style={{ width: z.w }} />)}
        </div>
        <div className="mt-3 flex text-[13px] leading-snug">
          {zones.map((z) => <div key={z.t} style={{ width: z.w }} className="pr-2"><div className="font-semibold tabular-nums">{z.t}</div><div className="text-white/55">{z.d}</div></div>)}
        </div>
      </div>
      <p className="mt-8 max-w-[60ch] text-[13px] leading-relaxed text-white/50">{ALFA_DISCLAIMER}</p>
    </Section>
  )
}

export function Memory() {
  return (
    <Section id="memory" tint>
      <h2 className={h2}>ИИ помнит вас между диалогами</h2>
      <p className={lead}>Теги и короткая выжимка прошлых разговоров попадают в каждый запрос. Пользователь сам видит и правит теги в профиле.</p>
      <blockquote className="mt-10 max-w-[600px] border-l-2 border-brand pl-6">
        <p className="text-[19px] leading-relaxed text-white/90">«Александр, Москва, новичок в общепите. Планирует кофейню у метро, свои средства 500 тыс ₽, нужен кредит около 1 млн ₽.»</p>
        <footer className="mt-3 text-[13px] text-white/50">Так выглядит память после первого плана</footer>
      </blockquote>
      <ul className="mt-8 flex max-w-[600px] flex-wrap gap-2.5">
        {mockProfile.tags.map((t) => <li key={t} className="rounded-full bg-white/[.07] px-4 py-2 text-[15px] font-medium ring-1 ring-white/15">{t}</li>)}
      </ul>
    </Section>
  )
}

export function Arch() {
  const nodes = [
    { t: 'Фронтенд', s: 'React' },
    { t: 'Бэкенд', s: 'база, память, проверка' },
    { t: 'ИИ-сервис', s: 'промпты, JSON' },
    { t: 'GigaChat', s: 'модель' },
  ]
  const links = ['JWT', 'HTTP', 'API']
  return (
    <Section id="arch">
      <h2 className={h2}>Фронт не ходит в ИИ напрямую</h2>
      <p className={lead}>Токен GigaChat живёт только на сервере. Бэкенд собирает контекст, проверяет JSON и хранит данные. ИИ-сервис ничего не хранит.</p>
      <svg viewBox="0 0 740 134" className="mt-12 w-full max-w-[740px]" role="img" aria-label="Схема: фронтенд, бэкенд, ИИ-сервис, GigaChat">
        <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L7 4L0 8z" fill="#fff" opacity=".6" /></marker></defs>
        {nodes.map((n, k) => (
          <g key={n.t} transform={`translate(${k * 196}, 30)`}>
            <rect width="150" height="72" rx="16" fill={k === 1 ? '#ef3124' : 'rgba(255,255,255,.07)'} stroke={k === 1 ? '#ef3124' : '#fff'} strokeOpacity={k === 1 ? 1 : 0.25} />
            <text x="75" y="31" textAnchor="middle" fontSize="16" fontWeight="600" fill="#fff">{n.t}</text>
            <text x="75" y="53" textAnchor="middle" fontSize="11.5" fill="#fff" opacity=".7">{n.s}</text>
            {k === 2 && (
              <g transform="translate(124,-10)">
                <rect width="26" height="22" rx="11" fill="#ef3124" />
                <path d="M9 11V9.5a4 4 0 018 0V11M8 11h10v6H8z" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" transform="translate(0,0)" />
              </g>
            )}
          </g>
        ))}
        {links.map((l, k) => (
          <g key={l}>
            <path d={`M${k * 196 + 154} 66 H${k * 196 + 192}`} stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" markerEnd="url(#arr)" />
            <text x={k * 196 + 173} y="56" textAnchor="middle" fontSize="12" fill="#fff" opacity=".65">{l}</text>
          </g>
        ))}
        <text x="418" y="126" textAnchor="middle" fontSize="12.5" fill="#fff" opacity=".65">замок: здесь хранится токен GigaChat</text>
      </svg>
    </Section>
  )
}

export function Team() {
  const people = [
    ['Александр', 'Frontend, капитан', 'Лендинг и кабинет'],
    ['Илья', 'Backend', 'Авторизация, база, память, проверка ответов ИИ'],
    ['Даня', 'AI', 'GigaChat, вопросы, строгий JSON-план'],
  ]
  return (
    <Section id="team" tint>
      <h2 className={h2}>Команда XRONIX</h2>
      <ul className="mt-10 max-w-[640px] divide-y divide-white/15">
        {people.map(([n, r, d]) => (
          <li key={n} className="flex items-center gap-4 py-5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand font-display text-[18px] font-semibold" aria-hidden>{n[0]}</span>
            <div><div className="text-[20px] font-semibold leading-tight">{n}</div><div className="text-[14px] text-white/65">{r}. {d}</div></div>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-[14px] text-white/50">xronix.ru · github.com/xrnskew/XRONIX</p>
    </Section>
  )
}
