import type { ReactNode } from 'react'
import TypedPrompt from './TypedPrompt'
import { FadeWords, Reveal, SectionBox, SplitText, useVisible } from './reveal'
import { ALFA_DISCLAIMER, alfaProducts, productTerm } from '../data/alfaProducts'
import { mockPlan, mockProfile } from '../mocks/data'
import { decimal, plural, short } from '../lib/format'
import { useCountUp } from '../lib/useCountUp'

export const pad = 'px-6 sm:px-12 lg:px-16'
const slide = `flex min-h-[calc(100svh/var(--ui,1))] flex-col justify-center py-24 ${pad}`
const h2 = 'font-display text-[clamp(28px,3.2vw,44px)] font-semibold leading-[1.1] tracking-tight max-w-[20ch]'
const leadCls = 'mt-6 max-w-[54ch] text-[18px] leading-relaxed text-white/70'

// tint: мягкое затемнение без границ (радиальный градиент гаснет раньше краёв слайда)
const Section = ({ id, tint, children }: { id: string; tint?: boolean; children: ReactNode }) => (
  <SectionBox id={id} className={`${slide} ${tint ? 'tint' : ''}`}>{children}</SectionBox>
)

export function Hero({ onTry, onHow }: { onTry: () => void; onHow: () => void }) {
  return (
    <SectionBox id="top" className={`${slide} -mt-20`}>
      <SplitText as="h1" text="Идея бизнеса. План. Кредит под него." delay={150} step={70} className="font-display text-[clamp(36px,5.2vw,72px)] font-semibold leading-[1.02] tracking-tight" />
      <Reveal delay={700}><p className={leadCls}>Предприниматель пишет, что хочет открыть. ИИ уточняет детали, считает, сколько нужно денег, и показывает, потянет ли бизнес кредит.</p></Reveal>
      <Reveal delay={900} className="mt-10"><TypedPrompt /></Reveal>
      <Reveal delay={1050} className="mt-8 flex flex-wrap gap-3">
        <button onClick={onTry} className="h-12 rounded-full bg-fill px-7 text-[16px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(239,49,36,.9)] transition-transform hover:-translate-y-0.5 active:translate-y-0 active:bg-brand-deep">Попробовать самому</button>
        <button onClick={onHow} className="h-12 rounded-full px-6 text-[16px] font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/10">Как это работает</button>
      </Reveal>
    </SectionBox>
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
      <SplitText text="Начинающий предприниматель не знает три вещи" className={h2} />
      <dl className="mt-12 max-w-[680px] divide-y divide-white/10 border-y border-white/10">
        {rows.map(([t, d], i) => (
          <Reveal key={t} delay={450 + i * 170} className="grid gap-2 py-7 sm:grid-cols-[1fr_1.1fr] sm:gap-10">
            <dt className="font-display text-[22px] font-semibold leading-snug tracking-tight">{t}</dt>
            <dd className="text-[16px] leading-relaxed text-white/65">{d}</dd>
          </Reveal>
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
    ['Вы получаете план', 'Шаги, риски, финансовая модель и подходящий кредит. Теги профиля остаются под вашим контролем.'],
  ]
  const live = activeStep > 0
  return (
    <Section id="how">
      <SplitText text="Один диалог вместо недель расчётов" className={h2} />
      <ol className="relative mt-12 max-w-[580px]">
        <span className="absolute bottom-4 left-[15px] top-4 w-px bg-gradient-to-b from-white/0 via-white/20 to-white/0" aria-hidden />
        {steps.map(([t, d], i) => {
          const n = i + 1
          const state = !live ? 'idle' : n < activeStep ? 'done' : n === activeStep ? 'active' : 'next'
          return (
            <li key={t} aria-current={state === 'active' ? 'step' : undefined} className={`relative pb-8 transition-opacity duration-500 last:pb-0 ${state === 'next' ? 'opacity-40' : ''}`}>
              <Reveal delay={400 + i * 150} className="flex gap-5">
                <span className={`relative z-10 flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-full font-display text-[13px] font-semibold transition-all duration-500 ${state === 'next' ? 'bg-[#1b1b1e] text-white/60 ring-1 ring-white/20' : 'bg-fill text-white'} ${state === 'active' ? 'scale-110 shadow-[0_0_0_6px_rgba(239,49,36,.25)]' : ''}`}>
                  {state === 'done' ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> : n}
                </span>
                <div><div className="text-[20px] font-semibold leading-tight">{t}</div><div className="mt-1 text-[16px] leading-relaxed text-white/65">{d}</div></div>
              </Reveal>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

function Stat({ n, a, b, delay }: { n: number; a: string; b: string; delay: number }) {
  const on = useVisible()
  const v = useCountUp(n, 1100, on)
  return (
    <Reveal delay={delay}>
      <dt className="font-display text-[56px] font-semibold leading-none tabular-nums text-brand">{Math.round(v)}</dt>
      <dd className="mt-3 text-[17px] font-semibold leading-snug">{a}</dd>
      <dd className="mt-1 text-[14px] leading-snug text-white/55">{b}</dd>
    </Reveal>
  )
}

export function PlanSlide() {
  const f = mockPlan
  return (
    <Section id="plan" tint>
      <SplitText text="План, который можно выполнять" className={h2} />
      <Reveal delay={450}><p className={leadCls}>Не абстрактный совет, а последовательность действий: что сделать, за сколько дней и во сколько это обойдётся.</p></Reveal>
      <dl className="mt-12 grid max-w-[680px] gap-x-8 gap-y-8 sm:grid-cols-3">
        <Stat n={f.steps.length} a={plural(f.steps.length, ['шаг запуска', 'шага запуска', 'шагов запуска'])} b="со сроком и стоимостью" delay={600} />
        <Stat n={f.risks.length} a={plural(f.risks.length, ['риск', 'риска', 'рисков'])} b="и меры защиты от каждого" delay={750} />
        <Stat n={f.finance.revenue_forecast.length} a="месяцев" b="прогноза выручки и расходов" delay={900} />
      </dl>
    </Section>
  )
}

function Scale() {
  const on = useVisible()
  const zones = [
    { w: 35, c: 'bg-ok', t: 'до 35%', d: 'кредит подходит' },
    { w: 15, c: 'bg-warn', t: '36–50%', d: 'есть риски' },
    { w: 50, c: 'bg-accent', t: 'больше 50%', d: 'не рекомендуем' },
  ]
  return (
    <>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-white/5" role="img" aria-label="Шкала: до 35% подходит, 36–50% есть риски, больше 50% не рекомендуем">
        {zones.map((z, i) => <div key={z.t} className={z.c} style={{ width: on ? `${z.w}%` : 0, transition: on ? `width 1s cubic-bezier(.2,.75,.2,1) ${900 + i * 220}ms` : 'none' }} />)}
      </div>
      <div className="mt-3 flex text-[13px] leading-snug">
        {zones.map((z) => <div key={z.t} style={{ width: `${z.w}%` }} className="pr-2"><div className="font-semibold tabular-nums">{z.t}</div><div className="text-white/55">{z.d}</div></div>)}
      </div>
    </>
  )
}

export function Credit() {
  return (
    <Section id="credit">
      <SplitText text="Кредитные продукты XRONIX" className={h2} />
      <Reveal delay={450}><p className={leadCls}>Кабинет считает платёж и нагрузку на прибыль, а затем подбирает продукты по сумме и сроку. Условия смоделированы по публичным страницам банка, это демо.</p></Reveal>

      <div className="mt-10 max-w-[680px] overflow-x-auto" tabIndex={0} role="region" aria-label="Кредитные продукты XRONIX (демо)">
        <table className="w-full min-w-[520px] text-left text-[15px]">
          <caption className="sr-only">Кредитные продукты XRONIX для бизнеса (демо)</caption>
          <thead className="border-b border-white/15 text-[13px] text-white/55">
            <tr><th className="py-2 pr-4 font-medium">Продукт</th><th className="py-2 pr-4 font-medium">Ставка</th><th className="py-2 pr-4 font-medium">Сумма до</th><th className="py-2 font-medium">Срок</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {alfaProducts.map((p, i) => (
              <Reveal key={p.id} as="tr" delay={600 + i * 110} y={14}>
                <td className="py-3.5 pr-4 font-semibold">{p.name}</td>
                <td className="py-3.5 pr-4 tabular-nums">{p.rateFrom ? `от ${decimal(p.rateFrom)}%` : 'по запросу'}</td>
                <td className="py-3.5 pr-4 tabular-nums">{short(p.amountMax)} ₽</td>
                <td className="py-3.5 tabular-nums">{productTerm(p)}</td>
              </Reveal>
            ))}
          </tbody>
        </table>
      </div>

      <Reveal delay={1000} className="mt-10 max-w-[680px]">
        <div className="text-[15px] font-semibold">Вердикт по долговой нагрузке</div>
        <div className="mt-1 text-[14px] text-white/55">Платёж в месяц ÷ прибыль в месяц</div>
        <Scale />
      </Reveal>
      <Reveal delay={1200}><p className="mt-8 max-w-[60ch] text-[13px] leading-relaxed text-white/50">{ALFA_DISCLAIMER}</p></Reveal>
    </Section>
  )
}

export function Memory() {
  return (
    <Section id="memory" tint>
      <SplitText text="ИИ спрашивает про каждый бизнес отдельно" className={h2} />
      <Reveal delay={450}><p className={leadCls}>Город подставляется из профиля. Свои деньги и опыт ИИ уточняет в чате для каждого бизнеса: у кофейни и у автомойки они разные.</p></Reveal>
      <Reveal delay={600} className="mt-10 max-w-[600px] border-l-2 border-brand pl-6">
        <FadeWords delay={800} className="text-[19px] leading-relaxed text-white/90" text="«Самара, кофейня. Свои деньги — 900 тыс ₽, опыта в общепите нет. Добавлю в план риск и подскажу, как его снизить.»" />
        <div className="mt-3 text-[13px] text-white/50">Пример: что ИИ уточняет в чате</div>
      </Reveal>
    </Section>
  )
}

function Diagram() {
  const on = useVisible()
  const nodes = [
    { t: 'Фронтенд', s: 'React' },
    { t: 'Бэкенд', s: 'база, память, проверка' },
    { t: 'ИИ-сервис', s: 'промпты, JSON' },
    { t: 'GigaChat', s: 'модель' },
  ]
  const links = ['JWT', 'HTTP', 'API']
  const fade = (i: number) => ({ opacity: on ? 1 : 0, transition: on ? `opacity .7s ease ${500 + i * 280}ms` : 'none' })
  return (
    <svg viewBox="0 0 740 134" className="mt-12 w-full max-w-[740px]" role="img" aria-label="Схема: фронтенд, бэкенд, ИИ-сервис, GigaChat">
      <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L7 4L0 8z" fill="#fff" opacity=".6" /></marker></defs>
      {nodes.map((n, k) => (
        <g key={n.t} transform={`translate(${k * 196}, 30)`}>
          <g style={fade(k * 2)}>
            <rect width="150" height="72" rx="16" fill={k === 1 ? '#e02a1e' : 'rgba(255,255,255,.07)'} stroke={k === 1 ? '#e02a1e' : '#fff'} strokeOpacity={k === 1 ? 1 : 0.25} />
            <text x="75" y="31" textAnchor="middle" fontSize="16" fontWeight="600" fill="#fff">{n.t}</text>
            <text x="75" y="53" textAnchor="middle" fontSize="11.5" fill="#fff" opacity=".7">{n.s}</text>
            {k === 2 && (
              <g transform="translate(124,-10)">
                <rect width="26" height="22" rx="11" fill="#e02a1e" />
                <path d="M9 11V9.5a4 4 0 018 0V11M8 11h10v6H8z" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            )}
          </g>
        </g>
      ))}
      {links.map((l, k) => (
        <g key={l}>
          <path d={`M${k * 196 + 154} 66 H${k * 196 + 192}`} stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" markerEnd="url(#arr)" strokeDasharray="40" strokeDashoffset={on ? 0 : 40} style={{ transition: on ? `stroke-dashoffset .6s ease ${700 + k * 560}ms` : 'none' }} />
          <text x={k * 196 + 173} y="56" textAnchor="middle" fontSize="12" fill="#fff" style={{ ...fade(k * 2 + 1), opacity: on ? 0.65 : 0 }}>{l}</text>
        </g>
      ))}
      <text x="418" y="126" textAnchor="middle" fontSize="12.5" fill="#fff" style={{ opacity: on ? 0.65 : 0, transition: on ? 'opacity .8s ease 2s' : 'none' }}>замок: здесь хранится токен GigaChat</text>
    </svg>
  )
}

export function Arch() {
  return (
    <Section id="arch">
      <SplitText text="Фронт не ходит в ИИ напрямую" className={h2} />
      <Reveal delay={450}><p className={leadCls}>Токен GigaChat живёт только на сервере. Бэкенд собирает контекст, проверяет JSON и хранит данные. ИИ-сервис ничего не хранит.</p></Reveal>
      <Diagram />
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
      <SplitText text="Команда XRONIX" className={h2} />
      <ul className="mt-10 max-w-[640px] divide-y divide-white/15">
        {people.map(([n, r, d], i) => (
          <Reveal key={n} as="li" delay={450 + i * 160} className="flex items-center gap-4 py-5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-fill font-display text-[18px] font-semibold" aria-hidden>{n[0]}</span>
            <div><div className="text-[20px] font-semibold leading-tight">{n}</div><div className="text-[14px] text-white/65">{r}. {d}</div></div>
          </Reveal>
        ))}
      </ul>
      <Reveal delay={1000} className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-4">
        <a href="./app" className="group inline-flex h-14 items-center gap-3 rounded-full bg-fill pl-7 pr-5 text-[17px] font-semibold text-white shadow-[0_16px_40px_-14px_rgba(239,49,36,.9)] transition-colors hover:bg-brand-deep">
          Открыть рабочую версию
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-1" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </a>
        <p className="text-[14px] text-white/50">Кабинет на весь экран, без презентации</p>
      </Reveal>
      <Reveal delay={1150}><p className="mt-10 text-[14px] text-white/50">xronix.ru · github.com/xrnskew/XRONIX</p></Reveal>
    </Section>
  )
}
