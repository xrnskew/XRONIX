import PhoneFrame from '../phone/PhoneFrame'
import Cabinet from '../phone/Cabinet'

const slide = 'flex min-h-svh flex-col justify-center px-6 py-16 sm:px-12 lg:px-16'
const h2 = 'font-display text-[clamp(28px,3.4vw,46px)] font-semibold leading-[1.1] tracking-tight max-w-[18ch]'
const lead = 'mt-6 max-w-[56ch] text-[18px] leading-relaxed text-ink/70'

const team = [
  { name: 'Александр', role: 'Frontend, капитан', note: 'Лендинг и кабинет' },
  { name: 'Илья', role: 'Backend', note: 'Авторизация, база, память, проверка ответов ИИ' },
  { name: 'Даня', role: 'AI', note: 'GigaChat, вопросы, строгий JSON-план' },
]

export default function Landing() {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(460px,42%)]">
      <aside className="flex items-center justify-center bg-brand px-4 py-10 lg:sticky lg:top-0 lg:order-2 lg:h-svh lg:py-0">
        <PhoneFrame>
          <Cabinet />
        </PhoneFrame>
      </aside>

      <main className="lg:order-1">
        <section className={slide} id="top">
          <div className="font-display text-[15px] font-semibold text-brand">XRONIX</div>
          <h1 className="mt-6 font-display text-[clamp(34px,5vw,68px)] font-semibold leading-[1.02] tracking-tight">
            Идея бизнеса. План. Кредит под него.
          </h1>
          <p className={lead}>Предприниматель пишет, что хочет открыть. ИИ уточняет детали, считает, сколько нужно денег, и показывает, потянет ли бизнес кредит.</p>
          <p className="mt-8 text-[15px] text-ink/60">Справа живой кабинет. Нажмите «Войти» и попробуйте.</p>
        </section>

        <section className={`${slide} bg-mist`} id="problem">
          <h2 className={h2}>Начинающий предприниматель не знает три вещи</h2>
          <ul className="mt-8 max-w-[56ch] space-y-5 text-[20px] leading-snug">
            <li><b>Сколько денег нужно.</b> Расходы вспоминают уже по ходу запуска.</li>
            <li><b>Какой кредит брать.</b> Сумма, срок и ставка выбираются наугад.</li>
            <li><b>Выдержит ли бизнес платёж.</b> Нагрузку считают после того, как договор подписан.</li>
          </ul>
        </section>

        <section className={slide} id="solution">
          <h2 className={h2}>Кабинет отвечает на эти вопросы в одном диалоге</h2>
          <p className={lead}>ИИ ведёт разговор как бизнес-консультант: спрашивает, пока не хватает данных, затем собирает персональный план с шагами, рисками и финансовой моделью.</p>
          <dl className="mt-10 grid max-w-[640px] gap-x-10 gap-y-6 sm:grid-cols-2">
            {[
              ['План', 'Шаги запуска со сроками и стоимостью, риски и возможности'],
              ['Финансы', 'Потребность в деньгах, прибыль, срок окупаемости'],
              ['Кредит', 'Сумма, срок, ставка, платёж и долговая нагрузка'],
              ['Профиль', 'Теги и память: ИИ помнит вас между диалогами'],
            ].map(([t, d]) => (
              <div key={t}><dt className="text-[18px] font-semibold">{t}</dt><dd className="mt-1 text-[15px] leading-snug text-ink/65">{d}</dd></div>
            ))}
          </dl>
        </section>

        <section className={`${slide} bg-mist`} id="how">
          <h2 className={h2}>Как это работает</h2>
          <ol className="mt-8 max-w-[56ch] space-y-5 text-[18px] leading-snug">
            {[
              'Вы описываете идею в чате.',
              'ИИ задаёт 3–6 уточняющих вопросов, на часть можно ответить одним нажатием.',
              'Сервер проверяет ответ ИИ по схеме и сам пересчитывает платёж по формуле аннуитета.',
              'Кабинет показывает план и кредитный расчёт. Теги и память обновляются.',
            ].map((t, i) => (
              <li key={t} className="flex gap-4"><span className="font-display text-brand">{i + 1}</span><span>{t}</span></li>
            ))}
          </ol>
        </section>

        <section className={slide} id="arch">
          <h2 className={h2}>Фронт не ходит в ИИ напрямую</h2>
          <p className={lead}>Токен GigaChat живёт только на сервере. Бэкенд собирает контекст, проверяет JSON и хранит данные. ИИ-сервис ничего не хранит.</p>
          <div className="mt-10 flex max-w-[640px] flex-wrap items-stretch gap-3 text-[15px] font-medium" aria-label="Схема: фронтенд, бэкенд, ИИ-сервис, GigaChat">
            {['Фронтенд React', 'Бэкенд: база, память, проверка', 'ИИ-сервис', 'GigaChat'].map((n, i, a) => (
              <div key={n} className="flex items-center gap-3">
                <span className="rounded-xl border border-ink/15 px-4 py-3">{n}</span>
                {i < a.length - 1 && <span aria-hidden className="text-ink/35">→</span>}
              </div>
            ))}
          </div>
        </section>

        <section className={`${slide} bg-ink text-white`} id="team">
          <h2 className={`${h2} text-white`}>Команда XRONIX</h2>
          <ul className="mt-10 max-w-[640px] divide-y divide-white/15">
            {team.map((m) => (
              <li key={m.name} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
                <span className="text-[22px] font-semibold">{m.name}</span>
                <span className="text-[15px] text-white/65">{m.role}. {m.note}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}
