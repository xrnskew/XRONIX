import { useEffect } from 'react'
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

export type Screen = 'login' | 'chat' | 'plan' | 'finance' | 'profile'

const tabs = [
  { to: '/chat', label: 'Чат', d: 'M4 5h16v11H9l-5 4z' },
  { to: '/plan', label: 'План', d: 'M5 4h14v16H5zM8 9h8M8 13h8' },
  { to: '/finance', label: 'Финансы', d: 'M4 19V9m6 10V5m6 14v-7m4 7H2' },
  { to: '/profile', label: 'Профиль', d: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6' },
]

// Презентация слева переключает экран телефона. Работает только на моках: с настоящим бэкендом презентация никого не логинит.
function Sync({ screen }: { screen?: Screen }) {
  const nav = useNavigate()
  const { signOut, demoLogin, showDemoPlan, status, userControlled } = useCabinet()
  useEffect(() => {
    if (!screen || !USE_MOCKS || userControlled) return
    let cancelled = false
    ;(async () => {
      if (screen === 'login') { if (status === 'in') signOut(); return }
      await demoLogin()
      if (cancelled) return
      if (screen === 'plan' || screen === 'finance') showDemoPlan()
      nav('/' + screen)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, userControlled])
  return null
}

function Shell() {
  const { status, needsOnboarding, userControlled } = useCabinet()
  const nav = useNavigate()
  // после своего входа всегда начинаем с чата, а не с экрана, на котором вышли
  // useNavigate меняется при каждой навигации, поэтому в зависимости его не кладём
  useEffect(() => { if (status === 'in' && userControlled) nav('/chat', { replace: true }) }, [status, userControlled]) // eslint-disable-line react-hooks/exhaustive-deps
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
      <nav className="mx-3 mb-6 grid grid-cols-4 rounded-[26px] bg-surface-2/90 p-1.5 shadow-[0_10px_30px_-10px_rgba(0,0,0,.8)] ring-1 ring-white/5 backdrop-blur" aria-label="Разделы кабинета">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `flex min-h-[50px] flex-col items-center justify-center gap-0.5 rounded-[20px] text-[11px] font-medium transition-colors ${isActive ? 'bg-accent text-white' : 'text-muted'}`}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={t.d} /></svg>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function Cabinet({ screen }: { screen?: Screen }) {
  return (
    <MemoryRouter initialEntries={['/chat']}>
      <CabinetProvider>
        <Sync screen={screen} />
        <Shell />
      </CabinetProvider>
    </MemoryRouter>
  )
}
