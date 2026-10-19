import { useState } from 'react'
import PhoneFrame from '../phone/PhoneFrame'
import Phone3D from '../phone/Phone3D'
import Cabinet, { type Scene } from '../phone/Cabinet'
import ShaderBackground from './ShaderBackground'
import { useMediaQuery, useSlides } from './useSlides'
import { USE_MOCKS, setToken } from '../api'
import { Arch, Credit, Hero, How, Memory, PlanSlide, Problem, Team, pad } from './Slides'

const slides: { id: string; label: string; scene: Scene }[] = [
  { id: 'top', label: 'Главная', scene: 'login' },
  { id: 'problem', label: 'Проблема', scene: 'chat-empty' },
  { id: 'how', label: 'Как работает', scene: 'chat-demo' },
  { id: 'plan', label: 'План', scene: 'plan' },
  { id: 'credit', label: 'Кредит', scene: 'credit' },
  { id: 'memory', label: 'Память', scene: 'memory' },
  { id: 'arch', label: 'Архитектура', scene: 'chat-final' },
  { id: 'team', label: 'Команда', scene: 'hold' },
]
const ids = slides.map((s) => s.id)
// Базовый ракурс телефона на каждом слайде (градусы): чередуем наклон влево и вправо
const angles = [{ x: 2, y: -12 }, { x: 0, y: 9 }, { x: -2, y: -8 }, { x: 2, y: 10 }, { x: 0, y: -9 }, { x: -2, y: 8 }, { x: 1, y: -10 }, { x: 0, y: 0 }]
const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

export default function Landing() {
  const { current, settled } = useSlides(ids)
  const wide = useMediaQuery('(min-width: 1024px)')
  const [auto, setAuto] = useState(true)
  const [cabinetKey, setCabinetKey] = useState(0)
  const [demoStep, setDemoStep] = useState(0)

  // Автопоказ работает, пока человек не коснулся телефона. Дальше телефон принадлежит ему.
  const takeOver = () => { if (auto) setAuto(false) }
  const tryIt = () => { setAuto(false); setCabinetKey((k) => k + 1); setDemoStep(0) }
  // С настоящим бэкендом «вернуть автопоказ» выходит из аккаунта: иначе заготовка перекрыла бы чужую сессию
  const resume = () => { if (!USE_MOCKS) setToken(null); setAuto(true); setCabinetKey((k) => k + 1) }
  const live = auto && wide

  return (
    <div className="text-white lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(480px,42%)]">
      <ShaderBackground />

      <aside className="relative flex items-center justify-center px-4 py-10 lg:sticky lg:top-0 lg:order-2 lg:h-svh lg:py-0">
        <Rings />
        <div className="relative" onPointerDownCapture={takeOver} onFocusCapture={takeOver}>
          <Phone3D base={angles[settled]} enabled={wide}>
            <PhoneFrame>
              <Cabinet key={cabinetKey} scene={slides[settled].scene} auto={live} onDemoStep={setDemoStep} onRealSession={() => setAuto(false)} />
            </PhoneFrame>
          </Phone3D>
        </div>
      </aside>

      <main className="lg:order-1">
        <header className="sticky top-0 z-30 h-20">
          <div className="header-fade absolute inset-0" aria-hidden />
          <div className={`relative flex h-16 items-center gap-4 ${pad}`}>
          <div className="min-w-0 leading-tight">
            <div className="font-display text-[15px] font-semibold text-brand">XRONIX</div>
            <div className="truncate text-[12px] text-white/55" aria-live="polite">{slides[current].label}</div>
          </div>
          <nav className="mx-auto hidden items-center gap-1.5 sm:flex" aria-label="Слайды">
            {slides.map((s, k) => (
              <button key={s.id} onClick={() => goTo(s.id)} aria-label={s.label} aria-current={k === current ? 'true' : undefined} title={s.label}
                className="group flex h-8 items-center">
                <span className={`block h-1.5 rounded-full transition-all duration-300 ${k === current ? 'w-7 bg-brand' : 'w-3 bg-white/25 group-hover:bg-white/50'}`} />
              </button>
            ))}
          </nav>
          {wide && (
            <button role="switch" aria-checked={auto} onClick={auto ? () => setAuto(false) : resume}
              title={!auto && !USE_MOCKS ? 'Выйдет из вашего аккаунта на сайте' : undefined}
              className="ml-auto flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-medium ring-1 ring-white/20 transition-colors hover:bg-white/10 sm:ml-0">
              <span className={`h-2 w-2 rounded-full ${auto ? 'bg-ok' : 'bg-white/40'}`} aria-hidden />
              {auto ? 'Автопоказ идёт' : 'Вернуть автопоказ'}
            </button>
          )}
          </div>
        </header>

        <Hero onTry={tryIt} onHow={() => goTo('how')} />
        <Problem />
        <How activeStep={live && slides[current].id === 'how' ? demoStep : 0} />
        <PlanSlide />
        <Credit />
        <Memory />
        <Arch />
        <Team />
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
