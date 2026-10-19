import { useEffect, useRef } from 'react'
import { MemoryRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { CabinetProvider, useCabinet } from './CabinetContext'
import Login from './screens/Login'
import Onboarding from './screens/Onboarding'
import Chat from './screens/Chat'
import PlanScreen from './screens/Plan'
import Finance from './screens/Finance'
import ProfileScreen from './screens/Profile'
import { Logo } from './ui'
import { USE_MOCKS } from '../api'
import { reduceMotion, scrollPhone, type Scene } from './demo'

export type { Scene } from './demo'

const tabs = [
  { to: '/chat', label: 'Чат', d: 'M4 5h16v11H9l-5 4z' },
  { to: '/plan', label: 'План', d: 'M5 4h14v16H5zM8 9h8M8 13h8' },
  { to: '/finance', label: 'Финансы', d: 'M4 19V9m6 10V5m6 14v-7m4 7H2' },
  { to: '/profile', label: 'Профиль', d: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6' },
]

// Режиссёр автопоказа. Пока auto включён, сцена слайда целиком определяет, что видно на телефоне.
// Данные берутся из заготовок, бэкенд не трогается, настоящая сессия не создаётся.
// Когда auto выключается (человек коснулся телефона), режиссёр замолкает и больше ничего не переключает.
function Director({ scene, auto, onStep, onRealSession }: { scene?: Scene; auto: boolean; onStep?: (n: number) => void; onRealSession?: () => void }) {
  const nav = useNavigate()
  const cab = useCabinet()
  const ref = useRef(cab)
  ref.current = cab

  useEffect(() => {
    const c = () => ref.current
    // Настоящая сессия (сохранённый вход или человек уже вошёл) важнее автопоказа: его выключаем и ничего не трогаем.
    if (auto && (c().status === 'booting' || (c().status === 'in' && !c().demo))) { onRealSession?.(); return }
    if (!auto || !scene) {
      // С настоящим бэкендом заготовленная сессия не должна достаться пользователю: возвращаем на вход.
      if (!USE_MOCKS && c().demo) c().demoExit()
      return
    }
    const timers: number[] = []
    const later = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, Math.max(ms, 60))) }
    const step = (n: number) => onStep?.(n)

    c().stopDemo()
    if (scene !== 'chat-demo' && scene !== 'chat-final') step(0)

    switch (scene) {
      case 'login':
        c().demoExit(); nav('/chat'); break
      case 'chat-empty':
        c().demoEnter(); c().newChat(); nav('/chat'); break
      case 'chat-demo':
        c().demoEnter(); nav('/chat'); c().playDemoChat({ instant: reduceMotion(), onStep }); break
      case 'chat-final':
        c().demoEnter(); nav('/chat'); c().playDemoChat({ instant: true, onStep }); break
      case 'plan':
        c().demoEnter(); nav('/plan')
        later(100, () => scrollPhone(null, false)); later(2800, () => scrollPhone('plan-steps')); later(5600, () => scrollPhone('plan-risks'))
        break
      case 'credit':
        c().demoEnter(); nav('/finance')
        later(100, () => scrollPhone(null, false)); later(2400, () => scrollPhone('credit-calc')); later(5000, () => scrollPhone('alfa-products'))
        break
      case 'memory':
        c().demoEnter(); nav('/profile')
        later(100, () => scrollPhone(null, false)); later(2000, () => scrollPhone('profile-tags'))
        break
      case 'hold':
        break
    }
    return () => { timers.forEach(clearTimeout); ref.current.stopDemo() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, auto])
  return null
}

function Shell() {
  const { status, needsOnboarding, demo } = useCabinet()
  const nav = useNavigate()
  // После настоящего входа всегда начинаем с чата, а не с экрана, на котором вышли.
  // useNavigate меняется при каждой навигации, поэтому в зависимости его не кладём.
  useEffect(() => { if (status === 'in' && !demo) nav('/chat', { replace: true }) }, [status, demo]) // eslint-disable-line react-hooks/exhaustive-deps
  if (status === 'booting')
    return <div className="flex h-full items-center justify-center" role="status" aria-label="Загрузка"><Logo size={56} /></div>
  if (status === 'out') return <Login />
  if (needsOnboarding) return <Onboarding />
  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/chat" element={<Chat />} />
          <Route path="/plan" element={<PlanScreen />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </main>
      <nav className="mx-3 mb-6 grid grid-cols-4 rounded-[26px] bg-surface-2/90 p-1.5 shadow-[0_10px_30px_-10px_rgba(0,0,0,.8)] ring-1 ring-white/5" aria-label="Разделы кабинета">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `flex min-h-[50px] flex-col items-center justify-center gap-0.5 rounded-[20px] text-[11px] font-medium transition-colors ${isActive ? 'bg-fill text-white' : 'text-muted'}`}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={t.d} /></svg>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function Cabinet({ scene, auto = false, onDemoStep, onRealSession }: { scene?: Scene; auto?: boolean; onDemoStep?: (n: number) => void; onRealSession?: () => void }) {
  return (
    <MemoryRouter initialEntries={['/chat']}>
      <CabinetProvider>
        <Director scene={scene} auto={auto} onStep={onDemoStep} onRealSession={onRealSession} />
        <Shell />
      </CabinetProvider>
    </MemoryRouter>
  )
}
