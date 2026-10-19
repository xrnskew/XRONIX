import { useEffect, useState } from 'react'
import PhoneFrame from '../phone/PhoneFrame'
import Cabinet, { type Screen } from '../phone/Cabinet'
import { ALFA_DISCLAIMER, alfaProducts } from '../data/alfaProducts'
import { short } from '../lib/format'
import ShaderBackground from './ShaderBackground'

interface Slide { id: string; label: string; screen: Screen }
const slides: Slide[] = [
  { id: 'top', label: 'Главная', screen: 'login' },
  { id: 'problem', label: 'Проблема', screen: 'chat' },
  { id: 'how', label: 'Как работает', screen: 'chat' },
  { id: 'plan', label: 'План', screen: 'plan' },
  { id: 'credit', label: 'Кредит', screen: 'finance' },
  { id: 'memory', label: 'Память', screen: 'profile' },
  { id: 'arch', label: 'Архитектура', screen: 'profile' },
  { id: 'team', label: 'Команда', screen: 'profile' },
]

const pad = 'px-6 sm:px-12 lg:px-16'
const slide = `flex min-h-svh flex-col justify-center py-24 ${pad}`
const h2 = 'font-display text-[clamp(28px,3.2vw,44px)] font-semibold leading-[1.1] tracking-tight max-w-[20ch]'
const lead = 'mt-6 max-w-[54ch] text-[18px] leading-relaxed text-white/70'

function useActive() {
  const [i, setI] = useState(0)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const els = slides.map((s) => document.getElementById(s.id)!)
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setI(els.indexOf(e.target as HTMLElement))),
      { rootMargin: '-45% 0px -45% 0px' },
    )
    els.forEach((el) => io.observe(el))
    const onScroll = () => setProgress(window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight))
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [])
  return { i, progress }
}

export default function Landing() {
  const { i, progress } = useActive()
  return (
    <div className="text-white lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(480px,42%)]">
      <ShaderBackground />
      <aside className="relative flex items-center justify-center overflow-hidden px-4 py-10 lg:sticky lg:top-0 lg:order-2 lg:h-svh lg:py-0">
        <Rings />
        <div className="relative"><PhoneFrame><Cabinet screen={slides[i].screen} /></PhoneFrame></div>
      </aside>

      <main className="lg:order-1">
        <header className={`sticky top-0 z-30 flex h-16 items-center justify-between bg-black/60 backdrop-blur-md ${pad}`}>
          <span className="font-display text-[15px] font-semibold text-brand">XRONIX</span>
          <span className="text-[14px] text-white/55" aria-live="polite">{slides[i].label}</span>
          <span className="absolute inset-x-0 bottom-0 h-px bg-white/10"><span className="block h-full origin-left bg-brand" style={{ transform: `scaleX(${progress})` }} /></span>
        </header>

        <section className={`${slide} -mt-16`} id="top">
          <h1 className="font-display text-[clamp(36px,5.2vw,72px)] font-semibold leading-[1.02] tracking-tight">
            Идея бизнеса. План. Кредит под него.
          </h1>
          <p className={lead}>Предприниматель пишет, что хочет открыть. ИИ уточняет детали, считает, сколько нужно денег, и показывает, потянет ли бизнес кредит.</p>
          <p className="mt-10 flex items-center gap-3 text-[15px] text-white/60">
            <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />Справа живой кабинет: нажмите «Войти» и попробуйте. Телефон следит за презентацией.
          </p>
        </section>

        <section className={`${slide} bg-black/30`} id="problem">
          <h2 className={h2}>Начинающий предприниматель не знает три вещи</h2>
          <dl className="mt-12 max-w-[640px] divide-y divide-white/10 border-y border-white/10">
            {[
              ['Сколько денег нужно', 'Расходы вспоминают уже по ходу запуска, когда деньги на исходе.'],
              ['Какой кредит брать', 'Сумма, срок и ставка выбираются наугад, продуктов много, различия неочевидны.'],
              ['Выдержит ли бизнес платёж', 'Нагрузку считают после того, как договор уже подписан.'],
            ].map(([t, d]) => (
              <div key={t} className="grid gap-1 py-6 sm:grid-cols-[220px_1fr] sm:gap-8">
                <dt className="text-[20px] font-semibold leading-snug">{t}</dt>
                <dd className="text-[16px] leading-relaxed text-white/65">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={slide} id="how">
          <h2 className={h2}>Один диалог вместо недель расчётов</h2>
          <ol className="relative mt-12 max-w-[560px]">
            <span className="absolute bottom-3 left-[15px] top-3 w-px bg-white/15" aria-hidden />
            {[
              ['Вы описываете идею', 'Одной фразой, как другу: «хочу кофейню у метро».'],
              ['ИИ уточняет', '3–6 вопросов, на часть можно ответить одним нажатием.'],
              ['Сервер проверяет', 'Ответ ИИ сверяется со схемой, платёж пересчитывается по формуле аннуитета.'],
              ['Вы получаете план', 'Шаги, риски, финансовая модель и подходящий кредит. Теги и память обновляются.'],
            ].map(([t, d], n) => (
              <li key={t} className="relative flex gap-5 pb-8 last:pb-0">
                <span className="relative z-10 flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-full bg-brand font-display text-[13px] font-semibold text-white">{n + 1}</span>
                <div><div className="text-[20px] font-semibold leading-tight">{t}</div><div className="mt-1 text-[16px] leading-relaxed text-white/65">{d}</div></div>
              </li>
            ))}
          </ol>
        </section>

        <section className={`${slide} bg-black/30`} id="plan">
          <h2 className={h2}>План, который можно выполнять</h2>
          <p className={lead}>Каждый шаг со сроком и стоимостью, риски с мерами защиты, прогноз выручки и расходов на год.</p>
          <ul className="mt-10 flex max-w-[560px] flex-wrap gap-2.5 text-[15px]">
            {['Шаги запуска', 'Риски и меры', 'Возможности', 'Срок окупаемости', 'Прогноз на 12 месяцев'].map((t) => (
              <li key={t} className="rounded-full bg-white/[.07] px-4 py-2 font-medium ring-1 ring-white/15">{t}</li>
            ))}
          </ul>
        </section>

        <section className={slide} id="credit">
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
          <p className="mt-5 max-w-[56ch] text-[13px] leading-relaxed text-white/50">{ALFA_DISCLAIMER}</p>
        </section>

        <section className={`${slide} bg-black/30`} id="memory">
          <h2 className={h2}>ИИ помнит вас между диалогами</h2>
          <p className={lead}>Теги вроде «общепит», «новичок», «Москва» и короткая выжимка прошлых разговоров попадают в каждый запрос. Пользователь сам видит и правит эти теги в профиле.</p>
        </section>

        <section className={slide} id="arch">
          <h2 className={h2}>Фронт не ходит в ИИ напрямую</h2>
          <p className={lead}>Токен GigaChat живёт только на сервере. Бэкенд собирает контекст, проверяет JSON и хранит данные. ИИ-сервис ничего не хранит.</p>
          <Diagram />
        </section>

        <section className={`${slide}`} id="team">
          <h2 className={`${h2} text-white`}>Команда XRONIX</h2>
          <ul className="mt-10 max-w-[640px] divide-y divide-white/15">
            {[
              ['Александр', 'Frontend, капитан', 'Лендинг и кабинет'],
              ['Илья', 'Backend', 'Авторизация, база, память, проверка ответов ИИ'],
              ['Даня', 'AI', 'GigaChat, вопросы, строгий JSON-план'],
            ].map(([n, r, d]) => (
              <li key={n} className="flex items-center gap-4 py-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand font-display text-[18px] font-semibold" aria-hidden>{n[0]}</span>
                <div><div className="text-[20px] font-semibold leading-tight">{n}</div><div className="text-[14px] text-white/65">{r}. {d}</div></div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}

function Rings() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
      {[180, 280, 380, 480, 580].map((r, k) => <circle key={r} cx="300" cy="450" r={r} stroke="white" strokeOpacity={0.12 - k * 0.02} strokeWidth="1.5" />)}
    </svg>
  )
}

function Diagram() {
  const nodes = [
    { x: 0, t: 'Фронтенд', s: 'React' },
    { x: 1, t: 'Бэкенд', s: 'база, память, проверка' },
    { x: 2, t: 'ИИ-сервис', s: 'промпты, JSON' },
    { x: 3, t: 'GigaChat', s: 'модель' },
  ]
  const links = ['JWT', 'HTTP', 'API']
  return (
    <svg viewBox="0 0 720 150" className="mt-12 w-full max-w-[720px]" role="img" aria-label="Схема: фронтенд, бэкенд, ИИ-сервис, GigaChat">
      {nodes.map((n) => (
        <g key={n.t} transform={`translate(${n.x * 190}, 40)`}>
          <rect width="150" height="70" rx="16" fill={n.x === 1 ? '#ef3124' : 'rgba(255,255,255,.07)'} stroke={n.x === 1 ? '#ef3124' : '#ffffff'} strokeOpacity={n.x === 1 ? 1 : 0.25} />
          <text x="75" y="31" textAnchor="middle" fontSize="16" fontWeight="600" fill="#fff">{n.t}</text>
          <text x="75" y="52" textAnchor="middle" fontSize="11.5" fill="#fff" opacity=".7">{n.s}</text>
        </g>
      ))}
      {links.map((l, k) => (
        <g key={l}>
          <path d={`M${k * 190 + 152} 75 H${k * 190 + 188}`} stroke="#fff" strokeOpacity=".5" strokeWidth="1.5" markerEnd="url(#a)" />
          <text x={k * 190 + 170} y="30" textAnchor="middle" fontSize="10.5" fill="#fff" opacity=".6">{l}</text>
        </g>
      ))}
      <defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L7 4L0 8z" fill="#fff" opacity=".6" /></marker></defs>
    </svg>
  )
}
